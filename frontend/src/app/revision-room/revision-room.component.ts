import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../api.config';

export interface ScopeMilestone {
  title: string;
  description: string;
  price_allocation: number;
  relative_deadline?: string;
  deadline?: string;
  proof_required: string;
  is_addendum?: boolean;
  status?: string;
}

export interface ScopeChangeItem {
  id: number;
  project_id: number;
  requested_by_id?: number;
  description: string;
  proposed_extra_cost: number;
  proposed_extra_days: number;
  status: 'DRAFT' | 'NEGOTIATING' | 'PENDING_FUNDS' | 'ACCEPTED' | 'REJECTED';
  rejection_reason?: string;
  addendum_contract?: string;
  proposed_milestones?: ScopeMilestone[];
  chat_history?: Array<{
    sender: string;
    sender_name?: string;
    message: string;
    proposed_extra_cost?: number;
    proposed_extra_days?: number;
    timestamp?: string;
  }>;
  paypal_order_id?: string;
  paypal_approval_url?: string;
  created_at?: string;
  updated_at?: string;
}

@Component({
  selector: 'app-revision-room',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './revision-room.component.html',
  styleUrl: './revision-room.component.scss'
})
export class RevisionRoomComponent implements OnInit {
  @Input() projectId!: number;
  @Input() currentRole: string = 'buyer';
  @Input() projectTitle: string = '';
  @Input() initialScopeChange: ScopeChangeItem | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() scopeAccepted = new EventEmitter<any>();
  @Output() scopeRejected = new EventEmitter<any>();

  Number = Number;
  isLoading = false;
  isSubmitting = false;
  isSubmittingCounter = false;
  isAccepting = false;
  isAuthorizing = false;
  isSubmittingRejection = false;
  isRejectModalOpen = false;
  rejectionReasonText = '';

  activeScopeChange: ScopeChangeItem | null = null;
  newDescription: string = '';
  initExtraDays: number = 0;
  initExtraCost: number = 0;
  showAddendumText: boolean = false;

