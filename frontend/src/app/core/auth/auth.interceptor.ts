import { HttpInterceptorFn } from '@angular/common/http';
import { getHrJwt } from './auth.storage';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const jwt = getHrJwt();
  if (!jwt) return next(req);

  const url = req.url ?? '';
  if (!url.startsWith('/api/') || url.startsWith('/api/public/')) return next(req);

  return next(
    req.clone({
      setHeaders: {
        Authorization: `Bearer ${jwt}`,
      },
    })
  );
};
