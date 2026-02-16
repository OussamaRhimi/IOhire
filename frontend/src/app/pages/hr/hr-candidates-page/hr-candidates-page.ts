import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { startWith } from 'rxjs';
import { formatDateTime } from '../../../core/format/date';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { CandidateStatus, HrCandidate } from '../../../core/strapi/strapi.types';

type SearchColumnKey = 'fullName' | 'email' | 'jobTitle' | 'status' | 'score' | 'hrNotes';
type SearchScope = SearchColumnKey | 'all';
const DEFAULT_CANDIDATE_STATUSES: CandidateStatus[] = [
  'new',
  'processing',
  'processed',
  'reviewing',
  'shortlisted',
  'rejected',
  'hired',
  'error',
];

function normalizeSearchText(value: unknown): string {
  const s = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return s;
}

@Component({
  selector: 'app-hr-candidates-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './hr-candidates-page.html',
})
export class HrCandidatesPage {
  private readonly api = inject(StrapiApi);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly showFilters = signal(false);
  readonly error = signal<string | null>(null);
  readonly candidates = signal<HrCandidate[]>([]);
  readonly statuses = signal<CandidateStatus[]>([]);
  readonly statusOptions = computed(() => (this.statuses().length > 0 ? this.statuses() : DEFAULT_CANDIDATE_STATUSES));

  readonly filterForm = this.fb.nonNullable.group({
    q: [''],
    status: ['' as '' | CandidateStatus],
    searchScope: this.fb.nonNullable.control<SearchScope>('all'),
  });
  readonly searchColumns = [
    { key: 'all' as const, label: 'All columns' },
    { key: 'fullName' as const, label: 'Name' },
    { key: 'email' as const, label: 'Email' },
    { key: 'jobTitle' as const, label: 'Job' },
    { key: 'status' as const, label: 'Status' },
    { key: 'score' as const, label: 'Score' },
    { key: 'hrNotes' as const, label: 'HR notes' },
  ];
  private readonly filterValue = toSignal(
    this.filterForm.valueChanges.pipe(startWith(this.filterForm.getRawValue())),
    { initialValue: this.filterForm.getRawValue() }
  );

  readonly filtered = computed(() => {
    const filter = this.filterValue();
    const q = normalizeSearchText(filter.q ?? '').trim();
    const qTokens = q.split(/\s+/g).filter(Boolean);
    const status = filter.status ?? '';
    const searchScope: SearchScope = filter.searchScope ?? 'all';

    return this.candidates().filter((c) => {
      if (status && c.status !== status) return false;
      if (qTokens.length === 0) return true;

      const include = (key: SearchColumnKey) => searchScope === 'all' || searchScope === key;
      const parts: string[] = [];
      if (include('fullName')) parts.push(c.fullName ?? '');
      if (include('email')) parts.push(c.email ?? '');
      if (include('jobTitle')) parts.push(c.jobTitle ?? '');
      if (include('status')) parts.push(c.status ?? '', this.statusLabel(c.status));
      if (include('score')) parts.push(c.score == null ? '' : `${c.score} ${c.score}%`);
      if (include('hrNotes')) parts.push(c.hrNotes ?? '');
      const hay = normalizeSearchText(parts.join(' '));
      return qTokens.every((token) => hay.includes(token));
    });
  });

  formatDateTime = formatDateTime;

  formatDateShort(value: string | null | undefined): string {
    if (!value) return '-';
    return value.slice(0, 10);
  }

  toggleFilters() {
    this.showFilters.update((v) => !v);
  }

  statusLabel(status: CandidateStatus | null): string {
    if (status === 'processed') return 'Parsed';
    if (status === 'processing') return 'Processing';
    if (status === 'shortlisted') return 'Shortlisted';
    if (status === 'rejected') return 'Rejected';
    if (status === 'hired') return 'Hired';
    if (status === 'reviewing') return 'Reviewing';
    if (status === 'error') return 'Error';
    return status || 'New';
  }

  statusClass(status: CandidateStatus | null): string {
    if (status === 'processed' || status === 'hired' || status === 'shortlisted') return 'candidate-status--good';
    if (status === 'processing' || status === 'reviewing' || status === 'new') return 'candidate-status--warn';
    if (status === 'error' || status === 'rejected') return 'candidate-status--bad';
    return '';
  }

  scoreClass(score: number | null): string {
    if (typeof score !== 'number' || !Number.isFinite(score)) return 'candidate-score__fill--none';
    if (score >= 85) return 'candidate-score__fill--good';
    if (score >= 70) return 'candidate-score__fill--warn';
    return 'candidate-score__fill--bad';
  }

  async ngOnInit() {
    await this.loadMeta();
    await this.refresh();
  }

  async loadMeta() {
    try {
      const meta = await this.api.getMeta();
      const statuses = (meta.candidateStatuses ?? []).filter((s) => typeof s === 'string') as CandidateStatus[];
      this.statuses.set(statuses.length > 0 ? statuses : DEFAULT_CANDIDATE_STATUSES);
    } catch {
      this.statuses.set(DEFAULT_CANDIDATE_STATUSES);
    }
  }

  async refresh() {
    try {
      this.loading.set(true);
      this.error.set(null);
      this.candidates.set(await this.api.listHrCandidates());
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openResume(c: HrCandidate) {
    window.open(`/api/hr/candidates/${c.id}/resume`, '_blank', 'noopener');
  }

  openStandardizedPdf(c: HrCandidate) {
    window.open(`/api/hr/candidates/${c.id}/standardized-cv.pdf`, '_blank', 'noopener');
  }

  view(c: HrCandidate) {
    void this.router.navigate(['/admin/candidates', c.id]);
  }

  async saveStatus(c: HrCandidate, status: CandidateStatus) {
    const next = typeof status === 'string' ? status.trim() : '';
    if (!next) return;
    if (!this.statuses().includes(next as any)) return;
    const nextStatus = next as CandidateStatus;
    const previous = c.status ?? null;
    this.candidates.update((items) =>
      items.map((item) =>
        (item.documentId || item.id) === (c.documentId || c.id)
          ? {
              ...item,
              status: nextStatus,
            }
          : item
      )
    );
    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.updateHrCandidate([c.documentId ?? '', String(c.id)], { status: nextStatus });
    } catch (e) {
      this.candidates.update((items) =>
        items.map((item) =>
          (item.documentId || item.id) === (c.documentId || c.id)
            ? {
                ...item,
                status: previous,
              }
            : item
        )
      );
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async saveNotes(c: HrCandidate, notes: string) {
    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.updateHrCandidate([c.documentId ?? '', String(c.id)], { hrNotes: notes.trim() ? notes : null });
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  setSearchScope(scope: SearchScope) {
    this.filterForm.controls.searchScope.setValue(scope);
  }

  resetFilters() {
    this.filterForm.reset({
      q: '',
      status: '',
      searchScope: 'all',
    });
  }

  async reprocess(c: HrCandidate) {
    if (!confirm(`Reprocess candidate ${c.fullName || c.email || c.id}?`)) return;
    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.hrReprocessCandidate(c.id);
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async delete(c: HrCandidate) {
    if (!confirm(`Delete candidate ${c.fullName || c.email || c.id}? This will remove the resume too.`)) return;
    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.hrDeleteCandidate(c.id);
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
