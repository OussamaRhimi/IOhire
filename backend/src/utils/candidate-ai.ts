import { parseJsonWithRecovery } from './json';
import { ollamaChat } from './ollama';
import { extractTextFromResume } from './resume-text';
import { isCvTemplateKey, renderCvMarkdownFromTemplate, type CvTemplateKey, type ResumeContent } from './cv-templates';

type CandidateEntity = {
  id: number;
  fullName?: string | null;
  email?: string | null;
  cvTemplateKey?: string | null;
  resume?: { url: string; mime?: string; ext?: string } | Array<{ url: string; mime?: string; ext?: string }>;
  jobPosting?: { requirements?: unknown } | null;
};

const PARSER_SYSTEM_PROMPT =
  'Extract contact info, skills, and work history from this CV into a clean JSON structure. ' +
  'Return ONLY valid JSON (no markdown, no code fences). ' +
  'Use this shape: { contact: { fullName?: string, email?: string, phone?: string, location?: string, links?: string[] }, ' +
  'summary?: string, skills: string[], experience: Array<{ company?: string, title?: string, startDate?: string, endDate?: string, highlights?: string[] }>, ' +
  'education?: Array<{ school?: string, degree?: string, startDate?: string, endDate?: string }>, certifications?: string[], projects?: Array<{ name?: string, description?: string, links?: string[] }> }';

const GENERATOR_SYSTEM_PROMPT =
  "Generate polished resume content from the candidate's extracted data. " +
  'Company style guide: concise, ATS-friendly, clear headings, bullet highlights, no tables. ' +
  'Return ONLY valid JSON (no markdown, no code fences) using this shape: ' +
  '{ summary?: string, skills: string[], experience: Array<{ company?: string, title?: string, startDate?: string, endDate?: string, highlights?: string[] }>, ' +
  'education?: Array<{ school?: string, degree?: string, startDate?: string, endDate?: string }>, certifications?: string[], projects?: Array<{ name?: string, description?: string, links?: string[] }>, ' +
  'languages?: string[], qualities?: string[], interests?: string[] }';

const JSON_REPAIR_SYSTEM_PROMPT =
  'You repair malformed JSON. Return ONLY valid JSON and preserve all original data fields/values as much as possible. ' +
  'Do not add markdown, explanations, comments, or code fences.';

const MONTH_MAP: Array<[RegExp, string]> = [
  [/\bjanvier\b/gi, 'January'],
  [/\bfevrier\b|\bf[ée]vrier\b/gi, 'February'],
  [/\bmars\b/gi, 'March'],
  [/\bavril\b/gi, 'April'],
  [/\bmai\b/gi, 'May'],
  [/\bjuin\b/gi, 'June'],
  [/\bjuillet\b/gi, 'July'],
  [/\bao[uû]t\b/gi, 'August'],
  [/\bseptembre\b/gi, 'September'],
  [/\boctobre\b/gi, 'October'],
  [/\bnovembre\b/gi, 'November'],
  [/\bd[ée]cembre\b/gi, 'December'],
  [/\bsept\b/gi, 'September'],
];

const SKILL_ALIAS_GROUPS: Record<string, string[]> = {
  vue: ['vuejs', 'vue js', 'vue.js'],
  angular: ['angularjs', 'angular js'],
  nextjs: ['next js', 'next.js'],
  nodejs: ['node js', 'node.js'],
  springboot: ['spring boot', 'spring-boot'],
  mongodb: ['mongo db', 'mongo-db', 'mango db', 'mangodb'],
  mysql: ['my sql'],
  tailwindcss: ['tailwind css'],
};

function truncateForModel(text: string, maxChars: number): string {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  const head = s.slice(0, Math.floor(maxChars * 0.65));
  const tail = s.slice(s.length - Math.floor(maxChars * 0.25));
  return `${head}\n\n[...truncated...]\n\n${tail}`;
}

function parseModelJson<T = unknown>(raw: string): { value: T; recovered: boolean } {
  const parsed = parseJsonWithRecovery<T>(raw);
  if (parsed.ok) return { value: parsed.value, recovered: parsed.recovered };
  if ('error' in parsed) throw parsed.error;
  throw new Error('Unexpected parse state');
}

function clampScore(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 100) / 100));
}

function pickTemplateKey(candidate: CandidateEntity): CvTemplateKey {
  const value = candidate.cvTemplateKey ?? undefined;
  return isCvTemplateKey(value) ? value : 'standard';
}

function asTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter(Boolean);
}

function uniqStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function normalizeDateText(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let out = input.trim();
  if (!out) return null;

  out = out.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [rx, replacement] of MONTH_MAP) out = out.replace(rx, replacement);

  out = out.replace(/\bactuellement\b|\ben cours\b/gi, 'Present');
  return out.trim() || null;
}

function normalizeParsedData(parsed: Record<string, unknown>): Record<string, unknown> {
  const contactRaw = (parsed.contact && typeof parsed.contact === 'object' ? parsed.contact : {}) as Record<string, unknown>;

  const contact = {
    fullName: asTrimmedString(contactRaw.fullName),
    email: asTrimmedString(contactRaw.email),
    phone: asTrimmedString(contactRaw.phone),
    location: asTrimmedString(contactRaw.location),
    links: uniqStrings(asStringArray(contactRaw.links)),
  };

  const skills = uniqStrings(asStringArray(parsed.skills));

  const experienceRaw = Array.isArray(parsed.experience) ? parsed.experience : [];
  const experience = experienceRaw
    .map((row: any) => {
      const company = asTrimmedString(row?.company);
      const title = asTrimmedString(row?.title);
      const startDate = normalizeDateText(row?.startDate);
      const endDate = normalizeDateText(row?.endDate);
      const highlights = uniqStrings(asStringArray(row?.highlights));
      if (!company && !title && !startDate && !endDate && highlights.length === 0) return null;
      return {
        ...(company ? { company } : {}),
        ...(title ? { title } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(highlights.length ? { highlights } : {}),
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  const educationRaw = Array.isArray(parsed.education) ? parsed.education : [];
  const education = educationRaw
    .map((row: any) => {
      const school = asTrimmedString(row?.school);
      const degree = asTrimmedString(row?.degree);
      const startDate = normalizeDateText(row?.startDate);
      const endDate = normalizeDateText(row?.endDate);
      if (!school && !degree && !startDate && !endDate) return null;
      return {
        ...(school ? { school } : {}),
        ...(degree ? { degree } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  const projectsRaw = Array.isArray(parsed.projects) ? parsed.projects : [];
  const projects = projectsRaw
    .map((row: any) => {
      const name = asTrimmedString(row?.name);
      const description = asTrimmedString(row?.description);
      const links = uniqStrings(asStringArray(row?.links));
      if (!name && !description && links.length === 0) return null;
      return {
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(links.length ? { links } : {}),
      };
    })
    .filter(Boolean) as Array<Record<string, unknown>>;

  const summary = asTrimmedString(parsed.summary);
  const certifications = uniqStrings(asStringArray(parsed.certifications));

  return {
    ...parsed,
    contact,
    skills,
    experience,
    education,
    projects,
    ...(summary ? { summary } : {}),
    certifications,
  };
}

function normalizeSkillKey(input: string): string {
  let s = input
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[^a-z0-9+#.\s-]/g, ' ')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  s = s.replace(/\bmango\s*db\b/g, 'mongodb').replace(/\bmongo\s*db\b/g, 'mongodb');
  return s;
}

function compactSkillKey(input: string): string {
  return normalizeSkillKey(input).replace(/\s+/g, '');
}

function resolveAliasGroup(compact: string): { canonical: string; aliases: string[] } {
  for (const [canonical, aliases] of Object.entries(SKILL_ALIAS_GROUPS)) {
    const aliasCompacts = aliases.map((v) => compactSkillKey(v));
    if (compact === compactSkillKey(canonical) || aliasCompacts.includes(compact)) {
      return { canonical, aliases };
    }
  }
  return { canonical: compact, aliases: [] };
}

function buildSkillVariants(skill: string): Set<string> {
  const base = normalizeSkillKey(skill);
  const compact = compactSkillKey(skill);
  const { canonical, aliases } = resolveAliasGroup(compact);
  const out = new Set<string>();
  if (base) out.add(base);
  if (compact) out.add(compact);

  const canonicalKey = normalizeSkillKey(canonical);
  const canonicalCompact = compactSkillKey(canonical);
  if (canonicalKey) out.add(canonicalKey);
  if (canonicalCompact) out.add(canonicalCompact);

  for (const alias of aliases) {
    const k = normalizeSkillKey(alias);
    const c = compactSkillKey(alias);
    if (k) out.add(k);
    if (c) out.add(c);
  }

  return out;
}

function buildEvidence(parsed: Record<string, unknown>): {
  textNormalized: string;
  textCompact: string;
  skillKeys: Set<string>;
} {
  const skills = asStringArray(parsed.skills);
  const skillKeys = new Set<string>();
  for (const s of skills) {
    const k = normalizeSkillKey(s);
    const c = compactSkillKey(s);
    if (k) skillKeys.add(k);
    if (c) skillKeys.add(c);
  }

  const parts: string[] = [];
  if (typeof parsed.summary === 'string') parts.push(parsed.summary);

  const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
  for (const row of experience as any[]) {
    if (typeof row?.title === 'string') parts.push(row.title);
    if (typeof row?.company === 'string') parts.push(row.company);
    for (const h of asStringArray(row?.highlights)) parts.push(h);
  }

  const projects = Array.isArray(parsed.projects) ? parsed.projects : [];
  for (const row of projects as any[]) {
    if (typeof row?.name === 'string') parts.push(row.name);
    if (typeof row?.description === 'string') parts.push(row.description);
    for (const link of asStringArray(row?.links)) parts.push(link);
  }

  const textNormalized = normalizeSkillKey(parts.join(' '));
  const textCompact = textNormalized.replace(/\s+/g, '');

  return { textNormalized, textCompact, skillKeys };
}

function hasSkillMatch(requiredSkill: string, evidence: { textNormalized: string; textCompact: string; skillKeys: Set<string> }): boolean {
  const variants = buildSkillVariants(requiredSkill);
  for (const variant of variants) {
    if (!variant) continue;
    if (evidence.skillKeys.has(variant)) return true;

    if (variant.includes(' ')) {
      if (evidence.textNormalized.includes(variant)) return true;
    } else if (evidence.textCompact.includes(variant)) {
      return true;
    }
  }
  return false;
}

function parseLooseDate(input: unknown): Date | null {
  const normalized = normalizeDateText(input);
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  if (['present', 'now', 'current', 'today'].includes(lower)) return new Date();

  const yearOnly = /^(\d{4})$/.exec(normalized);
  if (yearOnly) {
    const y = Number(yearOnly[1]);
    if (y >= 1900 && y <= 2100) return new Date(Date.UTC(y, 0, 1));
  }

  const ym = /^(\d{4})-(\d{1,2})$/.exec(normalized);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12) return new Date(Date.UTC(y, m - 1, 1));
  }

  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed);
}

function calculateExperienceYears(parsed: Record<string, unknown>): number {
  const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
  let totalMs = 0;

  for (const row of experience as any[]) {
    const start = parseLooseDate(row?.startDate);
    const end = parseLooseDate(row?.endDate) ?? new Date();
    if (!start || !end) continue;
    const delta = Math.max(0, end.getTime() - start.getTime());
    totalMs += delta;
  }

  return totalMs / (365.25 * 24 * 60 * 60 * 1000);
}

function deterministicEvaluate(requirements: unknown, parsed: Record<string, unknown>) {
  const requirementsObj = (requirements && typeof requirements === 'object' ? requirements : {}) as any;
  const required = uniqStrings(asStringArray(requirementsObj.skillsRequired));
  const niceToHave = uniqStrings(asStringArray(requirementsObj.skillsNiceToHave));

  const evidence = buildEvidence(parsed);

  const matchedRequired: string[] = [];
  const missingRequired: string[] = [];
  for (const skill of required) {
    if (hasSkillMatch(skill, evidence)) matchedRequired.push(skill);
    else missingRequired.push(skill);
  }

  const matchedNice: string[] = [];
  const missingNice: string[] = [];
  for (const skill of niceToHave) {
    if (hasSkillMatch(skill, evidence)) matchedNice.push(skill);
    else missingNice.push(skill);
  }

  const requiredCoverage = required.length > 0 ? matchedRequired.length / required.length : 1;
  const niceCoverage = niceToHave.length > 0 ? matchedNice.length / niceToHave.length : 1;

  const minYearsRaw = typeof requirementsObj.minYearsExperience === 'number'
    ? requirementsObj.minYearsExperience
    : Number(requirementsObj.minYearsExperience);
  const minYears = Number.isFinite(minYearsRaw) && minYearsRaw > 0 ? minYearsRaw : null;
  const actualYears = calculateExperienceYears(parsed);
  const experienceCoverage = minYears ? Math.max(0, Math.min(1, actualYears / minYears)) : 1;

  const fitScore = clampScore(requiredCoverage * 75 + niceCoverage * 15 + experienceCoverage * 10) ?? 0;

  const contact = (parsed.contact && typeof parsed.contact === 'object' ? parsed.contact : {}) as any;
  const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
  const education = Array.isArray(parsed.education) ? parsed.education : [];

  const hasFullName = !!asTrimmedString(contact.fullName);
  const hasEmail = !!asTrimmedString(contact.email);
  const hasPhone = !!asTrimmedString(contact.phone);
  const hasLocation = !!asTrimmedString(contact.location);
  const hasLinks = asStringArray(contact.links).length > 0;
  const hasSummary = !!asTrimmedString(parsed.summary);
  const hasEducation = education.length > 0;
  const hasExperience = experience.length > 0;
  const hasExperienceDates =
    hasExperience &&
    (experience as any[]).every((row) => !!normalizeDateText(row?.startDate) && !!normalizeDateText(row?.endDate));

  let completeness = 0;
  if (hasFullName) completeness += 10;
  if (hasEmail) completeness += 20;
  if (hasPhone) completeness += 10;
  if (hasLocation) completeness += 10;
  if (hasLinks) completeness += 5;
  if (hasSummary) completeness += 10;
  if (hasExperience) completeness += 15;
  if (hasExperienceDates) completeness += 10;
  if (hasEducation) completeness += 10;

  const completenessScore = clampScore(completeness) ?? 0;
  const score = clampScore(fitScore * 0.75 + completenessScore * 0.25) ?? 0;

  const missingFields: string[] = [];
  if (!hasFullName) missingFields.push('fullName');
  if (!hasEmail) missingFields.push('email');
  if (!hasPhone) missingFields.push('phone');
  if (!hasLocation) missingFields.push('location');
  if (!hasLinks) missingFields.push('links');
  if (!hasSummary) missingFields.push('summary');
  if (!hasEducation) missingFields.push('education');
  if (!hasExperience) missingFields.push('experience');
  if (hasExperience && !hasExperienceDates) missingFields.push('experienceDates');

  const notes =
    `Deterministic scoring: required=${matchedRequired.length}/${required.length}, ` +
    `nice=${matchedNice.length}/${niceToHave.length}, ` +
    `experienceYears=${actualYears.toFixed(1)}${minYears ? ` (required ${minYears})` : ''}. ` +
    `Weights: fit 75%, completeness 25%.`;

  return {
    score,
    fitScore,
    completenessScore,
    matchedSkills: matchedRequired,
    missingSkills: missingRequired,
    missingFields,
    notes,
    matchedNiceToHave: matchedNice,
    missingNiceToHave: missingNice,
    experienceYears: Math.round(actualYears * 10) / 10,
  };
}

function normalizeGeneratedResumeContent(content: ResumeContent): ResumeContent {
  const normalizeStart = (start: unknown, end: unknown): string | undefined => {
    const s = normalizeDateText(start);
    if (!s) return undefined;
    if (s.includes(' - ') && normalizeDateText(end)) {
      return s.split(' - ')[0]?.trim() || s;
    }
    return s;
  };

  const normalizeEnd = (end: unknown): string | undefined => {
    const e = normalizeDateText(end);
    return e || undefined;
  };

  const experience = Array.isArray(content.experience)
    ? content.experience.map((row) => ({
        ...row,
        ...(normalizeStart(row?.startDate, row?.endDate) ? { startDate: normalizeStart(row?.startDate, row?.endDate) } : {}),
        ...(normalizeEnd(row?.endDate) ? { endDate: normalizeEnd(row?.endDate) } : {}),
      }))
    : [];

  const education = Array.isArray(content.education)
    ? content.education.map((row) => ({
        ...row,
        ...(normalizeDateText(row?.startDate) ? { startDate: normalizeDateText(row?.startDate) as string } : {}),
        ...(normalizeDateText(row?.endDate) ? { endDate: normalizeDateText(row?.endDate) as string } : {}),
      }))
    : undefined;

  return {
    ...content,
    skills: uniqStrings(asStringArray(content.skills)),
    experience,
    ...(education ? { education } : {}),
  };
}

function resumeContentFromParsedData(parsed: Record<string, unknown>): ResumeContent {
  const experienceRaw = Array.isArray(parsed.experience) ? parsed.experience : [];
  const experience = experienceRaw
    .map((row: any) => {
      const company = asTrimmedString(row?.company);
      const title = asTrimmedString(row?.title);
      const startDate = normalizeDateText(row?.startDate);
      const endDate = normalizeDateText(row?.endDate);
      const highlights = uniqStrings(asStringArray(row?.highlights));
      if (!company && !title && !startDate && !endDate && highlights.length === 0) return null;
      return {
        ...(company ? { company } : {}),
        ...(title ? { title } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
        ...(highlights.length ? { highlights } : {}),
      };
    })
    .filter(Boolean) as NonNullable<ResumeContent['experience']>;

  const educationRaw = Array.isArray(parsed.education) ? parsed.education : [];
  const education = educationRaw
    .map((row: any) => {
      const school = asTrimmedString(row?.school);
      const degree = asTrimmedString(row?.degree);
      const startDate = normalizeDateText(row?.startDate);
      const endDate = normalizeDateText(row?.endDate);
      if (!school && !degree && !startDate && !endDate) return null;
      return {
        ...(school ? { school } : {}),
        ...(degree ? { degree } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      };
    })
    .filter(Boolean) as NonNullable<ResumeContent['education']>;

  const projectsRaw = Array.isArray(parsed.projects) ? parsed.projects : [];
  const projects = projectsRaw
    .map((row: any) => {
      const name = asTrimmedString(row?.name);
      const description = asTrimmedString(row?.description);
      const links = uniqStrings(asStringArray(row?.links));
      if (!name && !description && links.length === 0) return null;
      return {
        ...(name ? { name } : {}),
        ...(description ? { description } : {}),
        ...(links.length ? { links } : {}),
      };
    })
    .filter(Boolean) as NonNullable<ResumeContent['projects']>;

  return {
    ...(asTrimmedString(parsed.summary) ? { summary: asTrimmedString(parsed.summary) as string } : {}),
    skills: uniqStrings(asStringArray(parsed.skills)),
    experience,
    ...(education.length ? { education } : {}),
    certifications: uniqStrings(asStringArray(parsed.certifications)),
    ...(projects.length ? { projects } : {}),
    languages: uniqStrings(asStringArray(parsed.languages)),
    qualities: uniqStrings(asStringArray(parsed.qualities)),
    interests: uniqStrings(asStringArray(parsed.interests)),
  };
}

export async function processCandidate(candidateId: number): Promise<void> {
  const strapi = (globalThis as any).strapi;
  if (!strapi) throw new Error('Strapi is not available on globalThis.');

  const startedAt = Date.now();
  const log = (level: 'info' | 'warn' | 'error', message: string) => {
    strapi?.log?.[level]?.(`[candidate-ai] ${message}`);
  };

  const candidate = (await strapi.entityService.findOne('api::candidate.candidate', candidateId, {
    populate: ['resume', 'jobPosting'],
  })) as CandidateEntity | null;

  if (!candidate) return;
  const templateKey = pickTemplateKey(candidate);
  const resume = Array.isArray(candidate.resume) ? candidate.resume[0] : candidate.resume;
  if (!resume?.url) return;

  log('info', `Start candidate ${candidateId}`);
  await strapi.entityService.update('api::candidate.candidate', candidateId, {
    data: { status: 'processing' },
  });

  try {
    const t0 = Date.now();
    const cvText = await extractTextFromResume(resume);
    log('info', `candidate ${candidateId} extracted text in ${Date.now() - t0}ms`);
    if (!cvText.trim()) {
      strapi.log.warn(`[candidate-ai] No text extracted for candidate ${candidateId}`);
      await strapi.entityService.update('api::candidate.candidate', candidateId, {
        data: { status: 'error', hrNotes: 'No text could be extracted from the resume.' },
      });
      return;
    }

    const maxCvChars = Number(process.env.CANDIDATE_AI_MAX_CV_CHARS ?? 18000);
    const cvForModel = Number.isFinite(maxCvChars) && maxCvChars > 1000 ? truncateForModel(cvText, maxCvChars) : cvText;

    const t1 = Date.now();
    const parsedModel = parseModelJson<Record<string, unknown>>(
      await ollamaChat({
        system: PARSER_SYSTEM_PROMPT,
        user: cvForModel,
        format: 'json',
        timeoutMs: Number(process.env.CANDIDATE_AI_PARSE_TIMEOUT_MS ?? 120_000),
        ollamaOptions: { num_predict: Number(process.env.OLLAMA_NUM_PREDICT_PARSE ?? 900) },
      })
    );
    if (parsedModel.recovered) {
      log('warn', `candidate ${candidateId} parser output required JSON recovery`);
    }
    log('info', `candidate ${candidateId} parsed CV in ${Date.now() - t1}ms`);

    const parsed = normalizeParsedData(parsedModel.value);

    const t2 = Date.now();
    const evaluation = deterministicEvaluate(candidate.jobPosting?.requirements ?? {}, parsed);
    log('info', `candidate ${candidateId} evaluated deterministically in ${Date.now() - t2}ms`);

    const evalCompact = {
      score: evaluation.score,
      fitScore: evaluation.fitScore,
      completenessScore: evaluation.completenessScore,
      matchedSkills: evaluation.matchedSkills,
      missingSkills: evaluation.missingSkills,
      missingFields: evaluation.missingFields,
      notes: evaluation.notes,
    };

    const generatorInput =
      `Candidate extracted data (JSON):\n${JSON.stringify(parsed)}\n\n` +
      `Evaluation (JSON):\n${JSON.stringify(evalCompact)}\n\n` +
      'Generate strong but truthful bullet highlights. If some fields are missing, omit the section or use a short placeholder like "(Information not provided)".';

    const t3 = Date.now();
    const generatedRaw = await ollamaChat({
      system: GENERATOR_SYSTEM_PROMPT,
      user: generatorInput,
      format: 'json',
      timeoutMs: Number(process.env.CANDIDATE_AI_GENERATE_TIMEOUT_MS ?? 180_000),
      ollamaOptions: { num_predict: Number(process.env.OLLAMA_NUM_PREDICT_GENERATE ?? 1400) },
    });

    let resumeContentModel: { value: ResumeContent; recovered: boolean } | null = null;
    try {
      resumeContentModel = parseModelJson<ResumeContent>(generatedRaw);
    } catch (firstError: any) {
      log('warn', `candidate ${candidateId} generator parse failed, attempting repair pass: ${firstError?.message ?? firstError}`);
      try {
        const repairedRaw = await ollamaChat({
          system: JSON_REPAIR_SYSTEM_PROMPT,
          user:
            'Repair this malformed JSON into valid JSON while preserving content exactly where possible.\n\n' +
            generatedRaw,
          format: 'json',
          timeoutMs: Number(process.env.CANDIDATE_AI_GENERATE_TIMEOUT_MS ?? 180_000),
          ollamaOptions: { num_predict: Number(process.env.OLLAMA_NUM_PREDICT_GENERATE ?? 1400) },
        });
        resumeContentModel = parseModelJson<ResumeContent>(repairedRaw);
        log('warn', `candidate ${candidateId} generator parse succeeded after repair pass`);
      } catch (secondError: any) {
        log('warn', `candidate ${candidateId} generator repair failed, using extracted-data fallback: ${secondError?.message ?? secondError}`);
        resumeContentModel = { value: resumeContentFromParsedData(parsed), recovered: true };
      }
    }

    if (!resumeContentModel) {
      throw new Error('Resume generation returned no content.');
    }
    if (resumeContentModel.recovered) {
      log('warn', `candidate ${candidateId} generator output required JSON recovery`);
    }
    const resumeContent = normalizeGeneratedResumeContent(resumeContentModel.value);
    log('info', `candidate ${candidateId} generated resume content in ${Date.now() - t3}ms`);

    const markdown = renderCvMarkdownFromTemplate(templateKey, resumeContent);

    const contact = (parsed as any).contact ?? {};
    const derivedFullName = typeof contact.fullName === 'string' ? contact.fullName : undefined;
    const derivedEmail = typeof contact.email === 'string' ? contact.email : undefined;

    await strapi.entityService.update('api::candidate.candidate', candidateId, {
      data: {
        status: 'processed',
        extractedData: { ...parsed, evaluation, generatedResumeContent: resumeContent, cvTemplateKeyUsed: templateKey },
        ...(evaluation.score !== null ? { score: evaluation.score } : {}),
        standardizedCvMarkdown: markdown,
        ...(!candidate.fullName && derivedFullName ? { fullName: derivedFullName } : {}),
        ...(!candidate.email && derivedEmail ? { email: derivedEmail } : {}),
      },
    });
    log('info', `Done candidate ${candidateId} in ${Date.now() - startedAt}ms`);
  } catch (error: any) {
    await strapi.entityService.update('api::candidate.candidate', candidateId, {
      data: {
        status: 'error',
        hrNotes: `AI processing failed: ${error?.message ?? String(error)}`,
      },
    });
    log('error', `Failed candidate ${candidateId} after ${Date.now() - startedAt}ms: ${error?.message ?? error}`);
    throw error;
  }
}
