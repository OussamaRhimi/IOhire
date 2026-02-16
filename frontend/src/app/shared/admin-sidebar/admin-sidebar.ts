import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { LucideAngularModule, type LucideIconData } from 'lucide-angular';
import {
  BriefcaseBusiness,
  FileText,
  LayoutDashboard,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  Sun,
  Users,
} from 'lucide-angular/src/icons';
import { clearHrJwt } from '../../core/auth/auth.storage';
import { PortalThemeService } from '../../core/theme/portal-theme.service';

type AdminNavItem = {
  label: string;
  icon: LucideIconData;
  link: string;
};

@Component({
  selector: 'app-admin-sidebar',
  imports: [RouterLink, RouterLinkActive, LucideAngularModule],
  templateUrl: './admin-sidebar.html',
})
export class AdminSidebar {
  private readonly router = inject(Router);
  readonly theme = inject(PortalThemeService);

  readonly collapsed = signal(false);

  readonly iconShield = Shield;
  readonly iconCollapse = PanelLeftClose;
  readonly iconExpand = PanelLeftOpen;
  readonly iconSun = Sun;
  readonly iconMoon = Moon;
  readonly iconLogout = LogOut;

  readonly mainNav: AdminNavItem[] = [{ label: 'Analytics', icon: LayoutDashboard, link: '/admin/analytics' }];

  readonly hrNav: AdminNavItem[] = [
    { label: 'Job Postings', icon: BriefcaseBusiness, link: '/admin/hr/jobs' },
    { label: 'Candidates', icon: Users, link: '/admin/hr/candidates' },
    { label: 'CV Templates', icon: FileText, link: '/admin/hr/templates' },
  ];

  toggleCollapse() {
    this.collapsed.update((v) => !v);
  }

  toggleTheme() {
    this.theme.toggle();
  }

  logout() {
    clearHrJwt();
    void this.router.navigate(['/hr/login']);
  }
}
