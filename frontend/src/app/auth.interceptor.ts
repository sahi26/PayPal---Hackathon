import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';
import { API_BASE_URL } from './api.config';
import { getStoredAccessToken, shouldAttachAuthToken } from './runtime-config.mjs';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const router = inject(Router);

  if (!shouldAttachAuthToken(request.url, API_BASE_URL) || typeof localStorage === 'undefined') {
    return next(request);
  }

  let serializedUser: string | null = null;
  try {
    serializedUser = localStorage.getItem('prooflens_user');
  } catch {
    return next(request);
  }

  const accessToken = getStoredAccessToken(serializedUser);
  const authReq = accessToken
    ? request.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } })
    : request;

  return next(authReq).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401) {
        try {
          localStorage.removeItem('prooflens_user');
        } catch (_) {}

        const currentUrl = router.url || '';
        if (!currentUrl.startsWith('/login') && currentUrl !== '/') {
          router.navigate(['/login'], { replaceUrl: true });
        }
      }
      return throwError(() => error);
    })
  );
};
