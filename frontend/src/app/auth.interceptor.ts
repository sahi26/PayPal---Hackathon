import { HttpInterceptorFn } from '@angular/common/http';
import { API_BASE_URL } from './api.config';
import { getStoredAccessToken, shouldAttachAuthToken } from './runtime-config.mjs';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
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
  return next(accessToken
    ? request.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } })
    : request);
};
