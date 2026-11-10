import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, finalize, of, shareReplay, tap, throwError } from 'rxjs';
import { API_BASE_URL } from './api.config';

export interface PayPalOAuthUser {
  id: number;
  email: string;
  full_name: string;
  role_type: string;
  access_token?: string;
  token_type?: string;
}

@Injectable({ providedIn: 'root' })
export class PayPalOAuthService {
  private readonly inflightByCode = new Map<string, Observable<PayPalOAuthUser>>();
  private readonly resolvedByCode = new Map<string, PayPalOAuthUser>();
  private readonly failedByCode = new Map<string, any>();
  readonly authUser$ = new Subject<PayPalOAuthUser>();

  constructor(private http: HttpClient) {}

  getRedirectUri(): string {
    if (typeof window === 'undefined') {
      return 'https://pay-pal-hackathon-phi.vercel.app';
    }
    const isLocalhost =
      window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const storedUri = localStorage.getItem('prooflens_redirect_uri');
    if (storedUri && (isLocalhost || !storedUri.includes('localhost'))) {
      return storedUri.trim();
    }
    return isLocalhost ? 'http://localhost:4200' : 'https://pay-pal-hackathon-phi.vercel.app';
  }

  exchangeCode(code: string, redirectUri: string, role: string): Observable<PayPalOAuthUser> {
    const trimmed = (code || '').trim();
    if (!trimmed) {
      return throwError(() => new Error('Missing PayPal authorization code.'));
    }

    const cachedUser = this.resolvedByCode.get(trimmed);
    if (cachedUser) {
      return of(cachedUser);
    }

    if (this.failedByCode.has(trimmed)) {
      return throwError(() => this.failedByCode.get(trimmed));
    }

    const inflight$ = this.inflightByCode.get(trimmed);
    if (inflight$) {
      return inflight$;
    }

    const req$ = this.http
      .post<PayPalOAuthUser>(`${API_BASE_URL}/api/auth/paypal-login`, {
        code: trimmed,
        redirect_uri: redirectUri,
        role
      })
      .pipe(
        tap({
          next: (user) => {
            this.resolvedByCode.set(trimmed, user);
            this.failedByCode.delete(trimmed);
            if (typeof window !== 'undefined') {
              localStorage.setItem('prooflens_user', JSON.stringify(user));
              localStorage.removeItem('prooflens_pending_role');
              this.stripOAuthParamsFromUrl();
            }
            this.authUser$.next(user);
          },
          error: (err) => {
            this.failedByCode.set(trimmed, err);
            if (typeof window !== 'undefined') {
              this.stripOAuthParamsFromUrl();
            }
          }
        }),
        finalize(() => {
          this.inflightByCode.delete(trimmed);
        }),
        shareReplay({ bufferSize: 1, refCount: false })
      );

    this.inflightByCode.set(trimmed, req$);
    return req$;
  }

  stripOAuthParamsFromUrl(): void {
    if (typeof window === 'undefined' || !window.history?.replaceState) {
      return;
    }
    try {
      const url = new URL(window.location.href);
      let changed = false;
      for (const param of ['code', 'scope']) {
        if (url.searchParams.has(param)) {
          url.searchParams.delete(param);
          changed = true;
        }
      }
      if (changed) {
        const remaining = url.searchParams.toString();
        const nextUrl = url.pathname + (remaining ? `?${remaining}` : '') + url.hash;
        window.history.replaceState({}, document.title, nextUrl);
      }
    } catch (_) {}
  }
}
