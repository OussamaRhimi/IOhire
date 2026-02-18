function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
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
};

