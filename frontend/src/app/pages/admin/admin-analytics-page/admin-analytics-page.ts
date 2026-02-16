import {
  AfterViewInit,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { formatDateTime } from '../../../core/format/date';
import { toErrorMessage } from '../../../core/http/http-error';
import { PortalThemeService } from '../../../core/theme/portal-theme.service';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { CandidateStatus, HrCandidate, HrJobPosting, JobPostingStatus } from '../../../core/strapi/strapi.types';

Chart.register(...registerables);

type DayKey = string; // YYYY-MM-DD

function dayKey(iso: string | null): DayKey | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function safeMsBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (!Number.isFinite(da) || !Number.isFinite(db)) return null;
  const ms = db - da;
  return ms >= 0 ? ms : null;
}

function topEntries(counts: Record<string, number>, limit: number) {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
}

function inc(counts: Record<string, number>, key: string, n = 1) {
  counts[key] = (counts[key] ?? 0) + n;
}

function themeVars() {
  const css = getComputedStyle(document.documentElement);
  const get = (name: string) => css.getPropertyValue(name).trim();
  return {
    text: get('--text') || '#111827',
    muted: get('--muted') || '#6b7280',
    border: get('--border') || '#e5e7eb',
    panel2: get('--panel-2') || '#f3f4f6',
    accent: get('--accent') || '#dc2626',
    ok: get('--ok') || '#16a34a',
    danger: get('--danger') || '#dc2626',
  };
}

@Component({
  selector: 'app-admin-analytics-page',
  templateUrl: './admin-analytics-page.html',
})
export class AdminAnalyticsPage implements AfterViewInit, OnDestroy {
  private readonly api = inject(StrapiApi);
  readonly theme = inject(PortalThemeService);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly jobs = signal<HrJobPosting[]>([]);
  readonly candidates = signal<HrCandidate[]>([]);
  readonly jobStatuses = signal<JobPostingStatus[]>([]);
  readonly candidateStatuses = signal<CandidateStatus[]>([]);
  readonly lastRefreshedAt = signal<string | null>(null);

  readonly kpi = computed(() => {
    const jobs = this.jobs();
    const candidates = this.candidates();

    const openJobs = jobs.filter((j) => j.status === 'open').length;
    const totalJobs = jobs.length;
    const totalCandidates = candidates.length;

    const processed = candidates.filter((c) => c.status === 'processed').length;
    const processing = candidates.filter((c) => c.status === 'processing').length;
    const error = candidates.filter((c) => c.status === 'error').length;

    const scores = candidates.map((c) => c.score).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    const avgScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;

    const processedMs = candidates
      .filter((c) => c.status === 'processed' || c.status === 'error')
      .map((c) => safeMsBetween(c.createdAt, c.updatedAt))
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    const avgMs = processedMs.length ? Math.round(processedMs.reduce((a, b) => a + b, 0) / processedMs.length) : null;

    return {
      totalJobs,
      openJobs,
      totalCandidates,
      processed,
      processing,
      error,
      avgScore,
      avgProcessingMinutes: avgMs != null ? Math.max(0, Math.round(avgMs / 60000)) : null,
    };
  });

