import { parseJsonWithRecovery } from './json';
import { ollamaChat } from './ollama';
import { extractTextFromResume } from './resume-text';
import { isCvTemplateKey, renderCvMarkdownFromTemplate, type CvTemplateKey, type ResumeContent } from './cv-templates';

/* ------------------------------------------------------------------ */
/*  Evaluation Config                                                  */
/* ------------------------------------------------------------------ */

export type CompletenessPointsConfig = {
  fullName: number;
  email: number;
  phone: number;
  location: number;
  links: number;
  linkedin: number;
  portfolio: number;
  summary: number;
  competencies: number;
  experience: number;
  experienceDates: number;
  education: number;
};

export type CustomCriterion = {
  name: string;
  type: 'bonus' | 'penalty';
  points: number;
  keywords: string[];
  requireAll: boolean;
};

export type QualityThresholds = {
  excellent: number;
  good: number;
  fair: number;
};

export type EvaluationConfig = {
  fitWeight: number;
  completenessWeight: number;
  requiredSkillsWeight: number;
  niceToHaveSkillsWeight: number;
  experienceWeight: number;
  completenessPoints: CompletenessPointsConfig;
  customCriteria: CustomCriterion[];
  qualityThresholds: QualityThresholds;
};

export const DEFAULT_EVALUATION_CONFIG: EvaluationConfig = {
  fitWeight: 75,
  completenessWeight: 25,
  requiredSkillsWeight: 75,
  niceToHaveSkillsWeight: 15,
  experienceWeight: 10,
  completenessPoints: {
    fullName: 10,
    email: 15,
    phone: 5,
    location: 5,
    links: 5,
    linkedin: 5,
    portfolio: 5,
    summary: 10,
    competencies: 5,
    experience: 15,
    experienceDates: 10,
    education: 10,
  },
  customCriteria: [],
  qualityThresholds: { excellent: 80, good: 60, fair: 40 },
};

export function mergeEvaluationConfig(raw: unknown): EvaluationConfig {
  const d = DEFAULT_EVALUATION_CONFIG;
  if (!raw || typeof raw !== 'object') return { ...d, completenessPoints: { ...d.completenessPoints }, customCriteria: [], qualityThresholds: { ...d.qualityThresholds } };
  const r = raw as any;

  const fitWeight = clampNum(r.fitWeight, 0, 100, d.fitWeight);
  const completenessWeight = clampNum(r.completenessWeight, 0, 100, d.completenessWeight);
  const requiredSkillsWeight = clampNum(r.requiredSkillsWeight, 0, 100, d.requiredSkillsWeight);
  const niceToHaveSkillsWeight = clampNum(r.niceToHaveSkillsWeight, 0, 100, d.niceToHaveSkillsWeight);
  const experienceWeight = clampNum(r.experienceWeight, 0, 100, d.experienceWeight);

  const cp = r.completenessPoints && typeof r.completenessPoints === 'object' ? r.completenessPoints : {};
  const completenessPoints: CompletenessPointsConfig = {
    fullName: clampNum(cp.fullName, 0, 100, d.completenessPoints.fullName),
    email: clampNum(cp.email, 0, 100, d.completenessPoints.email),
    phone: clampNum(cp.phone, 0, 100, d.completenessPoints.phone),
    location: clampNum(cp.location, 0, 100, d.completenessPoints.location),
    links: clampNum(cp.links, 0, 100, d.completenessPoints.links),
    linkedin: clampNum(cp.linkedin, 0, 100, d.completenessPoints.linkedin),
    portfolio: clampNum(cp.portfolio, 0, 100, d.completenessPoints.portfolio),
    summary: clampNum(cp.summary, 0, 100, d.completenessPoints.summary),
    competencies: clampNum(cp.competencies, 0, 100, d.completenessPoints.competencies),
    experience: clampNum(cp.experience, 0, 100, d.completenessPoints.experience),
    experienceDates: clampNum(cp.experienceDates, 0, 100, d.completenessPoints.experienceDates),
    education: clampNum(cp.education, 0, 100, d.completenessPoints.education),
  };

  const customCriteria: CustomCriterion[] = [];
  if (Array.isArray(r.customCriteria)) {
    for (const c of r.customCriteria) {
      if (!c || typeof c !== 'object') continue;
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      const type = c.type === 'penalty' ? 'penalty' : 'bonus';
      const points = clampNum(c.points, 0, 50, 5);
      const keywords = Array.isArray(c.keywords) ? c.keywords.filter((k: any) => typeof k === 'string' && k.trim()).map((k: any) => k.trim()) : [];
      const requireAll = !!c.requireAll;
      if (name && keywords.length > 0) customCriteria.push({ name, type, points, keywords, requireAll });
    }
  }

  const qt = r.qualityThresholds && typeof r.qualityThresholds === 'object' ? r.qualityThresholds : {};
  const qualityThresholds: QualityThresholds = {
    excellent: clampNum(qt.excellent, 0, 100, d.qualityThresholds.excellent),
    good: clampNum(qt.good, 0, 100, d.qualityThresholds.good),
    fair: clampNum(qt.fair, 0, 100, d.qualityThresholds.fair),
  };

  return { fitWeight, completenessWeight, requiredSkillsWeight, niceToHaveSkillsWeight, experienceWeight, completenessPoints, customCriteria, qualityThresholds };
}

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

