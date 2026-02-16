export const HR_JWT_STORAGE_KEY = 'cv.hrJwt';

export function getHrJwt(): string | null {
  const jwt = localStorage.getItem(HR_JWT_STORAGE_KEY);
  return jwt && jwt.trim() ? jwt.trim() : null;
}

export function setHrJwt(jwt: string): void {
  localStorage.setItem(HR_JWT_STORAGE_KEY, jwt.trim());
}

export function clearHrJwt(): void {
  localStorage.removeItem(HR_JWT_STORAGE_KEY);
}
