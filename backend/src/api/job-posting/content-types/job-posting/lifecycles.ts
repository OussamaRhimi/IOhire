function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const id = Math.trunc(n);
  return id > 0 ? id : null;
}

function getSingleUpload(resume: any): any | null {
  if (!resume) return null;
  if (Array.isArray(resume)) return resume[0] ?? null;
  if (resume?.data) return resume.data;
  return resume;
}

async function resolveJobPostingIds(strapi: any, where: unknown): Promise<number[]> {
  const filters = isObject(where) ? (where as Record<string, unknown>) : undefined;
  const jobs = (await strapi.entityService.findMany('api::job-posting.job-posting', {
    ...(filters ? { filters: filters as any } : {}),
    fields: ['id'] as any,
    limit: 10_000,
  })) as any[];

  const ids = new Set<number>();
  for (const job of jobs ?? []) {
    const id = toPositiveInt(job?.id);
    if (id) ids.add(id);
  }
  return Array.from(ids);
}

async function deleteCandidatesForJobPostings(strapi: any, jobIds: number[]) {
  if (!Array.isArray(jobIds) || jobIds.length === 0) return;
  const uploadSvc = strapi.plugin('upload').service('upload');
  const targetJobIds = Array.from(new Set(jobIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Math.trunc(id))));
  if (targetJobIds.length === 0) return;

  // Delete in batches so large datasets are handled without loading everything at once.
  for (;;) {
    const batch = (await strapi.entityService.findMany('api::candidate.candidate', {
      filters: { jobPosting: { id: { $in: targetJobIds } } } as any,
      fields: ['id'] as any,
      populate: ['resume'] as any,
      sort: { id: 'asc' } as any,
      limit: 200,
    })) as any[];

    if (!Array.isArray(batch) || batch.length === 0) break;

    const resumeIds = new Set<number>();
    let deletedCount = 0;

    for (const candidate of batch) {
      const candidateId = toPositiveInt(candidate?.id);
      if (!candidateId) continue;

      const resume = getSingleUpload(candidate?.resume);
      const resumeId = toPositiveInt(resume?.id);
      if (resumeId) resumeIds.add(resumeId);

      await strapi.entityService.delete('api::candidate.candidate', candidateId);
      deletedCount += 1;
    }

    for (const resumeId of resumeIds) {
      try {
        const file = await uploadSvc.findOne(resumeId);
        if (file) await uploadSvc.remove(file);
      } catch (error: any) {
        strapi?.log?.warn?.(
          `[job-posting] Failed to remove resume file ${resumeId} during cascade delete: ${error?.message ?? error}`
        );
      }
    }

    if (deletedCount === 0 || batch.length < 200) break;
  }
}

function toStringArray(value: unknown): string[] | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const items = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    return items.length ? Array.from(new Set(items)).slice(0, 100) : null;
  }
  if (typeof value === 'string') {
    const items = value
      .split(/[\n,]+/g)
      .map((v) => v.trim())
      .filter(Boolean);
    return items.length ? Array.from(new Set(items)).slice(0, 100) : null;
  }
  return null;
}

function toNonNegativeInt(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.floor(n);
  return i >= 0 ? i : null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeRequirements(raw: unknown): Record<string, unknown> | null {
  let value = raw;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      value = JSON.parse(trimmed);
    } catch {
      // allow raw text; interpret as notes
      value = { notes: trimmed };
    }
  }

  if (Array.isArray(value)) {
    const skillsRequired = toStringArray(value);
    return skillsRequired ? { skillsRequired } : null;
  }

  if (!isObject(value)) return null;

  const skillsRequired =
    toStringArray((value as any).skillsRequired) ??
    toStringArray((value as any).requiredSkills) ??
    toStringArray((value as any).skills);

  const skillsNiceToHave =
    toStringArray((value as any).skillsNiceToHave) ??
    toStringArray((value as any).niceToHave) ??
    toStringArray((value as any).optionalSkills);

  const departments =
    toStringArray((value as any).departments) ??
    toStringArray((value as any).department);

  const minYearsExperience =
    toNonNegativeInt((value as any).minYearsExperience) ??
    toNonNegativeInt((value as any).minYears) ??
    toNonNegativeInt((value as any).yearsExperience);

  const notes = toStringOrNull((value as any).notes) ?? toStringOrNull((value as any).requirementsNotes);

  const normalized: Record<string, unknown> = {};
  if (skillsRequired) normalized.skillsRequired = skillsRequired;
  if (skillsNiceToHave) normalized.skillsNiceToHave = skillsNiceToHave;
  if (departments) normalized.departments = departments;
  if (minYearsExperience != null) normalized.minYearsExperience = minYearsExperience;
  if (notes) normalized.notes = notes;

  return Object.keys(normalized).length ? normalized : null;
}

export default {
  beforeCreate(event: any) {
    const data = event?.params?.data;
    if (!data) return;
    if (!('requirements' in data)) return;
    data.requirements = normalizeRequirements(data.requirements);
  },
  beforeUpdate(event: any) {
    const data = event?.params?.data;
    if (!data) return;
    if (!('requirements' in data)) return;
    data.requirements = normalizeRequirements(data.requirements);
  },
  async beforeDelete(event: { params?: { where?: unknown } }) {
    const where = event?.params?.where;
    const strapi = (globalThis as any).strapi;
    if (!strapi?.entityService) return;
    const jobIds = await resolveJobPostingIds(strapi, where);
    await deleteCandidatesForJobPostings(strapi, jobIds);
  },
  async beforeDeleteMany(event: { params?: { where?: unknown } }) {
    const where = event?.params?.where;
    const strapi = (globalThis as any).strapi;
    if (!strapi?.entityService) return;
    const jobIds = await resolveJobPostingIds(strapi, where);
    await deleteCandidatesForJobPostings(strapi, jobIds);
  },
};

