import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import {
  BrainCircuit,
  ChevronDown,
  Gauge,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sliders,
  Sparkles,
  Trash2,
  X,
} from 'lucide-angular/src/icons';
import { toErrorMessage } from '../../../core/http/http-error';
import { StrapiApi } from '../../../core/strapi/strapi.api';
import type {
  CompletenessPointsConfig,
  CustomCriterion,
  EvaluationConfig,
  HrJobPosting,
  QualityThresholds,
} from '../../../core/strapi/strapi.types';

const DEFAULTS: EvaluationConfig = {
  fitWeight: 75,
  completenessWeight: 25,
  requiredSkillsWeight: 75,
  niceToHaveSkillsWeight: 15,
  experienceWeight: 10,
  completenessPoints: {
    fullName: 10, email: 15, phone: 5, location: 5, links: 5,
    summary: 10, experience: 15, experienceDates: 10, education: 10,
    linkedin: 5, portfolio: 5, competencies: 5,
  },
  customCriteria: [],
  qualityThresholds: { excellent: 80, good: 60, fair: 40 },
};

@Component({
  selector: 'app-hr-ai-config-page',
  standalone: true,
  imports: [FormsModule, LucideAngularModule],
  templateUrl: './hr-ai-config-page.html',
  styleUrl: './hr-ai-config-page.css',
})
export class HrAiConfigPage {
  private readonly api = inject(StrapiApi);

