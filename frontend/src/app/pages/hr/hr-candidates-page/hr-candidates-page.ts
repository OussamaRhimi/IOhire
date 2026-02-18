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
type ScoreFilter = '' | `${'gt' | 'lt'}:${number}`;
type OpenJobOption = {
  id: number;
  title: string;
};

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
const SCORE_FILTER_OPTIONS: Array<{ value: ScoreFilter; label: string }> = [
  { value: '', label: 'All scores' },
  { value: 'lt:30', label: 'Below 30' },
  { value: 'lt:40', label: 'Below 40' },
  { value: 'lt:50', label: 'Below 50' },
  { value: 'lt:60', label: 'Below 60' },
  { value: 'lt:70', label: 'Below 70' },
  { value: 'lt:80', label: 'Below 80' },
  { value: 'lt:90', label: 'Below 90' },
  { value: 'gt:30', label: 'Above 30' },
  { value: 'gt:40', label: 'Above 40' },
  { value: 'gt:50', label: 'Above 50' },
  { value: 'gt:60', label: 'Above 60' },
  { value: 'gt:70', label: 'Above 70' },
  { value: 'gt:80', label: 'Above 80' },
  { value: 'gt:90', label: 'Above 90' },
];

function normalizeSearchText(value: unknown): string {
  const s = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return s;
}

function matchesScoreFilter(score: number | null, scoreFilter: ScoreFilter): boolean {
  if (!scoreFilter) return true;
  if (typeof score !== 'number' || !Number.isFinite(score)) return false;
  const match = /^(gt|lt):(\d{1,3})$/.exec(scoreFilter);
  if (!match) return true;
  const operator = match[1];
  const threshold = Number(match[2]);
  if (!Number.isFinite(threshold)) return true;
  return operator === 'gt' ? score > threshold : score < threshold;
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
  readonly openJobs = signal<OpenJobOption[]>([]);
  readonly selectedCandidateIds = signal<number[]>([]);
  readonly bulkStatus = signal<'' | CandidateStatus>('');
  readonly statusOptions = computed(() => (this.statuses().length > 0 ? this.statuses() : DEFAULT_CANDIDATE_STATUSES));
  readonly scoreOptions = SCORE_FILTER_OPTIONS;

  readonly filterForm = this.fb.nonNullable.group({
    q: [''],
    status: ['' as '' | CandidateStatus],
    searchScope: this.fb.nonNullable.control<SearchScope>('all'),
    scoreFilter: this.fb.nonNullable.control<ScoreFilter>(''),
    jobId: this.fb.nonNullable.control(''),
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
    const scoreFilter: ScoreFilter = filter.scoreFilter ?? '';
    const selectedJobId = filter.jobId ?? '';
    const selectedJobIdNumber = Number(selectedJobId);

    return this.candidates().filter((c) => {
      if (status && c.status !== status) return false;
      if (!matchesScoreFilter(c.score, scoreFilter)) return false;
      if (selectedJobId) {
        if (!Number.isFinite(selectedJobIdNumber)) return false;
        if (c.jobId !== selectedJobIdNumber) return false;
      }
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
  readonly selectedCount = computed(() => this.selectedCandidateIds().length);
  readonly allFilteredSelected = computed(() => {
    const filtered = this.filtered();
    if (filtered.length === 0) return false;
    const selected = new Set(this.selectedCandidateIds());
    return filtered.every((c) => selected.has(c.id));
  });
  readonly partlyFilteredSelected = computed(() => {
    const filtered = this.filtered();
    if (filtered.length === 0) return false;
    const selected = new Set(this.selectedCandidateIds());
    const selectedCount = filtered.filter((c) => selected.has(c.id)).length;
    return selectedCount > 0 && selectedCount < filtered.length;
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
    await Promise.all([this.loadMeta(), this.refresh()]);
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

  async loadOpenJobs() {
    try {
      const jobs = await this.api.listOpenJobPostings();
      const openJobs = jobs
        .map((job) => ({
          id: typeof job?.id === 'number' ? job.id : Number(job?.id),
          title: typeof job?.title === 'string' ? job.title.trim() : '',
        }))
        .filter((job) => Number.isFinite(job.id) && !!job.title)
        .sort((a, b) => a.title.localeCompare(b.title));
      this.openJobs.set(openJobs);
    } catch {
      this.openJobs.set([]);
    }
  }

  async refresh() {
    try {
      this.loading.set(true);
      this.error.set(null);
      const [candidates] = await Promise.all([this.api.listHrCandidates(), this.loadOpenJobs()]);
      this.candidates.set(candidates);
      const currentIds = new Set(candidates.map((c) => c.id));
      this.selectedCandidateIds.update((ids) => ids.filter((id) => currentIds.has(id)));
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

  setBulkStatus(value: string) {
    const next = typeof value === 'string' ? value.trim() : '';
    if (!next) {
      this.bulkStatus.set('');
      return;
    }
    if (!this.statusOptions().includes(next as CandidateStatus)) return;
    this.bulkStatus.set(next as CandidateStatus);
  }

  isSelected(candidateId: number): boolean {
    return this.selectedCandidateIds().includes(candidateId);
  }

  toggleCandidateSelection(candidateId: number, checked: boolean) {
    this.selectedCandidateIds.update((ids) => {
      const set = new Set(ids);
      if (checked) set.add(candidateId);
      else set.delete(candidateId);
      return Array.from(set);
    });
  }

  selectAllFiltered() {
    const filteredIds = this.filtered().map((c) => c.id);
    this.selectedCandidateIds.update((ids) => Array.from(new Set([...ids, ...filteredIds])));
  }

  clearFilteredSelection() {
    const filteredSet = new Set(this.filtered().map((c) => c.id));
    this.selectedCandidateIds.update((ids) => ids.filter((id) => !filteredSet.has(id)));
  }

  toggleSelectAllFiltered(checked: boolean) {
    if (checked) this.selectAllFiltered();
    else this.clearFilteredSelection();
  }

  clearSelection() {
    this.selectedCandidateIds.set([]);
  }

  async applyBulkStatus() {
    const status = this.bulkStatus();
    const ids = this.selectedCandidateIds();
    if (!status || ids.length === 0) return;
    if (!this.statusOptions().includes(status)) return;
    if (!confirm(`Apply status "${this.statusLabel(status)}" to ${ids.length} selected candidates?`)) return;

    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.bulkUpdateHrCandidatesStatus(ids, status);
      this.bulkStatus.set('');
      this.clearSelection();
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  resetFilters() {
    this.filterForm.reset({
      q: '',
      status: '',
      searchScope: 'all',
      scoreFilter: '',
      jobId: '',
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
