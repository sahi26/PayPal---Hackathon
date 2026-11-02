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
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  currentUser: CurrentUser | null = null;
  showAuthModal = false;
  isAuthenticating = false;
  oauthConfig: any = null;
  customAuthCode = '';
  authNotification: { message: string; type: 'success' | 'error' } | null = null;
  mobileMenuOpen = false;

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.loadStoredUser();
    this.loadOAuthConfig();
    this.checkForOAuthCallback();
  }

  toggleMobileMenu() {
    this.mobileMenuOpen = !this.mobileMenuOpen;
    this.updateBodyScroll();
  }

  closeMobileMenu() {
    this.mobileMenuOpen = false;
    this.updateBodyScroll();
  }

  private updateBodyScroll() {
    if (typeof document !== 'undefined') {
      if (this.mobileMenuOpen) {
        document.body.style.overflow = 'hidden';
      } else {
        document.body.style.overflow = '';
      }
    }
  }

  loadStoredUser() {
    try {
      const stored = localStorage.getItem('prooflens_user');
      if (stored) {
        this.currentUser = JSON.parse(stored);
      } else {
        // Default verified buyer user
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

  switchRole(role: 'buyer' | 'seller') {
    if (role === 'buyer') {
      this.currentUser = {
        id: 1,
        email: 'buyer@prooflens.com',
        full_name: 'PayPal Verified Buyer',
        role_type: 'buyer'
      };
    } else {
      this.currentUser = {
        id: 2,
        email: 'contractor@prooflens.com',
        full_name: 'Master Craftsman & Contractor',
        role_type: 'seller'
      };
    }
    localStorage.setItem('prooflens_user', JSON.stringify(this.currentUser));
    this.authNotification = {
      message: `Active session set to ${this.currentUser.full_name} (${this.currentUser.role_type.toUpperCase()})`,
      type: 'success'
    };
    this.closeAuthModal();
    this.closeMobileMenu();
    setTimeout(() => {
      this.authNotification = null;
    }, 4000);
  }

  logout() {
    localStorage.removeItem('prooflens_user');
    this.currentUser = null;
    this.showAuthModal = false;
    this.closeMobileMenu();
    this.authNotification = {
      message: 'Signed out from PayPal session.',
      type: 'success'
    };
    setTimeout(() => {
      this.authNotification = null;
    }, 4000);
  }
}