type CandidateEntity = {
  id: number;
  fullName?: string | null;
  email?: string | null;
  linkedin?: string | null;
  portfolio?: string | null;
  cvTemplateKey?: string | null;
  resume?: { url: string; mime?: string; ext?: string } | Array<{ url: string; mime?: string; ext?: string }>;
  jobPosting?: { requirements?: unknown } | null;
};

const PARSER_SYSTEM_PROMPT =
  'Extract contact info, skills, and work history from this CV into a clean JSON structure. ' +
  'Return ONLY valid JSON (no markdown, no code fences). ' +
  'IMPORTANT: For all dates (startDate, endDate), use the format "Month YYYY" (e.g. "June 2025"). ' +
  'If only a year is given, use "YYYY". If the role is current/ongoing, set endDate to "Present". ' +
  'CRITICAL CLASSIFICATION RULES: ' +
  '- "skills" is ONLY for short technology/tool names (e.g. "React", "Node.js", "Docker", "PostgreSQL", "Git"). ' +
  '- "competencies" is for accomplishment descriptions or capability statements (e.g. "Built a complete authentication system", "Implemented 2FA with TOTP"). ' +
  '- Do NOT put full sentences or descriptions in "skills". If it reads like a sentence, it belongs in "competencies". ' +
  '- "education" is for degrees, diplomas, academic programs at universities, institutes, schools, or colleges (e.g. "Software Engineering at ISIMS", "Bachelor at MIT"). ' +
  '- "experience" is ONLY for professional work: jobs, internships at companies, freelance work. ' +
  '- If someone is a STUDENT at a university/institute/school, that belongs in "education", NOT "experience". ' +
  '- Internships at companies (not schools) go in "experience". ' +
  '- Academic projects or student roles at educational institutions go in "education" or "projects", NOT "experience". ' +
  'Use this shape: { contact: { fullName?: string, email?: string, phone?: string, location?: string, links?: string[] }, ' +
  'summary?: string, skills: string[], competencies?: string[], experience: Array<{ company?: string, title?: string, startDate?: string, endDate?: string, highlights?: string[] }>, ' +
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

  // Trim trailing dashes/spaces that sometimes appear: "June 2025 - -" → "June 2025"
  out = out.replace(/[\s-]+$/, '').trim();

  // Collapse stray separators: "- -" or "--" at the end
  out = out.replace(/^[\s-]+$/, '').trim();

  return out || null;
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
  let experience = experienceRaw
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
  let education = educationRaw
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

  // ── Post-processing: fix misclassified education ↔ experience entries ──
  const eduKeywords = /\b(universit|institut|facult|school|college|acad|isims|isim|isg|isi\b|istic|ensi|enis|enet|esprit|insat|supcom|polytech|licence|bachelor|master|doctorat|mba|diplom|engineer|ing[eé]nieur|bts|dut|student|[eé]tudiant|[eé]l[eè]ve)\b/i;
  const internKeywords = /\b(intern|internship|stage|stagiaire)\b/i;

  // Move experience entries that look like education
  const misclassifiedAsExp: Array<Record<string, unknown>> = [];
  experience = experience.filter((entry) => {
    const company = String(entry.company ?? '').toLowerCase();
    const title = String(entry.title ?? '').toLowerCase();
    const combined = `${company} ${title}`;

    // If the title or company strongly indicates education AND it's not an internship
    const looksLikeEdu = eduKeywords.test(combined) && !internKeywords.test(combined);

    // Also check if the "company" matches an existing education school name
    const matchesEduSchool = company && education.some((edu) => {
      const school = String(edu.school ?? '').toLowerCase();
      return school && (company.includes(school) || school.includes(company));
    });

    if (looksLikeEdu || matchesEduSchool) {
      misclassifiedAsExp.push(entry);
      return false; // remove from experience
    }
    return true;
  });

  // Convert misclassified experience entries into education entries
  for (const entry of misclassifiedAsExp) {
    const school = asTrimmedString(entry.company) || asTrimmedString(entry.title);
    const degree = asTrimmedString(entry.title) || null;
    const startDate = asTrimmedString(entry.startDate) || null;
    const endDate = asTrimmedString(entry.endDate) || null;

    // Check if this school already exists in education
    const existing = education.find((edu) => {
      const existingSchool = String(edu.school ?? '').toLowerCase();
      const newSchool = (school ?? '').toLowerCase();
      return existingSchool && newSchool && (
        existingSchool.includes(newSchool) || newSchool.includes(existingSchool)
      );
    });

    if (existing) {
      // Merge: fill in missing dates or degree
      if (!existing.startDate && startDate) existing.startDate = startDate;
      if (!existing.endDate && endDate) existing.endDate = endDate;
      if ((!existing.degree || existing.degree === 'Education') && degree && degree !== school) {
        existing.degree = degree;
      }
    } else {
      // Add as new education entry
      education.push({
        ...(school ? { school } : {}),
        ...(degree && degree !== school ? { degree } : {}),
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      });
    }
  }

  // Move education entries that look like work experience (e.g., internships at companies)
  const misclassifiedAsEdu: Array<Record<string, unknown>> = [];
  education = education.filter((entry) => {
    const school = String(entry.school ?? '').toLowerCase();
    const degree = String(entry.degree ?? '').toLowerCase();
    const combined = `${school} ${degree}`;

    // If it mentions internship and does NOT look like a school
    if (internKeywords.test(combined) && !eduKeywords.test(combined)) {
      misclassifiedAsEdu.push(entry);
      return false;
    }
    return true;
  });

  for (const entry of misclassifiedAsEdu) {
    experience.push({
      ...(entry.school ? { company: entry.school } : {}),
      ...(entry.degree ? { title: entry.degree } : {}),
      ...(entry.startDate ? { startDate: entry.startDate } : {}),
      ...(entry.endDate ? { endDate: entry.endDate } : {}),
    });
  }
  // ── End post-processing ──

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

  // Separate skills (short tech names) from competencies (achievement descriptions)
  const COMPETENCY_THRESHOLD = 40; // chars – anything longer is likely a competency
  const VERB_START = /^(built|created|designed|developed|implemented|added|set\s+up|managed|led|reduced|improved|introduced|wrote|deployed|integrated|maintained|established|architected|automated|configured|migrated|optimized|launched|delivered|coordinated|conducted)/i;
  const pureSkills: string[] = [];
  const autoCompetencies: string[] = [];
  for (const s of skills) {
    if (s.length > COMPETENCY_THRESHOLD || VERB_START.test(s) || (s.includes(' ') && s.split(' ').length > 5)) {
      autoCompetencies.push(s);
    } else {
      pureSkills.push(s);
    }
  }
  const parsedCompetencies = uniqStrings(asStringArray(parsed.competencies));
  const competencies = uniqStrings([...autoCompetencies, ...parsedCompetencies]);

  // ── Extract tech keywords mentioned inside competencies and add them to skills ──
  const skillLower = new Set(pureSkills.map((s) => s.toLowerCase()));
  const techExtracted: string[] = [];

  // Tokens that look like tech names when found inside a sentence.
  // We capture: camelCase/PascalCase words (ReactJS, ExpressJS, NodeJS, MongoDB …),
  // dotted names (Node.js, Vue.js, ASP.NET …), words with + or # (C++, C#),
  // and a curated set of lower-case tech names that would otherwise be missed.
  const TECH_TOKEN_RX =
    /\b([A-Z][a-z]+(?:[A-Z][a-zA-Z]*)+)\b|(?<![.\w])([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+)(?![.\w])|\b(C\+\+|C#|F#)\b/g;

  const KNOWN_LOWER: Set<string> = new Set([
    'react', 'angular', 'vue', 'svelte', 'nextjs', 'nuxtjs', 'gatsby',
    'node', 'nodejs', 'express', 'expressjs', 'nestjs', 'fastify', 'hapi', 'koa',
    'django', 'flask', 'fastapi', 'rails', 'laravel', 'symfony', 'spring', 'springboot',
    'typescript', 'javascript', 'python', 'java', 'kotlin', 'swift', 'rust', 'golang', 'go',
    'ruby', 'php', 'perl', 'scala', 'elixir', 'haskell', 'clojure', 'dart', 'lua',
    'html', 'css', 'sass', 'scss', 'less', 'tailwind', 'tailwindcss', 'bootstrap',
    'sql', 'mysql', 'postgresql', 'postgres', 'sqlite', 'mariadb', 'oracle',
    'mongodb', 'redis', 'elasticsearch', 'cassandra', 'dynamodb', 'couchdb', 'neo4j',
    'docker', 'kubernetes', 'k8s', 'terraform', 'ansible', 'jenkins', 'gitlab', 'github',
    'aws', 'azure', 'gcp', 'firebase', 'heroku', 'vercel', 'netlify', 'cloudflare',
    'graphql', 'rest', 'grpc', 'websocket', 'socket.io',
    'webpack', 'vite', 'esbuild', 'rollup', 'parcel', 'babel',
    'jest', 'mocha', 'cypress', 'playwright', 'selenium', 'vitest',
    'git', 'linux', 'nginx', 'apache', 'kafka', 'rabbitmq',
    'figma', 'sketch', 'photoshop', 'illustrator',
    'tensorflow', 'pytorch', 'keras', 'pandas', 'numpy', 'scikit-learn', 'opencv',
    'unity', 'unreal', 'flutter', 'reactnative', 'ionic', 'xamarin',
    'strapi', 'contentful', 'sanity', 'wordpress', 'drupal',
    'jira', 'trello', 'confluence', 'slack', 'notion',
    'oauth', 'jwt', 'saml', 'ldap',
    'ci/cd', 'cicd', 'devops', 'agile', 'scrum',
    'hadoop', 'spark', 'airflow', 'dbt', 'snowflake', 'bigquery',
    'power bi', 'tableau', 'looker', 'grafana', 'prometheus',
    'solidity', 'web3', 'ethereum', 'blockchain',
  ]);

  // Word-boundary scan for known lower-case tech names
  const WORD_SPLIT_RX = /[^a-zA-Z0-9+#/.]+/;

  for (const comp of competencies) {
    // 1. Regex-based extraction (PascalCase, dotted, C++/C#)
    let m: RegExpExecArray | null;
    TECH_TOKEN_RX.lastIndex = 0;
    while ((m = TECH_TOKEN_RX.exec(comp)) !== null) {
      const token = (m[1] || m[2] || m[3]).trim();
      if (token && !skillLower.has(token.toLowerCase())) {
        techExtracted.push(token);
        skillLower.add(token.toLowerCase());
      }
    }

    // 2. Scan individual words against the curated list
    const words = comp.split(WORD_SPLIT_RX);
    for (const w of words) {
      const lower = w.toLowerCase();
      if (!lower || lower.length < 2) continue;
      if (KNOWN_LOWER.has(lower) && !skillLower.has(lower)) {
        // Preserve original casing from the competency text
        techExtracted.push(w);
        skillLower.add(lower);
      }
    }
  }

  const finalSkills = uniqStrings([...pureSkills, ...techExtracted]);

  return {
    ...parsed,
    contact,
    skills: finalSkills,
    competencies,
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

  // Year only: "2024"
  const yearOnly = /^(\d{4})$/.exec(normalized);
  if (yearOnly) {
    const y = Number(yearOnly[1]);
    if (y >= 1900 && y <= 2100) return new Date(Date.UTC(y, 0, 1));
  }

  // YYYY-MM or YYYY/MM: "2024-07", "2024/07"
  const ym = /^(\d{4})[\/-](\d{1,2})$/.exec(normalized);
  if (ym) {
    const y = Number(ym[1]);
    const m = Number(ym[2]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12) return new Date(Date.UTC(y, m - 1, 1));
  }

  // MM/YYYY or MM-YYYY: "07/2024"
  const my = /^(\d{1,2})[\/-](\d{4})$/.exec(normalized);
  if (my) {
    const m = Number(my[1]);
    const y = Number(my[2]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12) return new Date(Date.UTC(y, m - 1, 1));
  }

  // Month name map for robust matching
  const monthNames: Record<string, number> = {
    january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
    may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7,
    september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10,
    december: 11, dec: 11,
  };

  // "Month YYYY" or "Mon YYYY" or "Month. YYYY": "June 2025", "Sep. 2024"
  const monthYearMatch = /^([a-zA-Z]+)\.?\s+(\d{4})$/i.exec(normalized);
  if (monthYearMatch) {
    const monthKey = monthYearMatch[1].toLowerCase();
    const year = Number(monthYearMatch[2]);
    if (monthKey in monthNames && year >= 1900 && year <= 2100) {
      return new Date(Date.UTC(year, monthNames[monthKey], 1));
    }
  }

  // "YYYY Month": "2024 July"
  const yearMonthMatch = /^(\d{4})\s+([a-zA-Z]+)\.?$/i.exec(normalized);
  if (yearMonthMatch) {
    const year = Number(yearMonthMatch[1]);
    const monthKey = yearMonthMatch[2].toLowerCase();
    if (monthKey in monthNames && year >= 1900 && year <= 2100) {
      return new Date(Date.UTC(year, monthNames[monthKey], 1));
    }
  }

  // "DD Month YYYY" or "DD Mon YYYY": "15 June 2025"
  const dayMonthYear = /^(\d{1,2})\s+([a-zA-Z]+)\.?\s+(\d{4})$/i.exec(normalized);
  if (dayMonthYear) {
    const d = Number(dayMonthYear[1]);
    const monthKey = dayMonthYear[2].toLowerCase();
    const y = Number(dayMonthYear[3]);
    if (monthKey in monthNames && y >= 1900 && y <= 2100 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, monthNames[monthKey], d));
    }
  }

  // "Month DD, YYYY": "June 15, 2025"
  const monthDayYear = /^([a-zA-Z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(normalized);
  if (monthDayYear) {
    const monthKey = monthDayYear[1].toLowerCase();
    const d = Number(monthDayYear[2]);
    const y = Number(monthDayYear[3]);
    if (monthKey in monthNames && y >= 1900 && y <= 2100 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, monthNames[monthKey], d));
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY: "15/07/2024"
  const dmy = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/.exec(normalized);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    const y = Number(dmy[3]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, m - 1, d));
    }
  }

  // YYYY-MM-DD: "2024-07-15"
  const ymd = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(normalized);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]);
    const d = Number(ymd[3]);
    if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return new Date(Date.UTC(y, m - 1, d));
    }
  }

  // Fallback to native parser
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