  counterCost: number = 0;
  counterDays: number = 0;
  counterMessage: string = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (this.initialScopeChange) {
      this.activeScopeChange = this.initialScopeChange;
      this.initCounterValues();
    } else if (this.projectId) {
      this.loadScopeChanges();
    }
  }

  loadScopeChanges(): void {
    this.isLoading = true;
    this.http.get<{ active_scope_change: ScopeChangeItem; scope_changes: ScopeChangeItem[] }>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-changes`
    ).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.activeScopeChange = res.active_scope_change || null;
        this.initCounterValues();
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  initCounterValues(): void {
    if (this.activeScopeChange) {
      this.counterCost = Number(this.activeScopeChange.proposed_extra_cost || 0);
      this.counterDays = Number(this.activeScopeChange.proposed_extra_days || 0);
    }
  }

  private getCurrentUserEmail(): string {
    try {
      return JSON.parse(localStorage.getItem('prooflens_user') || '{}').email || '';
    } catch (error) {
      console.warn('Could not read the signed-in user for the scope revision:', error);
      return '';
    }
  }

  submitInit(): void {
    if (!this.newDescription.trim() || !this.projectId) return;

    this.isSubmitting = true;
    const payload = {
      description: this.newDescription.trim(),
      proposed_extra_days: Number(this.initExtraDays) || 0,
      proposed_extra_cost: Number(this.initExtraCost) || 0,
      user_email: this.getCurrentUserEmail()
    };

    this.http.post<{ message: string; scope_change: ScopeChangeItem }>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-change/init`,
      payload
    ).subscribe({
      next: (res) => {
        this.isSubmitting = false;
        this.activeScopeChange = res.scope_change;
        this.initCounterValues();
      },
      error: (err) => {
        this.isSubmitting = false;
        alert('Failed to initialize scope change: ' + (err.error?.detail || err.message));
      }
    });
  }

  submitCounterOffer(): void {
    if (!this.activeScopeChange) return;

    this.isSubmittingCounter = true;
    const payload = {
      scope_change_id: this.activeScopeChange.id,
      sender_role: this.currentRole === 'seller' ? 'seller' : 'buyer',
      sender_email: this.getCurrentUserEmail(),
      message: this.counterMessage.trim() || undefined,
      proposed_extra_cost: Number(this.counterCost),
      proposed_extra_days: Number(this.counterDays)
    };

    this.http.post<{ message: string; scope_change: ScopeChangeItem }>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-change/negotiate`,
      payload
    ).subscribe({
      next: (res) => {
        this.isSubmittingCounter = false;
        this.activeScopeChange = res.scope_change;
        this.counterMessage = '';
      },
      error: (err) => {
        this.isSubmittingCounter = false;
        alert('Counter-offer failed: ' + (err.error?.detail || err.message));
      }
    });
  }

  acceptScopeChange(): void {
    if (!this.activeScopeChange) return;

    this.isAccepting = true;
    const payload = {
      scope_change_id: this.activeScopeChange.id,
      user_email: this.getCurrentUserEmail()
    };

    this.http.post<any>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-change/accept`,
      payload
    ).subscribe({
      next: (res) => {
        this.isAccepting = false;
        if (res.scope_change) {
          this.activeScopeChange = res.scope_change;
        }
        if (res.status === 'ACCEPTED' || res.status === 'PENDING_FUNDS') {
          this.scopeAccepted.emit(res);
        }
      },
      error: (err) => {
        this.isAccepting = false;
        alert('Failed to accept scope change: ' + (err.error?.detail || err.message));
      }
    });
  }

  authorizeFunds(): void {
    if (!this.activeScopeChange) return;

    this.isAuthorizing = true;
    const payload = {
      scope_change_id: this.activeScopeChange.id,
      paypal_order_id: this.activeScopeChange.paypal_order_id,
      user_email: this.getCurrentUserEmail()
    };

    this.http.post<{ status: string; scope_change: ScopeChangeItem }>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-change/authorize-funds`,
      payload
    ).subscribe({
      next: (res) => {
        this.isAuthorizing = false;
        this.activeScopeChange = res.scope_change;
        this.scopeAccepted.emit(res);
      },
      error: (err) => {
        this.isAuthorizing = false;
        alert('Failed to confirm PayPal authorization: ' + (err.error?.detail || err.message));
      }
    });
  }

  openRejectModal(): void {
    this.rejectionReasonText = '';
    this.isRejectModalOpen = true;
  }

  closeRejectModal(): void {
    this.isRejectModalOpen = false;
    this.rejectionReasonText = '';
  }

  addQuickReason(reason: string): void {
    if (!this.rejectionReasonText) {
      this.rejectionReasonText = reason;
    } else if (!this.rejectionReasonText.includes(reason)) {
      this.rejectionReasonText = this.rejectionReasonText.trim() + ' ' + reason;
    }
  }

  submitScopeRejection(): void {
    const trimmed = this.rejectionReasonText.trim();
    if (!trimmed || !this.activeScopeChange || !this.projectId) return;

    this.isSubmittingRejection = true;
    const payload = {
      scope_change_id: this.activeScopeChange.id,
      reason: trimmed,
      user_email: this.getCurrentUserEmail()
    };

    this.http.post<any>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-change/reject`,
      payload
    ).subscribe({
      next: (res) => {
        this.isSubmittingRejection = false;
        this.isRejectModalOpen = false;
        if (res.scope_change) {
          this.activeScopeChange = res.scope_change;
        } else if (this.activeScopeChange) {
          this.activeScopeChange.status = 'REJECTED';
          this.activeScopeChange.rejection_reason = trimmed;
        }
        this.scopeRejected.emit(res);
        alert('Scope revision terms rejected. Your detailed feedback was sent to the buyer.');
      },
      error: (err) => {
        this.isSubmittingRejection = false;
        alert('Failed to reject scope revision: ' + (err.error?.detail || err.message));
      }
    });
  }

  resetForNewRequest(): void {
    this.activeScopeChange = null;
    this.newDescription = '';
    this.initExtraCost = 0;
    this.initExtraDays = 0;
  }

  toggleAddendumView(): void {
    this.showAddendumText = !this.showAddendumText;
  }

  formatStatus(status: string): string {
    switch (status) {
      case 'NEGOTIATING': return 'Under Negotiation';
      case 'PENDING_FUNDS': return 'Seller Accepted · Buyer Escrow Required';
      case 'ACCEPTED': return 'Accepted & Active';
      case 'REJECTED': return 'Rejected';
      default: return status || 'Active';
    }
  }

  formatTime(isoStr: string): string {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    this.close();
  }
}
