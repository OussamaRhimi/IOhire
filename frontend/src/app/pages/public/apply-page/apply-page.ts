import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { PublicJobPosting } from '../../../core/strapi/strapi.types';

@Component({
  selector: 'app-apply-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './apply-page.html',
})
export class ApplyPage {
  private readonly api = inject(StrapiApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly submitResult = signal<{ token: string; id: number } | null>(null);

  readonly jobs = signal<PublicJobPosting[]>([]);
  readonly selectedJobId = signal<number | null>(null);

  readonly form = this.fb.nonNullable.group({
    jobPostingId: [0, [Validators.required, Validators.min(1)]],
    fullName: [''],
    email: ['', [Validators.email]],
    consent: [false, [Validators.requiredTrue]],
    resume: [null as File | null, [Validators.required]],
  });

  readonly selectedJob = computed(() => {
    const id = this.selectedJobId();
    if (!id) return null;
    return this.jobs().find((j) => j.id === id) ?? null;
  });

  async ngOnInit() {
    try {
      this.loading.set(true);
      this.error.set(null);
      const jobs = await this.api.listOpenJobPostings();
      this.jobs.set(jobs);
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  chooseJob(job: PublicJobPosting) {
    this.submitResult.set(null);
    this.error.set(null);
    this.selectedJobId.set(job.id);
    this.form.controls.jobPostingId.setValue(job.id);
  }

  backToJobs() {
    this.selectedJobId.set(null);
    this.submitResult.set(null);
    this.error.set(null);
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement | null;
    const file = input?.files?.[0] ?? null;
    this.form.controls.resume.setValue(file);
    this.form.controls.resume.markAsTouched();
  }

  async submit() {
    if (this.submitting()) return;
    this.error.set(null);
    this.submitResult.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const resume = value.resume;
    if (!resume) return;

    try {
      this.submitting.set(true);
      const res = await this.api.submitApplication({
        jobPostingId: value.jobPostingId,
        consent: value.consent,
        resume,
        fullName: value.fullName?.trim() || undefined,
        email: value.email?.trim() || undefined,
      });
      this.submitResult.set(res);
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.submitting.set(false);
    }
  }

  goTrack() {
    const token = this.submitResult()?.token;
    if (!token) return;
    this.router.navigate(['/track'], { queryParams: { token } });
  }
}
