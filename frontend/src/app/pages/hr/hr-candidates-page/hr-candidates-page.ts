import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { clearHrJwt } from '../../../core/auth/auth.storage';
import { formatDateTime } from '../../../core/format/date';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { CandidateStatus, HrCandidate } from '../../../core/strapi/strapi.types';

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
  readonly error = signal<string | null>(null);
  readonly candidates = signal<HrCandidate[]>([]);
  readonly statuses = signal<CandidateStatus[]>([]);

  readonly filterForm = this.fb.nonNullable.group({
    q: [''],
    status: ['' as '' | CandidateStatus],
  });

  readonly filtered = computed(() => {
    const q = this.filterForm.controls.q.value.trim().toLowerCase();
    const status = this.filterForm.controls.status.value;
    return this.candidates().filter((c) => {
      if (status && c.status !== status) return false;
      if (!q) return true;
      const hay = `${c.fullName ?? ''} ${c.email ?? ''} ${c.jobTitle ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  });

  formatDateTime = formatDateTime;

  async ngOnInit() {
    await this.loadMeta();
    await this.refresh();
  }

  async loadMeta() {
    try {
      const meta = await this.api.getMeta();
      const statuses = (meta.candidateStatuses ?? []).filter((s) => typeof s === 'string') as CandidateStatus[];
      this.statuses.set(statuses);
    } catch {
      this.statuses.set([]);
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
    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.updateHrCandidate([c.documentId ?? '', String(c.id)], { status: next });
      await this.refresh();
    } catch (e) {
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

  logout() {
    clearHrJwt();
    void this.router.navigate(['/hr/login']);
  }
}
