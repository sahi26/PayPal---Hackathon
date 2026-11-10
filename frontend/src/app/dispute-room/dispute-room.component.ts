import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { API_BASE_URL } from '../api.config';
import { RevisionRoomComponent } from '../revision-room/revision-room.component';

export interface DisputeMessageItem {
  id?: number;
  sender_role: string;
  sender_name?: string;
  message: string;
  proposal_type: string;
  meta_payload?: any;
  created_at?: string;
}

export interface ActiveDisputeDetails {
  id: number;
  project_id: number;
  dispute_id: string | null;
  reason: string;
  disputed_by: string;
  milestone_index?: number;
  status: 'INTERNAL_NEGOTIATION' | 'ESCALATED_PROGRAMMATIC' | 'ESCALATED_HUMAN' | 'RESOLVED' | 'CANCELLED';
  resolution_type?: string;
  resolution_notes?: string;
  dispute_classification?: string;
  validity_flag?: string;
  ai_confidence_score?: number;
  ai_analysis?: string;
  has_dossier?: boolean;
  pushed_to_paypal?: boolean;
  paypal_claim_id?: string;
  escalated_to_human_at?: string;
  created_at?: string;
}

@Component({
  selector: 'app-dispute-room',
  standalone: true,
  imports: [CommonModule, FormsModule, RevisionRoomComponent],
  templateUrl: './dispute-room.component.html',
  styleUrl: './dispute-room.component.scss'
})
export class DisputeRoomComponent implements OnInit, OnDestroy {
  @Input() projectId!: number;
  @Input() currentRole: string = 'buyer';
  @Input() projectTitle: string = '';
  @Input() totalEscrowAmount: number = 0;

  @Output() closed = new EventEmitter<void>();
  @Output() disputeResolved = new EventEmitter<any>();
  @Output() disputeEscalated = new EventEmitter<any>();

  Number = Number;
  isLoading = true;
  isPolling = false;
  pollTimer: any = null;

  activeDispute: ActiveDisputeDetails | null = null;
  projectInfo: any = null;
  chatHistory: DisputeMessageItem[] = [];
  currentTier: number = 1;

  // New message input
  newMessageText: string = '';
  isSendingMessage: boolean = false;

  // Action states
  isEscalatingProgrammatic: boolean = false;
  isEscalatingHuman: boolean = false;
  isResolvingMutually: boolean = false;

  // Modal controls
  showScopeChangeModal: boolean = false;
  showDossierModal: boolean = false;
  dossierData: any = null;
  isLoadingDossier: boolean = false;

  // Initial dispute creation form if no dispute is open yet
  showOpenDisputeForm: boolean = false;
  openDisputeReason: string = '';
  isOpeningDispute: boolean = false;

