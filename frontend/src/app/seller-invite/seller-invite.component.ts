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
  errorMessage = '';
  projectData: any = null;

  sellerName = 'Master Craftsman';
  sellerEmail = 'contractor@prooflens.com';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
  ) {}

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.token = params.get('token') || '';
      if (this.token) {
        this.fetchInviteDetails();
      } else {
        this.errorMessage = 'No invitation token found in URL.';
        this.isLoading = false;
      }
    });
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
    this.isJoining = true;
    const payload = {
      seller_email: this.sellerEmail,
      seller_name: this.sellerName
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
