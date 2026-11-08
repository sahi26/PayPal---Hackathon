import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_BASE_URL } from '../api.config';
import { PROOFLENS_LOGO_BASE64 } from '../assets.constants';

interface CurrentUser {
  id: number;
  email: string;
  full_name: string;
  role_type: string;
  access_token?: string;
  token_type?: string;
}

interface RegistrationResponse {
  email: string;
  message: string;
  verification_url?: string | null;
}

type VerificationResponse = RegistrationResponse;

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnInit {
  readonly appLogo = PROOFLENS_LOGO_BASE64;
  selectedRole: 'buyer' | 'seller' = 'buyer';
  selectedRedirectUri: string = 'https://prooflens-auth.loca.lt';
  currentUser: CurrentUser | null = null;
  isRegistering: boolean = false;
  registrationFullName: string = '';
  loginEmail: string = '';
  loginPassword: string = '';
  isAuthenticating: boolean = false;
  isRedirecting: boolean = false;
  errorMessage: string | null = null;
  verificationMessage: string | null = null;
  verificationLink: string | null = null;
  isEmailVerificationPending = false;
  returnUrl: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.route.queryParamMap.subscribe(params => {
      this.returnUrl = this.getSafeInviteReturnUrl(params.get('returnUrl'));
      this.loginEmail = params.get('email') || this.loginEmail;
      const requestedRole = params.get('role');
      if (requestedRole === 'buyer' || requestedRole === 'seller') {
        this.selectedRole = requestedRole;
      } else if (this.returnUrl) {
        this.selectedRole = 'seller';
      }
    });

    // 1. Check existing session
    const saved = localStorage.getItem('prooflens_user');
    if (saved) {
      try {
        this.currentUser = JSON.parse(saved);
      } catch (_) {
        this.currentUser = null;
      }
    }

    if (this.returnUrl && this.currentUser?.role_type === 'seller') {
      this.router.navigateByUrl(this.returnUrl);
      return;
    }

    // 2. Load stored redirect URI preference (defaults to https://prooflens-auth.loca.lt for PayPal sandbox whitelist)
    const storedUri = localStorage.getItem('prooflens_redirect_uri');
    if (storedUri) {
      this.selectedRedirectUri = storedUri;
    }

    // 3. Listen for PayPal OAuth Callback (?code=...)
    this.route.queryParams.subscribe(params => {
      const code = params['code'];
      if (code) {
        this.processPayPalCallback(code);
      }
    });
    this.route.fragment.subscribe(token => {
      if (token) {
        this.verifyEmailToken(token);
      }
    });
  }

  setRedirectUri(uri: string) {
    this.selectedRedirectUri = uri;
    localStorage.setItem('prooflens_redirect_uri', uri);
  }

  extractErrorMessage(err: any): string {
    if (!err) return 'An unexpected error occurred.';
    if (typeof err === 'string') return err;
    const body = err.error;
    if (body) {
      if (typeof body === 'string') return body;
      if (typeof body.detail === 'string') return body.detail;
      if (Array.isArray(body.detail)) {
        return body.detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join('; ');
      }
      if (body.detail && typeof body.detail === 'object') {
        return body.detail.message || body.detail.msg || JSON.stringify(body.detail);
      }
      if (body.message) return body.message;
    }
    return err.message || 'Authentication failed. Please verify your credentials.';
  }

  loginWithCredentials() {
    if (!this.loginEmail.trim() || !this.loginPassword.trim()) {
      this.errorMessage = 'Please enter both your email address and password.';
      return;
    }
    this.isAuthenticating = true;
    this.errorMessage = null;

    this.http.post<CurrentUser>(`${API_BASE_URL}/api/auth/login`, {
      email: this.loginEmail.trim(),
      password: this.loginPassword.trim(),
      role: this.selectedRole
    }).subscribe({
      next: (user) => {
        this.isAuthenticating = false;
        this.completeAuthentication(user);
      },
      error: (err) => {
        this.isAuthenticating = false;
        this.errorMessage = this.extractErrorMessage(err);
        this.isEmailVerificationPending = err.status === 403
          && (err.error?.detail || '').toLowerCase().includes('email address is not verified');
      }
    });
  }

  registerWithCredentials() {
    if (!this.registrationFullName.trim() || !this.loginEmail.trim() || !this.loginPassword.trim()) {
      this.errorMessage = 'Please enter your name, email address, and password.';
      return;
    }

    this.isAuthenticating = true;
    this.errorMessage = null;
    this.http.post<RegistrationResponse>(`${API_BASE_URL}/api/auth/register`, {
      email: this.loginEmail.trim(),
      password: this.loginPassword.trim(),
      full_name: this.registrationFullName.trim(),
      role_type: this.selectedRole
    }).subscribe({
      next: (response) => {
        this.isAuthenticating = false;
        this.loginEmail = response.email;
        this.verificationMessage = response.message;
        this.verificationLink = response.verification_url || null;
        this.isEmailVerificationPending = true;
      },
      error: (err) => {
        this.isAuthenticating = false;
        this.errorMessage = this.extractErrorMessage(err);
      }
    });
  }

  resendVerificationEmail() {
    if (!this.loginEmail.trim()) {
      this.errorMessage = 'Enter your email address to request a verification link.';
      return;
    }

    this.isAuthenticating = true;
    this.errorMessage = null;
    this.http.post<VerificationResponse>(`${API_BASE_URL}/api/auth/resend-verification`, {
      email: this.loginEmail.trim()
    }).subscribe({
      next: (response) => {
        this.isAuthenticating = false;
        this.verificationMessage = response.message;
        this.verificationLink = response.verification_url || null;
      },
      error: (err) => {
        this.isAuthenticating = false;
        this.errorMessage = this.extractErrorMessage(err);
      }
    });
  }

  private verifyEmailToken(token: string) {
    this.isAuthenticating = true;
    this.errorMessage = null;
    this.http.post<VerificationResponse>(`${API_BASE_URL}/api/auth/verify-email`, { token }).subscribe({
      next: (response) => {
        this.isAuthenticating = false;
        this.loginEmail = response.email;
        this.verificationMessage = response.message;
        this.verificationLink = null;
        this.isEmailVerificationPending = false;
        this.isRegistering = false;
        this.router.navigate(['/login'], { queryParams: { email: response.email } });
      },
      error: (err) => {
        this.isAuthenticating = false;
        this.errorMessage = this.extractErrorMessage(err);
        this.router.navigate(['/login']);
      }
    });
  }

  private completeAuthentication(user: CurrentUser) {
    this.currentUser = user;
    localStorage.setItem('prooflens_user', JSON.stringify(user));
    this.proceedToConsole();
  }

  loginWithRealPayPal() {
    this.isRedirecting = true;
    this.errorMessage = null;

    localStorage.setItem('prooflens_pending_role', this.selectedRole);
    localStorage.setItem('prooflens_redirect_uri', this.selectedRedirectUri);

    this.http.get<any>(`${API_BASE_URL}/api/auth/paypal-config?redirect_uri=${encodeURIComponent(this.selectedRedirectUri)}`)
      .subscribe({
        next: (config) => {
          if (config && config.oauth_url) {
            window.location.href = config.oauth_url;
          } else {
            this.isRedirecting = false;
            this.errorMessage = 'Could not generate PayPal OAuth authorize URL.';
          }
        },
        error: (err) => {
          this.isRedirecting = false;
          this.errorMessage = this.extractErrorMessage(err);
        }
      });
  }

  processPayPalCallback(code: string) {
    this.isAuthenticating = true;
    this.errorMessage = null;

    const role = localStorage.getItem('prooflens_pending_role') || this.selectedRole || 'buyer';
    const redirectUri = localStorage.getItem('prooflens_redirect_uri') || this.selectedRedirectUri;

    this.http.post<CurrentUser>(`${API_BASE_URL}/api/auth/paypal-login`, {
      code,
      redirect_uri: redirectUri,
      role
    }).subscribe({
      next: (user) => {
        this.isAuthenticating = false;
        this.currentUser = user;
        localStorage.setItem('prooflens_user', JSON.stringify(user));
        localStorage.removeItem('prooflens_pending_role');

        this.router.navigate([], {
          queryParams: { code: null },
          queryParamsHandling: 'merge'
        });

        this.proceedToConsole();
      },
      error: (err) => {
        this.isAuthenticating = false;
        const detail = this.extractErrorMessage(err);
        this.errorMessage = `PayPal OAuth Error: ${detail}`;
        this.isEmailVerificationPending = detail.toLowerCase().includes('verify your email');
      }
    });
  }

  proceedToConsole() {
    if (!this.currentUser) return;
    if (this.currentUser.role_type === 'seller' && this.returnUrl) {
      this.router.navigateByUrl(this.returnUrl);
      return;
    }
    if (this.currentUser.role_type === 'seller') {
      this.router.navigate(['/seller']);
    } else {
      this.router.navigate(['/buyer']);
    }
  }

  private getSafeInviteReturnUrl(value: string | null): string | null {
    return value && /^\/invite\/[^/?#]+$/.test(value) ? value : null;
  }

  logout() {
    localStorage.removeItem('prooflens_user');
    this.currentUser = null;
    this.errorMessage = null;
    this.verificationMessage = null;
    this.verificationLink = null;
    this.isEmailVerificationPending = false;
  }
}