function deterministicEvaluate(requirements: unknown, parsed: Record<string, unknown>, candidateMeta?: { linkedin?: string; portfolio?: string }) {
  const requirementsObj = (requirements && typeof requirements === 'object' ? requirements : {}) as any;
  const cfg = mergeEvaluationConfig(requirementsObj.evaluationConfig);
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

  // Configurable fit sub-weights (normalized to sum=100)
  const fitSubTotal = cfg.requiredSkillsWeight + cfg.niceToHaveSkillsWeight + cfg.experienceWeight;
  const rw = fitSubTotal > 0 ? cfg.requiredSkillsWeight / fitSubTotal * 100 : 75;
  const nw = fitSubTotal > 0 ? cfg.niceToHaveSkillsWeight / fitSubTotal * 100 : 15;
  const ew = fitSubTotal > 0 ? cfg.experienceWeight / fitSubTotal * 100 : 10;

  const fitScore = clampScore(requiredCoverage * rw + niceCoverage * nw + experienceCoverage * ew) ?? 0;

  const contact = (parsed.contact && typeof parsed.contact === 'object' ? parsed.contact : {}) as any;
  const experience = Array.isArray(parsed.experience) ? parsed.experience : [];
  const education = Array.isArray(parsed.education) ? parsed.education : [];

  const hasFullName = !!asTrimmedString(contact.fullName);
  const hasEmail = !!asTrimmedString(contact.email);
  const hasPhone = !!asTrimmedString(contact.phone);
  const hasLocation = !!asTrimmedString(contact.location);
  const hasLinks = asStringArray(contact.links).length > 0;
  const hasLinkedin = !!(candidateMeta?.linkedin?.trim()) || asStringArray(contact.links).some((l: string) => /linkedin\.com/i.test(l));
  const hasPortfolio = !!(candidateMeta?.portfolio?.trim()) || asStringArray(contact.links).some((l: string) => /github\.com|gitlab\.com|bitbucket\.org|portfolio|behance|dribbble/i.test(l));
  const hasSummary = !!asTrimmedString(parsed.summary);
  const hasCompetencies = asStringArray(parsed.competencies).length > 0;
  const hasEducation = education.length > 0;
  const hasExperience = experience.length > 0;
  const hasExperienceDates =
    hasExperience &&
    (experience as any[]).every((row) => !!normalizeDateText(row?.startDate) && !!normalizeDateText(row?.endDate));

  // Configurable completeness points
  const cp = cfg.completenessPoints;
  let completeness = 0;
  const cpTotal = cp.fullName + cp.email + cp.phone + cp.location + cp.links + cp.linkedin + cp.portfolio + cp.summary + cp.competencies + cp.experience + cp.experienceDates + cp.education;
  if (hasFullName) completeness += cp.fullName;
  if (hasEmail) completeness += cp.email;
  if (hasPhone) completeness += cp.phone;
  if (hasLocation) completeness += cp.location;
  if (hasLinks) completeness += cp.links;
  if (hasLinkedin) completeness += cp.linkedin;
  if (hasPortfolio) completeness += cp.portfolio;
  if (hasSummary) completeness += cp.summary;
  if (hasCompetencies) completeness += cp.competencies;
  if (hasExperience) completeness += cp.experience;
  if (hasExperienceDates) completeness += cp.experienceDates;
  if (hasEducation) completeness += cp.education;
  if (hasExperienceDates) completeness += cp.experienceDates;
  if (hasEducation) completeness += cp.education;

  // Normalize to 0–100 in case points don't sum to 100
  const completenessScore = cpTotal > 0 ? clampScore(completeness / cpTotal * 100) ?? 0 : 0;

  // Configurable main weights (normalized to sum=100)
  const mainTotal = cfg.fitWeight + cfg.completenessWeight;
  const fw = mainTotal > 0 ? cfg.fitWeight / mainTotal : 0.75;
  const cw = mainTotal > 0 ? cfg.completenessWeight / mainTotal : 0.25;
  let score = clampScore(fitScore * fw + completenessScore * cw) ?? 0;

  // Custom criteria bonuses/penalties
  const customResults: Array<{ name: string; type: 'bonus' | 'penalty'; points: number; matched: boolean }> = [];
  if (cfg.customCriteria.length > 0) {
    const evidenceText = evidence.textNormalized;
    for (const criterion of cfg.customCriteria) {
      const kwNorms = criterion.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean);
      if (kwNorms.length === 0) continue;
      const matched = criterion.requireAll
        ? kwNorms.every((kw) => evidenceText.includes(kw))
        : kwNorms.some((kw) => evidenceText.includes(kw));
      customResults.push({ name: criterion.name, type: criterion.type, points: criterion.points, matched });
      if (matched) {
        if (criterion.type === 'bonus') score = Math.min(100, score + criterion.points);
        else score = Math.max(0, score - criterion.points);
      }
    }
  }

  const missingFields: string[] = [];
  if (!hasFullName) missingFields.push('fullName');
  if (!hasEmail) missingFields.push('email');
  if (!hasPhone) missingFields.push('phone');
  if (!hasLocation) missingFields.push('location');
  if (!hasLinks) missingFields.push('links');
  if (!hasLinkedin) missingFields.push('linkedin');
  if (!hasPortfolio) missingFields.push('portfolio');
  if (!hasSummary) missingFields.push('summary');
  if (!hasCompetencies) missingFields.push('competencies');
  if (!hasEducation) missingFields.push('education');
  if (!hasExperience) missingFields.push('experience');
  if (hasExperience && !hasExperienceDates) missingFields.push('experienceDates');

  const notes =
    `Deterministic scoring: required=${matchedRequired.length}/${required.length}, ` +
    `nice=${matchedNice.length}/${niceToHave.length}, ` +
    `experienceYears=${actualYears.toFixed(1)}${minYears ? ` (required ${minYears})` : ''}. ` +
    `Weights: fit ${cfg.fitWeight}%, completeness ${cfg.completenessWeight}%.`;

  return {
    score: clampScore(score) ?? 0,
    fitScore,
    completenessScore,
    matchedSkills: matchedRequired,
    missingSkills: missingRequired,
    missingFields,
    notes,
    matchedNiceToHave: matchedNice,
    missingNiceToHave: missingNice,
    experienceYears: Math.round(actualYears * 10) / 10,
    customResults: customResults.length > 0 ? customResults : undefined,
    evaluationConfig: cfg,
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
    const evaluation = deterministicEvaluate(candidate.jobPosting?.requirements ?? {}, parsed, {
      linkedin: (candidate as any).linkedin ?? undefined,
      portfolio: (candidate as any).portfolio ?? undefined,
    });
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
