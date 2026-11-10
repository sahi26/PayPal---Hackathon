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

  // PayPal dispute sync controls
  syncPayPalCaseId: string = '';
  isSyncingPayPal: boolean = false;
  syncFeedback: string = '';
  syncError: string = '';

  // Modal controls
  showScopeChangeModal: boolean = false;
  showDossierModal: boolean = false;
  dossierData: any = null;
  isLoadingDossier: boolean = false;
  isGeneratingDossier: boolean = false;

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
    if (
      !this.projectId ||
      this.isSendingMessage ||
      this.isOpeningDispute ||
      this.isSyncingPayPal ||
      this.isEscalatingProgrammatic ||
      this.isEscalatingHuman
    ) {
      return;
    }
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

  get hasCapturedPayment(): boolean {
    return Boolean(this.projectInfo?.has_captured_payment);
  }

  syncWithPayPal(manualCaseId?: string): void {
    if (!this.projectId || this.isSyncingPayPal) return;
    const caseIdToLink = (manualCaseId !== undefined ? manualCaseId : this.syncPayPalCaseId).trim();
    this.isSyncingPayPal = true;
    this.syncFeedback = '';
    this.syncError = '';

    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/sync-paypal`, {
      paypal_dispute_id: caseIdToLink || null
    }).subscribe({
      next: (res) => {
        this.isSyncingPayPal = false;
        if (res?.synced) {
          this.syncFeedback = res.message || `Linked PayPal Case #${res.paypal_dispute_id}.`;
          this.syncPayPalCaseId = '';
          this.loadActiveDispute();
          this.disputeEscalated.emit(res);
        } else {
          this.syncFeedback = res?.message || 'No matching PayPal dispute found yet.';
        }
      },
      error: (err) => {
        this.isSyncingPayPal = false;
        this.syncError = err.error?.detail || err.message || 'Failed to sync PayPal dispute case.';
      }
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
      ? 'Escalate this previously resolved dispute to Tier 2: Programmatic Dossier Escalation?\n\nProofLens will reopen the dispute, pause milestone payouts, compile the SHA-256 Forensic Evidence Dossier Report and AI audit, and push it to PayPal Disputes API if a PayPal Case ID is linked.'
      : 'Escalate dispute to Tier 2: Programmatic Dossier Escalation?\n\nProofLens will compile the legal agreement, all cryptographic SHA-256 evidence hashes, and AI forensic audits into an Authoritative Evidence Dossier Report (and push to PayPal if a PayPal dispute is linked).';
    if (!confirm(confirmMsg)) {
      return;
    }

    this.isEscalatingProgrammatic = true;
    this.syncError = '';
    const manualCaseId = this.syncPayPalCaseId.trim() || null;

    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/escalate`, {
      notes: this.activeDispute?.reason || 'Programmatic evidence dossier escalation',
      paypal_dispute_id: manualCaseId
    }).subscribe({
      next: (res) => {
        this.isEscalatingProgrammatic = false;
        this.showFollowUpDisputeForm = false;
        if (manualCaseId) {
          this.syncPayPalCaseId = '';
        }
        if (res?.pushed_to_paypal) {
          alert(`Case successfully escalated to Tier 2!\n\nDossier ${res.evidence_dossier?.dossier_id || ''} submitted to PayPal Case ${res.paypal_dispute_id}.`);
        } else {
          alert(
            `Case escalated to Tier 2!\n\n` +
            `Forensic Dossier Report (${res?.evidence_dossier?.dossier_id || 'ready'}) is compiled — click "Inspect Dossier" to view, download, or print.\n\n` +
            `${res?.sync_note || 'No PayPal Case ID linked yet; you can still link one later via Sync PayPal Case.'}`
          );
        }
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
      ? 'Escalate this previously resolved dispute to Tier 3: Human Adjudication Review?\n\nThis will reopen the case, pause milestone payouts, compile the Forensic Dossier Report, and initiate the 20-day human review window (escalating at PayPal too if a PayPal dispute is linked).'
      : 'Escalate dispute to Tier 3: Human Adjudication Review?\n\nThis will initiate the 20-day formal adjudication review and escalate to a PayPal Claim if a PayPal dispute is linked.';
    if (!confirm(confirmMsg)) {
      return;
    }

    this.isEscalatingHuman = true;
    this.syncError = '';
    const manualCaseId = this.syncPayPalCaseId.trim() || null;

    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/escalate-to-human`, {
      note: 'ProofLens dispute escalated to Claim for 20-day manual human adjudicator arbitration.',
      paypal_dispute_id: manualCaseId
    }).subscribe({
      next: (res) => {
        this.isEscalatingHuman = false;
        this.showFollowUpDisputeForm = false;
        if (manualCaseId) {
          this.syncPayPalCaseId = '';
        }
        if (res?.escalated_at_paypal && res?.claim_id) {
          alert(`Case escalated to PayPal Claim!\n\nPayPal Claim ID: ${res.claim_id}\nPayPal 20-day manual investigation window is now active.`);
        } else {
          alert(
            `Case escalated to Tier 3: 20-Day Human Adjudication Hold!\n\n` +
            `${res?.sync_note || 'Milestone payouts remain paused under ProofLens 20-day adjudication hold pending PayPal Case sync.'}`
          );
        }
        this.loadActiveDispute();
        this.disputeEscalated.emit(res);
      },
      error: (err) => {
        this.isEscalatingHuman = false;
        alert(err.error?.detail || err.message || 'Failed to escalate dispute to Tier 3.');
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
    if (!this.activeDispute?.has_dossier) {
      this.compileDossierReport();
      return;
    }

    this.http.get<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/dossier`).subscribe({
      next: (data) => {
        this.isLoadingDossier = false;
        this.dossierData = data;
      },
      error: (err) => {
        if (err.status === 404) {
          this.compileDossierReport();
          return;
        }
        this.isLoadingDossier = false;
        alert(err.error?.detail || err.message || 'Failed to load forensic dossier report.');
        this.showDossierModal = false;
      }
    });
  }

  regenerateDossier(): void {
    if (!this.projectId || this.isGeneratingDossier) return;
    this.compileDossierReport();
  }

  private compileDossierReport(): void {
    this.isGeneratingDossier = true;
    this.isLoadingDossier = true;
    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/dossier/generate`, {}).subscribe({
      next: (res) => {
        this.isGeneratingDossier = false;
        this.isLoadingDossier = false;
        const compiled = res?.dossier || res;
        this.dossierData = compiled;
        if (this.activeDispute && compiled) {
          this.activeDispute = {
            ...this.activeDispute,
            has_dossier: true,
            dispute_classification: compiled.ai_dispute_classification || this.activeDispute.dispute_classification,
            validity_flag: compiled.ai_validity_flag || this.activeDispute.validity_flag,
            ai_confidence_score: compiled.ai_confidence_score ?? this.activeDispute.ai_confidence_score,
            ai_analysis: compiled.adjudication_analysis || this.activeDispute.ai_analysis
          };
        }
      },
      error: (err) => {
        this.isGeneratingDossier = false;
        this.isLoadingDossier = false;
        alert(err.error?.detail || err.message || 'Failed to compile ProofLens Evidence Dossier.');
        if (!this.dossierData) {
          this.showDossierModal = false;
        }
      }
    });
  }

  downloadDossierJson(): void {
    if (!this.dossierData) return;
    const jsonText = JSON.stringify(this.dossierData, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ProofLens-Dossier-${this.dossierData.dossier_id || this.projectId}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  private escapeHtml(val: any): string {
    return String(val ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  printDossierReport(): void {
    if (!this.dossierData) return;
    const d = this.dossierData;
    const win = window.open('', '_blank', 'width=960,height=780');
    if (!win) {
      alert('Pop-up blocked. Please allow pop-ups or use Download JSON.');
      return;
    }

    const beforeRows = (d.authoritative_evidence_chronology?.before_evidence || [])
      .map((b: any, i: number) => `
        <tr>
          <td>Baseline #${i + 1}</td>
          <td><code>${this.escapeHtml(b.sha256_hash || '')}</code></td>
          <td>${this.escapeHtml(b.server_receipt_timestamp || '')}</td>
          <td>${this.escapeHtml(b.capture_method || 'verified_capture')}</td>
        </tr>
      `)
      .join('');

    const msRows = (d.authoritative_evidence_chronology?.milestone_submissions || [])
      .map((m: any) => `
        <tr>
          <td>Milestone ${(Number(m.milestone_index) || 0) + 1}</td>
          <td><code>${this.escapeHtml(m.sha256_hash || '')}</code></td>
          <td>${this.escapeHtml(m.server_receipt_timestamp || '')}</td>
          <td>${this.escapeHtml(m.ai_match_score ?? '-')}%</td>
          <td>${this.escapeHtml(m.status || '')}</td>
        </tr>
      `)
      .join('');

    win.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>ProofLens Evidence Dossier - ${this.escapeHtml(d.dossier_id)}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; margin: 2rem; line-height: 1.5; }
            h1 { margin: 0 0 0.25rem; color: #001435; font-size: 1.35rem; }
            h2 { margin: 1.5rem 0 0.5rem; font-size: 1rem; color: #003087; border-bottom: 1px solid #cbd5e1; padding-bottom: 0.25rem; }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.5rem 1.5rem; background: #f8fafc; border: 1px solid #cbd5e1; padding: 1rem; border-radius: 8px; margin-top: 1rem; font-size: 0.85rem; }
            .box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 0.85rem; border-radius: 6px; white-space: pre-wrap; font-size: 0.85rem; }
            table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.8rem; }
            th, td { border: 1px solid #cbd5e1; padding: 0.45rem 0.6rem; text-align: left; word-break: break-all; }
            th { background: #f1f5f9; }
            code { font-family: monospace; font-size: 0.75rem; }
          </style>
        </head>
        <body>
          <h1>ProofLens Authoritative Forensic Evidence Dossier</h1>
          <div>Project: <strong>${this.escapeHtml(d.project_title)}</strong> (#${this.escapeHtml(d.project_id)}) • Escrow: $${this.escapeHtml(d.total_escrow_amount)} ${this.escapeHtml(d.currency || 'USD')}</div>
          <div class="meta">
            <div><strong>Dossier ID:</strong> ${this.escapeHtml(d.dossier_id)}</div>
            <div><strong>Compiled At:</strong> ${this.escapeHtml(d.compiled_at)}</div>
            <div><strong>AI Classification:</strong> ${this.escapeHtml(d.ai_dispute_classification)}</div>
            <div><strong>AI Validity Flag:</strong> ${this.escapeHtml(d.ai_validity_flag)} (${this.escapeHtml(d.ai_confidence_score)}%)</div>
            <div><strong>Claimant:</strong> ${this.escapeHtml(d.claimant)}</div>
            <div><strong>PayPal Sync:</strong> ${this.escapeHtml(d.paypal_dispute_id || d.paypal_sync_status || 'Internal Dossier Ready')}</div>
          </div>
          <h2>Dispute Claim</h2>
          <div class="box">${this.escapeHtml(d.dispute_claim)}</div>
          <h2>Executive Summary</h2>
          <div class="box">${this.escapeHtml(d.executive_summary || '')}</div>
          <h2>Adjudication Analysis & Findings</h2>
          <div class="box">${this.escapeHtml(d.adjudication_analysis || '')}</div>
          <h2>Recommended Adjudication</h2>
          <div class="box">${this.escapeHtml(d.recommended_adjudication || '')}</div>
          <h2>Contractual Baseline (Agreement v${this.escapeHtml(d.contractual_baseline?.agreement_version || 1)})</h2>
          <div class="box">${this.escapeHtml(d.contractual_baseline?.legal_terms || '')}</div>
          ${beforeRows ? `<h2>Baseline Before-Evidence (SHA-256)</h2><table><thead><tr><th>Item</th><th>SHA-256 Hash</th><th>Server Receipt</th><th>Method</th></tr></thead><tbody>${beforeRows}</tbody></table>` : ''}
          <h2>Milestone Proof Submissions (SHA-256)</h2>
          <table><thead><tr><th>Milestone</th><th>SHA-256 Hash</th><th>Server Receipt</th><th>AI Match</th><th>Status</th></tr></thead><tbody>${msRows || '<tr><td colspan="5">No milestone proof submissions recorded yet.</td></tr>'}</tbody></table>
          <script>window.onload = function() { window.print(); };</script>
        </body>
      </html>
    `);
    win.document.close();
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