  @ViewChild('chartCandidatesByDay', { static: false }) chartCandidatesByDay?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartCandidatesByStatus', { static: false }) chartCandidatesByStatus?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartJobsByStatus', { static: false }) chartJobsByStatus?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartScoreHistogram', { static: false }) chartScoreHistogram?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartCandidatesByJob', { static: false }) chartCandidatesByJob?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartMissingFields', { static: false }) chartMissingFields?: ElementRef<HTMLCanvasElement>;

  private viewReady = false;
  private charts: Chart[] = [];

  formatDateTime = formatDateTime;

  constructor() {
    effect(() => {
      // Re-render on theme change
      this.theme.theme();
      this.renderCharts();
    });
  }

  async ngOnInit() {
    await this.refresh();
  }

  ngAfterViewInit() {
    this.viewReady = true;
    this.renderCharts();
  }

  ngOnDestroy() {
    for (const c of this.charts) c.destroy();
    this.charts = [];
  }

  async refresh() {
    try {
      this.loading.set(true);
      this.error.set(null);

      const meta = await this.api.getMeta();
      this.jobStatuses.set(meta.jobPostingStatuses);
      this.candidateStatuses.set(meta.candidateStatuses);

      const [jobs, candidates] = await Promise.all([this.api.listHrJobPostings(), this.api.listHrCandidates()]);
      this.jobs.set(jobs);
      this.candidates.set(candidates);
      this.lastRefreshedAt.set(new Date().toISOString());
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
      // Canvases are inside `@if (!loading())`, so render charts on the next tick
      // after the view has updated.
      window.setTimeout(() => this.renderCharts(), 0);
    }
  }

  private destroyCharts() {
    for (const c of this.charts) c.destroy();
    this.charts = [];
  }

  private renderCharts() {
    if (!this.viewReady) return;
    const el = (r?: ElementRef<HTMLCanvasElement>) => r?.nativeElement ?? null;
    if (
      !el(this.chartCandidatesByDay) ||
      !el(this.chartCandidatesByStatus) ||
      !el(this.chartJobsByStatus) ||
      !el(this.chartScoreHistogram) ||
      !el(this.chartCandidatesByJob) ||
      !el(this.chartMissingFields)
    ) {
      return;
    }

    const colors = themeVars();

    const candidates = this.candidates();
    const jobs = this.jobs();

    // Line: submissions per day (last 14 days)
    const daysBack = 14;
    const now = new Date();
    const dayLabels: string[] = [];
    const dayCounts: number[] = [];
    const countsByDay: Record<string, number> = {};

    for (const c of candidates) {
      const key = dayKey(c.createdAt);
      if (key) inc(countsByDay, key);
    }

    for (let i = daysBack - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const key = `${y}-${m}-${day}`;
      dayLabels.push(`${m}/${day}`);
      dayCounts.push(countsByDay[key] ?? 0);
    }

    // Doughnut: candidates by status
    const statusOrder =
      this.candidateStatuses().length > 0
        ? this.candidateStatuses()
        : (['new', 'processing', 'processed', 'reviewing', 'shortlisted', 'rejected', 'hired', 'error'] as CandidateStatus[]);
    const candCounts: Record<string, number> = {};
    for (const c of candidates) inc(candCounts, c.status ?? 'unknown');
    const candStatusLabels = statusOrder.filter((s) => (candCounts[s] ?? 0) > 0);
    const candStatusData = candStatusLabels.map((s) => candCounts[s] ?? 0);

    // Pie: jobs by status
    const jobOrder =
      this.jobStatuses().length > 0 ? this.jobStatuses() : (['draft', 'open', 'closed'] as JobPostingStatus[]);
    const jobCounts: Record<string, number> = {};
    for (const j of jobs) inc(jobCounts, j.status ?? 'unknown');
    const jobStatusLabels = jobOrder.filter((s) => (jobCounts[s] ?? 0) > 0);
    const jobStatusData = jobStatusLabels.map((s) => jobCounts[s] ?? 0);

    // Bar: score histogram
    const bins = [0, 20, 40, 60, 80, 100];
    const histLabels = ['0–19', '20–39', '40–59', '60–79', '80–100'];
    const histCounts = [0, 0, 0, 0, 0];
    for (const c of candidates) {
      const s = c.score;
      if (typeof s !== 'number' || !Number.isFinite(s)) continue;
      const score = clamp(s, 0, 100);
      const idx = Math.min(histCounts.length - 1, Math.floor(score / 20));
      histCounts[idx] += 1;
    }

    // Horizontal bar: candidates per job (top 8)
    const byJob: Record<string, number> = {};
    for (const c of candidates) inc(byJob, c.jobTitle || 'Unknown');
    const topJobs = topEntries(byJob, 8);
    const topJobLabels = topJobs.map(([k]) => k);
    const topJobData = topJobs.map(([, v]) => v);

    // Horizontal bar: top missing fields (top 10)
    const missingCounts: Record<string, number> = {};
    for (const c of candidates) {
      for (const m of c.missing ?? []) inc(missingCounts, m);
    }
    const topMissing = topEntries(missingCounts, 10);
    const missingLabels = topMissing.map(([k]) => k);
    const missingData = topMissing.map(([, v]) => v);

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: colors.muted } as any },
        tooltip: { enabled: true } as any,
      },
    } as const;

    const gridColor = colors.border;
    const tickColor = colors.muted;

    const lineConfig: ChartConfiguration<'line'> = {
      type: 'line',
      data: {
        labels: dayLabels,
        datasets: [
          {
            label: 'Candidates',
            data: dayCounts,
            borderColor: colors.accent,
            backgroundColor: 'rgba(220,38,38,0.12)',
            pointRadius: 3,
            pointHoverRadius: 5,
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        ...commonOptions,
        plugins: { ...commonOptions.plugins, legend: { display: false } as any },
        scales: {
          x: { ticks: { color: tickColor } as any, grid: { color: gridColor } as any },
          y: { ticks: { color: tickColor, precision: 0 } as any, grid: { color: gridColor } as any },
        },
      },
    };

    const candidatesByStatusConfig: ChartConfiguration<'doughnut'> = {
      type: 'doughnut',
      data: {
        labels: candStatusLabels,
        datasets: [
          {
            label: 'Candidates',
            data: candStatusData,
            backgroundColor: [
              'rgba(220,38,38,0.28)',
              'rgba(245,158,11,0.28)',
              'rgba(22,163,74,0.28)',
              'rgba(59,130,246,0.22)',
              'rgba(124,58,237,0.20)',
              'rgba(107,114,128,0.24)',
              'rgba(14,165,233,0.20)',
              'rgba(220,38,38,0.14)',
            ],
            borderColor: colors.border,
            borderWidth: 1,
          },
        ],
      },
      options: {
        ...commonOptions,
        cutout: '60%' as any,
        plugins: { ...commonOptions.plugins, legend: { position: 'bottom' } as any },
      },
    };

    const jobsByStatusConfig: ChartConfiguration<'pie'> = {
      type: 'pie',
      data: {
        labels: jobStatusLabels,
        datasets: [
          {
            label: 'Job postings',
            data: jobStatusData,
            backgroundColor: ['rgba(107,114,128,0.25)', 'rgba(220,38,38,0.22)', 'rgba(17,24,39,0.15)'],
            borderColor: colors.border,
            borderWidth: 1,
          },
        ],
      },
      options: {
        ...commonOptions,
        plugins: { ...commonOptions.plugins, legend: { position: 'bottom' } as any },
      },
    };

    const histogramConfig: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: histLabels,
        datasets: [
          {
            label: 'Candidates',
            data: histCounts,
            borderColor: colors.accent,
            backgroundColor: 'rgba(220,38,38,0.20)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        ...commonOptions,
        plugins: { ...commonOptions.plugins, legend: { display: false } as any },
        scales: {
          x: { ticks: { color: tickColor } as any, grid: { color: gridColor } as any },
          y: { ticks: { color: tickColor, precision: 0 } as any, grid: { color: gridColor } as any },
        },
      },
    };

    const byJobConfig: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: topJobLabels,
        datasets: [
          {
            label: 'Candidates',
            data: topJobData,
            borderColor: colors.ok,
            backgroundColor: 'rgba(22,163,74,0.20)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        ...commonOptions,
        indexAxis: 'y' as const,
        plugins: { ...commonOptions.plugins, legend: { display: false } as any },
        scales: {
          x: { ticks: { color: tickColor, precision: 0 } as any, grid: { color: gridColor } as any },
          y: { ticks: { color: tickColor } as any, grid: { color: gridColor } as any },
        },
      },
    };

    const missingConfig: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: missingLabels,
        datasets: [
          {
            label: 'Missing',
            data: missingData,
            borderColor: colors.danger,
            backgroundColor: 'rgba(220,38,38,0.20)',
            borderWidth: 1,
          },
        ],
      },
      options: {
        ...commonOptions,
        indexAxis: 'y' as const,
        plugins: { ...commonOptions.plugins, legend: { display: false } as any },
        scales: {
          x: { ticks: { color: tickColor, precision: 0 } as any, grid: { color: gridColor } as any },
          y: { ticks: { color: tickColor } as any, grid: { color: gridColor } as any },
        },
      },
    };

    this.destroyCharts();
    this.charts.push(
      new Chart(this.chartCandidatesByDay!.nativeElement, lineConfig),
      new Chart(this.chartCandidatesByStatus!.nativeElement, candidatesByStatusConfig),
      new Chart(this.chartJobsByStatus!.nativeElement, jobsByStatusConfig),
      new Chart(this.chartScoreHistogram!.nativeElement, histogramConfig),
      new Chart(this.chartCandidatesByJob!.nativeElement, byJobConfig),
      new Chart(this.chartMissingFields!.nativeElement, missingConfig)
    );
  }
}
