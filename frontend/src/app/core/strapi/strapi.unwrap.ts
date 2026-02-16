function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object';
}

function pick<T = unknown>(obj: unknown, path: string[]): T | null {
  let current: any = obj;
  for (const key of path) {
    if (!isObject(current)) return null;
    current = (current as any)[key];
  }
  return (current as T) ?? null;
}

export function unwrapCollection<T extends Record<string, any>>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const data = pick<any[]>(raw, ['data']);
  if (!Array.isArray(data)) return [];
  return data.map((item) => unwrapEntity<T>(item));
}

export function unwrapEntity<T extends Record<string, any>>(raw: unknown): T {
  if (!isObject(raw)) return {} as T;

  const entity: any = raw as any;
  const attributes = entity.attributes;
  const merged: any = isObject(attributes) ? { ...(attributes as any) } : { ...(entity as any) };
  if ('attributes' in merged) delete merged.attributes;

  if ('id' in entity) merged.id = entity.id;
  if ('documentId' in entity) merged.documentId = entity.documentId;

  return merged as T;
}

export function unwrapRelation<T extends Record<string, any>>(raw: unknown): T | null {
  if (!raw) return null;
  if (isObject(raw) && 'data' in raw) return unwrapEntity<T>((raw as any).data);
  if (isObject(raw)) return raw as T;
  return null;
}
