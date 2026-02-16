import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { clearHrJwt } from '../../../core/auth/auth.storage';
import { PortalThemeService } from '../../../core/theme/portal-theme.service';

@Component({
  selector: 'app-admin-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-shell.html',
})
export class AdminShell {
  private readonly router = inject(Router);
  readonly theme = inject(PortalThemeService);

  toggleTheme() {
    this.theme.toggle();
  }

  logout() {
    clearHrJwt();
    void this.router.navigate(['/hr/login']);
  }
}
