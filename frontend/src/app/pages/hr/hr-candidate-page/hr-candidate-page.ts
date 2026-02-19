import { Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { formatDateTime } from '../../../core/format/date';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { getHrDefaultCvTemplateKey } from '../../../core/strapi/cv-template.storage';
import { CvTemplateMeta, HrCandidateDetail } from '../../../core/strapi/strapi.types';

type TabKey = 'overview' | 'skills' | 'experience' | 'pdf';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v : '')).filter(Boolean);
}

function normalizeSkill(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-') // hyphen variants
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqStrings(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of items) {
    const v = s.trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function parseDateLoose(input: unknown): Date | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  const lowered = raw.toLowerCase();
  if (['present', 'current', 'now', 'today', 'en cours', 'actuellement'].includes(lowered)) return new Date();

  // Year only: "2024"
  const yearOnly = /^(\d{4})$/.exec(raw);
  if (yearOnly) {
    const y = Number(yearOnly[1]);
    if (y >= 1900 && y <= 2100) return new Date(Date.UTC(y, 0, 1));
  }

  // YYYY-MM: "2024-07"
  const ym = /^(\d{4})[\/-](\d{1,2})$/.exec(raw);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12) return new Date(Date.UTC(y, m - 1, 1));
  }

  // MM/YYYY or MM-YYYY: "07/2024"
  const my = /^(\d{1,2})[\/-](\d{4})$/.exec(raw);
  if (my) {
    const m = Number(my[1]);
    const y = Number(my[2]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12) return new Date(Date.UTC(y, m - 1, 1));
  }

  // "Month YYYY" or "Mon YYYY" or "Month. YYYY": "June 2025", "Jun 2025", "Sept. 2024"
  const monthNames: Record<string, number> = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
    may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
    september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
    december: 11, dec: 11,
    // French
    janvier: 0, fevrier: 1, février: 1, mars: 2, avril: 3, mai: 4, juin: 5,
    juillet: 6, aout: 7, août: 7, septembre: 8, octobre: 9, novembre: 10, decembre: 11, décembre: 11,
  };
  const monthYearMatch = /^([a-zA-ZÀ-ÿ]+)\.?\s+(\d{4})$/i.exec(raw);
  if (monthYearMatch) {
    const monthKey = monthYearMatch[1].toLowerCase();
    const year = Number(monthYearMatch[2]);
    if (monthKey in monthNames && year >= 1900 && year <= 2100) {
      return new Date(Date.UTC(year, monthNames[monthKey], 1));
    }
  }

  // "YYYY Month": "2024 July"
  const yearMonthMatch = /^(\d{4})\s+([a-zA-ZÀ-ÿ]+)\.?$/i.exec(raw);
  if (yearMonthMatch) {
    const year = Number(yearMonthMatch[1]);
    const monthKey = yearMonthMatch[2].toLowerCase();
    if (monthKey in monthNames && year >= 1900 && year <= 2100) {
      return new Date(Date.UTC(year, monthNames[monthKey], 1));
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY: "15/07/2024"
  const dmy = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(raw);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, m - 1, d));
    }
  }

  // Fallback to native parser
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

