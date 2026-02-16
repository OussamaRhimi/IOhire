export function toErrorMessage(error: unknown): string {
  const anyErr = error as any;
  const candidates = [
    anyErr?.error?.error?.message, // Strapi error shape: { error: { message } }
    anyErr?.error?.message, // common REST shape: { message }
    anyErr?.message, // HttpErrorResponse message fallback
  ];

  for (const msg of candidates) {
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }

  if (typeof anyErr?.error === 'string' && anyErr.error.trim()) return anyErr.error.trim();
  return 'Something went wrong.';
}
