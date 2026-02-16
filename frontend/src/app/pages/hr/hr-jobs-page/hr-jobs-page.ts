import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatDateTime } from '../../../core/format/date';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { HrJobPosting, JobPostingStatus, JobRequirements } from '../../../core/strapi/strapi.types';

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

@Component({
  selector: 'app-hr-jobs-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './hr-jobs-page.html',
})
export class HrJobsPage {
  private readonly api = inject(StrapiApi);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly jobs = signal<HrJobPosting[]>([]);
  readonly statuses = signal<JobPostingStatus[]>([]);

  readonly createForm = this.fb.nonNullable.group({
    title: ['', [Validators.required, Validators.minLength(3)]],
    description: ['', [Validators.required, Validators.minLength(10)]],
    skillsRequired: [''],
    skillsNiceToHave: [''],
    minYearsExperience: [null as number | null],
    requirementsNotes: [''],
    status: ['draft' as JobPostingStatus, [Validators.required]],
  });

  readonly hasJobs = computed(() => this.jobs().length > 0);

  formatDateTime = formatDateTime;

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
      this.jobs.set(await this.api.listHrJobPostings());
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async create() {
    if (this.saving()) return;
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    try {
      this.saving.set(true);
      this.error.set(null);
      const value = this.createForm.getRawValue();
      const requirements: JobRequirements = {
        skillsRequired: parseSkillList(value.skillsRequired),
        skillsNiceToHave: parseSkillList(value.skillsNiceToHave),
        minYearsExperience: coercePositiveInt(value.minYearsExperience) ?? undefined,
        notes: value.requirementsNotes?.trim() ? value.requirementsNotes.trim() : undefined,
      };

      const cleanedRequirements =
        (requirements.skillsRequired?.length ?? 0) > 0 ||
        (requirements.skillsNiceToHave?.length ?? 0) > 0 ||
        requirements.minYearsExperience != null ||
        !!requirements.notes
          ? requirements
          : null;

      await this.api.createHrJobPosting({
        title: value.title,
        description: value.description,
        status: value.status,
        requirements: cleanedRequirements,
      });

      this.createForm.reset({
        title: '',
        description: '',
        skillsRequired: '',
        skillsNiceToHave: '',
        minYearsExperience: null,
        requirementsNotes: '',
        status: 'draft',
      });
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
