import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_BASE_URL } from '../api.config';

@Component({
  selector: 'app-seller-invite',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './seller-invite.component.html',
  styleUrl: './seller-invite.component.scss'
})
export class SellerInviteComponent implements OnInit {
  token = '';
  isLoading = true;
  isJoining = false;
  isRejecting = false;
  isRejectModalOpen = false;
  rejectionReason = '';
  errorMessage = '';
  projectData: any = null;

  currentUser: any = null;
  isSeller = false;
  isBuyer = false;
  sellerName = '';
  sellerEmail = '';
  isAlreadyJoined = false;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.loadCurrentUser();
    this.route.paramMap.subscribe(params => {
      this.token = params.get('token') || '';
      if (this.token) {
        if (typeof window !== 'undefined') {
          localStorage.setItem('prooflens_return_url', `/invite/${this.token}`);
        }
        this.fetchInviteDetails();
      } else {
        this.errorMessage = 'No invitation token found in URL.';
        this.isLoading = false;
      }
    });
  }

  loadCurrentUser() {
    try {
      const stored = localStorage.getItem('prooflens_user');
      if (stored) {
        this.currentUser = JSON.parse(stored);
        this.isSeller = this.currentUser?.role_type === 'seller';
        this.isBuyer = this.currentUser?.role_type === 'buyer';
        if (this.isSeller) {
          this.sellerName = this.currentUser.full_name || this.currentUser.name || this.currentUser.email?.split('@')[0] || 'Contractor';
          this.sellerEmail = this.currentUser.email || '';
        }
      } else {
        this.currentUser = null;
        this.isSeller = false;
        this.isBuyer = false;
      }
    } catch {
      this.currentUser = null;
      this.isSeller = false;
      this.isBuyer = false;
    }
  }

  fetchInviteDetails() {
    this.isLoading = true;
    this.errorMessage = '';
    this.http.get<any>(`${API_BASE_URL}/api/projects/invite/${this.token}`)
      .subscribe({
        next: (data) => {
          this.projectData = data;
          this.isLoading = false;
          if (this.currentUser && data?.project?.seller_id && data.project.seller_id === this.currentUser.id) {
            this.isAlreadyJoined = true;
          }
        },
        error: (err) => {
          this.isLoading = false;
          this.errorMessage = err.error?.detail || 'This invitation is invalid or has expired.';
        }
      });
  }

  signInAsSeller() {
    if (typeof window !== 'undefined') {
      localStorage.setItem('prooflens_return_url', `/invite/${this.token}`);
      localStorage.setItem('prooflens_pending_role', 'seller');
    }
    this.router.navigate(['/login'], {
      queryParams: { role: 'seller', returnUrl: `/invite/${this.token}` }
    });
  }

  joinProject() {
    this.loadCurrentUser();
    if (!this.isSeller) {
      this.signInAsSeller();
      return;
    }

    this.isJoining = true;
    const payload = {
      seller_email: this.sellerEmail,
      seller_name: this.sellerName
    };

    this.http.post<any>(`${API_BASE_URL}/api/projects/invite/${this.token}/join`, payload)
      .subscribe({
        next: (res) => {
          this.isJoining = false;
          if (typeof window !== 'undefined') {
            localStorage.removeItem('prooflens_return_url');
          }
          // Navigate to negotiation room as seller
          this.router.navigate(['/project', res.project_id, 'negotiate'], { queryParams: { role: 'seller' } });
        },
        error: (err) => {
          this.isJoining = false;
          alert('Failed to join project: ' + (err.error?.detail || err.message));
        }
      });
  }

  get isProjectRejected(): boolean {
    const st = (this.projectData?.project?.status || '').toLowerCase();
    return st === 'rejected';
  }

  get isProjectAccepted(): boolean {
    const st = (this.projectData?.project?.status || '').toLowerCase();
    return ['accepted', 'active', 'in_review', 'warranty_period', 'completed'].includes(st);
  }

  openRejectModal() {
    this.rejectionReason = '';
    this.isRejectModalOpen = true;
  }

  closeRejectModal() {
    this.isRejectModalOpen = false;
  }

  rejectAgreement() {
    if (this.isRejecting) return;
    this.isRejecting = true;
    const reason = this.rejectionReason.trim() || 'Contractor declined agreement terms.';

    const rejectUrl = `${API_BASE_URL}/api/projects/invite/${this.token}/reject`;
    this.http.post<any>(rejectUrl, { reason, role: 'seller' })
      .subscribe({
        next: () => {
          this.isRejecting = false;
          this.isRejectModalOpen = false;
          if (typeof window !== 'undefined') {
            localStorage.removeItem('prooflens_return_url');
          }
          alert('Agreement rejected. Redirecting to contractor dashboard.');
          this.router.navigate(['/seller']);
        },
        error: (err) => {
          this.isRejecting = false;
          if (this.projectData?.project?.id) {
            this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectData.project.id}/reject`, { reason, role: 'seller' })
              .subscribe({
                next: () => {
                  this.isRejectModalOpen = false;
                  if (typeof window !== 'undefined') {
                    localStorage.removeItem('prooflens_return_url');
                  }
                  alert('Agreement rejected. Redirecting to contractor dashboard.');
                  this.router.navigate(['/seller']);
                },
                error: (e2) => alert('Failed to reject agreement: ' + (e2.error?.detail || e2.message || err.message))
              });
            return;
          }
          alert('Failed to reject agreement: ' + (err.error?.detail || err.message));
        }
      });
  }

  goToMilestones() {
    if (this.projectData?.project?.id) {
      this.router.navigate(['/project', this.projectData.project.id, 'fulfillment'], { queryParams: { role: 'seller' } });
    }
  }

  goToSellerDashboard() {
    this.router.navigate(['/seller']);
  }

  goToNegotiation() {
    if (this.projectData?.project?.id) {
      this.router.navigate(['/project', this.projectData.project.id, 'negotiate'], { queryParams: { role: 'seller' } });
    }
  }

  goToHome() {
    this.router.navigate(['/']);
  }
}
