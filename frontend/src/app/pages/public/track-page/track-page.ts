import { Component, computed, effect, inject, OnDestroy, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import { Download, RefreshCw, Search, ShieldCheck, Trash2 } from 'lucide-angular/src/icons';
import { formatDateTime } from '../../../core/format/date';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { PublicApplicationStatus } from '../../../core/strapi/strapi.types';

@Component({
  selector: 'app-track-page',
  imports: [ReactiveFormsModule, LucideAngularModule],
  templateUrl: './track-page.html',
})
export class TrackPage implements OnDestroy {
  private readonly api = inject(StrapiApi);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly status = signal<PublicApplicationStatus | null>(null);
  readonly polling = signal(false);
  readonly pollStartedAt = signal<number | null>(null);
  readonly pollSeconds = computed(() => {
    const startedAt = this.pollStartedAt();
    if (!startedAt) return 0;
    return Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  });

  readonly form = this.fb.nonNullable.group({
    token: ['', [Validators.required]],
  });

  private pollTimer: number | null = null;

  formatDateTime = formatDateTime;
  readonly iconSearch: LucideIconData = Search;
  readonly iconRefresh: LucideIconData = RefreshCw;
  readonly iconDownload: LucideIconData = Download;
  readonly iconDelete: LucideIconData = Trash2;
  readonly iconShield: LucideIconData = ShieldCheck;

  constructor() {
    effect(() => {
      const token = this.route.snapshot.queryParamMap.get('token');
      if (token && token.trim()) {
        this.form.controls.token.setValue(token.trim());
        void this.refresh(true);
      }
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  private startPolling() {
    if (this.pollTimer) return;
    this.polling.set(true);
    this.pollStartedAt.set(Date.now());
    this.pollTimer = window.setInterval(() => void this.refresh(false), 5000);
  }

  stopPolling() {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = null;
    this.polling.set(false);
    this.pollStartedAt.set(null);
  }

  async refresh(allowPoll: boolean) {
    this.error.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const token = this.form.controls.token.value.trim();
    if (!token) return;

    try {
      this.loading.set(true);
      const s = await this.api.getApplicationStatus(token);
      this.status.set(s);

      const state = String(s?.status ?? '').toLowerCase();
      const pending = state === 'new' || state === 'processing';
      if (allowPoll && pending) this.startPolling();
      if (!pending) this.stopPolling();
    } catch (e) {
      this.status.set(null);
      this.stopPolling();
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  downloadPdf() {
    if (this.form.invalid) return;
    const token = this.form.controls.token.value.trim();
    if (!token) return;
    window.open(`/api/public/applications/${encodeURIComponent(token)}/standardized-cv.pdf`, '_blank', 'noopener');
  }

  async deleteApplication() {
    if (this.form.invalid) return;
    const token = this.form.controls.token.value.trim();
    if (!token) return;

    if (!confirm('Delete this application and resume? This cannot be undone.')) return;
    try {
      this.loading.set(true);
      await this.api.deleteApplication(token);
      this.status.set(null);
      this.stopPolling();
      this.error.set(null);
      alert('Deleted.');
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }
}
