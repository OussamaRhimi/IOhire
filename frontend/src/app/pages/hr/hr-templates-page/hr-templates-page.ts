import { Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { toErrorMessage } from '../../../core/http/http-error';
import { getHrDefaultCvTemplateKey, setHrDefaultCvTemplateKey } from '../../../core/strapi/cv-template.storage';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import { CvTemplateMeta } from '../../../core/strapi/strapi.types';

@Component({
  selector: 'app-hr-templates-page',
  templateUrl: './hr-templates-page.html',
})
export class HrTemplatesPage implements OnDestroy {
  private readonly api = inject(StrapiApi);
  private readonly sanitizer = inject(DomSanitizer);
  private samplePreviewBlobUrl: string | null = null;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);

  readonly templates = signal<CvTemplateMeta[]>([]);
  readonly selectedKey = signal<string>(getHrDefaultCvTemplateKey() ?? 'standard');
  readonly defaultKey = signal<string>(getHrDefaultCvTemplateKey() ?? 'standard');
  readonly sampleHtml = signal<string | null>(null);
  readonly sampleMarkdown = signal<string | null>(null);
  readonly samplePreviewUrl = signal<SafeResourceUrl | null>(null);

  readonly selectedTemplate = computed(() => {
    const key = this.selectedKey();
    return this.templates().find((t) => t.key === key) ?? null;
  });

  async ngOnInit() {
    await this.refresh();
  }

  ngOnDestroy() {
    this.clearPreviewBlobUrl();
  }

  async refresh() {
    try {
      this.loading.set(true);
      this.error.set(null);
      const templates = await this.api.listHrCvTemplates();
      this.templates.set(templates);

      const preferred = this.defaultKey();
      const existing = this.selectedKey();
      const nextKey = templates.some((t) => t.key === preferred)
        ? preferred
        : templates.some((t) => t.key === existing)
          ? existing
          : templates[0]?.key ?? 'standard';
      if (nextKey !== this.defaultKey()) this.persistDefault(nextKey);
      this.selectedKey.set(nextKey);

      await this.loadSample(nextKey);
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async onSelectTemplate(nextKey: string) {
    this.persistDefault(nextKey);
    this.selectedKey.set(nextKey);
    await this.loadSample(nextKey);
  }

  isDefaultTemplate(key: string): boolean {
    return this.defaultKey() === key;
  }

  private persistDefault(key: string) {
    setHrDefaultCvTemplateKey(key);
    this.defaultKey.set(key);
  }

  private async loadSample(key: string) {
    try {
      this.sampleHtml.set(null);
      this.sampleMarkdown.set(null);
      this.samplePreviewUrl.set(null);
      this.clearPreviewBlobUrl();
      const res = await this.api.getHrCvTemplateSample(key);
      this.sampleHtml.set(res.html);
      this.sampleMarkdown.set(res.markdown);
      if (res.html) this.setPreviewBlobUrl(res.html);
    } catch (e) {
      this.sampleHtml.set(null);
      this.sampleMarkdown.set(null);
      this.samplePreviewUrl.set(null);
      this.clearPreviewBlobUrl();
      this.error.set(toErrorMessage(e));
    }
  }

  private setPreviewBlobUrl(html: string) {
    this.clearPreviewBlobUrl();
    const blob = new Blob([html], { type: 'text/html' });
    this.samplePreviewBlobUrl = URL.createObjectURL(blob);
    this.samplePreviewUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(this.samplePreviewBlobUrl));
  }

  private clearPreviewBlobUrl() {
    if (!this.samplePreviewBlobUrl) return;
    URL.revokeObjectURL(this.samplePreviewBlobUrl);
    this.samplePreviewBlobUrl = null;
  }
}
