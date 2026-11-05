import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { API_BASE_URL } from '../api.config';

@Component({
  selector: 'app-seller-invite',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './seller-invite.component.html',
  styleUrl: './seller-invite.component.scss'
})
export class SellerInviteComponent implements OnInit {
  token = '';
  isLoading = true;
  isJoining = false;
  errorMessage = '';
  projectData: any = null;

  sellerName = '';
  sellerEmail = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.token = params.get('token') || '';
      if (this.token) {
        const user = this.getSignedInSeller();
        if (!user) {
          this.router.navigate(['/login'], {
            queryParams: { role: 'seller', returnUrl: this.router.url }
          });
          return;
        }
        this.sellerName = user.full_name;
        this.sellerEmail = user.email;
        this.fetchInviteDetails();
      } else {
        this.errorMessage = 'No invitation token found in URL.';
        this.isLoading = false;
      }
    });
  }

  private getSignedInSeller(): { full_name: string; email: string } | null {
    try {
      const user = JSON.parse(localStorage.getItem('prooflens_user') || 'null');
      return user?.role_type === 'seller' && user.email && user.full_name
        ? { full_name: user.full_name, email: user.email }
        : null;
    } catch {
      return null;
    }
  }

  fetchInviteDetails() {
    this.isLoading = true;
    this.http.get<any>(`${API_BASE_URL}/api/projects/invite/${this.token}`)
      .subscribe({
        next: (data) => {
          this.projectData = data;
          this.isLoading = false;
        },
        error: (err) => {
          this.isLoading = false;
          this.errorMessage = err.error?.detail || 'This invitation is invalid or has expired.';
        }
      });
  }

  joinProject() {
    const seller = this.getSignedInSeller();
    if (!seller) {
      this.router.navigate(['/login'], {
        queryParams: { role: 'seller', returnUrl: this.router.url }
      });
      return;
    }

    this.isJoining = true;
    const payload = {
      seller_email: seller.email,
      seller_name: seller.full_name
    };

    this.http.post<any>(`${API_BASE_URL}/api/projects/invite/${this.token}/join`, payload)
      .subscribe({
        next: (res) => {
          this.isJoining = false;
          // Navigate to negotiation room as seller
          this.router.navigate(['/project', res.project_id, 'negotiate'], { queryParams: { role: 'seller' } });
        },
        error: (err) => {
          this.isJoining = false;
          alert('Failed to join project: ' + (err.error?.detail || err.message));
        }
      });
  }

  goToHome() {
    this.router.navigate(['/']);
  }
}
