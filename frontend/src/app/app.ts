import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { PortalThemeService } from './core/theme/portal-theme.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly router = inject(Router);
  readonly theme = inject(PortalThemeService);

  async ngOnInit() {
    this.theme.initForPortal(this.getPortalFromUrl(this.router.url));
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)).subscribe((e) => {
      this.theme.setPortal(this.getPortalFromUrl(e.urlAfterRedirects));
    });
  }

  private getPortalFromUrl(url: string) {
    return url.startsWith('/admin') || url.startsWith('/hr') ? 'admin' : 'public';
  }
}
