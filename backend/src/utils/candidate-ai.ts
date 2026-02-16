import { extractLikelyJsonObject, safeJsonParse } from './json';
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

const EVALUATOR_SYSTEM_PROMPT =
  "Compare the candidate's extracted profile against the JobPosting requirements. " +
  'You will be given:\n' +
  '- requirements JSON (may include skillsRequired, skillsNiceToHave, minYearsExperience, notes)\n' +
  '- extracted candidate JSON (includes skills[], experience[], education[], contact, summary)\n' +
  'Rules:\n' +
  '- matchedSkills/missingSkills MUST be based on requirements.skillsRequired (+ optionally skillsNiceToHave) compared to candidate skills/experience.\n' +
  '- Prefer exact matches; allow obvious normalization (case, punctuation, whitespace, "js" vs "javascript"). Do NOT invent skills.\n' +
  '- If a required skill is only implied by experience text, you may count it as matched, but mention the evidence in notes.\n' +
  'Compute:\n' +
  '- fitScore (0-100): weight required skills heavily (e.g., 70%), then nice-to-have (e.g., 20%), then experience relevance (e.g., 10%).\n' +
  '- completenessScore (0-100): contact completeness + presence of experience dates + education.\n' +
  '- score (0-100): combine fit + completeness; explain the weighting briefly in notes.\n' +
  'Also list missingFields (e.g., email, phone, education, experienceDates, location, links). ' +
  'Return ONLY valid JSON (no markdown, no code fences) with this shape: ' +
  '{ score: number, fitScore: number, completenessScore: number, matchedSkills: string[], missingSkills: string[], missingFields: string[], notes?: string }';

const GENERATOR_SYSTEM_PROMPT =
  "Generate polished resume content from the candidate's extracted data. " +
  'Company style guide: concise, ATS-friendly, clear headings, bullet highlights, no tables. ' +
  'Return ONLY valid JSON (no markdown, no code fences) using this shape: ' +
  '{ summary?: string, skills: string[], experience: Array<{ company?: string, title?: string, startDate?: string, endDate?: string, highlights?: string[] }>, ' +
  'education?: Array<{ school?: string, degree?: string, startDate?: string, endDate?: string }>, certifications?: string[], projects?: Array<{ name?: string, description?: string, links?: string[] }>, ' +
  'languages?: string[], qualities?: string[], interests?: string[] }';

function truncateForModel(text: string, maxChars: number): string {
  const s = String(text ?? '');
  if (s.length <= maxChars) return s;
  const head = s.slice(0, Math.floor(maxChars * 0.65));
  const tail = s.slice(s.length - Math.floor(maxChars * 0.25));
  return `${head}\n\n[...truncated...]\n\n${tail}`;
}

function parseModelJson<T = unknown>(raw: string): T {
  const direct = safeJsonParse<T>(raw);
  if (direct.ok) return direct.value;

  const extracted = extractLikelyJsonObject(raw);
  if (extracted) {
    const second = safeJsonParse<T>(extracted);
    if (second.ok) return second.value;
  }

  throw (direct as { ok: false; error: Error }).error;
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
    const parsed = parseModelJson<Record<string, unknown>>(
      await ollamaChat({
        system: PARSER_SYSTEM_PROMPT,
        user: cvForModel,
        format: 'json',
        timeoutMs: Number(process.env.CANDIDATE_AI_PARSE_TIMEOUT_MS ?? 120_000),
        ollamaOptions: { num_predict: Number(process.env.OLLAMA_NUM_PREDICT_PARSE ?? 900) },
      })
    );
    log('info', `candidate ${candidateId} parsed CV in ${Date.now() - t1}ms`);

    const requirements = candidate.jobPosting?.requirements ?? {};
    const requirementsObj = (requirements && typeof requirements === 'object' ? requirements : {}) as any;
    const skillsRequired = Array.isArray(requirementsObj.skillsRequired)
      ? requirementsObj.skillsRequired.filter((s: any) => typeof s === 'string')
      : [];
    const skillsNiceToHave = Array.isArray(requirementsObj.skillsNiceToHave)
      ? requirementsObj.skillsNiceToHave.filter((s: any) => typeof s === 'string')
      : [];
    const extractedSkills = Array.isArray((parsed as any)?.skills) ? (parsed as any).skills.filter((s: any) => typeof s === 'string') : [];

    const evaluationInput =
      `JobPosting requirements (JSON):\n${JSON.stringify(requirements)}\n\n` +
      `Requirements skillsRequired: ${JSON.stringify(skillsRequired)}\n` +
      `Requirements skillsNiceToHave: ${JSON.stringify(skillsNiceToHave)}\n` +
      `Candidate extracted skills: ${JSON.stringify(extractedSkills)}\n\n` +
      `Candidate extracted data (JSON):\n${JSON.stringify(parsed)}`;

    const t2 = Date.now();
    const evaluation = parseModelJson<Record<string, unknown>>(
      await ollamaChat({
        system: EVALUATOR_SYSTEM_PROMPT,
        user: evaluationInput,
        format: 'json',
        timeoutMs: Number(process.env.CANDIDATE_AI_EVAL_TIMEOUT_MS ?? 90_000),
        ollamaOptions: { num_predict: Number(process.env.OLLAMA_NUM_PREDICT_EVAL ?? 700) },
      })
    );
    log('info', `candidate ${candidateId} evaluated in ${Date.now() - t2}ms`);

    const score = clampScore((evaluation as any).score);

    const evalCompact = {
      score: (evaluation as any).score,
      fitScore: (evaluation as any).fitScore,
      completenessScore: (evaluation as any).completenessScore,
      matchedSkills: (evaluation as any).matchedSkills,
      missingSkills: (evaluation as any).missingSkills,
      missingFields: (evaluation as any).missingFields,
      notes: (evaluation as any).notes,
    };

    const generatorInput =
      `Candidate extracted data (JSON):\n${JSON.stringify(parsed)}\n\n` +
      `Evaluation (JSON):\n${JSON.stringify(evalCompact)}\n\n` +
      'Generate strong but truthful bullet highlights. If some fields are missing, omit the section or use a short placeholder like "(Information not provided)".';

    const t3 = Date.now();
    const resumeContent = parseModelJson<ResumeContent>(
      await ollamaChat({
        system: GENERATOR_SYSTEM_PROMPT,
        user: generatorInput,
        format: 'json',
        timeoutMs: Number(process.env.CANDIDATE_AI_GENERATE_TIMEOUT_MS ?? 180_000),
        ollamaOptions: { num_predict: Number(process.env.OLLAMA_NUM_PREDICT_GENERATE ?? 1400) },
      })
    );
    log('info', `candidate ${candidateId} generated resume content in ${Date.now() - t3}ms`);

    const markdown = renderCvMarkdownFromTemplate(templateKey, resumeContent);

    const contact = (parsed as any).contact ?? {};
    const derivedFullName = typeof contact.fullName === 'string' ? contact.fullName : undefined;
    const derivedEmail = typeof contact.email === 'string' ? contact.email : undefined;

    await strapi.entityService.update('api::candidate.candidate', candidateId, {
      data: {
        status: 'processed',
        extractedData: { ...parsed, evaluation, generatedResumeContent: resumeContent, cvTemplateKeyUsed: templateKey },
        ...(score !== null ? { score } : {}),
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
