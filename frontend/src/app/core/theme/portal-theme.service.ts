import { computed, Injectable, signal } from '@angular/core';

export type PortalKey = 'public' | 'admin';
export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY_BY_PORTAL: Record<PortalKey, string> = {
  public: 'cv.theme.public',
  admin: 'cv.theme.admin',
};

function readTheme(key: string): ThemeMode {
  const raw = localStorage.getItem(key);
  return raw === 'dark' ? 'dark' : 'light';
}

function writeTheme(key: string, theme: ThemeMode): void {
  localStorage.setItem(key, theme);
}

@Injectable({ providedIn: 'root' })
export class PortalThemeService {
  readonly portal = signal<PortalKey>('public');
  readonly theme = signal<ThemeMode>('light');
  readonly isDark = computed(() => this.theme() === 'dark');

  setPortal(portal: PortalKey): void {
    if (this.portal() === portal) return;
    this.portal.set(portal);
    const theme = readTheme(STORAGE_KEY_BY_PORTAL[portal]);
    this.theme.set(theme);
    this.applyToDocument();
  }

  initForPortal(portal: PortalKey): void {
    this.portal.set(portal);
    this.theme.set(readTheme(STORAGE_KEY_BY_PORTAL[portal]));
    this.applyToDocument();
  }

  toggle(): void {
    const next: ThemeMode = this.theme() === 'dark' ? 'light' : 'dark';
    this.theme.set(next);
    writeTheme(STORAGE_KEY_BY_PORTAL[this.portal()], next);
    this.applyToDocument();
  }

  private applyToDocument(): void {
    document.documentElement.classList.remove('theme-light', 'theme-dark');
    document.documentElement.classList.add(`theme-${this.theme()}`);
  }
}

