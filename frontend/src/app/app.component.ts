import { Component, OnInit } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from './api.config';

interface CurrentUser {
  id: number;
  email: string;
  full_name: string;
  role_type: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="main-shell">
      <!-- Enterprise Corporate Header -->
      <header class="pp-navbar">
        <div class="nav-left">
          <a routerLink="/" class="brand-link">
            <div class="pp-brand-icon">
              <!-- Official PayPal Double-P Monogram SVG -->
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 3.72a.784.784 0 0 1 .773-.654h6.398c2.936 0 5.093.633 6.411 1.882 1.258 1.192 1.666 2.87 1.213 4.989-.66 3.08-2.613 5.228-5.805 6.385-1.026.372-2.22.56-3.548.56H7.954a.784.784 0 0 0-.773.654l-.105.546z" fill="#0079C1"/>
                <path d="M9.13 16.882l.983-6.23a.784.784 0 0 1 .773-.654h3.63c2.722 0 4.707.575 5.905 1.708 1.144 1.082 1.492 2.607 1.034 4.53-.615 2.578-2.316 4.398-5.056 5.41a10.03 10.03 0 0 1-3.606.636H10.12a.784.784 0 0 1-.773-.654l-.217-1.126z" fill="#00457C"/>
              </svg>
            </div>
            <div>
              <div class="brand-title">
                ProofLens <span class="pp-tag">PayPal Escrow</span>
              </div>
              <div class="brand-subtitle">AI-Verified Milestones & Contract Intelligence</div>
            </div>
          </a>

          <!-- Corporate Navigation Links -->
          <nav class="corp-nav-links">
            <a routerLink="/buyer" routerLinkActive="active" class="corp-nav-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
              </svg>
              <span>Buyer Console</span>
            </a>
            <a routerLink="/seller" routerLinkActive="active" class="corp-nav-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
              </svg>
              <span>Contractor Desk</span>
            </a>
            <a routerLink="/wizard" routerLinkActive="active" class="corp-nav-item">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <span>New Escrow Project</span>
            </a>
          </nav>
        </div>

        <div class="nav-right">
          <div class="nav-status-pill">
            <span class="pulse-dot"></span>
            <span>PayPal Sandbox Active</span>
          </div>

          <!-- Authentication Button / User Profile -->
          @if (currentUser) {
            <button type="button" class="user-profile-badge" (click)="openAuthModal()">
              <div class="user-avatar-circle">
                {{ currentUser.full_name.charAt(0) || 'P' }}
              </div>
              <div class="user-meta-col">
                <span class="user-name">{{ currentUser.full_name }}</span>
                <span class="user-role-tag">{{ currentUser.role_type | uppercase }}</span>
              </div>
              <svg class="dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
          } @else {
            <a routerLink="/login" class="btn-paypal-login">
              <svg class="pp-icon-svg" width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 3.72a.784.784 0 0 1 .773-.654h6.398c2.936 0 5.093.633 6.411 1.882 1.258 1.192 1.666 2.87 1.213 4.989-.66 3.08-2.613 5.228-5.805 6.385-1.026.372-2.22.56-3.548.56H7.954a.784.784 0 0 0-.773.654l-.105.546z" fill="#0079C1"/>
                <path d="M9.13 16.882l.983-6.23a.784.784 0 0 1 .773-.654h3.63c2.722 0 4.707.575 5.905 1.708 1.144 1.082 1.492 2.607 1.034 4.53-.615 2.578-2.316 4.398-5.056 5.41a10.03 10.03 0 0 1-3.606.636H10.12a.784.784 0 0 1-.773-.654l-.217-1.126z" fill="#00457C"/>
              </svg>
              <span>Log in with PayPal</span>
            </a>
          }
        </div>
      </header>

