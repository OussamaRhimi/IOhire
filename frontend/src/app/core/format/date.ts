export function formatDateTime(value: unknown): string {
  const d = new Date(String(value ?? ''));
  if (!Number.isFinite(d.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

