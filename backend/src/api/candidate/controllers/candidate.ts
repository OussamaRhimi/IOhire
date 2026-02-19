import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { factories } from '@strapi/strapi';

import { processCandidate } from '../../../utils/candidate-ai';
import { renderCvMarkdownToPdf } from '../../../utils/cv-pdf';
import { renderHtmlToPdf } from '../../../utils/html-pdf';
import { parseJsonWithRecovery } from '../../../utils/json';
import { ollamaChat } from '../../../utils/ollama';
import { extractTextFromResume } from '../../../utils/resume-text';
import {
  isCvTemplateKey,
  listCvTemplates,
  renderCvHtmlFromTemplate,
  renderCvMarkdownFromTemplate,
  type ResumeContact,
  type ResumeContent,
} from '../../../utils/cv-templates';

function coerceBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value !== 'string') return false;
  return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function coerceNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toPositiveIntArrayUnique(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of value) {
    const n = coerceNumber(raw);
    if (!n || !Number.isFinite(n)) continue;
    const id = Math.trunc(n);
    if (id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function getSingleFile(files: any): any | null {
  if (!files) return null;
  if (Array.isArray(files)) return files[0] ?? null;
  return files;
}

function getSingleUpload(resume: any): any | null {
  if (!resume) return null;
  if (Array.isArray(resume)) return resume[0] ?? null;
  if (resume?.data) return resume.data; // in case of REST response shape
  return resume;
}

function safeFilename(value: string): string {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 120) || 'candidate';
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
}

function resolveTemplateKey(candidateTemplateKey: unknown, requestedTemplateKey: unknown, globalDefault?: unknown) {
  if (isCvTemplateKey(requestedTemplateKey)) return requestedTemplateKey;
  if (isCvTemplateKey(candidateTemplateKey)) return candidateTemplateKey;
  if (isCvTemplateKey(globalDefault)) return globalDefault;
  return 'standard';
}

const STORE_KEY_DEFAULT_TEMPLATE = 'plugin_cv_default_template_key';

async function getGlobalDefaultTemplateKey(): Promise<string | null> {
  try {
    const val = await strapi.store.get({ key: STORE_KEY_DEFAULT_TEMPLATE });
    return typeof val === 'string' && isCvTemplateKey(val) ? val : null;
  } catch {
    return null;
  }
}

async function setGlobalDefaultTemplateKey(key: string): Promise<void> {
  await strapi.store.set({ key: STORE_KEY_DEFAULT_TEMPLATE, value: key });
}

const RECOMMENDATION_PARSER_SYSTEM_PROMPT =
  'Extract skills from the provided resume text. Return ONLY valid JSON with this shape: ' +
  '{ "skills": string[] }. ' +
  'Rules: include technical tools, frameworks, programming languages, cloud/devops skills, and professional domains. ' +
  'Deduplicate, keep concise labels, do not include explanations.';

function truncateForModel(text: string, maxChars: number): string {
  const raw = String(text ?? '');
  if (raw.length <= maxChars) return raw;
  const head = raw.slice(0, Math.floor(maxChars * 0.7));
  const tail = raw.slice(raw.length - Math.floor(maxChars * 0.2));
  return `${head}\n\n[...truncated...]\n\n${tail}`;
}

function normalizeSkill(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeSkills(skills: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of skills) {
    const skill = typeof raw === 'string' ? raw.trim() : '';
    if (!skill) continue;
    const key = normalizeSkill(skill);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

function parseSkillListFromModel(raw: string): string[] {
  const parsed = parseJsonWithRecovery<any>(raw);
  if (!parsed.ok) return [];

  const value = parsed.value;
  if (Array.isArray(value)) return dedupeSkills(value.filter((v) => typeof v === 'string'));
  if (value && typeof value === 'object') {
    const direct = toStringArray((value as any).skills);
    if (direct.length) return dedupeSkills(direct);

    const nested = toStringArray((value as any).data?.skills);
    if (nested.length) return dedupeSkills(nested);
  }
  return [];
}

function extractSkillsHeuristically(cvText: string, knownSkills: string[]): string[] {
  const textNorm = normalizeSkill(cvText);
  const textCompact = textNorm.replace(/\s+/g, '');
  if (!textNorm) return [];

  const matched: string[] = [];
  for (const skill of knownSkills) {
    const normalized = normalizeSkill(skill);
    if (!normalized) continue;

    const compact = normalized.replace(/\s+/g, '');
    const hasMatch =
      normalized.includes(' ') || normalized.length >= 5
        ? textNorm.includes(normalized)
        : compact && textCompact.includes(compact);

    if (hasMatch) matched.push(skill);
  }
  return dedupeSkills(matched);
}

function hasSkillMatch(requiredSkill: string, candidateNormalized: string[]): boolean {
  const required = normalizeSkill(requiredSkill);
  if (!required) return false;

  for (const skill of candidateNormalized) {
    if (!skill) continue;
    if (skill === required) return true;

    // Allow broad matching for terms like "react" vs "react js".
    if (required.length >= 4 && (skill.includes(required) || required.includes(skill))) return true;
  }
  return false;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

export default factories.createCoreController('api::candidate.candidate', ({ strapi }) => ({
  async hrListCvTemplates(ctx) {
    ctx.body = { templates: listCvTemplates() };
  },

  async hrGetCvTemplateSampleHtml(ctx) {
    const key = typeof ctx.params?.key === 'string' ? ctx.params.key.trim() : '';
    if (!isCvTemplateKey(key)) return ctx.badRequest('Unknown template key.');

    const sample: ResumeContent = {
      summary:
        'Product-minded software engineer with 6+ years of experience building ATS-friendly HR workflows, APIs, and PDF exports.',
      skills: ['TypeScript', 'Node.js', 'Strapi', 'PostgreSQL', 'REST APIs', 'Playwright', 'Docker', 'CI/CD'],
      languages: ['English (Fluent)', 'French (Professional)'],
      qualities: ['Structured', 'Reliable', 'Collaborative', 'Detail-oriented'],
      interests: ['Open-source', 'UX writing', 'Career coaching'],
      experience: [
        {
          title: 'Software Engineer',
          company: 'Example Corp',
          startDate: '2022',
          endDate: 'Present',
          highlights: [
            'Built internal HR tooling: candidate intake, scoring, and export workflows.',
            'Introduced HTML/CSS-based CV templates and reliable PDF rendering.',
            'Reduced processing time by optimizing parsing and caching.',
          ],
        },
        {
          title: 'Junior Developer',
          company: 'Startup Co',
          startDate: '2020',
          endDate: '2022',
          highlights: [
            'Implemented API endpoints and data models.',
            'Improved error handling and observability for background jobs.',
            'Wrote documentation and basic test coverage.',
          ],
        },
      ],
      education: [{ degree: 'B.Sc. Computer Science', school: 'Sample University', startDate: '2017', endDate: '2020' }],
      projects: [
        {
          name: 'CV Template System',
          description: 'Multiple resume layouts selectable by HR and rendered to HTML/CSS → PDF.',
          links: ['https://example.com/project'],
        },
      ],
      certifications: ['AWS Cloud Practitioner (sample)'],
    };

    const contact: ResumeContact = {
      fullName: 'Sample Candidate',
      email: 'sample@example.com',
      phone: '+1 (555) 010-0200',
      location: 'New York, NY',
      links: ['https://example.com'],
      photoUrl:
        "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop stop-color='%230ea5e9'/><stop offset='1' stop-color='%237c3aed'/></linearGradient></defs><rect width='256' height='256' fill='url(%23g)'/><circle cx='128' cy='106' r='46' fill='rgba(255,255,255,0.85)'/><rect x='44' y='170' width='168' height='60' rx='30' fill='rgba(255,255,255,0.85)'/></svg>",
    };

    ctx.body = { key, html: renderCvHtmlFromTemplate(key, { contact, content: sample }) };
  },

  async hrFindOne(ctx) {
    const id = coerceNumber(ctx.params?.id);
    if (!id) return ctx.badRequest('Candidate id is required.');

    const candidate = (await strapi.entityService.findOne('api::candidate.candidate', id, {
      fields: [
        'fullName',
        'email',
        'cvTemplateKey',
        'status',
        'score',
        'createdAt',
        'updatedAt',
        'hrNotes',
        'extractedData',
        'standardizedCvMarkdown',
        'documentId',
      ] as any,
      populate: {
        resume: true as any,
        jobPosting: { fields: ['title', 'status', 'requirements', 'documentId'] as any },
      } as any,
    })) as any;

    if (!candidate) return ctx.notFound();

    const resume = getSingleUpload(candidate.resume);
    const rawScore = candidate.score;
    const score = typeof rawScore === 'number' ? rawScore : rawScore != null ? Number(rawScore) : null;

    ctx.body = {
      id: typeof candidate.id === 'number' ? candidate.id : id,
      documentId: typeof candidate.documentId === 'string' ? candidate.documentId : null,
      fullName: typeof candidate.fullName === 'string' ? candidate.fullName : null,
      email: typeof candidate.email === 'string' ? candidate.email : null,
      cvTemplateKey: typeof candidate.cvTemplateKey === 'string' ? candidate.cvTemplateKey : null,
      status: typeof candidate.status === 'string' ? candidate.status : null,
      score: Number.isFinite(score) ? score : null,
      hrNotes: typeof candidate.hrNotes === 'string' ? candidate.hrNotes : null,
      createdAt: typeof candidate.createdAt === 'string' ? candidate.createdAt : null,
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : null,
      extractedData: candidate.extractedData ?? null,
      standardizedCvMarkdown: typeof candidate.standardizedCvMarkdown === 'string' ? candidate.standardizedCvMarkdown : null,
      jobPosting: candidate.jobPosting
        ? {
            id: typeof candidate.jobPosting.id === 'number' ? candidate.jobPosting.id : null,
            documentId: typeof candidate.jobPosting.documentId === 'string' ? candidate.jobPosting.documentId : null,
            title: typeof candidate.jobPosting.title === 'string' ? candidate.jobPosting.title : null,
            status: typeof candidate.jobPosting.status === 'string' ? candidate.jobPosting.status : null,
            requirements: candidate.jobPosting.requirements ?? null,
          }
        : null,
      resume: resume
        ? {
            id: typeof resume.id === 'number' ? resume.id : null,
            name: typeof resume.name === 'string' ? resume.name : null,
            mime: typeof resume.mime === 'string' ? resume.mime : null,
            ext: typeof resume.ext === 'string' ? resume.ext : null,
            size: typeof resume.size === 'number' ? resume.size : null,
          }
        : null,
    };
  },

  async hrSetCvTemplate(ctx) {
    const id = coerceNumber(ctx.params?.id);
    if (!id) return ctx.badRequest('Candidate id is required.');

    const body = (ctx.request as any).body ?? {};
    const templateKey = typeof body.templateKey === 'string' ? body.templateKey.trim() : null;
    if (!templateKey) return ctx.badRequest('templateKey is required.');
    if (!isCvTemplateKey(templateKey)) return ctx.badRequest('Unknown templateKey.');

    const candidate = (await strapi.entityService.findOne('api::candidate.candidate', id, {
      fields: ['cvTemplateKey', 'extractedData', 'standardizedCvMarkdown'] as any,
    })) as any;
    if (!candidate) return ctx.notFound();

    const extractedData = candidate.extractedData ?? null;

    await strapi.entityService.update('api::candidate.candidate', id, {
      data: {
        cvTemplateKey: templateKey,
        ...(extractedData ? { extractedData: { ...extractedData, cvTemplateKeyUsed: templateKey } } : {}),
      } as any,
    });

    ctx.body = { ok: true, templateKey };
  },

  async submitApplication(ctx) {
    const body = (ctx.request as any).body ?? {};
    const files = ((ctx.request as any).files ?? {}) as Record<string, unknown>;

    const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : null;
    const email = typeof body.email === 'string' ? body.email.trim() : null;
    const consent = coerceBoolean(body.consent);
    const jobPostingId = coerceNumber(body.jobPostingId);

    if (!consent) return ctx.badRequest('Consent is required.');
    if (!jobPostingId) return ctx.badRequest('jobPostingId is required.');

    const jobPosting = await strapi.entityService.findOne('api::job-posting.job-posting', jobPostingId, {
      fields: ['status', 'title'] as any,
    });
    if (!jobPosting) return ctx.badRequest('Job posting not found.');
    if ((jobPosting as any).status !== 'open') return ctx.badRequest('Job posting is not open.');

    const incoming = getSingleFile((files as any).resume ?? (files as any).files);
    if (!incoming?.filepath) return ctx.badRequest('Resume file is required.');

    const allowedMimes = new Set([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ]);

    const fileMime = (incoming.mimetype ?? '').toLowerCase();
    if (fileMime && !allowedMimes.has(fileMime)) {
      return ctx.badRequest(`Unsupported file type: ${incoming.mimetype}`);
    }

    const maxBytes = Number(process.env.MAX_RESUME_BYTES ?? 20 * 1024 * 1024);
    if (Number.isFinite(maxBytes) && incoming.size > maxBytes) {
      return ctx.badRequest(`File too large. Max ${maxBytes} bytes.`);
    }

    const apiUploadFolder = await strapi.plugin('upload').service('api-upload-folder').getAPIUploadFolder();

    const uploaded = (await strapi.plugin('upload').service('upload').upload(
      {
        data: { fileInfo: { folder: apiUploadFolder.id } },
        files: incoming,
      },
      { user: ctx.state?.user }
    )) as any[];

    const uploadFile = uploaded?.[0];
    if (!uploadFile?.id) return ctx.badRequest('Upload failed.');

    const now = new Date();
    const retentionDays = Number(process.env.CANDIDATE_RETENTION_DAYS ?? 180);
    const retentionUntil = new Date(now.getTime() + retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const publicToken = crypto.randomUUID();

    const candidate = await strapi.entityService.create('api::candidate.candidate', {
      data: {
        fullName,
        email,
        resume: uploadFile.id,
        jobPosting: jobPostingId,
        consent: true,
        consentAt: now.toISOString(),
        retentionUntil,
        publicToken,
        status: 'new',
      } as any,
    });

    ctx.status = 201;
    ctx.body = { id: candidate.id, token: publicToken };
  },

  async publicRecommendJobPostings(ctx) {
    const files = ((ctx.request as any).files ?? {}) as Record<string, unknown>;
    const incoming = getSingleFile((files as any).resume ?? (files as any).file ?? (files as any).files);
    if (!incoming?.filepath) return ctx.badRequest('Resume file is required.');

    const allowedMimes = new Set([
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
    ]);

    const fileMime = String(incoming.mimetype ?? incoming.mime ?? '')
      .toLowerCase()
      .trim();
    if (fileMime && !allowedMimes.has(fileMime)) {
      return ctx.badRequest(`Unsupported file type: ${incoming.mimetype ?? incoming.mime}`);
    }

    const maxBytes = Number(process.env.MAX_RESUME_BYTES ?? 20 * 1024 * 1024);
    const incomingSize = typeof incoming.size === 'number' ? incoming.size : Number(incoming.size);
    if (Number.isFinite(maxBytes) && Number.isFinite(incomingSize) && incomingSize > maxBytes) {
      return ctx.badRequest(`File too large. Max ${maxBytes} bytes.`);
    }

    const openJobs = (await strapi.entityService.findMany('api::job-posting.job-posting', {
      filters: { status: 'open' } as any,
      fields: ['title', 'description', 'requirements'] as any,
      sort: { createdAt: 'desc' } as any,
      limit: 200,
    })) as any[];

    if (!openJobs?.length) {
      ctx.body = {
        skills: [],
        totalConsidered: 0,
        top: [],
        message: 'No matching job is available at the moment.',
      };
      return;
    }

    let cvText = '';
    try {
      cvText = await extractTextFromResume({
        filepath: incoming.filepath,
        mimetype: incoming.mimetype,
        mime: incoming.mime,
        ext: incoming.ext,
        name: incoming.name,
        originalFilename: incoming.originalFilename,
      });
    } catch (error: any) {
      return ctx.badRequest(`Failed to read resume: ${error?.message ?? error}`);
    }

    if (!cvText || !cvText.trim()) return ctx.badRequest('No readable text found in resume.');

    const knownSkills = dedupeSkills(
      openJobs.flatMap((job) => {
        const requirements = (job?.requirements ?? {}) as any;
        return [...toStringArray(requirements?.skillsRequired), ...toStringArray(requirements?.skillsNiceToHave)];
      })
    );

    const maxCvChars = Number(process.env.CANDIDATE_AI_MAX_CV_CHARS ?? 18000);
    const cvForModel =
      Number.isFinite(maxCvChars) && maxCvChars > 1000 ? truncateForModel(cvText, maxCvChars) : String(cvText ?? '');

    let aiSkills: string[] = [];
    try {
      const raw = await ollamaChat({
        system: RECOMMENDATION_PARSER_SYSTEM_PROMPT,
        user:
          `Resume text:\n${cvForModel}\n\n` +
          `Known skills from open postings (use when present): ${JSON.stringify(knownSkills)}`,
        format: 'json',
        timeoutMs: Number(process.env.CANDIDATE_AI_RECOMMEND_TIMEOUT_MS ?? 120_000),
        ollamaOptions: { num_predict: Number(process.env.OLLAMA_NUM_PREDICT_PARSE ?? 900) },
      });
      aiSkills = parseSkillListFromModel(raw);
    } catch (error: any) {
      strapi?.log?.warn?.(
        `[candidate-ai] recommendation skill extraction failed: ${error?.message ?? error}`
      );
    }

    const fallbackSkills = extractSkillsHeuristically(cvText, knownSkills);
    const candidateSkills = dedupeSkills([...aiSkills, ...fallbackSkills]);
    const candidateNormalized = candidateSkills.map(normalizeSkill).filter(Boolean);

    const ranked = openJobs
      .map((job) => {
        const requirements = (job?.requirements ?? {}) as any;
        const required = dedupeSkills(toStringArray(requirements?.skillsRequired));
        const niceToHave = dedupeSkills(toStringArray(requirements?.skillsNiceToHave));

        const matchedRequired = required.filter((s) => hasSkillMatch(s, candidateNormalized));
        const matchedNiceToHave = niceToHave.filter((s) => hasSkillMatch(s, candidateNormalized));

        const missingRequired = required.filter((s) => !matchedRequired.includes(s));
        const missingNiceToHave = niceToHave.filter((s) => !matchedNiceToHave.includes(s));

        const requiredCoverage = required.length > 0 ? matchedRequired.length / required.length : 0;
        const niceCoverage = niceToHave.length > 0 ? matchedNiceToHave.length / niceToHave.length : 0;
        const compatibility = clampPercent(requiredCoverage * 85 + niceCoverage * 15);

        return {
          id: typeof job?.id === 'number' ? job.id : Number(job?.id),
          title: typeof job?.title === 'string' ? job.title : null,
          description: typeof job?.description === 'string' ? job.description : null,
          requirements: requirements ?? null,
          compatibility,
          matchedRequired,
          missingRequired,
          matchedNiceToHave,
          missingNiceToHave,
        };
      })
      .filter((job) => Number.isFinite(job.id))
      .filter((job) => job.compatibility > 0)
      .sort((a, b) => {
        if (b.compatibility !== a.compatibility) return b.compatibility - a.compatibility;
        if (b.matchedRequired.length !== a.matchedRequired.length) return b.matchedRequired.length - a.matchedRequired.length;
        if (b.matchedNiceToHave.length !== a.matchedNiceToHave.length) {
          return b.matchedNiceToHave.length - a.matchedNiceToHave.length;
        }
        return a.id - b.id;
      });

    ctx.body = {
      skills: candidateSkills.slice(0, 40),
      totalConsidered: openJobs.length,
      top: ranked.slice(0, 3),
      message: ranked.length === 0 ? 'No matching job is available at the moment.' : null,
    };
  },

  async publicStatus(ctx) {
    const token = String(ctx.params?.token ?? '').trim();
    if (!token) return ctx.badRequest('Token is required.');

    const results = (await strapi.entityService.findMany('api::candidate.candidate', {
      filters: { publicToken: token } as any,
      fields: ['status', 'score', 'standardizedCvMarkdown', 'extractedData', 'createdAt', 'updatedAt'] as any,
      populate: { jobPosting: { fields: ['title'] } } as any,
      limit: 1,
    })) as any[];

    const candidate = results?.[0];
    if (!candidate) return ctx.notFound();

    const evaluation = candidate.extractedData?.evaluation ?? null;
    const missing = evaluation?.missingFields ?? evaluation?.missing ?? [];

    ctx.body = {
      id: candidate.id,
      status: candidate.status ?? null,
      createdAt: candidate.createdAt ?? null,
      updatedAt: candidate.updatedAt ?? null,
      jobTitle: candidate.jobPosting?.title ?? null,
      score: candidate.score ?? null,
      missing,
      standardizedCvReady: !!candidate?.extractedData?.generatedResumeContent || !!candidate?.standardizedCvMarkdown,
      standardizedCvMarkdown: candidate.standardizedCvMarkdown ?? null,
    };
  },

  async publicDownloadStandardizedCvPdf(ctx) {
    const token = String(ctx.params?.token ?? '').trim();
    if (!token) return ctx.badRequest('Token is required.');

    const results = (await strapi.entityService.findMany('api::candidate.candidate', {
      filters: { publicToken: token } as any,
      fields: ['fullName', 'email', 'cvTemplateKey', 'standardizedCvMarkdown', 'extractedData'] as any,
      limit: 1,
    })) as any[];

    const candidate = results?.[0];
    if (!candidate) return ctx.notFound();

    const contact = (candidate.extractedData?.contact ?? {}) as any;
    const fullName = toStringOrNull(candidate.fullName) ?? toStringOrNull(contact?.fullName) ?? null;

    const globalDefault = await getGlobalDefaultTemplateKey();
    const templateKey = resolveTemplateKey(candidate.cvTemplateKey, ctx.query?.templateKey, globalDefault);
    const generated = (candidate.extractedData?.generatedResumeContent ?? null) as ResumeContent | null;

    let pdf: Buffer | null = null;
    if (generated && typeof generated === 'object') {
      const html = renderCvHtmlFromTemplate(templateKey, {
        contact: {
          fullName,
          email: toStringOrNull(candidate.email) ?? toStringOrNull(contact?.email) ?? null,
          phone: toStringOrNull(contact?.phone) ?? null,
          location: toStringOrNull(contact?.location) ?? null,
          links: toStringArray(contact?.links),
        },
        content: generated,
      });
      pdf = await renderHtmlToPdf({ html, title: fullName ? `${fullName} - Standardized CV` : 'Standardized CV' });
    } else {
      const markdown = toStringOrNull(candidate.standardizedCvMarkdown);
      if (!markdown) return ctx.notFound('No standardized CV is available yet.');
      pdf = await renderCvMarkdownToPdf({
        markdown,
        title: fullName ? `${fullName} - Standardized CV` : 'Standardized CV',
        contact: {
          fullName,
          email: toStringOrNull(candidate.email) ?? toStringOrNull(contact?.email) ?? null,
          phone: toStringOrNull(contact?.phone) ?? null,
          location: toStringOrNull(contact?.location) ?? null,
          links: toStringArray(contact?.links),
        },
      });
    }

    ctx.set('Cache-Control', 'no-store');
    ctx.type = 'application/pdf';
    (ctx as any).attachment(`${safeFilename(fullName ?? `candidate-${candidate.id}`)}-standardized-cv.pdf`);
    ctx.body = pdf;
  },

  async publicDelete(ctx) {
    const token = String(ctx.params?.token ?? '').trim();
    if (!token) return ctx.badRequest('Token is required.');

    const results = (await strapi.entityService.findMany('api::candidate.candidate', {
      filters: { publicToken: token } as any,
      populate: ['resume'] as any,
      limit: 1,
    })) as any[];

    const candidate = results?.[0];
    if (!candidate) return ctx.notFound();

    const resume = getSingleUpload(candidate.resume);
    const resumeId = resume?.id ?? null;

    await strapi.entityService.delete('api::candidate.candidate', candidate.id);

    if (resumeId) {
      const uploadSvc = strapi.plugin('upload').service('upload');
      const file = await uploadSvc.findOne(resumeId);
      if (file) await uploadSvc.remove(file);
    }

    ctx.status = 204;
  },

  async hrDelete(ctx) {
    const id = coerceNumber(ctx.params?.id);
    if (!id) return ctx.badRequest('Candidate id is required.');

    const candidate = (await strapi.entityService.findOne('api::candidate.candidate', id, {
      populate: ['resume'] as any,
    })) as any;

    if (!candidate) return ctx.notFound();

    const resume = getSingleUpload(candidate.resume);
    const resumeId = resume?.id ?? null;

    await strapi.entityService.delete('api::candidate.candidate', id);

    if (resumeId) {
      const uploadSvc = strapi.plugin('upload').service('upload');
      const file = await uploadSvc.findOne(resumeId);
      if (file) await uploadSvc.remove(file);
    }

    ctx.status = 204;
  },

  async downloadResume(ctx) {
    const id = coerceNumber(ctx.params?.id);
    if (!id) return ctx.badRequest('Candidate id is required.');

    const candidate = (await strapi.entityService.findOne('api::candidate.candidate', id, {
      populate: ['resume'] as any,
    })) as any;

    if (!candidate) return ctx.notFound();

    const resume = getSingleUpload(candidate.resume);
    if (!resume?.url) return ctx.notFound('No resume on candidate.');

    const filename = resume.name ?? resume.hash ?? `candidate-${id}-resume`;
    if (resume.mime) ctx.type = resume.mime;
    (ctx as any).attachment(filename);

    if (/^https?:\/\//i.test(resume.url)) {
      const res = await fetch(resume.url);
      if (!res.ok || !res.body) return ctx.throw(res.status, 'Failed to fetch resume');
      ctx.type = res.headers.get('content-type') ?? ctx.type;
      ctx.body = Readable.fromWeb(res.body as any);
      return;
    }

    const relativeUrl = resume.url.startsWith('/') ? resume.url.slice(1) : resume.url;
    const filePath = path.join(process.cwd(), 'public', relativeUrl);
    ctx.body = fs.createReadStream(filePath);
  },

  async downloadStandardizedCvPdf(ctx) {
    const id = coerceNumber(ctx.params?.id);
    if (!id) return ctx.badRequest('Candidate id is required.');

    const candidate = (await strapi.entityService.findOne('api::candidate.candidate', id, {
      fields: ['fullName', 'email', 'cvTemplateKey', 'standardizedCvMarkdown', 'extractedData'] as any,
    })) as any;

    if (!candidate) return ctx.notFound();

    const contact = (candidate.extractedData?.contact ?? {}) as any;
    const fullName = toStringOrNull(candidate.fullName) ?? toStringOrNull(contact?.fullName) ?? null;

    const globalDefault = await getGlobalDefaultTemplateKey();
    const templateKey = resolveTemplateKey(candidate.cvTemplateKey, ctx.query?.templateKey, globalDefault);
    const generated = (candidate.extractedData?.generatedResumeContent ?? null) as ResumeContent | null;

    let pdf: Buffer | null = null;
    if (generated && typeof generated === 'object') {
      const html = renderCvHtmlFromTemplate(templateKey, {
        contact: {
          fullName,
          email: toStringOrNull(candidate.email) ?? toStringOrNull(contact?.email) ?? null,
          phone: toStringOrNull(contact?.phone) ?? null,
          location: toStringOrNull(contact?.location) ?? null,
          links: toStringArray(contact?.links),
        },
        content: generated,
      });
      pdf = await renderHtmlToPdf({
        html,
        title: fullName ? `${fullName} - Standardized CV` : `Candidate ${id} - Standardized CV`,
      });
    } else {
      const markdown = toStringOrNull(candidate.standardizedCvMarkdown);
      if (!markdown) return ctx.notFound('No standardized CV is available yet.');
      pdf = await renderCvMarkdownToPdf({
        markdown,
        title: fullName ? `${fullName} - Standardized CV` : `Candidate ${id} - Standardized CV`,
        contact: {
          fullName,
          email: toStringOrNull(candidate.email) ?? toStringOrNull(contact?.email) ?? null,
          phone: toStringOrNull(contact?.phone) ?? null,
          location: toStringOrNull(contact?.location) ?? null,
          links: toStringArray(contact?.links),
        },
      });
    }

    ctx.set('Cache-Control', 'no-store');
    ctx.type = 'application/pdf';
    (ctx as any).attachment(`${safeFilename(fullName ?? `candidate-${id}`)}-standardized-cv.pdf`);
    ctx.body = pdf;
  },

  async hrBulkUpdateStatus(ctx) {
    const body = ((ctx.request as any).body ?? {}) as Record<string, unknown>;
    const ids = toPositiveIntArrayUnique(body.ids);
    const status = typeof body.status === 'string' ? body.status.trim() : '';

    if (!status) return ctx.badRequest('status is required.');
    if (ids.length === 0) return ctx.badRequest('ids must contain at least one candidate id.');

    const candidateContentType = strapi.contentType('api::candidate.candidate') as any;
    const allowedStatuses = Array.isArray(candidateContentType?.attributes?.status?.enum)
      ? (candidateContentType.attributes.status.enum as string[])
      : [];
    if (!allowedStatuses.includes(status)) return ctx.badRequest('Invalid status value.');

    const existing = (await strapi.entityService.findMany('api::candidate.candidate', {
      filters: { id: { $in: ids } } as any,
      fields: ['id'] as any,
      limit: ids.length,
    })) as any[];

    const existingIds = existing
      .map((item) => (typeof item?.id === 'number' ? item.id : Number(item?.id)))
      .filter((id) => Number.isFinite(id));

    for (const id of existingIds) {
      await strapi.entityService.update('api::candidate.candidate', id, {
        data: { status } as any,
      });
    }

    const updatedSet = new Set<number>(existingIds);
    const notFoundIds = ids.filter((id) => !updatedSet.has(id));

    ctx.body = {
      ok: true,
      status,
      updatedCount: existingIds.length,
      updatedIds: existingIds,
      notFoundIds,
    };
  },

  async hrReprocess(ctx) {
    const id = coerceNumber(ctx.params?.id);
    if (!id) return ctx.badRequest('Candidate id is required.');

    const candidate = (await strapi.entityService.findOne('api::candidate.candidate', id, {
      populate: ['resume'] as any,
    })) as any;

    if (!candidate) return ctx.notFound();
    if ((candidate as any).status === 'processing') return ctx.badRequest('Candidate is currently processing.');

    const resume = getSingleUpload(candidate.resume);
    if (!resume?.url) return ctx.badRequest('Candidate has no resume.');

    await strapi.entityService.update('api::candidate.candidate', id, {
      data: {
        status: 'new',
        hrNotes: null,
        extractedData: null,
        standardizedCvMarkdown: null,
        score: null,
      } as any,
    });

    setImmediate(() => {
      processCandidate(id).catch((error) => {
        strapi?.log?.error?.(`[candidate-ai] Reprocess failed for candidate ${id}: ${error?.message ?? error}`);
      });
    });

    ctx.status = 202;
    ctx.body = { ok: true };
  },

  /* ------------------------------------------------------------------ */
  /*  Public chatbot                                                     */
  /* ------------------------------------------------------------------ */
  async publicChat(ctx) {
    const body = ctx.request.body as any;
    const messages = body?.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      ctx.status = 400;
      ctx.body = { error: 'messages array is required.' };
      return;
    }

    // Validate & sanitize messages – only keep role + content, cap history
    const MAX_HISTORY = 20;
    const MAX_MSG_LENGTH = 1000;
    const validRoles = new Set(['user', 'assistant']);
    const sanitized = messages
      .filter((m: any) => m && validRoles.has(m.role) && typeof m.content === 'string' && m.content.trim())
      .slice(-MAX_HISTORY)
      .map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content.trim().slice(0, MAX_MSG_LENGTH),
      }));

    if (sanitized.length === 0 || sanitized[sanitized.length - 1].role !== 'user') {
      ctx.status = 400;
      ctx.body = { error: 'Last message must be from the user.' };
      return;
    }

    const CHATBOT_SYSTEM_PROMPT =
      `You are a helpful assistant embedded in a candidate job-application portal. ` +
      `You ONLY answer questions related to the candidate portal features listed below. ` +
      `If a user asks about anything unrelated (general knowledge, coding, politics, etc.), ` +
      `politely decline and redirect them to the portal topics.\n\n` +
      `PORTAL FEATURES YOU CAN HELP WITH:\n` +
      `1. APPLY FOR A JOB: Candidates can browse open job postings and submit their CV (PDF/DOCX/TXT) along with their name, email, and consent. ` +
      `They receive a tracking token after submission.\n` +
      `2. TRACK APPLICATION: Using their token, candidates can check their application status ` +
      `(new → processing → processed → reviewing → shortlisted → rejected → hired). ` +
      `They can see their CV score (0-100), missing fields, and download a standardized PDF version of their CV.\n` +
      `3. CV SCORE: The score is calculated automatically based on two factors: ` +
      `Fit Score (75%) — how well skills, experience, and qualifications match the job requirements; ` +
      `and Completeness Score (25%) — whether the CV contains all expected fields (name, email, phone, location, links, summary, experience with dates, education). ` +
      `Score = FitScore × 0.75 + CompletenessScore × 0.25.\n` +
      `4. JOB RECOMMENDATIONS: Candidates can upload their CV to get AI-powered job recommendations ` +
      `ranked by compatibility with their extracted skills.\n` +
      `5. DATA PRIVACY (GDPR): Candidates gave consent when applying. They can delete their application ` +
      `and all associated data at any time using their tracking token.\n` +
      `6. STANDARDIZED CV: After processing, the system generates a polished, standardized version of the CV ` +
      `using professional templates. Candidates can download this as a PDF.\n\n` +
      `GUIDELINES:\n` +
      `- Be concise, friendly, and helpful.\n` +
      `- Use short paragraphs and bullet points when appropriate.\n` +
      `- If you don't know the specific answer, guide them to the relevant portal page (Apply, Track, Recommendation).\n` +
      `- Never reveal internal system details, API endpoints, or technical implementation.\n` +
      `- Never make up information about specific job postings or application statuses.`;

    try {
      const reply = await ollamaChat({
        system: CHATBOT_SYSTEM_PROMPT,
        user: '', // not used when messages is provided
        messages: sanitized,
        timeoutMs: Number(process.env.CANDIDATE_CHAT_TIMEOUT_MS ?? 60_000),
        ollamaOptions: {
          temperature: 0.4,
          num_predict: Number(process.env.OLLAMA_NUM_PREDICT_CHAT ?? 400),
        },
      });

      ctx.body = { reply: reply.trim() };
    } catch (error: any) {
      strapi?.log?.error?.(`[chatbot] Chat failed: ${error?.message ?? error}`);
      ctx.status = 502;
      ctx.body = { error: 'Chat service is temporarily unavailable. Please try again later.' };
    }
  },
}));
