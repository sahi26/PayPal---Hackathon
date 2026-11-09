import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from './api.config';
import { PROOFLENS_LOGO_BASE64 } from './assets.constants';

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
export class AppComponent implements OnInit, OnDestroy {
  readonly appLogo = PROOFLENS_LOGO_BASE64;
  currentUser: CurrentUser | null = null;
  showAuthModal = false;
  isAuthenticating = false;
  oauthConfig: any = null;
  customAuthCode = '';
  mobileMenuOpen = false;

  // Real-time In-App Notifications
  notifications: any[] = [];
  unreadNotificationCount = 0;
  showNotificationsPopover = false;
  private notifPollInterval: any = null;
  private isFetchingNotifications = false;

  // Floating Toast Notification System
  activeToast: {
    title?: string;
    message: string;
    type: 'success' | 'error' | 'info';
    actionUrl?: string;
  } | null = null;
  private toastTimer: any = null;

  get authNotification(): { message: string; type: 'success' | 'error' } | null {
    if (!this.activeToast) return null;
    return {
      message: this.activeToast.message,
      type: this.activeToast.type === 'error' ? 'error' : 'success'
    };
  }
  set authNotification(val: { message: string; type: 'success' | 'error' } | null) {
    if (val) {
      this.showToast(
        val.type === 'error' ? 'Authentication Alert' : 'PayPal Action Verified',
        val.message,
        val.type
      );
    } else {
      this.dismissToast();
    }
  }

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit() {
    this.loadStoredUser();
    this.loadOAuthConfig();
    this.checkForOAuthCallback();
    this.loadNotifications();
    if (typeof window !== 'undefined' && this.currentUser) {
      const path = window.location.pathname;
      if (path === '/' || path === '/login') {
        const targetRoute = this.currentUser.role_type === 'seller' ? '/seller' : '/buyer';
        this.router.navigate([targetRoute]);
      }
    }

    // Poll notifications every 30 seconds for active updates when user is logged in
    if (typeof window !== 'undefined') {
      this.notifPollInterval = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) {
          return;
        }
        if (this.currentUser && !this.isFetchingNotifications) {
          this.loadNotifications();
        }
      }, 30000);
    }
  }

  ngOnDestroy() {
    if (this.notifPollInterval) {
      clearInterval(this.notifPollInterval);
      this.notifPollInterval = null;
    }
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  }

  showToast(title: string, message: string, type: 'success' | 'error' | 'info' = 'info', actionUrl?: string) {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.activeToast = { title, message, type, actionUrl };
    if (typeof window !== 'undefined') {
      this.toastTimer = setTimeout(() => {
        this.activeToast = null;
      }, 6000);
    }
  }

  dismissToast() {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
    this.activeToast = null;
  }

  handleToastClick(actionUrl?: string) {
    if (actionUrl) {
      this.dismissToast();
      this.router.navigateByUrl(this.getRoleAwareActionUrl(actionUrl));
    }
  }

  private getRoleAwareActionUrl(actionUrl: string): string {
    const role = this.currentUser?.role_type?.toLowerCase();
    if (!role || !actionUrl.startsWith('/project/')) return actionUrl;

    const resolvedRole = role === 'seller' || role === 'maker' ? 'seller' : 'buyer';
    const [path, query = ''] = actionUrl.split('?', 2);
    const params = new URLSearchParams(query);
    params.set('role', resolvedRole);
    return `${path}?${params.toString()}`;
  }

  loadNotifications() {
    if (!this.currentUser) {
      this.notifications = [];
      this.unreadNotificationCount = 0;
      return;
    }
    if (this.isFetchingNotifications) {
      return;
    }
    this.isFetchingNotifications = true;

    const role = this.currentUser.role_type || 'buyer';
    const email = this.currentUser.email || '';
    let url = `${API_BASE_URL}/api/notifications?role=${role}`;
    if (email) {
      url += `&email=${encodeURIComponent(email)}`;
    }
    
    this.http.get<any>(url).subscribe({
      next: (res) => {
        this.isFetchingNotifications = false;
        this.notifications = res.notifications || [];
        this.unreadNotificationCount = res.unread_count || 0;
      },
      error: () => {
        this.isFetchingNotifications = false;
        // Silently handle offline/mock state
      }
    });
  }

  toggleNotificationsPopover() {
    this.showNotificationsPopover = !this.showNotificationsPopover;
  }

  closeNotificationsPopover() {
    this.showNotificationsPopover = false;
  }

  @HostListener('document:click', ['$event'])
  closeNotificationsOnOutsideClick(event: MouseEvent) {
    const target = event.target;
    if (target instanceof Element && !target.closest('.notification-bell-container')) {
      this.closeNotificationsPopover();
    }
  }

  markNotificationAsRead(notif: any, event?: Event) {
    if (event) event.stopPropagation();
    if (notif.is_read) return;
    this.http.post<any>(`${API_BASE_URL}/api/notifications/${notif.id}/read`, {}).subscribe({
      next: () => {
        notif.is_read = true;
        this.unreadNotificationCount = Math.max(0, this.unreadNotificationCount - 1);
      }
    });
  }

  markAllNotificationsAsRead() {
    const role = this.currentUser?.role_type || 'buyer';
    const email = this.currentUser?.email || '';
    let url = `${API_BASE_URL}/api/notifications/mark-all-read?role=${role}`;
    if (email) {
      url += `&email=${encodeURIComponent(email)}`;
    }
    
    this.http.post<any>(url, {}).subscribe({
      next: () => {
        this.notifications.forEach(n => n.is_read = true);
        this.unreadNotificationCount = 0;
      }
    });
  }

  handleNotificationClick(notif: any) {
    this.markNotificationAsRead(notif);
    this.closeNotificationsPopover();
    if (notif.action_url) {
      this.router.navigateByUrl(this.getRoleAwareActionUrl(notif.action_url));
    }
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

  get dashboardRoute(): string {
    return this.currentUser?.role_type === 'seller' ? '/seller' : '/buyer';
  }

  get isLoginPage(): boolean {
    if (typeof window !== 'undefined') {
      const url = this.router.url;
      const path = window.location.pathname;
      return url === '/login' || url.startsWith('/login?') || url === '/' || path === '/login' || path.startsWith('/login?');
    }
    return false;
  }

  loadStoredUser() {
    try {
      const stored = localStorage.getItem('prooflens_user');
      if (stored) {
        this.currentUser = JSON.parse(stored);
      } else {
        this.currentUser = null;
      }
    } catch {
      this.currentUser = null;
    }
  }

  loadOAuthConfig() {
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const effectiveRedirect = isLocalhost ? 'http://localhost:4200' : 'https://pay-pal-hackathon-phi.vercel.app';

    this.http.get<any>(`${API_BASE_URL}/api/auth/paypal-config?redirect_uri=${encodeURIComponent(effectiveRedirect)}`).subscribe({
      next: (cfg) => {
        this.oauthConfig = cfg;
      },
      error: () => {
        this.oauthConfig = {
          redirect_uri: effectiveRedirect,
          oauth_url: `https://www.sandbox.paypal.com/connect?flowEntry=static&client_id=AXTjsjnN-jp1XjvX8PI-eE46ycgGDn6rZFvvIpoQGGpVQqj4PnlEqQ185sfTdsir_IbDx4CM7xdhZikc&response_type=code&scope=openid%20profile%20email&redirect_uri=${encodeURIComponent(effectiveRedirect)}`
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
    const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
    const redirectUri = isLocalhost ? 'http://localhost:4200' : 'https://pay-pal-hackathon-phi.vercel.app';
    const role = localStorage.getItem('prooflens_pending_role') || 'buyer';

    this.http.post<CurrentUser>(`${API_BASE_URL}/api/auth/paypal-login`, {
      code: code.trim(),
      redirect_uri: redirectUri,
      role
    }).subscribe({
      next: (user) => {
        this.isAuthenticating = false;
        this.currentUser = user;
        localStorage.setItem('prooflens_user', JSON.stringify(user));
        this.showAuthModal = false;
        this.loadNotifications();

        // Auto-navigate directly to respective dashboard
        const targetRoute = user.role_type === 'seller' ? '/seller' : '/buyer';
        this.router.navigate([targetRoute]);
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
    this.loadNotifications();
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
    this.router.navigate(['/login']);
    this.authNotification = {
      message: 'Signed out from PayPal session.',
      type: 'success'
    };
    setTimeout(() => {
      this.authNotification = null;
    }, 4000);
  }
}
