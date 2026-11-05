import { Component, OnInit } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_BASE_URL } from '../api.config';

interface CurrentUser {
  id: number;
  email: string;
  full_name: string;
  role_type: string;
}

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent implements OnInit {
  selectedRole: 'buyer' | 'seller' = 'buyer';
  selectedRedirectUri: string = 'https://prooflens-auth.loca.lt';
  currentUser: CurrentUser | null = null;
  loginEmail: string = '';
  loginPassword: string = '';
  isAuthenticating: boolean = false;
  isRedirecting: boolean = false;
  errorMessage: string | null = null;
  returnUrl: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.route.queryParamMap.subscribe(params => {
      this.returnUrl = this.getSafeInviteReturnUrl(params.get('returnUrl'));
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
        this.currentUser = user;
        localStorage.setItem('prooflens_user', JSON.stringify(user));
        this.proceedToConsole();
      },
      error: (err) => {
        this.isAuthenticating = false;
        this.errorMessage = this.extractErrorMessage(err);
      }
    });
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
        this.errorMessage = `PayPal OAuth Error: ${this.extractErrorMessage(err)}`;
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
  }
}