      <!-- Toast Notification for OAuth -->
      @if (authNotification) {
        <div class="auth-toast-banner" [class.is-error]="authNotification.type === 'error'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            @if (authNotification.type === 'error') {
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            } @else {
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            }
          </svg>
          <span>{{ authNotification.message }}</span>
          <button (click)="authNotification = null" class="btn-toast-close" aria-label="Close notification">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      }

      <main class="page-content">
        <router-outlet></router-outlet>
      </main>

      <!-- PayPal OAuth Authentication Modal -->
      @if (showAuthModal) {
        <div class="modal-backdrop" (click)="closeAuthModal()">
          <div class="auth-modal-card" (click)="$event.stopPropagation()">
            <div class="auth-modal-header">
              <div class="auth-pp-icon-box">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 3.72a.784.784 0 0 1 .773-.654h6.398c2.936 0 5.093.633 6.411 1.882 1.258 1.192 1.666 2.87 1.213 4.989-.66 3.08-2.613 5.228-5.805 6.385-1.026.372-2.22.56-3.548.56H7.954a.784.784 0 0 0-.773.654l-.105.546z" fill="#0079C1"/>
                  <path d="M9.13 16.882l.983-6.23a.784.784 0 0 1 .773-.654h3.63c2.722 0 4.707.575 5.905 1.708 1.144 1.082 1.492 2.607 1.034 4.53-.615 2.578-2.316 4.398-5.056 5.41a10.03 10.03 0 0 1-3.606.636H10.12a.784.784 0 0 1-.773-.654l-.217-1.126z" fill="#00457C"/>
                </svg>
              </div>
              <div class="auth-header-text">
                <h3>PayPal Identity & Escrow Login</h3>
                <p>ProofLens Authenticated Access & Escrow Protection</p>
              </div>
              <button (click)="closeAuthModal()" class="btn-close-modal" aria-label="Close modal">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>

            <div class="auth-modal-body">
              @if (currentUser) {
                <div class="logged-in-profile-box">
                  <div class="profile-avatar-lg">
                    {{ currentUser.full_name.charAt(0) || 'P' }}
                  </div>
                  <div class="profile-details-col">
                    <strong>{{ currentUser.full_name }}</strong>
                    <span class="profile-email-text">{{ currentUser.email }}</span>
                    <span class="profile-role-badge">Active Role: {{ currentUser.role_type | uppercase }}</span>
                  </div>
                </div>

                <div class="auth-switch-section">
                  <label class="auth-label">Switch Local Sandbox Profile:</label>
                  <div class="quick-login-grid">
                    <button type="button" (click)="loginWithCode('sandbox_buyer')" class="btn-quick-auth">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.5">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
                      </svg>
                      <span>Switch to Buyer (buyer&#64;prooflens.com)</span>
                    </button>
                    <button type="button" (click)="loginWithCode('sandbox_seller')" class="btn-quick-auth">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.5">
                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                      </svg>
                      <span>Switch to Contractor (seller&#64;prooflens.com)</span>
                    </button>
                  </div>
                </div>

                <div class="auth-modal-footer">
                  <button type="button" (click)="logout()" class="btn-logout-auth">
                    Sign Out
                  </button>
                  <button type="button" (click)="closeAuthModal()" class="btn-done-auth">
                    Done
                  </button>
                </div>
              } @else {
                <p class="auth-explainer">
                  ProofLens connects directly to PayPal's live Sandbox Identity OAuth protocol. Click below to authorize with your real PayPal Sandbox account.
                </p>

                <!-- Primary: Official PayPal OAuth Button -->
                @if (oauthConfig?.oauth_url) {
                  <a [href]="oauthConfig.oauth_url" class="btn-paypal-oauth-full">
                    <svg class="pp-icon-svg" width="18" height="18" viewBox="0 0 24 24" fill="none">
                      <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 3.72a.784.784 0 0 1 .773-.654h6.398c2.936 0 5.093.633 6.411 1.882 1.258 1.192 1.666 2.87 1.213 4.989-.66 3.08-2.613 5.228-5.805 6.385-1.026.372-2.22.56-3.548.56H7.954a.784.784 0 0 0-.773.654l-.105.546z" fill="#0079C1"/>
                      <path d="M9.13 16.882l.983-6.23a.784.784 0 0 1 .773-.654h3.63c2.722 0 4.707.575 5.905 1.708 1.144 1.082 1.492 2.607 1.034 4.53-.615 2.578-2.316 4.398-5.056 5.41a10.03 10.03 0 0 1-3.606.636H10.12a.784.784 0 0 1-.773-.654l-.217-1.126z" fill="#00457C"/>
                    </svg>
                    <span>Authorize with PayPal Sandbox (Real OAuth)</span>
                  </a>
                }

                <!-- Manual OAuth Authorization Code Input -->
                <div class="manual-code-section">
                  <label class="auth-label">Manual Authorization Code Exchange:</label>
                  <div class="manual-input-row">
                    <input
                      type="text"
                      [(ngModel)]="customAuthCode"
                      placeholder="Paste PayPal authorization code..."
                      class="auth-code-input"
                    />
                    <button
                      type="button"
                      (click)="loginWithCode(customAuthCode)"
                      [disabled]="!customAuthCode.trim() || isAuthenticating"
                      class="btn-exchange-code"
                    >
                      {{ isAuthenticating ? 'Exchanging...' : 'Exchange Code' }}
                    </button>
                  </div>
                </div>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .main-shell {
      min-height: 100vh;
      background: #f8fafc;
      display: flex;
      flex-direction: column;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
    }

    /* Enterprise Corporate Navbar */
    .pp-navbar {
      background: #001435;
      color: #ffffff;
      padding: 0.75rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0, 20, 53, 0.15);
      border-bottom: 2px solid #0070ba;
      flex-wrap: wrap;
      gap: 1.25rem;
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .nav-left {
      display: flex;
      align-items: center;
      gap: 2rem;
      flex-wrap: wrap;
    }

    .brand-link {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      text-decoration: none;
      color: inherit;
    }

    .pp-brand-icon {
      width: 38px;
      height: 38px;
      background: #ffffff;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
    }

    .brand-title {
      font-size: 1.15rem;
      font-weight: 800;
      letter-spacing: -0.02em;
      line-height: 1.2;
      color: #ffffff;
    }

    .pp-tag {
      font-size: 0.7rem;
      font-weight: 700;
      background: #0070ba;
      color: #ffffff;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      vertical-align: middle;
      margin-left: 0.35rem;
      letter-spacing: 0.02em;
    }

    .brand-subtitle {
      font-size: 0.75rem;
      color: #94a3b8;
    }

    /* Corporate Nav Links */
    .corp-nav-links {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .corp-nav-item {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      color: #cbd5e1;
      text-decoration: none;
      font-size: 0.84rem;
      font-weight: 600;
      padding: 0.45rem 0.85rem;
      border-radius: 8px;
      transition: all 0.18s;
    }

    .corp-nav-item:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.08);
    }

    .corp-nav-item.active {
      color: #ffffff;
      background: rgba(0, 112, 186, 0.35);
      border: 1px solid rgba(0, 112, 186, 0.5);
    }

    /* Right Nav Items */
    .nav-right {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .nav-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(0, 112, 186, 0.18);
      padding: 0.35rem 0.85rem;
      border-radius: 20px;
      font-size: 0.74rem;
      font-weight: 700;
      color: #7dd3fc;
      border: 1px solid rgba(0, 112, 186, 0.4);
    }

    .pulse-dot {
      width: 7px;
      height: 7px;
      background: #10b981;
      border-radius: 50%;
      box-shadow: 0 0 6px #10b981;
    }

    /* PayPal Login Button */
    .btn-paypal-login {
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      background: #0070ba;
      color: #ffffff;
      border: 1px solid #005ea6;
      padding: 0.45rem 1rem;
      border-radius: 20px;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 112, 186, 0.35);
      transition: all 0.18s;
    }

    .btn-paypal-login:hover {
      background: #005ea6;
      transform: translateY(-1px);
    }

    /* Logged in Profile Badge */
    .user-profile-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.65rem;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 0.35rem 0.85rem;
      border-radius: 20px;
      cursor: pointer;
      color: #ffffff;
      transition: background 0.18s;
    }

    .user-profile-badge:hover {
      background: rgba(255, 255, 255, 0.14);
    }

    .user-avatar-circle {
      width: 26px;
      height: 26px;
      background: #0070ba;
      color: #ffffff;
      border-radius: 50%;
      font-size: 0.8rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .user-meta-col {
      display: flex;
      flex-direction: column;
      text-align: left;
    }

    .user-name {
      font-size: 0.8rem;
      font-weight: 700;
      color: #ffffff;
      line-height: 1.1;
    }

    .user-role-tag {
      font-size: 0.65rem;
      font-weight: 800;
      color: #93c5fd;
      letter-spacing: 0.04em;
    }

    .dropdown-chevron {
      color: #94a3b8;
    }

    /* Auth Toast */
    .auth-toast-banner {
      background: #f0fdf4;
      border-bottom: 1.5px solid #bbf7d0;
      color: #166534;
      padding: 0.6rem 2rem;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      font-size: 0.85rem;
      font-weight: 600;
    }

    .auth-toast-banner.is-error {
      background: #fef2f2;
      border-bottom-color: #fecaca;
      color: #991b1b;
    }

    .btn-toast-close {
      margin-left: auto;
      background: none;
      border: none;
      font-size: 0.9rem;
      color: inherit;
      cursor: pointer;
    }

    .page-content {
      flex: 1;
      padding: 1.5rem 1rem 3rem 1rem;
    }

    /* Authentication Modal */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 20, 53, 0.65);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .auth-modal-card {
      background: #ffffff;
      border-radius: 16px;
      max-width: 520px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 20, 53, 0.25);
      border: 1px solid #e2e8f0;
      overflow: hidden;
    }

    .auth-modal-header {
      background: #001435;
      padding: 1.25rem 1.5rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      color: #ffffff;
      position: relative;
    }

    .auth-pp-icon-box {
      width: 40px;
      height: 40px;
      background: #ffffff;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .auth-header-text h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 800;
      color: #ffffff;
    }

    .auth-header-text p {
      margin: 0.2rem 0 0 0;
      font-size: 0.78rem;
      color: #94a3b8;
    }

    .btn-close-modal {
      position: absolute;
      top: 1.25rem;
      right: 1.25rem;
      background: none;
      border: none;
      color: #94a3b8;
      font-size: 1.1rem;
      cursor: pointer;
    }

    .btn-close-modal:hover {
      color: #ffffff;
    }

    .auth-modal-body {
      padding: 1.5rem;
    }

    .auth-explainer {
      font-size: 0.88rem;
      color: #475569;
      line-height: 1.5;
      margin: 0 0 1.25rem 0;
    }

    .btn-paypal-oauth-full {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.65rem;
      background: #0070ba;
      color: #ffffff;
      text-decoration: none;
      padding: 0.85rem 1.25rem;
      border-radius: 10px;
      font-weight: 700;
      font-size: 0.95rem;
      box-shadow: 0 4px 12px rgba(0, 112, 186, 0.3);
      transition: all 0.18s;
    }

    .btn-paypal-oauth-full:hover {
      background: #005ea6;
      transform: translateY(-1px);
    }

    .auth-divider {
      text-align: center;
      position: relative;
      margin: 1.5rem 0 1.25rem 0;
    }

    .auth-divider::before {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 1px;
      background: #e2e8f0;
    }

    .auth-divider span {
      background: #ffffff;
      padding: 0 0.85rem;
      position: relative;
      font-size: 0.7rem;
      font-weight: 800;
      color: #64748b;
      letter-spacing: 0.05em;
    }

    .quick-login-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.85rem;
    }

    .btn-quick-auth {
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 10px;
      padding: 0.85rem 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.65rem;
      text-align: left;
      cursor: pointer;
      transition: all 0.18s;
    }

    .btn-quick-auth:hover {
      background: #f0f9ff;
      border-color: #0070ba;
      transform: translateY(-1px);
    }

    .quick-btn-text strong {
      display: block;
      font-size: 0.82rem;
      color: #0f172a;
    }

    .quick-btn-text span {
      display: block;
      font-size: 0.72rem;
      color: #64748b;
    }

    .manual-code-section {
      margin-top: 1.25rem;
      padding-top: 1.25rem;
      border-top: 1px solid #e2e8f0;
    }

    .auth-label {
      display: block;
      font-size: 0.78rem;
      font-weight: 700;
      color: #334155;
      margin-bottom: 0.45rem;
    }

    .manual-input-row {
      display: flex;
      gap: 0.5rem;
    }

    .auth-code-input {
      flex: 1;
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.55rem 0.75rem;
      font-size: 0.85rem;
    }

    .btn-exchange-code {
      background: #001435;
      color: #ffffff;
      border: none;
      padding: 0.55rem 1rem;
      border-radius: 8px;
      font-size: 0.82rem;
      font-weight: 700;
      cursor: pointer;
    }

    .btn-exchange-code:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }

    .logged-in-profile-box {
      display: flex;
      align-items: center;
      gap: 1rem;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1.25rem;
    }

    .profile-avatar-lg {
      width: 46px;
      height: 46px;
      background: #0070ba;
      color: #ffffff;
      border-radius: 50%;
      font-size: 1.2rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .profile-details-col {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }

    .profile-details-col strong {
      font-size: 0.95rem;
      color: #0f172a;
    }

    .profile-email-text {
      font-size: 0.82rem;
      color: #64748b;
    }

    .profile-role-badge {
      font-size: 0.7rem;
      font-weight: 800;
      color: #0070ba;
      background: #e0f2fe;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      align-self: flex-start;
      margin-top: 0.2rem;
    }

    .auth-switch-section {
      margin-top: 1rem;
    }

    .auth-modal-footer {
      display: flex;
      justify-content: space-between;
      margin-top: 1.5rem;
      padding-top: 1rem;
      border-top: 1px solid #e2e8f0;
    }

    .btn-logout-auth {
      background: #ffffff;
      border: 1px solid #f87171;
      color: #dc2626;
      padding: 0.55rem 1rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.85rem;
      cursor: pointer;
    }

    .btn-done-auth {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.55rem 1.25rem;
      border-radius: 8px;
      font-weight: 700;
      font-size: 0.85rem;
      cursor: pointer;
    }
  `]
})
export class AppComponent implements OnInit {
  currentUser: CurrentUser | null = null;
  showAuthModal = false;
  isAuthenticating = false;
  oauthConfig: any = null;
  customAuthCode = '';
  authNotification: { message: string; type: 'success' | 'error' } | null = null;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadStoredUser();
    this.loadOAuthConfig();
    this.checkForOAuthCallback();
  }

  loadStoredUser() {
    try {
      const stored = localStorage.getItem('prooflens_user');
      if (stored) {
        this.currentUser = JSON.parse(stored);
      } else {
        // Default guest user
        this.currentUser = {
          id: 1,
          email: 'buyer@prooflens.com',
          full_name: 'PayPal Verified Buyer',
          role_type: 'buyer'
        };
      }
    } catch {
      this.currentUser = null;
    }
  }

  loadOAuthConfig() {
    this.http.get<any>(`${API_BASE_URL}/api/auth/paypal-config`).subscribe({
      next: (cfg) => {
        this.oauthConfig = cfg;
      },
      error: () => {
        // Fallback config for localhost:4200
        this.oauthConfig = {
          redirect_uri: 'http://localhost:4200',
          oauth_url: 'https://www.sandbox.paypal.com/connect?flowEntry=static&client_id=AXTjsjnN-jp1XjvX8PI-eE46ycgGDn6rZFvvIpoQGGpVQqj4PnlEqQ185sfTdsir_IbDx4CM7xdhZikc&response_type=code&scope=openid%20profile%20email&redirect_uri=http://localhost:4200'
        };
      }
    });
  }

  checkForOAuthCallback() {
    if (typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      this.loginWithCode(code);
      // Clean query parameter from URL
      const cleanUrl = window.location.origin + window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);
    }
  }

  openAuthModal() {
    this.showAuthModal = true;
  }

  closeAuthModal() {
    this.showAuthModal = false;
  }

  loginWithCode(code: string) {
    if (!code) return;
    this.isAuthenticating = true;
    this.http.post<CurrentUser>(`${API_BASE_URL}/api/auth/paypal-login`, {
      code: code.trim(),
      redirect_uri: 'http://localhost:4200'
    }).subscribe({
      next: (user) => {
        this.isAuthenticating = false;
        this.currentUser = user;
        localStorage.setItem('prooflens_user', JSON.stringify(user));
        this.showAuthModal = false;
        this.authNotification = {
          message: `Successfully authenticated via PayPal Identity as ${user.full_name} (${user.email})!`,
          type: 'success'
        };
        setTimeout(() => {
          this.authNotification = null;
        }, 5000);
      },
      error: (err) => {
        this.isAuthenticating = false;
        const msg = err.error?.detail || err.message || 'PayPal authentication failed.';
        this.authNotification = {
          message: `PayPal Login Error: ${msg}`,
          type: 'error'
        };
      }
    });
  }

  logout() {
    localStorage.removeItem('prooflens_user');
    this.currentUser = null;
    this.showAuthModal = false;
    this.authNotification = {
      message: 'Signed out from PayPal session.',
      type: 'success'
    };
    setTimeout(() => {
      this.authNotification = null;
    }, 4000);
  }
}