  // Post-resolution escalation form
  showFollowUpDisputeForm: boolean = false;
  followUpDisputeReason: string = '';

  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private router: Router
  ) {}

  ngOnInit(): void {
    if (!this.projectId) {
      const routeId = this.route.snapshot.paramMap.get('id');
      if (routeId) {
        this.projectId = Number(routeId);
      }
    }

    if (this.projectId) {
      this.loadActiveDispute();
      // Start background polling every 3.5 seconds
      this.pollTimer = setInterval(() => {
        this.pollChatUpdates();
      }, 3500);
    }
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  loadActiveDispute(): void {
    this.isLoading = true;
    this.http.get<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/active`).subscribe({
      next: (res) => {
        this.isLoading = false;
        if (res && res.active && res.dispute) {
          this.activeDispute = res.dispute;
          this.currentTier = res.tier || 1;
          this.projectInfo = res.project;
          this.chatHistory = res.chat_history || [];
          if (!this.projectTitle && res.project?.title) {
            this.projectTitle = res.project.title;
          }
          if (!this.totalEscrowAmount && res.project?.total_price) {
            this.totalEscrowAmount = res.project.total_price;
          }
          this.showOpenDisputeForm = false;
        } else if (res && res.dispute && res.dispute.status === 'RESOLVED') {
          this.activeDispute = res.dispute;
          this.currentTier = 4;
          this.projectInfo = res.project;
          this.chatHistory = res.chat_history || [];
          if (!this.projectTitle && res.project?.title) {
            this.projectTitle = res.project.title;
          }
          if (!this.totalEscrowAmount && res.project?.total_price) {
            this.totalEscrowAmount = res.project.total_price;
          }
          this.showOpenDisputeForm = false;
        } else {
          this.activeDispute = null;
          this.showOpenDisputeForm = true;
        }
      },
      error: (err) => {
        this.isLoading = false;
        console.error('Failed to load active dispute:', err);
      }
    });
  }

  pollChatUpdates(): void {
    if (!this.projectId || this.isSendingMessage || this.isOpeningDispute) return;
    this.http.get<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/active`).subscribe({
      next: (res) => {
        if (res && res.dispute) {
          this.activeDispute = res.dispute;
          this.currentTier = res.tier || 1;
          this.projectInfo = res.project;
          if (!this.projectTitle && res.project?.title) {
            this.projectTitle = res.project.title;
          }
          if (!this.totalEscrowAmount && res.project?.total_price) {
            this.totalEscrowAmount = res.project.total_price;
          }
          if (res.chat_history) {
            const incomingLastId = res.chat_history[res.chat_history.length - 1]?.id;
            const currentLastId = this.chatHistory[this.chatHistory.length - 1]?.id;
            if (res.chat_history.length !== this.chatHistory.length || incomingLastId !== currentLastId) {
              this.chatHistory = res.chat_history;
            }
          }
        }
      },
      error: () => {}
    });
  }

  isResolvedByPayPal(): boolean {
    const resType = (this.activeDispute?.resolution_type || '').toUpperCase();
    if (!resType) return false;
    return resType !== 'MUTUAL_SETTLEMENT' && resType !== 'SCOPE_CHANGE';
  }

  toggleFollowUpDisputeForm(): void {
    this.showFollowUpDisputeForm = true;
    if (!this.followUpDisputeReason.trim() && this.activeDispute?.reason) {
      this.followUpDisputeReason = `Follow-up escalation on prior resolved dispute: ${this.activeDispute.reason}`;
    }
  }

  cancelFollowUpDisputeForm(): void {
    this.showFollowUpDisputeForm = false;
  }

  submitFollowUpDispute(): void {
    const reason = this.followUpDisputeReason.trim();
    if (!reason || this.isOpeningDispute) {
      alert('Please enter a specific reason to escalate this dispute.');
      return;
    }

    this.isOpeningDispute = true;
    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/open`, {
      reason,
      disputed_by: this.currentRole
    }).subscribe({
      next: (res) => {
        this.isOpeningDispute = false;
        this.showFollowUpDisputeForm = false;
        this.followUpDisputeReason = '';
        this.loadActiveDispute();
        this.disputeEscalated.emit(res);
      },
      error: (err) => {
        this.isOpeningDispute = false;
        alert(err.error?.detail || err.message || 'Failed to escalate dispute.');
      }
    });
  }

  openDisputeFromForm(): void {
    if (!this.openDisputeReason.trim()) {
      alert('Please enter a specific reason or deliverable defect for this dispute.');
      return;
    }
    this.isOpeningDispute = true;
    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/open`, {
      reason: this.openDisputeReason.trim(),
      disputed_by: this.currentRole
    }).subscribe({
      next: (res) => {
        this.isOpeningDispute = false;
        this.showOpenDisputeForm = false;
        this.loadActiveDispute();
        this.disputeEscalated.emit(res);
      },
      error: (err) => {
        this.isOpeningDispute = false;
        alert(err.error?.detail || err.message || 'Failed to open dispute workspace.');
      }
    });
  }

  sendMessage(proposalType: string = 'message', textOverride?: string): void {
    const textToSend = textOverride || this.newMessageText.trim();
    if (!textToSend || this.isSendingMessage) return;

    this.isSendingMessage = true;
    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/messages`, {
      sender_role: this.currentRole,
      sender_name: this.currentRole === 'buyer' ? 'ProofLens Buyer' : 'ProofLens Contractor',
      message: textToSend,
      proposal_type: proposalType
    }).subscribe({
      next: (res) => {
        this.isSendingMessage = false;
        if (!textOverride) {
          this.newMessageText = '';
        }
        if (res?.chat_item) {
          this.chatHistory.push(res.chat_item);
        } else {
          this.pollChatUpdates();
        }
      },
      error: (err) => {
        this.isSendingMessage = false;
        alert(err.error?.detail || err.message || 'Failed to send message.');
      }
    });
  }

  getTier1DaysRemaining(): number {
    if (!this.activeDispute?.created_at) return 20;
    try {
      const createdDate = new Date(this.activeDispute.created_at).getTime();
      const now = new Date().getTime();
      const elapsedDays = (now - createdDate) / (1000 * 60 * 60 * 24);
      return Math.max(0, Math.ceil(20 - elapsedDays));
    } catch {
      return 20;
    }
  }

  // Quick remedy suggestions
  sendQuickRemedy(type: 'caliper' | 'extension' | 'adjustment'): void {
    if (type === 'caliper') {
      this.sendMessage(
        'request_proof',
        'Remedy Proposal: Please provide an authentic, high-resolution direct capture showing verified measurements or caliper gauge alignment without screen reflections.'
      );
    } else if (type === 'extension') {
      this.sendMessage(
        'propose_remedy',
        'Remedy Proposal: I propose granting a 3-calendar-day schedule extension to allow contractor to execute required corrections.'
      );
    } else if (type === 'adjustment') {
      this.sendMessage(
        'propose_remedy',
        'Remedy Proposal: I propose a $25.00 USD adjustment to the final deliverable amount to compensate for scope differences.'
      );
    }
  }

  // Phase 3: Programmatic Dossier Escalation
  escalateToProgrammatic(): void {
    const confirmMsg = this.currentTier === 4
      ? 'Escalate this previously resolved dispute to Tier 2: Programmatic PayPal Evidence Submission?\n\nProofLens will reopen the dispute, pause milestone payouts, compile all SHA-256 evidence hashes and AI forensic audits, and submit them to the PayPal Disputes API.'
      : 'Escalate dispute to Tier 2: Programmatic PayPal Evidence Submission?\n\nProofLens will compile the legal agreement, all cryptographic SHA-256 evidence hashes, and AI forensic audits, and submit them directly to the PayPal Disputes API.';
    if (!confirm(confirmMsg)) {
      return;
    }

    this.isEscalatingProgrammatic = true;
    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/escalate`, {
      notes: this.activeDispute?.reason || 'Programmatic evidence dossier escalation'
    }).subscribe({
      next: (res) => {
        this.isEscalatingProgrammatic = false;
        this.showFollowUpDisputeForm = false;
        alert('Case successfully escalated to Tier 2!\n\nProofLens Authoritative Dossier submitted to PayPal Disputes API.');
        this.loadActiveDispute();
        this.disputeEscalated.emit(res);
      },
      error: (err) => {
        this.isEscalatingProgrammatic = false;
        alert(err.error?.detail || err.message || 'Failed to escalate dispute programmatically.');
      }
    });
  }

  // Phase 4: Human Review Escalation (Claim)
  escalateToHuman(): void {
    const confirmMsg = this.currentTier === 4
      ? 'Escalate this previously resolved dispute to Tier 3: Official PayPal Claim (Manual Human Review)?\n\nThis will reopen the case, pause milestone payouts, and trigger PayPal\'s 20-day formal adjudication cycle with a human PayPal disputes specialist.'
      : 'Escalate dispute to Tier 3: Official PayPal Claim (Manual Human Review)?\n\nThis will trigger PayPal\'s 20-day formal adjudication cycle with a human PayPal disputes specialist.';
    if (!confirm(confirmMsg)) {
      return;
    }

    this.isEscalatingHuman = true;
    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/escalate-to-human`, {
      note: 'ProofLens dispute escalated to Claim for 20-day manual human adjudicator arbitration.'
    }).subscribe({
      next: (res) => {
        this.isEscalatingHuman = false;
        this.showFollowUpDisputeForm = false;
        alert(`Case escalated to PayPal Claim!\n\nPayPal Claim ID: ${res.claim_id}\nPayPal 20-day manual investigation window is now active.`);
        this.loadActiveDispute();
        this.disputeEscalated.emit(res);
      },
      error: (err) => {
        this.isEscalatingHuman = false;
        alert(err.error?.detail || err.message || 'Failed to escalate dispute to PayPal claim.');
      }
    });
  }

  // Resolution Actions
  openScopeChange(): void {
    this.showScopeChangeModal = true;
  }

  closeScopeChange(): void {
    this.showScopeChangeModal = false;
  }

  onScopeChangeAccepted(event: any): void {
    if (event?.status === 'PENDING_FUNDS') {
      return;
    }

    this.showScopeChangeModal = false;
    this.isResolvingMutually = true;
    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/resolve`, {
      resolution_type: 'SCOPE_CHANGE',
      notes: event?.message || event?.scope_change?.description || 'Dispute resolved by accepted and funded scope change.'
    }).subscribe({
      next: (res) => {
        this.isResolvingMutually = false;
        alert('Scope Change accepted and funded! Contract addendum appended and dispute officially RESOLVED.');
        this.loadActiveDispute();
        this.disputeResolved.emit({ ...event, ...res });
      },
      error: (err) => {
        this.isResolvingMutually = false;
        alert(err.error?.detail || err.message || 'Scope change was accepted, but dispute resolution failed.');
        this.loadActiveDispute();
      }
    });
  }

  resolveMutually(): void {
    if (!confirm('Confirm mutual resolution?\n\nThis will mark the dispute as RESOLVED and restore standard project milestone fulfillment.')) {
      return;
    }

    this.isResolvingMutually = true;
    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/resolve`, {
      resolution_type: 'MUTUAL_SETTLEMENT',
      notes: 'Parties reached mutual consensus during internal dispute mediation.'
    }).subscribe({
      next: (res) => {
        this.isResolvingMutually = false;
        alert('Dispute resolved successfully! Project milestone fulfillment unlocked.');
        this.loadActiveDispute();
        this.disputeResolved.emit(res);
      },
      error: (err) => {
        this.isResolvingMutually = false;
        alert(err.error?.detail || err.message || 'Failed to resolve dispute.');
      }
    });
  }

  // Dossier Modal
  openDossier(): void {
    this.isLoadingDossier = true;
    this.showDossierModal = true;
    this.http.get<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/dossier`).subscribe({
      next: (data) => {
        this.isLoadingDossier = false;
        this.dossierData = data;
      },
      error: (err) => {
        this.isLoadingDossier = false;
        alert(err.error?.detail || err.message || 'No dossier on file yet. Escalate to Tier 2 to compile one.');
        this.showDossierModal = false;
      }
    });
  }

  closeDossier(): void {
    this.showDossierModal = false;
  }

  toggleRole(): void {
    this.currentRole = this.currentRole === 'buyer' ? 'seller' : 'buyer';
  }

  returnToFulfillment(): void {
    if (this.closed.observed) {
      this.closed.emit();
    } else {
      this.router.navigate(['/project', this.projectId, 'fulfillment']);
    }
  }
}
