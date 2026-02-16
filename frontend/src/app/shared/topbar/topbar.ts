import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import { Moon, Sun } from 'lucide-angular/src/icons';
import { filter } from 'rxjs';
import { getHrJwt } from '../../core/auth/auth.storage';
import { PortalThemeService } from '../../core/theme/portal-theme.service';

type NavItem = {
  label: string;
  routerLink: string;
  exact?: boolean;
  queryParams?: Record<string, string>;
};

@Component({
  selector: 'app-topbar',
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  templateUrl: './topbar.html',
})
export class Topbar {
  private readonly router = inject(Router);
  readonly theme = inject(PortalThemeService);

  readonly appName = signal('IOHire');
  readonly isHrAuthed = signal(false);
  readonly isScrolled = signal(false);
  readonly currentUrl = signal('/');
  readonly iconSun: LucideIconData = Sun;
  readonly iconMoon: LucideIconData = Moon;

  readonly navItems = computed<NavItem[]>(() => {
    const isHrAuthed = this.isHrAuthed();

    return [
      { label: 'Home', routerLink: '/home', exact: true },
      { label: 'Apply', routerLink: '/apply', exact: true },
      { label: 'Track', routerLink: '/track' },
      ...(isHrAuthed
        ? [{ label: 'Admin', routerLink: '/admin' }]
        : [{ label: 'HR Login', routerLink: '/hr/login', queryParams: { returnUrl: '/admin' } }]),
    ];
  });
  readonly showPortalThemeToggle = computed(() => {
    const url = this.currentUrl();
    return url.startsWith('/home') || url.startsWith('/apply') || url.startsWith('/track') || url === '/';
  });

  ngOnInit() {
    this.isHrAuthed.set(!!getHrJwt());
    this.currentUrl.set(this.router.url);
    this.updateScrollState();

    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      this.isHrAuthed.set(!!getHrJwt());
      this.currentUrl.set(e.urlAfterRedirects || e.url);
    });
  }

  @HostListener('window:scroll')
  onWindowScroll() {
    this.updateScrollState();
  }

  toggleTheme() {
    this.theme.toggle();
  }

  private updateScrollState() {
    if (typeof window === 'undefined') return;
    this.isScrolled.set(window.scrollY > 4);
  }
}
