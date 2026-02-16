export function safeJsonParse<T = unknown>(input: string): { ok: true; value: T } | { ok: false; error: Error } {
  try {
    return { ok: true, value: JSON.parse(input) as T };
  } catch (error) {
    return { ok: false, error: error as Error };
  }
}

export function extractLikelyJsonObject(input: string): string | null {
  const start = input.indexOf('{');
  const end = input.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return input.slice(start, end + 1);
}

