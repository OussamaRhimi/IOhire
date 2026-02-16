import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

import { factories } from '@strapi/strapi';

import { processCandidate } from '../../../utils/candidate-ai';
import { renderCvMarkdownToPdf } from '../../../utils/cv-pdf';
import { renderHtmlToPdf } from '../../../utils/html-pdf';
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

    const templateKeyRaw = typeof candidate.cvTemplateKey === 'string' ? candidate.cvTemplateKey : null;
    const templateKey = isCvTemplateKey(templateKeyRaw) ? templateKeyRaw : 'standard';
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

    const templateKeyRaw = typeof candidate.cvTemplateKey === 'string' ? candidate.cvTemplateKey : null;
    const templateKey = isCvTemplateKey(templateKeyRaw) ? templateKeyRaw : 'standard';
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
}));
