import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import { Calendar, Edit2, Plus, Trash2, Users, X } from 'lucide-angular/src/icons';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { HrCandidate, HrJobPosting, HrLookupItem, JobPostingStatus, JobRequirements } from '../../../core/strapi/strapi.types';

function normalizeLabel(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[\n,]+/g)
      .map((v) => v.trim())
      .filter(Boolean);
  }
  return [];
}

function dedupeStringList(values: unknown): string[] {
  const items = toStringList(values);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = normalizeLabel(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.slice(0, 100);
}

function coercePositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.floor(n);
  return rounded >= 0 ? rounded : null;
}

type JobMeta = {
  departments: string[];
  location: string;
  employmentType: string;
  customNotes: string;
};

function parseJobMeta(rawNotes: unknown): JobMeta {
  const out: JobMeta = {
    departments: [],
    location: '',
    employmentType: '',
    customNotes: '',
  };
  const source = typeof rawNotes === 'string' ? rawNotes : '';
  if (!source.trim()) return out;

  const extra: string[] = [];
  for (const line of source
    .split(/\r?\n/g)
    .map((v) => v.trim())
    .filter(Boolean)) {
    const mDepartments = /^departments?\s*:\s*(.+)$/i.exec(line);
    if (mDepartments) {
      out.departments = dedupeStringList(mDepartments[1]);
      continue;
    }
    const mLocation = /^location\s*:\s*(.+)$/i.exec(line);
    if (mLocation) {
      out.location = mLocation[1].trim();
      continue;
    }
    const mType = /^(type|employment)\s*:\s*(.+)$/i.exec(line);
    if (mType) {
      out.employmentType = mType[2].trim();
      continue;
    }
    extra.push(line);
  }

  out.customNotes = extra.join('\n');
  return out;
}

function composeJobNotes(meta: { departments: string[]; location: string; employmentType: string; customNotes: string }): string | undefined {
  const lines: string[] = [];
  if (meta.departments.length > 0) lines.push(`Departments: ${meta.departments.join(', ')}`);
  if (meta.location.trim()) lines.push(`Location: ${meta.location.trim()}`);
  if (meta.employmentType.trim()) lines.push(`Type: ${meta.employmentType.trim()}`);
  if (meta.customNotes.trim()) lines.push(meta.customNotes.trim());
  return lines.length > 0 ? lines.join('\n') : undefined;
}

@Component({
  selector: 'app-hr-jobs-page',
  imports: [ReactiveFormsModule, LucideAngularModule],
  templateUrl: './hr-jobs-page.html',
  styleUrl: './hr-jobs-page.css',
})
export class HrJobsPage {
  private readonly api = inject(StrapiApi);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly jobs = signal<HrJobPosting[]>([]);
  readonly statuses = signal<JobPostingStatus[]>([]);
  readonly applicantCounts = signal<Record<string, number>>({});
  readonly skills = signal<HrLookupItem[]>([]);
  readonly departments = signal<HrLookupItem[]>([]);
  readonly showModal = signal(false);
  readonly editingJob = signal<HrJobPosting | null>(null);
  readonly departmentQuery = signal('');
  readonly requiredSkillQuery = signal('');
  readonly niceSkillQuery = signal('');

  readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    departments: [[] as string[]],
    location: [''],
    employmentType: [''],
    description: ['', [Validators.required, Validators.minLength(10)]],
    skillsRequired: [[] as string[]],
    skillsNiceToHave: [[] as string[]],
    minYearsExperience: [null as number | null],
    requirementsNotes: [''],
    status: ['draft' as JobPostingStatus, [Validators.required]],
  });

  readonly hasJobs = computed(() => this.jobs().length > 0);
  readonly modalTitle = computed(() => (this.editingJob() ? 'Edit Job Posting' : 'Create New Job Posting'));
  readonly submitLabel = computed(() => (this.editingJob() ? 'Save Changes' : 'Create Posting'));

  /* ─── Pagination ─── */
  readonly currentPage = signal(1);
  readonly pageSize = signal(6);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.jobs().length / this.pageSize())));
  readonly paginatedJobs = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const size = this.pageSize();
    const start = (page - 1) * size;
    return this.jobs().slice(start, start + size);
  });
  readonly pageNumbers = computed(() => {
    const total = this.totalPages();
    const current = this.currentPage();
    const pages: (number | '...')[] = [];
    if (total <= 7) {
      for (let i = 1; i <= total; i++) pages.push(i);
    } else {
      pages.push(1);
      if (current > 3) pages.push('...');
      for (let i = Math.max(2, current - 1); i <= Math.min(total - 1, current + 1); i++) pages.push(i);
      if (current < total - 2) pages.push('...');
      pages.push(total);
    }
    return pages;
  });

  goToPage(page: number) {
    const p = Math.max(1, Math.min(page, this.totalPages()));
    this.currentPage.set(p);
  }

  setPageSize(size: number) {
    this.pageSize.set(size);
    this.currentPage.set(1);
  }
  /* ─── End Pagination ─── */

  readonly iconPlus: LucideIconData = Plus;
  readonly iconEdit: LucideIconData = Edit2;
  readonly iconTrash: LucideIconData = Trash2;
  readonly iconUsers: LucideIconData = Users;
  readonly iconCalendar: LucideIconData = Calendar;
  readonly iconClose: LucideIconData = X;

  async ngOnInit() {
    await Promise.all([this.loadMeta(), this.loadTaxonomies()]);
    await this.refresh();
  }

  async loadMeta() {
    try {
      const meta = await this.api.getMeta();
      const statuses = (meta.jobPostingStatuses ?? []).filter((s) => typeof s === 'string') as JobPostingStatus[];
      this.statuses.set(statuses);
    } catch {
      this.statuses.set([]);
    }
  }

  async loadTaxonomies() {
    try {
      const [skills, departments] = await Promise.all([this.api.listHrSkills(), this.api.listHrDepartments()]);
      this.skills.set(skills);
      this.departments.set(departments);
    } catch (e) {
      this.error.set(toErrorMessage(e));
      this.skills.set([]);
      this.departments.set([]);
    }
  }

  async refresh() {
    try {
      this.loading.set(true);
      this.error.set(null);
      const [jobs, candidates] = await Promise.all([this.api.listHrJobPostings(), this.api.listHrCandidates()]);
      this.jobs.set(jobs);
      this.applicantCounts.set(this.computeApplicantCounts(candidates));
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  openCreateModal() {
    void this.loadTaxonomies();
    this.resetPickerQueries();
    this.editingJob.set(null);
    this.createForm.reset({
      title: '',
      departments: [],
      location: '',
      employmentType: '',
      description: '',
      skillsRequired: [],
      skillsNiceToHave: [],
      minYearsExperience: null,
      requirementsNotes: '',
      status: 'draft',
    });
    this.showModal.set(true);
  }

  openEditModal(job: HrJobPosting) {
    void this.loadTaxonomies();
    this.resetPickerQueries();
    const requirements = (job.requirements ?? {}) as JobRequirements;
    const meta = parseJobMeta(requirements.notes);
    const departments = dedupeStringList(requirements.departments ?? meta.departments);

    this.editingJob.set(job);
    this.createForm.reset({
      title: job.title ?? '',
      departments,
      location: meta.location,
      employmentType: meta.employmentType || 'Full-time',
      description: job.description ?? '',
      skillsRequired: dedupeStringList(requirements.skillsRequired ?? []),
      skillsNiceToHave: dedupeStringList(requirements.skillsNiceToHave ?? []),
      minYearsExperience: requirements.minYearsExperience ?? null,
      requirementsNotes: meta.customNotes,
      status: (job.status ?? 'draft') as JobPostingStatus,
    });
    this.showModal.set(true);
  }

  closeModal() {
    if (this.saving()) return;
    this.resetPickerQueries();
    this.showModal.set(false);
  }

  private resetPickerQueries() {
    this.departmentQuery.set('');
    this.requiredSkillQuery.set('');
    this.niceSkillQuery.set('');
  }

  selectedDepartments(): string[] {
    return dedupeStringList(this.createForm.controls.departments.value ?? []);
  }

  selectedRequiredSkills(): string[] {
    return dedupeStringList(this.createForm.controls.skillsRequired.value ?? []);
  }

  selectedNiceSkills(): string[] {
    return dedupeStringList(this.createForm.controls.skillsNiceToHave.value ?? []);
  }

  setDepartmentQuery(value: string) {
    this.departmentQuery.set(String(value ?? ''));
  }

  setRequiredSkillQuery(value: string) {
    this.requiredSkillQuery.set(String(value ?? ''));
  }

  setNiceSkillQuery(value: string) {
    this.niceSkillQuery.set(String(value ?? ''));
  }

  availableDepartmentOptions(): string[] {
    const selected = new Set(this.selectedDepartments().map(normalizeLabel));
    return this.departments()
      .map((d) => d.name)
      .filter((name) => !selected.has(normalizeLabel(name)));
  }

  filteredDepartmentOptions(): string[] {
    const query = normalizeLabel(this.departmentQuery());
    const options = this.availableDepartmentOptions();
    if (!query) return options;
    return options.filter((name) => normalizeLabel(name).includes(query));
  }

  availableSkillOptions(control: 'skillsRequired' | 'skillsNiceToHave'): string[] {
    const selected =
      control === 'skillsRequired'
        ? new Set(this.selectedRequiredSkills().map(normalizeLabel))
        : new Set(this.selectedNiceSkills().map(normalizeLabel));

    return this.skills()
      .map((s) => s.name)
      .filter((name) => !selected.has(normalizeLabel(name)));
  }

  filteredSkillOptions(control: 'skillsRequired' | 'skillsNiceToHave'): string[] {
    const query = normalizeLabel(control === 'skillsRequired' ? this.requiredSkillQuery() : this.niceSkillQuery());
    const options = this.availableSkillOptions(control);
    if (!query) return options;
    return options.filter((name) => normalizeLabel(name).includes(query));
  }

  addDepartment(name: string) {
    const value = String(name ?? '').trim();
    if (!value) return;
    const next = dedupeStringList([...(this.createForm.controls.departments.value ?? []), value]);
    this.createForm.controls.departments.setValue(next);
    this.createForm.controls.departments.markAsDirty();
    this.departmentQuery.set('');
  }

  removeDepartment(name: string) {
    const key = normalizeLabel(name);
    const next = this.selectedDepartments().filter((item) => normalizeLabel(item) !== key);
    this.createForm.controls.departments.setValue(next);
    this.createForm.controls.departments.markAsDirty();
  }

  addSkill(control: 'skillsRequired' | 'skillsNiceToHave', name: string) {
    const value = String(name ?? '').trim();
    if (!value) return;
    const current = this.createForm.controls[control].value ?? [];
    const next = dedupeStringList([...(current as string[]), value]);
    this.createForm.controls[control].setValue(next);
    this.createForm.controls[control].markAsDirty();
    if (control === 'skillsRequired') this.requiredSkillQuery.set('');
    else this.niceSkillQuery.set('');
  }

  addFirstDepartmentMatch() {
    const first = this.filteredDepartmentOptions()[0];
    if (first) this.addDepartment(first);
  }

  addFirstSkillMatch(control: 'skillsRequired' | 'skillsNiceToHave') {
    const first = this.filteredSkillOptions(control)[0];
    if (first) this.addSkill(control, first);
  }

  removeSkill(control: 'skillsRequired' | 'skillsNiceToHave', name: string) {
    const key = normalizeLabel(name);
    const current = dedupeStringList(this.createForm.controls[control].value ?? []);
    const next = current.filter((item) => normalizeLabel(item) !== key);
    this.createForm.controls[control].setValue(next);
    this.createForm.controls[control].markAsDirty();
  }

  async submitModal() {
    if (this.saving()) return;
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    try {
      this.saving.set(true);
      this.error.set(null);

      const value = this.createForm.getRawValue();
      const departments = dedupeStringList(value.departments);
      const notes = composeJobNotes({
        departments,
        location: value.location,
        employmentType: value.employmentType,
        customNotes: value.requirementsNotes,
      });

      const requirements: JobRequirements = {
        skillsRequired: dedupeStringList(value.skillsRequired),
        skillsNiceToHave: dedupeStringList(value.skillsNiceToHave),
        departments,
        minYearsExperience: coercePositiveInt(value.minYearsExperience) ?? undefined,
        notes,
      };

      const cleanedRequirements =
        (requirements.skillsRequired?.length ?? 0) > 0 ||
        (requirements.skillsNiceToHave?.length ?? 0) > 0 ||
        (requirements.departments?.length ?? 0) > 0 ||
        requirements.minYearsExperience != null ||
        !!requirements.notes
          ? requirements
          : null;

      const editing = this.editingJob();
      if (!editing) {
        await this.api.createHrJobPosting({
          title: value.title,
          description: value.description,
          status: value.status,
          requirements: cleanedRequirements,
        });
      } else {
        const keys = [editing.documentId ?? '', editing.id != null ? String(editing.id) : ''].filter(Boolean);
        if (keys.length === 0) throw new Error('Unable to identify the job to edit.');
        await this.api.updateHrJobPosting(keys, {
          title: value.title,
          description: value.description,
          status: value.status,
          requirements: cleanedRequirements,
        });
      }

      this.resetPickerQueries();
      this.showModal.set(false);
      this.editingJob.set(null);
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async setStatus(job: HrJobPosting, status: JobPostingStatus) {
    const keys = [job.documentId ?? '', job.id != null ? String(job.id) : ''].filter(Boolean);
    if (keys.length === 0) return;
    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.updateHrJobPostingStatus(keys, status);
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  jobMeta(job: HrJobPosting): JobMeta {
    const parsed = parseJobMeta(job.requirements?.notes);
    const fromRequirements = dedupeStringList(job.requirements?.departments ?? []);
    return {
      departments: fromRequirements.length > 0 ? fromRequirements : parsed.departments.length > 0 ? parsed.departments : ['General'],
      location: parsed.location || 'Remote',
      employmentType: parsed.employmentType || 'Full-time',
      customNotes: parsed.customNotes,
    };
  }

  jobSkillsRequired(job: HrJobPosting): string[] {
    return dedupeStringList(job.requirements?.skillsRequired ?? []);
  }

  jobExperience(job: HrJobPosting): string {
    const years = job.requirements?.minYearsExperience;
    if (typeof years === 'number' && years >= 0) return `${years}+ years`;
    return 'Not specified';
  }

  postedDate(job: HrJobPosting): string {
    const raw = job.createdAt;
    if (!raw) return 'Unknown';
    const d = new Date(raw);
    if (!Number.isFinite(d.getTime())) return 'Unknown';
    return d.toISOString().slice(0, 10);
  }

  applicantCount(job: HrJobPosting): number {
    const titleKey = (job.title ?? '').trim().toLowerCase();
    if (!titleKey) return 0;
    return this.applicantCounts()[titleKey] ?? 0;
  }

  statusClass(status: JobPostingStatus | null): string {
    if (status === 'open') return 'hr-job-status hr-job-status--open';
    if (status === 'closed') return 'hr-job-status hr-job-status--closed';
    return 'hr-job-status hr-job-status--draft';
  }

  statusLabel(status: JobPostingStatus | null): string {
    if (!status) return 'Draft';
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  private computeApplicantCounts(candidates: HrCandidate[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const c of candidates) {
      const key = (c.jobTitle ?? '').trim().toLowerCase();
      if (!key) continue;
      out[key] = (out[key] ?? 0) + 1;
    }
    return out;
  }

  async delete(job: HrJobPosting) {
    const keys = [job.documentId ?? '', job.id != null ? String(job.id) : ''].filter(Boolean);
    const label = job.title || keys[0] || 'job';
    if (keys.length === 0) return;
    if (!confirm(`Delete job "${label}"? This does not delete candidates, but it may break their relation.`)) {
      return;
    }

    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.deleteHrJobPosting(keys);
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