function diffDays(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function formatDuration(daysTotal: number): string {
  let days = Math.max(0, Math.floor(daysTotal));
  const years = Math.floor(days / 365);
  days -= years * 365;
  const months = Math.floor(days / 30);
  days -= months * 30;

  const parts: string[] = [];
  if (years) parts.push(`${years}y`);
  if (months) parts.push(`${months}m`);
  if (days || parts.length === 0) parts.push(`${days}d`);
  return parts.join(' ');
}

function formatBytes(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

@Component({
  selector: 'app-hr-candidate-page',
  templateUrl: './hr-candidate-page.html',
})
export class HrCandidatePage {
  private readonly api = inject(StrapiApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly candidate = signal<HrCandidateDetail | null>(null);
  readonly tab = signal<TabKey>('overview');
  readonly templates = signal<CvTemplateMeta[]>([]);
  readonly selectedTemplateKey = signal<string>(getHrDefaultCvTemplateKey() ?? 'standard');

  readonly id = computed(() => {
    const raw = this.route.snapshot.paramMap.get('id') ?? '';
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  });

  readonly missing = computed(() => {
    const extracted: any = this.candidate()?.extractedData ?? null;
    const evaluation = extracted?.evaluation ?? null;
    const missing = evaluation?.missingFields ?? evaluation?.missing ?? [];
    return toStringArray(missing);
  });

  readonly parsedJson = computed(() => {
    const extracted = this.candidate()?.extractedData ?? null;
    return extracted ? JSON.stringify(extracted, null, 2) : null;
  });

  readonly standardizedMarkdown = computed(() => this.candidate()?.standardizedCvMarkdown ?? null);
  readonly extracted = computed<any>(() => this.candidate()?.extractedData ?? null);

  readonly summaryText = computed(() => {
    const summary = this.extracted()?.summary;
    if (typeof summary === 'string' && summary.trim()) return summary.trim();
    if (Array.isArray(summary)) {
      const joined = summary.filter((v) => typeof v === 'string').join(' ').trim();
      if (joined) return joined;
    }
    return 'No professional summary extracted yet.';
  });

  readonly contactInfo = computed(() => {
    const extracted = this.extracted();
    const contact = extracted?.contact ?? {};
    return {
      fullName: this.candidate()?.fullName || contact?.fullName || '-',
      email: this.candidate()?.email || contact?.email || '-',
      phone: typeof contact?.phone === 'string' && contact.phone.trim() ? contact.phone.trim() : '-',
      location: typeof contact?.location === 'string' && contact.location.trim() ? contact.location.trim() : '-',
      links: toStringArray(contact?.links),
    };
  });

  readonly extractedSkills = computed(() => {
    const extracted: any = this.candidate()?.extractedData ?? null;
    const skills = toStringArray(extracted?.skills ?? []);
    return uniqStrings(skills);
  });

  readonly requiredSkills = computed(() => {
    const skills = this.candidate()?.jobPosting?.requirements?.skillsRequired ?? [];
    return uniqStrings(Array.isArray(skills) ? skills.filter((v) => typeof v === 'string') : []);
  });

  readonly niceToHaveSkills = computed(() => {
    const skills = this.candidate()?.jobPosting?.requirements?.skillsNiceToHave ?? [];
    return uniqStrings(Array.isArray(skills) ? skills.filter((v) => typeof v === 'string') : []);
  });

  readonly skillMatch = computed(() => {
    const extracted = this.extractedSkills().map((s) => ({ raw: s, norm: normalizeSkill(s) })).filter((s) => s.norm);
    const extractedSet = new Set(extracted.map((s) => s.norm));

    const matchesRequirement = (req: string) => {
      const n = normalizeSkill(req);
      if (!n) return false;
      if (extractedSet.has(n)) return true;
      for (const e of extracted) {
        if (e.norm.includes(n) || n.includes(e.norm)) return true;
      }
      return false;
    };

    const required = this.requiredSkills().map((s) => ({ skill: s, matched: matchesRequirement(s) }));
    const nice = this.niceToHaveSkills().map((s) => ({ skill: s, matched: matchesRequirement(s) }));

    const requiredMatched = required.filter((r) => r.matched).length;
    const niceMatched = nice.filter((r) => r.matched).length;

    return {
      required,
      nice,
      requiredMatched,
      requiredTotal: required.length,
      niceMatched,
      niceTotal: nice.length,
    };
  });

  readonly experienceTimeline = computed(() => {
    const extracted: any = this.candidate()?.extractedData ?? null;
    const experience = Array.isArray(extracted?.experience) ? extracted.experience : [];

    const roles = experience
      .map((e: any) => {
        const company = typeof e?.company === 'string' ? e.company.trim() : '';
        const title = typeof e?.title === 'string' ? e.title.trim() : '';
        const startRaw = typeof e?.startDate === 'string' ? e.startDate.trim() : '';
        const endRaw = typeof e?.endDate === 'string' ? e.endDate.trim() : '';
        const start = parseDateLoose(startRaw);
        const end = parseDateLoose(endRaw);
        const days = start && end ? diffDays(start, end) : null;

        // Build a human-readable date range string
        let dateRange: string | null = null;
        if (startRaw && endRaw) {
          dateRange = `${startRaw} – ${endRaw}`;
        } else if (startRaw) {
          dateRange = `${startRaw} – Present`;
        } else if (endRaw) {
          dateRange = endRaw;
        }

        return {
          company: company || null,
          title: title || null,
          startRaw: startRaw || null,
          endRaw: endRaw || null,
          dateRange,
          days,
          duration: typeof days === 'number' ? formatDuration(days) : null,
        };
      })
      .filter((r: any) => r.company || r.title || r.startRaw || r.endRaw);

    const totalDays = roles.reduce((sum: number, r: any) => sum + (typeof r.days === 'number' ? r.days : 0), 0);
    return {
      roles,
      totalDays,
      totalLabel: formatDuration(totalDays),
    };
  });

  readonly educationItems = computed(() => {
    const extracted: any = this.extracted();
    const education = Array.isArray(extracted?.education) ? extracted.education : [];
    return education
      .map((e: any) => {
        const degree = typeof e?.degree === 'string' ? e.degree.trim() : '';
        const school = typeof e?.school === 'string' ? e.school.trim() : '';
        const startDate = typeof e?.startDate === 'string' ? e.startDate.trim() : '';
        const endDate = typeof e?.endDate === 'string' ? e.endDate.trim() : '';
        let period = '-';
        if (startDate && endDate) period = `${startDate} \u2013 ${endDate}`;
        else if (startDate) period = `${startDate} \u2013 Present`;
        else if (endDate) period = endDate;
        return {
          degree: degree || 'Education',
          school: school || '-',
          period,
        };
      })
      .filter((e: any) => e.degree || e.school || e.period);
  });

  readonly presentInfo = computed(() => {
    const contact = this.contactInfo();
    return [
      { label: 'Personal Info', present: contact.fullName !== '-' || contact.email !== '-' },
      { label: 'Work Experience', present: this.experienceTimeline().roles.length > 0 },
      { label: 'Education', present: this.educationItems().length > 0 },
      { label: 'Skills', present: this.extractedSkills().length > 0 },
      { label: 'Contact Details', present: contact.phone !== '-' || contact.location !== '-' || contact.links.length > 0 },
    ];
  });

  readonly missingInfo = computed(() => this.missing().map((m) => ({ label: m })));

  /** Score explanation breakdown from the deterministic evaluation */
  readonly scoreExplanation = computed(() => {
    const evaluation: any = this.extracted()?.evaluation ?? null;
    if (!evaluation || typeof evaluation.score !== 'number') return null;

    const score = Math.round((evaluation.score ?? 0) * 10) / 10;
    const fitScore = Math.round((evaluation.fitScore ?? 0) * 10) / 10;
    const completenessScore = Math.round((evaluation.completenessScore ?? 0) * 10) / 10;
    const matchedSkills = toStringArray(evaluation.matchedSkills);
    const missingSkills = toStringArray(evaluation.missingSkills);
    const matchedNiceToHave = toStringArray(evaluation.matchedNiceToHave);
    const missingNiceToHave = toStringArray(evaluation.missingNiceToHave);
    const experienceYears = typeof evaluation.experienceYears === 'number' ? evaluation.experienceYears : null;
    const notes = typeof evaluation.notes === 'string' && evaluation.notes.trim() ? evaluation.notes.trim() : null;

    const minYears = this.candidate()?.jobPosting?.requirements?.minYearsExperience ?? null;
    const experienceMet = minYears != null && experienceYears != null ? experienceYears >= minYears : null;

    // Determine a qualitative label
    let qualityLabel = 'Poor';
    let qualityClass = 'poor';
    if (score >= 80) { qualityLabel = 'Excellent'; qualityClass = 'excellent'; }
    else if (score >= 60) { qualityLabel = 'Good'; qualityClass = 'good'; }
    else if (score >= 40) { qualityLabel = 'Fair'; qualityClass = 'fair'; }

    return {
      score,
      fitScore,
      completenessScore,
      matchedSkills,
      missingSkills,
      matchedNiceToHave,
      missingNiceToHave,
      experienceYears,
      minYears,
      experienceMet,
      notes,
      qualityLabel,
      qualityClass,
    };
  });

  readonly minYearsText = computed(() => {
    const years = this.candidate()?.jobPosting?.requirements?.minYearsExperience;
    return typeof years === 'number' ? String(years) : '—';
  });

  readonly requiredSkillsText = computed(() => {
    const skills = this.candidate()?.jobPosting?.requirements?.skillsRequired ?? [];
    return skills.length ? skills.join(', ') : '—';
  });

  readonly niceToHaveSkillsText = computed(() => {
    const skills = this.candidate()?.jobPosting?.requirements?.skillsNiceToHave ?? [];
    return skills.length ? skills.join(', ') : '—';
  });

  readonly standardizedPdfUrl = computed((): SafeResourceUrl | null => {
    const id = this.id();
    if (!id) return null;
    const templateKey = this.selectedTemplateKey();
    const query = templateKey ? `?templateKey=${encodeURIComponent(templateKey)}` : '';
    return this.sanitizer.bypassSecurityTrustResourceUrl(`/api/hr/candidates/${id}/standardized-cv.pdf${query}`);
  });

  readonly canReprocess = computed(() => {
    const c = this.candidate();
    if (!c) return false;
    if (this.saving()) return false;
    return c.status !== 'processing';
  });

  formatDateTime = formatDateTime;
  formatBytes = formatBytes;

  async ngOnInit() {
    await Promise.all([this.refresh(), this.loadTemplates()]);
  }

  async refresh() {
    const id = this.id();
    if (!id) {
      this.error.set('Invalid candidate id.');
      this.loading.set(false);
      return;
    }

    try {
      this.loading.set(true);
      this.error.set(null);
      const c = await this.api.getHrCandidate(id);
      this.candidate.set(c);
      // If backend is older and doesn't return cvTemplateKey, keep current selection.
      if (c && typeof (c as any).cvTemplateKey === 'string' && (c as any).cvTemplateKey.trim()) {
        this.selectedTemplateKey.set((c as any).cvTemplateKey.trim());
      } else {
        this.selectedTemplateKey.set(getHrDefaultCvTemplateKey() ?? 'standard');
      }
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async loadTemplates() {
    try {
      this.templates.set(await this.api.listHrCvTemplates());
    } catch {
      // Non-blocking: template selection is optional.
      this.templates.set([]);
    }
  }

  back() {
    void this.router.navigate(['/admin/hr/candidates']);
  }

  openResume() {
    const id = this.id();
    if (!id) return;
    window.open(`/api/hr/candidates/${id}/resume`, '_blank', 'noopener');
  }

  openStandardizedPdf() {
    const id = this.id();
    if (!id) return;
    const templateKey = this.selectedTemplateKey();
    const query = templateKey ? `?templateKey=${encodeURIComponent(templateKey)}` : '';
    window.open(`/api/hr/candidates/${id}/standardized-cv.pdf${query}`, '_blank', 'noopener');
  }

  async applyTemplateKey(nextKey: string) {
    const id = this.id();
    if (!id) return;
    if (this.saving()) return;
    if (!nextKey) return;
    const previousKey = this.selectedTemplateKey();
    const previousCandidate = this.candidate();

    try {
      this.saving.set(true);
      this.error.set(null);
      this.selectedTemplateKey.set(nextKey);
      const docId = this.candidate()?.documentId ?? null;
      await this.api.setHrCandidateTemplate({ id, documentId: docId }, nextKey);
      // Update local state immediately to avoid UI reset/flicker.
      const current = this.candidate();
      if (current) this.candidate.set({ ...current, cvTemplateKey: nextKey });
    } catch (e) {
      this.selectedTemplateKey.set(previousKey);
      this.candidate.set(previousCandidate);
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async reprocess() {
    const id = this.id();
    if (!id) return;
    if (!this.canReprocess()) return;
    if (!confirm('Re-run AI processing for this candidate? This will reset extracted data and score.')) return;

    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.hrReprocessCandidate(id);
      await this.refresh();
      this.tab.set('overview');
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
