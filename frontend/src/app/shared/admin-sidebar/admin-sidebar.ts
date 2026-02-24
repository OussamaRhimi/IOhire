import { Component, computed, effect, HostListener, inject, OnInit, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import {
  Activity,
  BrainCircuit,
  BriefcaseBusiness,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Sun,
  Target,
  Users,
  X,
} from 'lucide-angular/src/icons';
import { filter } from 'rxjs';
import { clearHrJwt } from '../../core/auth/auth.storage';
import { PortalThemeService } from '../../core/theme/portal-theme.service';

type AdminNavItem = {
  label: string;
  icon: LucideIconData;
  link: string;
};

const MOBILE_BREAKPOINT = 920;

@Component({
  selector: 'app-admin-sidebar',
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  templateUrl: './admin-sidebar.html',
})
export class AdminSidebar implements OnInit {
  private readonly router = inject(Router);
  readonly theme = inject(PortalThemeService);

  /** desktop collapsed state */
  readonly collapsed = signal(false);
  /** mobile overlay open state */
  readonly mobileOpen = signal(false);
  /** tracks if we're in mobile viewport */
  readonly isMobile = signal(typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT);

  readonly iconShield = Shield;
  readonly iconCollapse = PanelLeftClose;
  readonly iconExpand = PanelLeftOpen;
  readonly iconSun = Sun;
  readonly iconMoon = Moon;
  readonly iconLogout = LogOut;
  readonly iconMenu: LucideIconData = Menu;
  readonly iconClose: LucideIconData = X;

  readonly mainNav: AdminNavItem[] = [{ label: 'Analytics', icon: LayoutDashboard, link: '/admin/analytics' }];

  readonly hrNav: AdminNavItem[] = [
    { label: 'Job Postings', icon: BriefcaseBusiness, link: '/admin/hr/jobs' },
    { label: 'Candidates', icon: Users, link: '/admin/hr/candidates' },
    { label: 'AI Evaluation', icon: BrainCircuit, link: '/admin/hr/ai' },
    { label: 'CV Templates', icon: FileText, link: '/admin/hr/templates' },
    { label: 'Skills', icon: Target, link: '/admin/hr/skills' },
    { label: 'Departments', icon: Activity, link: '/admin/hr/departments' },
  ];

  ngOnInit() {
    // close mobile sidebar on navigation
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => {
      this.mobileOpen.set(false);
    });
  }

  @HostListener('window:resize')
  onResize() {
    const mobile = window.innerWidth <= MOBILE_BREAKPOINT;
    this.isMobile.set(mobile);
    if (!mobile) this.mobileOpen.set(false);
  }

  toggleCollapse() {
    if (this.isMobile()) {
      this.mobileOpen.update((v) => !v);
    } else {
      this.collapsed.update((v) => !v);
    }
  }

  openMobile() {
    this.mobileOpen.set(true);
  }

  closeMobile() {
    this.mobileOpen.set(false);
  }

  toggleTheme() {
    this.theme.toggle();
  }

  logout() {
    clearHrJwt();
    this.mobileOpen.set(false);
    void this.router.navigate(['/hr/login']);
  }
}
