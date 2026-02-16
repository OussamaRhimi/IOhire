import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import { Calendar, Edit2, Plus, Trash2, Users, X } from 'lucide-angular/src/icons';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { HrCandidate, HrJobPosting, JobPostingStatus, JobRequirements } from '../../../core/strapi/strapi.types';

function parseSkillList(raw: string): string[] {
  const parts = String(raw ?? '')
    .split(/[\n,]+/g)
    .map((v) => v.trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).slice(0, 50);
}

function coercePositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.floor(n);
  return rounded >= 0 ? rounded : null;
}

type JobMeta = {
  department: string;
  location: string;
  employmentType: string;
  customNotes: string;
};

function parseJobMeta(rawNotes: unknown): JobMeta {
  const out: JobMeta = {
    department: '',
    location: '',
    employmentType: '',
    customNotes: '',
  };
  const source = typeof rawNotes === 'string' ? rawNotes : '';
  if (!source.trim()) return out;

  const extra: string[] = [];
  for (const line of source.split(/\r?\n/g).map((v) => v.trim()).filter(Boolean)) {
    const mDepartment = /^department\s*:\s*(.+)$/i.exec(line);
    if (mDepartment) {
      out.department = mDepartment[1].trim();
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

function composeJobNotes(meta: { department: string; location: string; employmentType: string; customNotes: string }): string | undefined {
  const lines: string[] = [];
  if (meta.department.trim()) lines.push(`Department: ${meta.department.trim()}`);
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
  readonly showModal = signal(false);
  readonly editingJob = signal<HrJobPosting | null>(null);

  readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    department: [''],
    location: [''],
    employmentType: [''],
    description: ['', [Validators.required, Validators.minLength(10)]],
    skillsRequired: [''],
    skillsNiceToHave: [''],
    minYearsExperience: [null as number | null],
    requirementsNotes: [''],
    status: ['draft' as JobPostingStatus, [Validators.required]],
  });

  readonly hasJobs = computed(() => this.jobs().length > 0);
  readonly modalTitle = computed(() => (this.editingJob() ? 'Edit Job Posting' : 'Create New Job Posting'));
  readonly submitLabel = computed(() => (this.editingJob() ? 'Save Changes' : 'Create Posting'));

  readonly iconPlus: LucideIconData = Plus;
  readonly iconEdit: LucideIconData = Edit2;
  readonly iconTrash: LucideIconData = Trash2;
  readonly iconUsers: LucideIconData = Users;
  readonly iconCalendar: LucideIconData = Calendar;
  readonly iconClose: LucideIconData = X;

  async ngOnInit() {
    await this.loadMeta();
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
    this.editingJob.set(null);
    this.createForm.reset({
      title: '',
      department: '',
      location: '',
      employmentType: '',
      description: '',
      skillsRequired: '',
      skillsNiceToHave: '',
      minYearsExperience: null,
      requirementsNotes: '',
      status: 'draft',
    });
    this.showModal.set(true);
  }

  openEditModal(job: HrJobPosting) {
    const requirements = (job.requirements ?? {}) as JobRequirements;
    const meta = parseJobMeta(requirements.notes);
    this.editingJob.set(job);
    this.createForm.reset({
      title: job.title ?? '',
      department: meta.department,
      location: meta.location,
      employmentType: meta.employmentType || 'Full-time',
      description: job.description ?? '',
      skillsRequired: (requirements.skillsRequired ?? []).join(', '),
      skillsNiceToHave: (requirements.skillsNiceToHave ?? []).join(', '),
      minYearsExperience: requirements.minYearsExperience ?? null,
      requirementsNotes: meta.customNotes,
      status: (job.status ?? 'draft') as JobPostingStatus,
    });
    this.showModal.set(true);
  }

  closeModal() {
    if (this.saving()) return;
    this.showModal.set(false);
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
      const notes = composeJobNotes({
        department: value.department,
        location: value.location,
        employmentType: value.employmentType,
        customNotes: value.requirementsNotes,
      });
      const requirements: JobRequirements = {
        skillsRequired: parseSkillList(value.skillsRequired),
        skillsNiceToHave: parseSkillList(value.skillsNiceToHave),
        minYearsExperience: coercePositiveInt(value.minYearsExperience) ?? undefined,
        notes,
      };

      const cleanedRequirements =
        (requirements.skillsRequired?.length ?? 0) > 0 ||
        (requirements.skillsNiceToHave?.length ?? 0) > 0 ||
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
    return {
      department: parsed.department || 'Engineering',
      location: parsed.location || 'Remote',
      employmentType: parsed.employmentType || 'Full-time',
      customNotes: parsed.customNotes,
    };
  }

  jobSkillsRequired(job: HrJobPosting): string[] {
    return (job.requirements?.skillsRequired ?? []).filter((s): s is string => typeof s === 'string' && !!s.trim());
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
