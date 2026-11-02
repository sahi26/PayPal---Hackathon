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
  selectedRedirectUri: string = 'http://localhost:4200';
  currentUser: CurrentUser | null = null;
  isAuthenticating: boolean = false;
  isRedirecting: boolean = false;
  errorMessage: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    // 1. Check existing session
    const saved = localStorage.getItem('prooflens_user');
    if (saved) {
      try {
        this.currentUser = JSON.parse(saved);
      } catch (_) {
        this.currentUser = null;
      }
    }

    // 2. Load stored redirect URI preference
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

  fastTrackLogin(role: 'buyer' | 'seller') {
    this.isAuthenticating = true;
    this.errorMessage = null;

    const mockCode = role === 'seller' ? 'sandbox_seller' : 'sandbox_buyer';
    this.http.post<CurrentUser>(`${API_BASE_URL}/api/auth/paypal-login`, {
      code: mockCode,
      role
    }).subscribe({
      next: (user) => {
        this.isAuthenticating = false;
        this.currentUser = user;
        localStorage.setItem('prooflens_user', JSON.stringify(user));
        this.proceedToConsole();
      },
      error: (err) => {
        this.isAuthenticating = false;
        this.errorMessage = err.error?.detail || err.message || 'Login failed.';
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
          this.errorMessage = err.error?.detail || err.message || 'Failed to reach PayPal authentication gateway.';
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
        const detail = err.error?.detail || err.message || 'PayPal token exchange failed.';
        this.errorMessage = `PayPal OAuth Error: ${detail}`;
      }
    });
  }

  proceedToConsole() {
    if (!this.currentUser) return;
    if (this.currentUser.role_type === 'seller') {
      this.router.navigate(['/seller']);
    } else {
      this.router.navigate(['/buyer']);
    }
  }

  logout() {
    localStorage.removeItem('prooflens_user');
    this.currentUser = null;
    this.errorMessage = null;
  }
}
