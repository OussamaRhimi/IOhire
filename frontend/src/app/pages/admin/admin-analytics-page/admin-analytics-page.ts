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
import { FormsModule } from '@angular/forms';
import { Chart, ChartConfiguration, registerables } from 'chart.js';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import { Activity, BarChart3, BriefcaseBusiness, Clock3, GitCompareArrows, RefreshCw, Target, Users } from 'lucide-angular/src/icons';
import { formatDateTime } from '../../../core/format/date';
import { toErrorMessage } from '../../../core/http/http-error';
import { PortalThemeService } from '../../../core/theme/portal-theme.service';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { CandidateStatus, HrCandidate, HrJobPosting, JobPostingStatus } from '../../../core/strapi/strapi.types';
import { RevealOnScrollDirective } from '../../../shared/animations/reveal-on-scroll.directive';

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
  imports: [LucideAngularModule, RevealOnScrollDirective, FormsModule],
  templateUrl: './admin-analytics-page.html',
  styleUrl: './admin-analytics-page.css',
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

  // -- Compare job postings --
  @ViewChild('chartCmpScoreHist', { static: false }) chartCmpScoreHist?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartCmpStatus', { static: false }) chartCmpStatus?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartCmpRadar', { static: false }) chartCmpRadar?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartCmpMissing', { static: false }) chartCmpMissing?: ElementRef<HTMLCanvasElement>;
  @ViewChild('chartCmpScoreBox', { static: false }) chartCmpScoreBox?: ElementRef<HTMLCanvasElement>;

  private viewReady = false;
  private charts: Chart[] = [];
  private compareCharts: Chart[] = [];

  readonly compareJobA = signal<number | null>(null);
  readonly compareJobB = signal<number | null>(null);
  readonly compareReady = computed(() => {
    const a = this.compareJobA();
    const b = this.compareJobB();
    return a != null && b != null && a !== b;
  });

  /** Available jobs for the comparator dropdowns */
  readonly comparableJobs = computed(() => {
    return this.jobs().filter((j) => {
      const count = this.candidates().filter((c) => c.jobId === j.id).length;
      return count > 0;
    });
  });

  /** Compute comparison data for the two selected job postings */
  readonly cmpData = computed(() => {
    const a = this.compareJobA();
    const b = this.compareJobB();
    if (a == null || b == null || a === b) return null;

    const allCandidates = this.candidates();
    const candA = allCandidates.filter((c) => c.jobId === a);
    const candB = allCandidates.filter((c) => c.jobId === b);
    const jobA = this.jobs().find((j) => j.id === a);
    const jobB = this.jobs().find((j) => j.id === b);
    if (!jobA || !jobB) return null;

    const scoresFn = (cands: HrCandidate[]) =>
      cands.map((c) => c.score).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
    const avgFn = (nums: number[]) => (nums.length ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10 : 0);
    const medianFn = (nums: number[]) => {
      if (!nums.length) return 0;
      const sorted = [...nums].sort((x, y) => x - y);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
    };
    const histFn = (cands: HrCandidate[]) => {
      const h = [0, 0, 0, 0, 0];
      for (const c of cands) {
        const s = c.score;
        if (typeof s !== 'number' || !Number.isFinite(s)) continue;
        const idx = Math.min(4, Math.floor(clamp(s, 0, 100) / 20));
        h[idx]++;
      }
      return h;
    };
    const statusCountFn = (cands: HrCandidate[]) => {
      const m: Record<string, number> = {};
      for (const c of cands) inc(m, c.status ?? 'unknown');
      return m;
    };
    const missingFn = (cands: HrCandidate[]) => {
      const m: Record<string, number> = {};
      for (const c of cands) for (const f of c.missing ?? []) inc(m, f);
      return m;
    };
    const pctAbove = (cands: HrCandidate[], threshold: number) => {
      const scores = scoresFn(cands);
      if (!scores.length) return 0;
      return Math.round((scores.filter((s) => s >= threshold).length / scores.length) * 100);
    };
    const avgProcessingFn = (cands: HrCandidate[]) => {
      const ms = cands
        .filter((c) => c.status === 'processed' || c.status === 'error')
        .map((c) => safeMsBetween(c.createdAt, c.updatedAt))
        .filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
      return ms.length ? Math.round(ms.reduce((s, v) => s + v, 0) / ms.length / 60000) : 0;
    };

    const scoresA = scoresFn(candA);
    const scoresB = scoresFn(candB);

    return {
      titleA: jobA.title ?? 'Job A',
      titleB: jobB.title ?? 'Job B',
      countA: candA.length,
      countB: candB.length,
      avgA: avgFn(scoresA),
      avgB: avgFn(scoresB),
      medianA: medianFn(scoresA),
      medianB: medianFn(scoresB),
      histA: histFn(candA),
      histB: histFn(candB),
      statusA: statusCountFn(candA),
      statusB: statusCountFn(candB),
      missingA: missingFn(candA),
      missingB: missingFn(candB),
      pctAbove60A: pctAbove(candA, 60),
      pctAbove60B: pctAbove(candB, 60),
      pctAbove80A: pctAbove(candA, 80),
      pctAbove80B: pctAbove(candB, 80),
      shortlistedPctA: candA.length ? Math.round((candA.filter((c) => c.status === 'shortlisted' || c.status === 'hired').length / candA.length) * 100) : 0,
      shortlistedPctB: candB.length ? Math.round((candB.filter((c) => c.status === 'shortlisted' || c.status === 'hired').length / candB.length) * 100) : 0,
      avgProcessingA: avgProcessingFn(candA),
      avgProcessingB: avgProcessingFn(candB),
      missingAvgA: candA.length ? Math.round(candA.reduce((s, c) => s + (c.missing?.length ?? 0), 0) / candA.length * 10) / 10 : 0,
      missingAvgB: candB.length ? Math.round(candB.reduce((s, c) => s + (c.missing?.length ?? 0), 0) / candB.length * 10) / 10 : 0,
    };
  });

  formatDateTime = formatDateTime;
  readonly iconRefresh: LucideIconData = RefreshCw;
  readonly iconJobs: LucideIconData = BriefcaseBusiness;
  readonly iconCandidates: LucideIconData = Users;
  readonly iconActivity: LucideIconData = Activity;
  readonly iconTarget: LucideIconData = Target;
  readonly iconClock: LucideIconData = Clock3;
  readonly iconChart: LucideIconData = BarChart3;
  readonly iconCompare: LucideIconData = GitCompareArrows;

  constructor() {
    effect(() => {
      // Re-render on theme change
      this.theme.theme();
      this.renderCharts();
    });
    effect(() => {
      // Re-render comparison charts when selection or theme changes
      this.theme.theme();
      this.cmpData();
      window.setTimeout(() => this.renderCompareCharts(), 0);
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
    for (const c of this.compareCharts) c.destroy();
    this.compareCharts = [];
  }

  onCompareJobChange(slot: 'A' | 'B', value: string) {
    const id = value ? Number(value) : null;
    if (slot === 'A') this.compareJobA.set(id);
    else this.compareJobB.set(id);
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

  /* ------------------------------------------------------------------ */
  /*  Compare charts                                                     */
  /* ------------------------------------------------------------------ */
  private destroyCompareCharts() {
    for (const c of this.compareCharts) c.destroy();
    this.compareCharts = [];
  }

  private renderCompareCharts() {
    if (!this.viewReady) return;
    const data = this.cmpData();
    if (!data) { this.destroyCompareCharts(); return; }

    const el = (r?: ElementRef<HTMLCanvasElement>) => r?.nativeElement ?? null;
    if (!el(this.chartCmpScoreHist) || !el(this.chartCmpStatus) || !el(this.chartCmpRadar) || !el(this.chartCmpMissing) || !el(this.chartCmpScoreBox)) return;

    const colors = themeVars();
    const gridColor = colors.border;
    const tickColor = colors.muted;
    const colorA = 'rgba(59,130,246,0.7)';   // blue
    const colorABg = 'rgba(59,130,246,0.18)';
    const colorB = 'rgba(220,38,38,0.7)';     // red
    const colorBBg = 'rgba(220,38,38,0.18)';

    const commonOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: colors.muted } as any },
        tooltip: { enabled: true } as any,
      },
    } as const;

    // 1) Overlaid score histogram
    const histLabels = ['0–19', '20–39', '40–59', '60–79', '80–100'];
    const scoreHistConfig: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: histLabels,
        datasets: [
          { label: data.titleA, data: data.histA, backgroundColor: colorA, borderColor: colorA, borderWidth: 1 },
          { label: data.titleB, data: data.histB, backgroundColor: colorB, borderColor: colorB, borderWidth: 1 },
        ],
      },
      options: {
        ...commonOptions,
        scales: {
          x: { ticks: { color: tickColor } as any, grid: { color: gridColor } as any },
          y: { ticks: { color: tickColor, precision: 0 } as any, grid: { color: gridColor } as any },
        },
      },
    };

    // 2) Status breakdown side-by-side
    const allStatuses = Array.from(new Set([
      ...Object.keys(data.statusA),
      ...Object.keys(data.statusB),
    ])).sort();
    const statusConfig: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: allStatuses,
        datasets: [
          { label: data.titleA, data: allStatuses.map((s) => data.statusA[s] ?? 0), backgroundColor: colorA, borderColor: colorA, borderWidth: 1 },
          { label: data.titleB, data: allStatuses.map((s) => data.statusB[s] ?? 0), backgroundColor: colorB, borderColor: colorB, borderWidth: 1 },
        ],
      },
      options: {
        ...commonOptions,
        scales: {
          x: { ticks: { color: tickColor } as any, grid: { color: gridColor } as any },
          y: { ticks: { color: tickColor, precision: 0 } as any, grid: { color: gridColor } as any },
        },
      },
    };

    // 3) Radar: quality dimensions
    const radarConfig: ChartConfiguration<'radar'> = {
      type: 'radar',
      data: {
        labels: ['Avg Score', 'Median Score', '% ≥ 60', '% ≥ 80', 'Shortlisted %', 'Completeness'],
        datasets: [
          {
            label: data.titleA,
            data: [
              data.avgA,
              data.medianA,
              data.pctAbove60A,
              data.pctAbove80A,
              data.shortlistedPctA,
              Math.max(0, 100 - data.missingAvgA * 10), // completeness inverse of missing
            ],
            borderColor: colorA,
            backgroundColor: colorABg,
            pointBackgroundColor: colorA,
          },
          {
            label: data.titleB,
            data: [
              data.avgB,
              data.medianB,
              data.pctAbove60B,
              data.pctAbove80B,
              data.shortlistedPctB,
              Math.max(0, 100 - data.missingAvgB * 10),
            ],
            borderColor: colorB,
            backgroundColor: colorBBg,
            pointBackgroundColor: colorB,
          },
        ],
      },
      options: {
        ...commonOptions,
        scales: {
          r: {
            beginAtZero: true,
            max: 100,
            ticks: { color: tickColor, backdropColor: 'transparent' } as any,
            grid: { color: gridColor } as any,
            angleLines: { color: gridColor } as any,
            pointLabels: { color: colors.text, font: { size: 11 } } as any,
          },
        },
      },
    };

    // 4) Missing fields comparison (top 8 from both)
    const allMissing: Record<string, { a: number; b: number }> = {};
    for (const [k, v] of Object.entries(data.missingA)) {
      if (!allMissing[k]) allMissing[k] = { a: 0, b: 0 };
      allMissing[k].a = v;
    }
    for (const [k, v] of Object.entries(data.missingB)) {
      if (!allMissing[k]) allMissing[k] = { a: 0, b: 0 };
      allMissing[k].b = v;
    }
    const topMissingKeys = Object.entries(allMissing)
      .sort((x, y) => (y[1].a + y[1].b) - (x[1].a + x[1].b))
      .slice(0, 8)
      .map(([k]) => k);

    const missingConfig: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: topMissingKeys,
        datasets: [
          { label: data.titleA, data: topMissingKeys.map((k) => allMissing[k]?.a ?? 0), backgroundColor: colorA, borderColor: colorA, borderWidth: 1 },
          { label: data.titleB, data: topMissingKeys.map((k) => allMissing[k]?.b ?? 0), backgroundColor: colorB, borderColor: colorB, borderWidth: 1 },
        ],
      },
      options: {
        ...commonOptions,
        indexAxis: 'y' as const,
        scales: {
          x: { ticks: { color: tickColor, precision: 0 } as any, grid: { color: gridColor } as any },
          y: { ticks: { color: tickColor } as any, grid: { color: gridColor } as any },
        },
      },
    };

    // 5) Average score bar comparison (simple grouped bar)
    const scoreBoxConfig: ChartConfiguration<'bar'> = {
      type: 'bar',
      data: {
        labels: ['Avg Score', 'Median Score', '% Score ≥ 60', '% Score ≥ 80'],
        datasets: [
          { label: data.titleA, data: [data.avgA, data.medianA, data.pctAbove60A, data.pctAbove80A], backgroundColor: colorA, borderColor: colorA, borderWidth: 1 },
          { label: data.titleB, data: [data.avgB, data.medianB, data.pctAbove60B, data.pctAbove80B], backgroundColor: colorB, borderColor: colorB, borderWidth: 1 },
        ],
      },
      options: {
        ...commonOptions,
        scales: {
          x: { ticks: { color: tickColor } as any, grid: { color: gridColor } as any },
          y: { ticks: { color: tickColor, precision: 0 } as any, grid: { color: gridColor } as any, beginAtZero: true },
        },
      },
    };

    this.destroyCompareCharts();
    this.compareCharts.push(
      new Chart(this.chartCmpScoreHist!.nativeElement, scoreHistConfig),
      new Chart(this.chartCmpStatus!.nativeElement, statusConfig),
      new Chart(this.chartCmpRadar!.nativeElement, radarConfig),
      new Chart(this.chartCmpMissing!.nativeElement, missingConfig),
      new Chart(this.chartCmpScoreBox!.nativeElement, scoreBoxConfig)
    );
  }
}
