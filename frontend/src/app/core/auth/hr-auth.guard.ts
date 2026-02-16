import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router, UrlSegment } from '@angular/router';
import { getHrJwt } from './auth.storage';

export const hrAuthGuard: CanActivateFn = (_route, state) => {
  const jwt = getHrJwt();
  if (jwt) return true;

  const router = inject(Router);
  return router.createUrlTree(['/hr/login'], { queryParams: { returnUrl: state.url } });
};

function segmentsToUrl(segments: readonly UrlSegment[]): string {
  const path = segments.map((s) => s.path).filter(Boolean).join('/');
  return path ? `/${path}` : '';
}

export const hrAuthMatchGuard: CanMatchFn = (_route, segments) => {
  const jwt = getHrJwt();
  if (jwt) return true;

  const router = inject(Router);
  const returnUrl = segmentsToUrl(segments) || '/admin';
  return router.createUrlTree(['/hr/login'], { queryParams: { returnUrl } });
};
