import { Component, HostListener, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import { BrainCircuit, BriefcaseBusiness, FileUp, Sparkles, Trash2, X } from 'lucide-angular/src/icons';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { PublicRecommendationResponse } from '../../../core/strapi/strapi.types';

@Component({
  selector: 'app-recommendation-page',
  imports: [ReactiveFormsModule, RouterLink, LucideAngularModule],
  templateUrl: './recommendation-page.html',
  styleUrl: './recommendation-page.css',
})
export class RecommendationPage {
  private readonly api = inject(StrapiApi);
  private readonly fb = inject(FormBuilder);

  readonly analyzing = signal(false);
  readonly error = signal<string | null>(null);
  readonly result = signal<PublicRecommendationResponse | null>(null);
  readonly modalOpen = signal(false);
  readonly selectedFileName = signal<string>('');
  readonly selectedFileSize = signal<string>('');
  readonly dragActive = signal(false);

  readonly form = this.fb.nonNullable.group({
    resume: [null as File | null, [Validators.required]],
  });

  readonly iconSparkles: LucideIconData = Sparkles;
  readonly iconUpload: LucideIconData = FileUp;
  readonly iconBrain: LucideIconData = BrainCircuit;
  readonly iconBriefcase: LucideIconData = BriefcaseBusiness;
  readonly iconClose: LucideIconData = X;
  readonly iconTrash: LucideIconData = Trash2;

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.modalOpen()) this.closeModal();
  }

  private setFile(file: File | null) {
    this.form.controls.resume.setValue(file);
    this.form.controls.resume.markAsTouched();
    this.dragActive.set(false);
    this.selectedFileName.set(file?.name ?? '');

    const bytes = file?.size ?? 0;
    if (!bytes) {
      this.selectedFileSize.set('');
    } else if (bytes < 1024) {
      this.selectedFileSize.set(`${bytes} B`);
    } else if (bytes / 1024 < 1024) {
      this.selectedFileSize.set(`${Math.round(bytes / 1024)} KB`);
    } else {
      this.selectedFileSize.set(`${(bytes / 1024 / 1024).toFixed(1)} MB`);
    }
  }

  triggerFilePicker(input: HTMLInputElement) {
    input.click();
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement | null;
    this.setFile(input?.files?.[0] ?? null);
  }

  clearFile(input: HTMLInputElement) {
    input.value = '';
    this.setFile(null);
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
    this.dragActive.set(false);
    const file = event.dataTransfer?.files?.[0] ?? null;
    this.setFile(file);
  }

  async recommend() {
    if (this.analyzing()) return;
    this.error.set(null);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const file = this.form.controls.resume.value;
    if (!file) return;

    try {
      this.analyzing.set(true);
      const response = await this.api.recommendJobPostings(file);
      this.result.set(response);
      this.modalOpen.set(true);
    } catch (e) {
      this.error.set(toErrorMessage(e));
      this.modalOpen.set(false);
    } finally {
      this.analyzing.set(false);
    }
  }

  closeModal() {
    this.modalOpen.set(false);
  }

  compatibilityLabel(value: number): string {
    const score = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
    return `${Math.round(score)}%`;
  }
}
