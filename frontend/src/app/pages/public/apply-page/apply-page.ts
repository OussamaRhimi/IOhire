import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import {
  BriefcaseBusiness,
  CheckCircle2,
  Clock3,
  FileUp,
  Link,
  Mail,
  Phone,
  Search,
  Sparkles,
  Trash2,
  User,
} from 'lucide-angular/src/icons';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { PublicJobPosting } from '../../../core/strapi/strapi.types';

@Component({
  selector: 'app-apply-page',
  imports: [ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './apply-page.html',
  styleUrl: './apply-page.css',
})
export class ApplyPage {
  private readonly api = inject(StrapiApi);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly submitResult = signal<{ token: string; id: number } | null>(null);
  readonly dragActive = signal(false);
  readonly selectedJobId = signal<number | null>(null);
  readonly resumeFile = signal<File | null>(null);

  readonly jobs = signal<PublicJobPosting[]>([]);

  readonly form = this.fb.nonNullable.group({
    jobPostingId: [0, [Validators.required, Validators.min(1)]],
    fullName: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    linkedin: [''],
    portfolio: [''],
    yearsExperience: [null as number | null],
    notes: [''],
    consent: [false, [Validators.requiredTrue]],
    resume: [null as File | null, [Validators.required]],
  });

  readonly selectedJob = computed(() => {
    const id = this.selectedJobId();
    if (!id) return null;
    return this.jobs().find((j) => j.id === id) ?? null;
  });
  readonly hasFile = computed(() => !!this.resumeFile());
  readonly fileName = computed(() => this.resumeFile()?.name ?? '');
  readonly fileSizeLabel = computed(() => {
    const bytes = this.resumeFile()?.size;
    if (!bytes || !Number.isFinite(bytes)) return '';
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${Math.round(kb)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
  });

  readonly iconSearch: LucideIconData = Search;
  readonly iconBriefcase: LucideIconData = BriefcaseBusiness;
  readonly iconFileUp: LucideIconData = FileUp;
  readonly iconSparkles: LucideIconData = Sparkles;
  readonly iconCheck: LucideIconData = CheckCircle2;
  readonly iconClock: LucideIconData = Clock3;
  readonly iconTrash: LucideIconData = Trash2;
  readonly iconUser: LucideIconData = User;
  readonly iconMail: LucideIconData = Mail;
  readonly iconPhone: LucideIconData = Phone;
  readonly iconLink: LucideIconData = Link;

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
    this.form.controls.jobPostingId.setValue(0);
  }

  private setResumeFile(file: File | null) {
    this.resumeFile.set(file);
    this.form.controls.resume.setValue(file);
    this.form.controls.resume.markAsTouched();
    this.dragActive.set(false);
  }

  triggerFilePicker(input: HTMLInputElement) {
    input.click();
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement | null;
    this.setResumeFile(input?.files?.[0] ?? null);
  }

  clearFile(input: HTMLInputElement) {
    input.value = '';
    this.setResumeFile(null);
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.dragActive.set(true);
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.dragActive.set(false);
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0] ?? null;
    this.setResumeFile(file);
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
        fullName: value.fullName.trim(),
        email: value.email.trim(),
      });
      this.submitResult.set(res);
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.submitting.set(false);
    }
  }

  submitAnother() {
    this.form.reset({
      jobPostingId: 0,
      fullName: '',
      email: '',
      phone: '',
      linkedin: '',
      portfolio: '',
      yearsExperience: null,
      notes: '',
      consent: false,
      resume: null,
    });
    this.selectedJobId.set(null);
    this.resumeFile.set(null);
    this.submitResult.set(null);
    this.error.set(null);
    this.dragActive.set(false);
  }

  goTrack() {
    const token = this.submitResult()?.token;
    if (!token) return;
    this.router.navigate(['/track'], { queryParams: { token } });
  }
}
