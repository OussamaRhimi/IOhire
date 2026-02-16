import { Component, computed, inject, signal } from '@angular/core';

import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { CvTemplateMeta } from '../../../core/strapi/strapi.types';

@Component({
  selector: 'app-hr-templates-page',
  templateUrl: './hr-templates-page.html',
})
export class HrTemplatesPage {
  private readonly api = inject(StrapiApi);

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly templates = signal<CvTemplateMeta[]>([]);
  readonly selectedKey = signal<string>('standard');
  readonly sampleHtml = signal<string | null>(null);
  readonly sampleMarkdown = signal<string | null>(null);

  readonly selectedTemplate = computed(() => {
    const key = this.selectedKey();
    return this.templates().find((t) => t.key === key) ?? null;
  });

  async ngOnInit() {
    await this.refresh();
  }

  async refresh() {
    try {
      this.loading.set(true);
      this.error.set(null);
      const templates = await this.api.listHrCvTemplates();
      this.templates.set(templates);

      const existing = this.selectedKey();
      const nextKey = templates.some((t) => t.key === existing) ? existing : templates[0]?.key ?? 'standard';
      this.selectedKey.set(nextKey);

      await this.loadSample(nextKey);
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async onSelectTemplate(nextKey: string) {
    this.selectedKey.set(nextKey);
    await this.loadSample(nextKey);
  }

  private async loadSample(key: string) {
    try {
      this.sampleHtml.set(null);
      this.sampleMarkdown.set(null);
      const res = await this.api.getHrCvTemplateSample(key);
      this.sampleHtml.set(res.html);
      this.sampleMarkdown.set(res.markdown);
    } catch (e) {
      this.sampleHtml.set(null);
      this.sampleMarkdown.set(null);
      this.error.set(toErrorMessage(e));
    }
  }
}
