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
  template: `
    <div class="invite-container">
      @if (isLoading) {
        <div class="loading-box">
          <div class="spinner"></div>
          <p>Loading project invitation...</p>
        </div>
      } @else if (errorMessage) {
        <div class="error-box">
          <h2>Invitation Error</h2>
          <p>{{ errorMessage }}</p>
          <button (click)="goToHome()" class="btn-primary">Return to Home</button>
        </div>
      } @else if (projectData) {
        <div class="invite-card">
          <!-- Header Banner -->
          <div class="invite-header">
            <span class="invite-badge">Project Invitation</span>
            <h1>{{ projectData.project.title }}</h1>
            <div class="meta-row">
              <span class="meta-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                <span>{{ projectData.project.industry_type }}</span>
              </span>
              <span class="meta-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
                <span>Initiated by {{ projectData.project.buyer_email }}</span>
              </span>
              @if (projectData.project.deadline) {
                <span class="meta-item">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                    <line x1="16" y1="2" x2="16" y2="6"/>
                    <line x1="8" y1="2" x2="8" y2="6"/>
                    <line x1="3" y1="10" x2="21" y2="10"/>
                  </svg>
                  <span>Due: {{ projectData.project.deadline }}</span>
                </span>
              }
              <span class="price-tag">\${{ projectData.project.total_price }} USD (Escrow Protected)</span>
            </div>
          </div>

          <!-- Project Description -->
          <div class="section-box">
            <div class="section-title">Initial Scope & Order Description</div>
            <p class="description-text">{{ projectData.project.description }}</p>
          </div>

          <!-- AI Drafted Contract & Evidence -->
          <div class="grid-2">
            <div class="contract-card">
              <div class="card-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                  <polyline points="14 2 14 8 20 8"/>
                </svg>
                <span>Draft Agreement Terms</span>
              </div>
              <div class="card-content">{{ projectData.agreement.ai_generated_contract }}</div>
            </div>

            <div class="contract-card evidence-card">
              <div class="card-title evidence-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
                <span>Proof-of-Work Evidence Criteria</span>
              </div>
              <div class="card-content">{{ projectData.agreement.evidence_requirements }}</div>
            </div>
          </div>

          <!-- Join Form -->
          <div class="join-box">
            <h3>Join this Project as the Contractor/Seller</h3>
            <p class="join-desc">Join to accept these terms or request changes (schedule, milestones, or price) in the ProofLens Negotiation Room.</p>

            <div class="join-form">
              <div class="form-group">
                <label>Your Name / Business Name</label>
                <input type="text" [(ngModel)]="sellerName" placeholder="e.g. Master Woodcraft LLC" class="input" />
              </div>

              <div class="form-group">
                <label>Your Email Address</label>
                <input type="email" [(ngModel)]="sellerEmail" placeholder="contractor@example.com" class="input" />
              </div>

              <button (click)="joinProject()" [disabled]="isJoining" class="btn-join">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                <span>{{ isJoining ? 'Joining Project...' : 'Accept Invite & Enter Negotiation Room' }}</span>
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .invite-container {
      max-width: 900px;
      margin: 2rem auto;
      padding: 0 1rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .invite-card {
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
      padding: 2rem;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    .invite-header {
      border-bottom: 1px solid #f1f5f9;
      padding-bottom: 1.25rem;
    }
    .invite-badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      color: #0284c7;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      text-transform: uppercase;
      margin-bottom: 0.5rem;
    }
    h1 {
      margin: 0 0 0.75rem 0;
      font-size: 1.75rem;
      color: #0f172a;
    }
    .meta-row {
      display: flex;
      gap: 1.25rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .meta-item {
      font-size: 0.875rem;
      color: #64748b;
    }
    .price-tag {
      background: #dcfce7;
      color: #166534;
      font-weight: 700;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.9rem;
    }
    .section-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1.25rem;
    }
    .section-title {
      font-size: 0.8rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #475569;
      margin-bottom: 0.5rem;
    }
    .description-text {
      margin: 0;
      color: #1e293b;
      line-height: 1.6;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
    }
    @media (max-width: 768px) {
      .grid-2 {
        grid-template-columns: 1fr;
      }
    }
    .contract-card {
      background: #fdfdfd;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .evidence-card {
      background: #fffbeb;
      border-color: #fef3c7;
      border-left: 4px solid #f59e0b;
    }
    .card-title {
      font-size: 0.85rem;
      font-weight: 700;
      color: #0284c7;
    }
    .evidence-title {
      color: #d97706;
    }
    .card-content {
      font-size: 0.875rem;
      color: #334155;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .join-box {
      background: #f1f5f9;
      border-radius: 12px;
      padding: 1.5rem;
    }
    .join-box h3 {
      margin: 0 0 0.35rem 0;
      font-size: 1.15rem;
      color: #0f172a;
    }
    .join-desc {
      color: #64748b;
      font-size: 0.875rem;
      margin: 0 0 1.25rem 0;
    }
    .join-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    label {
      font-size: 0.8rem;
      font-weight: 600;
      color: #334155;
    }
    .input {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      font-size: 0.95rem;
      outline: none;
      background: #ffffff;
    }
    .btn-join {
      background: #10b981;
      color: white;
      border: none;
      padding: 0.85rem 1.5rem;
      border-radius: 10px;
      font-weight: 700;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.2s;
      margin-top: 0.5rem;
    }
    .btn-join:hover:not(:disabled) {
      background: #059669;
    }
    .btn-join:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }
    .loading-box, .error-box {
      text-align: center;
      padding: 3rem 1rem;
      background: white;
      border-radius: 16px;
      border: 1px solid #e2e8f0;
    }
    .btn-primary {
      background: #0284c7;
      color: white;
      border: none;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3px solid #e2e8f0;
      border-top-color: #0284c7;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 1rem auto;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `]
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