  readonly iconBrain = BrainCircuit;
  readonly iconSliders = Sliders;
  readonly iconSettings = Settings2;
  readonly iconSave = Save;
  readonly iconReset = RotateCcw;
  readonly iconPlus = Plus;
  readonly iconTrash = Trash2;
  readonly iconX = X;
  readonly iconSparkles = Sparkles;
  readonly iconGauge = Gauge;
  readonly iconChevron = ChevronDown;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);
  readonly success = signal<string | null>(null);

  readonly jobs = signal<HrJobPosting[]>([]);
  readonly selectedJobId = signal<number | null>(null);

  // Config state
  readonly fitWeight = signal(DEFAULTS.fitWeight);
  readonly completenessWeight = signal(DEFAULTS.completenessWeight);
  readonly requiredSkillsWeight = signal(DEFAULTS.requiredSkillsWeight);
  readonly niceToHaveSkillsWeight = signal(DEFAULTS.niceToHaveSkillsWeight);
  readonly experienceWeight = signal(DEFAULTS.experienceWeight);
  readonly completenessPoints = signal<CompletenessPointsConfig>({ ...DEFAULTS.completenessPoints });
  readonly customCriteria = signal<CustomCriterion[]>([]);
  readonly qualityThresholds = signal<QualityThresholds>({ ...DEFAULTS.qualityThresholds });

  readonly dirty = signal(false);
  private serverConfig: EvaluationConfig | null = null;

  // Computed
  readonly selectedJob = computed(() => {
    const id = this.selectedJobId();
    return this.jobs().find((j) => j.id === id) ?? null;
  });

  readonly mainWeightSum = computed(() => this.fitWeight() + this.completenessWeight());
  readonly fitSubWeightSum = computed(() => this.requiredSkillsWeight() + this.niceToHaveSkillsWeight() + this.experienceWeight());
  readonly completenessPointsTotal = computed(() => {
    const cp = this.completenessPoints();
    return cp.fullName + cp.email + cp.phone + cp.location + cp.links + cp.summary + cp.experience + cp.experienceDates + cp.education;
  });

  readonly previewScore = computed(() => {
    const fw = this.fitWeight();
    const cw = this.completenessWeight();
    const total = fw + cw;
    if (total === 0) return { fitPct: 50, completenessPct: 50 };
    return { fitPct: Math.round(fw / total * 100), completenessPct: Math.round(cw / total * 100) };
  });

  readonly fitSubPreview = computed(() => {
    const r = this.requiredSkillsWeight();
    const n = this.niceToHaveSkillsWeight();
    const e = this.experienceWeight();
    const total = r + n + e;
    if (total === 0) return { requiredPct: 34, nicePct: 33, expPct: 33 };
    return {
      requiredPct: Math.round(r / total * 100),
      nicePct: Math.round(n / total * 100),
      expPct: Math.round(e / total * 100),
    };
  });

  // Section collapse
  readonly expandedSections = signal<Record<string, boolean>>({
    weights: true, fitSub: true, completeness: false, custom: false, thresholds: false,
  });

  toggleSection(key: string) {
    this.expandedSections.update((s) => ({ ...s, [key]: !s[key] }));
  }
  isExpanded(key: string): boolean {
    return this.expandedSections()[key] ?? false;
  }

  async ngOnInit() {
    try {
      this.loading.set(true);
      const jobs = await this.api.listHrJobPostings();
      this.jobs.set(jobs);
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  async onSelectJob(jobId: number) {
    if (!jobId) return;
    this.selectedJobId.set(jobId);
    this.error.set(null);
    this.success.set(null);

    try {
      this.loading.set(true);
      const { evaluationConfig } = await this.api.getHrEvalConfig(jobId);
      this.serverConfig = evaluationConfig;
      this.applyConfig(evaluationConfig);
      this.dirty.set(false);
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  private applyConfig(cfg: EvaluationConfig) {
    this.fitWeight.set(cfg.fitWeight);
    this.completenessWeight.set(cfg.completenessWeight);
    this.requiredSkillsWeight.set(cfg.requiredSkillsWeight);
    this.niceToHaveSkillsWeight.set(cfg.niceToHaveSkillsWeight);
    this.experienceWeight.set(cfg.experienceWeight);
    this.completenessPoints.set({ ...cfg.completenessPoints });
    this.customCriteria.set(cfg.customCriteria.map((c) => ({ ...c, keywords: [...c.keywords] })));
    this.qualityThresholds.set({ ...cfg.qualityThresholds });
  }

  private buildConfig(): EvaluationConfig {
    return {
      fitWeight: this.fitWeight(),
      completenessWeight: this.completenessWeight(),
      requiredSkillsWeight: this.requiredSkillsWeight(),
      niceToHaveSkillsWeight: this.niceToHaveSkillsWeight(),
      experienceWeight: this.experienceWeight(),
      completenessPoints: { ...this.completenessPoints() },
      customCriteria: this.customCriteria().map((c) => ({ ...c, keywords: [...c.keywords] })),
      qualityThresholds: { ...this.qualityThresholds() },
    };
  }

  markDirty() {
    this.dirty.set(true);
    this.success.set(null);
  }

  onMainWeightChange(which: 'fit' | 'completeness', value: number) {
    const clamped = Math.max(0, Math.min(100, value));
    if (which === 'fit') {
      this.fitWeight.set(clamped);
      this.completenessWeight.set(100 - clamped);
    } else {
      this.completenessWeight.set(clamped);
      this.fitWeight.set(100 - clamped);
    }
    this.markDirty();
  }

  onFitSubWeightChange(which: 'required' | 'nice' | 'exp', value: number) {
    const clamped = Math.max(0, Math.min(100, value));
    if (which === 'required') this.requiredSkillsWeight.set(clamped);
    else if (which === 'nice') this.niceToHaveSkillsWeight.set(clamped);
    else this.experienceWeight.set(clamped);
    this.markDirty();
  }

  onCompletenessPointChange(field: keyof CompletenessPointsConfig, value: number) {
    const clamped = Math.max(0, Math.min(100, value));
    this.completenessPoints.update((cp) => ({ ...cp, [field]: clamped }));
    this.markDirty();
  }

  onThresholdChange(which: keyof QualityThresholds, value: number) {
    const clamped = Math.max(0, Math.min(100, value));
    this.qualityThresholds.update((qt) => ({ ...qt, [which]: clamped }));
    this.markDirty();
  }

  // Custom criteria
  addCriterion() {
    this.customCriteria.update((list) => [
      ...list,
      { name: '', type: 'bonus' as const, points: 5, keywords: [''], requireAll: false },
    ]);
    this.markDirty();
    // Expand custom section if collapsed
    if (!this.isExpanded('custom')) this.toggleSection('custom');
  }

  removeCriterion(index: number) {
    this.customCriteria.update((list) => list.filter((_, i) => i !== index));
    this.markDirty();
  }

  updateCriterion(index: number, patch: Partial<CustomCriterion>) {
    this.customCriteria.update((list) =>
      list.map((c, i) => (i === index ? { ...c, ...patch } : c))
    );
    this.markDirty();
  }

  addKeyword(criterionIndex: number) {
    this.customCriteria.update((list) =>
      list.map((c, i) => (i === criterionIndex ? { ...c, keywords: [...c.keywords, ''] } : c))
    );
    this.markDirty();
  }

  removeKeyword(criterionIndex: number, kwIndex: number) {
    this.customCriteria.update((list) =>
      list.map((c, i) =>
        i === criterionIndex ? { ...c, keywords: c.keywords.filter((_, ki) => ki !== kwIndex) } : c
      )
    );
    this.markDirty();
  }

  updateKeyword(criterionIndex: number, kwIndex: number, value: string) {
    this.customCriteria.update((list) =>
      list.map((c, i) =>
        i === criterionIndex
          ? { ...c, keywords: c.keywords.map((kw, ki) => (ki === kwIndex ? value : kw)) }
          : c
      )
    );
    this.markDirty();
  }

  resetToDefaults() {
    this.applyConfig(DEFAULTS);
    this.markDirty();
  }

  async save() {
    const jobId = this.selectedJobId();
    if (!jobId || this.saving()) return;

    try {
      this.saving.set(true);
      this.error.set(null);
      this.success.set(null);
      const config = this.buildConfig();
      const saved = await this.api.setHrEvalConfig(jobId, config);
      this.serverConfig = saved;
      this.applyConfig(saved);
      this.dirty.set(false);
      this.success.set('Evaluation configuration saved. Reprocess candidates to apply the new scoring.');
    } catch (e) {
      this.error.set(toErrorMessage(e));
    } finally {
      this.saving.set(false);
    }
  }

  readonly completenessFieldLabels: { key: keyof CompletenessPointsConfig; label: string }[] = [
    { key: 'fullName', label: 'Full Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'location', label: 'Location' },
    { key: 'links', label: 'Links (CV)' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'portfolio', label: 'Portfolio / GitHub' },
    { key: 'summary', label: 'Summary' },
    { key: 'experience', label: 'Work Experience' },
    { key: 'experienceDates', label: 'Experience Dates' },
    { key: 'education', label: 'Education' },
    { key: 'competencies', label: 'Competencies' },
  ];
}
