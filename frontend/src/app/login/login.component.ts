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
  template: `
    <div class="login-shell">
      <div class="login-card">
        <!-- Top PayPal Brand Ribbon -->
        <div class="login-brand-header">
          <div class="pp-badge-circle">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 3.72a.784.784 0 0 1 .773-.654h6.398c2.936 0 5.093.633 6.411 1.882 1.258 1.192 1.666 2.87 1.213 4.989-.66 3.08-2.613 5.228-5.805 6.385-1.026.372-2.22.56-3.548.56H7.954a.784.784 0 0 0-.773.654l-.105.546z" fill="#0079C1"/>
              <path d="M9.13 16.882l.983-6.23a.784.784 0 0 1 .773-.654h3.63c2.722 0 4.707.575 5.905 1.708 1.144 1.082 1.492 2.607 1.034 4.53-.615 2.578-2.316 4.398-5.056 5.41a10.03 10.03 0 0 1-3.606.636H10.12a.784.784 0 0 1-.773-.654l-.217-1.126z" fill="#00457C"/>
            </svg>
          </div>
          <h2>ProofLens Escrow Login</h2>
          <p class="brand-sub">PayPal-Backed Cryptographic Milestone & Contract Identity</p>
        </div>

        @if (isAuthenticating) {
          <!-- Real-time OAuth Token Exchange State -->
          <div class="auth-loading-state">
            <div class="spinner"></div>
            <h4>Connecting to PayPal Sandbox API...</h4>
            <p>Exchanging authoritative OAuth grant code and verifying user profile token.</p>
          </div>
        } @else if (currentUser) {
          <!-- Already Authenticated State -->
          <div class="active-session-box">
            <div class="session-head">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
              <span>Authenticated PayPal Session Active</span>
            </div>
            <div class="user-row">
              <div class="user-avatar-lg">
                {{ currentUser.full_name.charAt(0) || 'P' }}
              </div>
              <div class="user-details">
                <strong>{{ currentUser.full_name }}</strong>
                <span class="user-email">{{ currentUser.email }}</span>
                <span class="role-chip">ACTIVE ROLE: {{ currentUser.role_type | uppercase }}</span>
              </div>
            </div>

            <div class="session-actions">
              <button (click)="proceedToConsole()" class="btn-proceed-portal">
                <span>Enter {{ currentUser.role_type === 'seller' ? 'Contractor Desk' : 'Buyer Console' }}</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                </svg>
              </button>
              <button (click)="logout()" class="btn-logout-link">
                Sign out / Log in with different account
              </button>
            </div>
          </div>
        } @else {
          <!-- Primary Login Body -->
          <div class="login-body">
            @if (errorMessage) {
              <div class="login-error-banner">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <div class="error-text">
                  <strong>PayPal OAuth Notice:</strong>
                  <span>{{ errorMessage }}</span>
                </div>
              </div>
            }

            <!-- Role Selector -->
            <div class="form-group">
              <label class="input-label">Select Workspace Role:</label>
              <div class="role-radio-grid">
                <button
                  type="button"
                  class="role-card"
                  [class.is-selected]="selectedRole === 'buyer'"
                  (click)="selectedRole = 'buyer'"
                >
                  <div class="role-icon-box">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                    </svg>
                  </div>
                  <div class="role-title">Buyer Console</div>
                  <div class="role-desc">Draft agreements, fund PayPal escrow, & approve milestones</div>
                </button>

                <button
                  type="button"
                  class="role-card"
                  [class.is-selected]="selectedRole === 'seller'"
                  (click)="selectedRole = 'seller'"
                >
                  <div class="role-icon-box">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                    </svg>
                  </div>
                  <div class="role-title">Contractor Desk</div>
                  <div class="role-desc">Negotiate terms, submit hardware live camera proof, & claim payouts</div>
                </button>
              </div>
            </div>

            <!-- SECTION 1: INSTANT APPLICATION FLOW TEST (Zero Setup) -->
            <div class="fast-track-box">
              <div class="fast-track-head">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.5">
                  <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
                </svg>
                <span>Instant Testing Mode (Skip Redirect / Test Full App Flow Right Now)</span>
              </div>
              <p class="fast-track-sub">
                Authenticate immediately into the database without getting blocked by PayPal redirect URL verification during local testing:
              </p>
              <div class="fast-track-buttons">
                <button type="button" (click)="fastTrackLogin('buyer')" class="btn-fast-auth" [disabled]="isAuthenticating">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.2">
                    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
                  </svg>
                  <span>Test as Buyer (buyer&#64;prooflens.com)</span>
                </button>
                <button type="button" (click)="fastTrackLogin('seller')" class="btn-fast-auth" [disabled]="isAuthenticating">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.2">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                  </svg>
                  <span>Test as Contractor (seller&#64;prooflens.com)</span>
                </button>
              </div>
            </div>

            <!-- SECTION 2: LIVE PAYPAL SANDBOX OAUTH -->
            <div class="oauth-section">
              <div class="oauth-section-title">
                <span>OR LIVE PAYPAL SANDBOX OAUTH CONNECT</span>
              </div>

              <!-- Return URL Selector (Matches Dashboard) -->
              <div class="return-url-selector-box">
                <label class="url-selector-label">
                  <span>PayPal Dashboard Return URL Match:</span>
                </label>
                <div class="url-pills-row">
                  <button
                    type="button"
                    class="url-pill-btn"
                    [class.is-active]="selectedRedirectUri === 'http://localhost:4200'"
                    (click)="setRedirectUri('http://localhost:4200')"
                  >
                    Direct Localhost (http://localhost:4200)
                  </button>
                  <button
                    type="button"
                    class="url-pill-btn"
                    [class.is-active]="selectedRedirectUri === 'https://prooflens-auth.loca.lt'"
                    (click)="setRedirectUri('https://prooflens-auth.loca.lt')"
                  >
                    Tunnel URL (https://prooflens-auth.loca.lt)
                  </button>
                </div>
              </div>

              <button
                type="button"
                (click)="loginWithRealPayPal()"
                class="btn-paypal-primary"
                [disabled]="isRedirecting"
              >
                <div class="pp-icon-embed">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 3.72a.784.784 0 0 1 .773-.654h6.398c2.936 0 5.093.633 6.411 1.882 1.258 1.192 1.666 2.87 1.213 4.989-.66 3.08-2.613 5.228-5.805 6.385-1.026.372-2.22.56-3.548.56H7.954a.784.784 0 0 0-.773.654l-.105.546z" fill="#0079C1"/>
                    <path d="M9.13 16.882l.983-6.23a.784.784 0 0 1 .773-.654h3.63c2.722 0 4.707.575 5.905 1.708 1.144 1.082 1.492 2.607 1.034 4.53-.615 2.578-2.316 4.398-5.056 5.41a10.03 10.03 0 0 1-3.606.636H10.12a.784.784 0 0 1-.773-.654l-.217-1.126z" fill="#00457C"/>
                  </svg>
                </div>
                <span>{{ isRedirecting ? 'Redirecting to PayPal Sandbox...' : 'Log in with Live PayPal Sandbox' }}</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>

              <div class="dashboard-tip-card">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.2">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                </svg>
                <div class="tip-text">
                  <strong>Why PayPal showed "invalid client_id or redirect_uri":</strong>
                  <span>
                    In your PayPal Developer Dashboard, the Return URL was set to the tunnel URL. To log in directly on localhost without a tunnel, add <code>http://localhost:4200</code> to your App's <strong>Return URL</strong> list on <a href="https://developer.paypal.com/dashboard/applications/sandbox" target="_blank" rel="noopener">developer.paypal.com</a> and check the <strong>"Log in with PayPal"</strong> feature.
                  </span>
                </div>
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
  styles: [`
    .login-shell {
      min-height: calc(100vh - 120px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem 1rem;
      background: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }

    .login-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 16px;
      box-shadow: 0 10px 30px rgba(0, 20, 53, 0.06);
      max-width: 600px;
      width: 100%;
      overflow: hidden;
    }

    .login-brand-header {
      background: #001435;
      padding: 2.25rem 2rem 1.75rem 2rem;
      text-align: center;
      color: #ffffff;
    }

    .pp-badge-circle {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 0.85rem auto;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .login-brand-header h2 {
      margin: 0 0 0.35rem 0;
      font-size: 1.55rem;
      font-weight: 800;
      letter-spacing: -0.01em;
    }

    .brand-sub {
      margin: 0;
      font-size: 0.86rem;
      color: #94a3b8;
    }

    .login-body {
      padding: 1.75rem 2rem;
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .login-error-banner {
      display: flex;
      align-items: flex-start;
      gap: 0.65rem;
      background: #fef2f2;
      border: 1.5px solid #fecaca;
      border-left: 4px solid #dc2626;
      border-radius: 8px;
      padding: 0.85rem 1rem;
    }

    .error-text {
      display: flex;
      flex-direction: column;
      font-size: 0.82rem;
      color: #991b1b;
      line-height: 1.4;
    }

    .input-label {
      display: block;
      font-size: 0.82rem;
      font-weight: 800;
      color: #001435;
      margin-bottom: 0.65rem;
      letter-spacing: 0.02em;
    }

    .role-radio-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.85rem;
    }

    .role-card {
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 12px;
      padding: 0.85rem;
      text-align: left;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      transition: all 0.2s;
    }

    .role-card:hover {
      background: #f1f5f9;
      border-color: #94a3b8;
    }

    .role-card.is-selected {
      background: #ffffff;
      border-color: #0070ba;
      box-shadow: 0 0 0 3px rgba(0, 112, 186, 0.12);
    }

    .role-icon-box {
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: #e2e8f0;
      color: #001435;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0.2rem;
    }

    .role-card.is-selected .role-icon-box {
      background: #0070ba;
      color: #ffffff;
    }

    .role-title {
      font-size: 0.92rem;
      font-weight: 700;
      color: #001435;
    }

    .role-desc {
      font-size: 0.74rem;
      color: #64748b;
      line-height: 1.35;
    }

    /* Fast Track Box */
    .fast-track-box {
      background: #f0f7ff;
      border: 1.5px solid #bae0fd;
      border-radius: 12px;
      padding: 1.15rem;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }

    .fast-track-head {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      color: #0070ba;
      font-size: 0.82rem;
      font-weight: 800;
      letter-spacing: 0.02em;
    }

    .fast-track-sub {
      margin: 0;
      font-size: 0.78rem;
      color: #334155;
      line-height: 1.4;
    }

    .fast-track-buttons {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.65rem;
      margin-top: 0.25rem;
    }

    .btn-fast-auth {
      background: #ffffff;
      border: 1.5px solid #0070ba;
      color: #0070ba;
      padding: 0.65rem 0.85rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.45rem;
      transition: all 0.2s;
    }

    .btn-fast-auth:hover {
      background: #0070ba;
      color: #ffffff;
    }

    .btn-fast-auth:hover svg {
      stroke: #ffffff;
    }

    /* OAuth Section */
    .oauth-section {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      border-top: 1px solid #e2e8f0;
      padding-top: 1.15rem;
    }

    .oauth-section-title {
      text-align: center;
      font-size: 0.72rem;
      font-weight: 800;
      color: #94a3b8;
      letter-spacing: 0.05em;
    }

    .return-url-selector-box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.75rem 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }

    .url-selector-label {
      font-size: 0.72rem;
      font-weight: 700;
      color: #475569;
    }

    .url-pills-row {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .url-pill-btn {
      flex: 1;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 0.35rem 0.65rem;
      font-size: 0.74rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      transition: all 0.15s;
    }

    .url-pill-btn.is-active {
      background: #001435;
      color: #ffffff;
      border-color: #001435;
    }

    .btn-paypal-primary {
      width: 100%;
      background: #0070ba;
      color: #ffffff;
      border: none;
      border-radius: 28px;
      padding: 0.9rem 1.5rem;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.65rem;
      transition: all 0.2s;
      box-shadow: 0 4px 14px rgba(0, 112, 186, 0.25);
    }

    .btn-paypal-primary:hover:not(:disabled) {
      background: #005ea6;
      transform: translateY(-1px);
    }

    .btn-paypal-primary:disabled {
      opacity: 0.7;
      cursor: not-allowed;
    }

    .pp-icon-embed {
      width: 24px;
      height: 24px;
      background: #ffffff;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dashboard-tip-card {
      display: flex;
      gap: 0.6rem;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 0.75rem 0.85rem;
      align-items: flex-start;
    }

    .tip-text {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.74rem;
      color: #475569;
      line-height: 1.45;
    }

    .tip-text strong {
      color: #001435;
    }

    .tip-text code {
      background: #e2e8f0;
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      font-family: monospace;
      color: #001435;
    }

    .tip-text a {
      color: #0070ba;
      font-weight: 700;
      text-decoration: underline;
    }

    /* Auth loading & active states */
    .auth-loading-state {
      padding: 3.5rem 2rem;
      text-align: center;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3.5px solid #e2e8f0;
      border-top-color: #0070ba;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 1.25rem auto;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .auth-loading-state h4 {
      margin: 0 0 0.4rem 0;
      font-size: 1.15rem;
      color: #001435;
    }

    .auth-loading-state p {
      margin: 0;
      font-size: 0.85rem;
      color: #64748b;
    }

    .active-session-box {
      padding: 2.25rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }

    .session-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #15803d;
      font-size: 0.85rem;
      font-weight: 700;
      background: #f0fdf4;
      border: 1px solid #86efac;
      padding: 0.45rem 0.85rem;
      border-radius: 6px;
    }

    .user-row {
      display: flex;
      align-items: center;
      gap: 1.25rem;
    }

    .user-avatar-lg {
      width: 58px;
      height: 58px;
      border-radius: 50%;
      background: #0070ba;
      color: #ffffff;
      font-size: 1.5rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .user-details {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .user-details strong {
      font-size: 1.15rem;
      color: #001435;
    }

    .user-email {
      font-size: 0.85rem;
      color: #64748b;
    }

    .role-chip {
      display: inline-block;
      align-self: flex-start;
      margin-top: 0.25rem;
      background: #e2e8f0;
      color: #001435;
      font-size: 0.68rem;
      font-weight: 800;
      padding: 0.15rem 0.55rem;
      border-radius: 4px;
    }

    .session-actions {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .btn-proceed-portal {
      background: #0070ba;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 0.85rem 1.4rem;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: background 0.2s;
    }

    .btn-proceed-portal:hover {
      background: #005ea6;
    }

    .btn-logout-link {
      background: none;
      border: none;
      color: #64748b;
      font-size: 0.82rem;
      cursor: pointer;
      padding: 0.35rem 0;
    }

    .btn-logout-link:hover {
      color: #dc2626;
      text-decoration: underline;
    }
  `]
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
