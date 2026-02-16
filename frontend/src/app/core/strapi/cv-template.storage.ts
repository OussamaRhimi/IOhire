const HR_DEFAULT_CV_TEMPLATE_KEY = 'cv.hrDefaultTemplateKey';

export function getHrDefaultCvTemplateKey(): string | null {
  const value = localStorage.getItem(HR_DEFAULT_CV_TEMPLATE_KEY);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function setHrDefaultCvTemplateKey(templateKey: string): void {
  const trimmed = templateKey.trim();
  if (!trimmed) {
    localStorage.removeItem(HR_DEFAULT_CV_TEMPLATE_KEY);
    return;
  }
  localStorage.setItem(HR_DEFAULT_CV_TEMPLATE_KEY, trimmed);
}
