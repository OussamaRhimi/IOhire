import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import { Check, Edit2, Plus, Trash2, X } from 'lucide-angular/src/icons';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { HrLookupItem } from '../../../core/strapi/strapi.types';

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

@Component({
  selector: 'app-hr-departments-page',
  imports: [ReactiveFormsModule, LucideAngularModule],
  templateUrl: './hr-departments-page.html',
  styleUrl: './hr-departments-page.css',
})
export class HrDepartmentsPage {
  private readonly api = inject(StrapiApi);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly departments = signal<HrLookupItem[]>([]);
  readonly editingId = signal<number | null>(null);
  readonly searchQuery = signal('');
  readonly filteredDepartments = computed(() => {
    const q = normalizeText(this.searchQuery());
    if (!q) return this.departments();
    return this.departments().filter((item) => normalizeText(item.name).includes(q));
  });

  /* ─── Pagination ─── */
  readonly currentPage = signal(1);
  readonly pageSize = signal(15);
  readonly totalPages = computed(() => Math.max(1, Math.ceil(this.filteredDepartments().length / this.pageSize())));
  readonly paginatedDepartments = computed(() => {
    const page = Math.min(this.currentPage(), this.totalPages());
    const size = this.pageSize();
    const start = (page - 1) * size;
    return this.filteredDepartments().slice(start, start + size);
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

  readonly createForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
  });

  readonly editForm = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(2)]],
  });

  readonly iconPlus: LucideIconData = Plus;
  readonly iconEdit: LucideIconData = Edit2;
  readonly iconTrash: LucideIconData = Trash2;
  readonly iconSave: LucideIconData = Check;
  readonly iconCancel: LucideIconData = X;

  async ngOnInit() {
    await this.refresh();
  }

  async refresh() {
    try {
      this.loading.set(true);
      this.error.set(null);
      this.departments.set(await this.api.listHrDepartments());
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  setSearchQuery(value: string) {
    this.searchQuery.set(String(value ?? ''));
    this.currentPage.set(1);
  }

  async create() {
    if (this.saving()) return;
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }

    const name = this.createForm.controls.name.value.trim();
    if (!name) return;

    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.createHrDepartment(name);
      this.createForm.reset({ name: '' });
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  startEdit(item: HrLookupItem) {
    this.editingId.set(item.id);
    this.editForm.reset({ name: item.name });
  }

  cancelEdit() {
    this.editingId.set(null);
    this.editForm.reset({ name: '' });
  }

  async saveEdit(item: HrLookupItem) {
    if (this.saving()) return;
    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      return;
    }

    const name = this.editForm.controls.name.value.trim();
    if (!name) return;

    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.updateHrDepartment(item.id, name);
      this.cancelEdit();
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  async delete(item: HrLookupItem) {
    if (this.saving()) return;
    if (!confirm(`Delete department "${item.name}"?`)) return;

    try {
      this.saving.set(true);
      this.error.set(null);
      await this.api.deleteHrDepartment(item.id);
      if (this.editingId() === item.id) this.cancelEdit();
      await this.refresh();
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }
}
