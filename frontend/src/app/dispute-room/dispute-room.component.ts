import { Component, Input, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { Observable, firstValueFrom, of } from 'rxjs';
import { API_BASE_URL } from '../api.config';
import { EvidenceFileService } from '../evidence-file.service';
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
  private readonly emptyUrl$ = of('');
  private readonly resolvedPrintImages = new Map<string, string>();
  private readonly failedImageKeys = new Set<string>();

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
    private router: Router,
    private evidenceFileService: EvidenceFileService
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
        if (this.activeDispute && data) {
          this.activeDispute = {
            ...this.activeDispute,
            has_dossier: true,
            dispute_classification: data.ai_dispute_classification || this.activeDispute.dispute_classification,
            validity_flag: data.ai_validity_flag || this.activeDispute.validity_flag,
            ai_confidence_score: data.ai_confidence_score ?? this.activeDispute.ai_confidence_score,
            ai_analysis: data.adjudication_analysis || this.activeDispute.ai_analysis
          };
        }
        void this.prefetchDossierImages(data);
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
        void this.prefetchDossierImages(compiled);
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

  getEvidencePathKey(ev: any): string {
    if (!ev) return '';
    return String(ev.file_path || ev.download_path || '').trim();
  }

  isPreviewableImage(ev: any): boolean {
    if (!ev) return false;
    const key = this.getEvidencePathKey(ev);
    if (!key || this.failedImageKeys.has(key)) return false;
    const mime = String(ev.mime_type || '').toLowerCase();
    if (mime.startsWith('image/')) return true;
    if (mime && (mime.startsWith('video/') || mime.includes('pdf') || mime.startsWith('text/') || mime.includes('zip'))) {
      return false;
    }
    const candidate = String(ev.original_filename || key).split('?')[0].toLowerCase();
    return /\.(jpe?g|png|webp|gif|bmp)$/.test(candidate);
  }

  getEvidenceUrl(ev: any): Observable<string> {
    const key = this.getEvidencePathKey(ev);
    if (!key) return this.emptyUrl$;
    return this.evidenceFileService.getFileUrl(key);
  }

  getSafeExternalUrl(url: any): string | null {
    const raw = String(url || '').trim();
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }
    return null;
  }

  openResolvedUrl(url: string | null | undefined): void {
    const target = String(url || '').trim();
    if (target) {
      window.open(target, '_blank', 'noopener,noreferrer');
    }
  }

  onEvidenceImageError(ev: any): void {
    const key = this.getEvidencePathKey(ev);
    if (key) {
      this.failedImageKeys.add(key);
    }
  }

  formatClassification(classification: any): string {
    const val = String(classification || '').trim();
    if (!val) return 'Under Review';
    return val
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  formatScopeStatus(status: any): string {
    const val = String(status || 'NEGOTIATING').trim().toUpperCase();
    if (val === 'NEGOTIATING') return 'Under Negotiation';
    if (val === 'PENDING_FUNDS') return 'Pending Escrow Funding';
    if (val === 'ACCEPTED') return 'Accepted Addendum';
    if (val === 'REJECTED') return 'Declined';
    return val;
  }

  getApprovedMilestoneNumbersText(): string {
    const indices: number[] = this.dossierData?.authoritative_evidence_chronology?.considered_approved_milestone_indices || [];
    if (!Array.isArray(indices) || indices.length === 0) {
      const milestones: any[] = this.dossierData?.contractual_baseline?.milestones || [];
      const derived = milestones
        .filter(ms => String(ms?.status || '').toLowerCase() === 'approved')
        .map(ms => Number(ms.milestone_number || (Number(ms.index || 0) + 1)));
      return derived.length ? derived.map(n => `Milestone ${n}`).join(', ') : 'None yet';
    }
    return indices.map(idx => `Milestone ${Number(idx) + 1}`).join(', ');
  }

  getNonRejectionFlags(flags: any): string[] {
    if (!Array.isArray(flags)) return [];
    return flags
      .map(f => String(f || '').trim())
      .filter(f => f.length > 0 && f.toLowerCase() !== 'buyer_resubmission_requested');
  }

  private async blobUrlToDataUrl(url: string): Promise<string> {
    if (!url) return '';
    if (url.startsWith('data:')) return url;
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      return await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : '');
        reader.onerror = () => resolve('');
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  }

  private async prefetchDossierImages(dossier: any): Promise<void> {
    if (!dossier) return;
    const beforeItems: any[] = dossier.authoritative_evidence_chronology?.before_evidence || [];
    const msItems: any[] = dossier.authoritative_evidence_chronology?.milestone_submissions || [];
    const allItems = [...beforeItems, ...msItems];
    await Promise.all(
      allItems.map(async (item) => {
        const key = this.getEvidencePathKey(item);
        if (!key || this.resolvedPrintImages.has(key) || !this.isPreviewableImage(item)) {
          return;
        }
        try {
          const url = await firstValueFrom(this.getEvidenceUrl(item));
          const dataUrl = await this.blobUrlToDataUrl(url);
          if (dataUrl) {
            this.resolvedPrintImages.set(key, dataUrl);
          }
        } catch {
          // Non-fatal: report still prints complete metadata even if an image cannot be embedded.
        }
      })
    );
  }

  async printDossierReport(): Promise<void> {
    if (!this.dossierData) return;
    const d = this.dossierData;
    const win = window.open('', '_blank', 'width=1024,height=840');
    if (!win) {
      alert('Pop-up blocked. Please allow pop-ups or use Download JSON.');
      return;
    }

    win.document.write('<!doctype html><html><head><title>Preparing ProofLens Evidence Dossier...</title></head><body style="font-family:sans-serif;padding:2rem;color:#334155;">Loading agreement &amp; approved milestone evidences for PDF export...</body></html>');
    await this.prefetchDossierImages(d);

    const cb = d.contractual_baseline || {};
    const auth = d.authoritative_evidence_chronology || {};
    const milestones: any[] = Array.isArray(cb.milestones) ? cb.milestones : [];
    const scopeChanges: any[] = Array.isArray(cb.scope_changes) ? cb.scope_changes : [];
    const beforeEvidence: any[] = Array.isArray(auth.before_evidence) ? auth.before_evidence : [];
    const milestoneEvidence: any[] = Array.isArray(auth.milestone_submissions) ? auth.milestone_submissions : [];
    const excludedCount = Number(auth.excluded_unapproved_or_superseded_count || 0);

    const milestoneRows = milestones.length
      ? milestones.map((ms: any, idx: number) => `
          <tr>
            <td><strong>M${this.escapeHtml(ms.milestone_number ?? (idx + 1))}</strong>${ms.is_addendum ? '<br><span class="pill pill-purple">Addendum</span>' : ''}</td>
            <td>
              <strong>${this.escapeHtml(ms.title || `Milestone ${idx + 1}`)}</strong>
              ${ms.description ? `<div class="muted">${this.escapeHtml(ms.description)}</div>` : ''}
              ${ms.proof_required ? `<div class="muted"><em>Proof Required:</em> ${this.escapeHtml(ms.proof_required)}</div>` : ''}
            </td>
            <td>$${Number(ms.price_allocation || 0).toFixed(2)} USD</td>
            <td>${this.escapeHtml(ms.deadline || ms.relative_deadline || 'Per Schedule')}</td>
            <td><span class="pill ${String(ms.status || '').toLowerCase() === 'approved' ? 'pill-green' : 'pill-slate'}">${this.escapeHtml(String(ms.status || 'pending').toUpperCase())}</span></td>
          </tr>
        `).join('')
      : '<tr><td colspan="5">No milestone schedule attached.</td></tr>';

    const scopeChangeRows = scopeChanges.length
      ? scopeChanges.map((sc: any) => `
          <tr>
            <td>#${this.escapeHtml(sc.id || '')}</td>
            <td>${this.escapeHtml(sc.description || '')}</td>
            <td>+$${Number(sc.proposed_extra_cost || 0).toFixed(2)} / +${this.escapeHtml(sc.proposed_extra_days ?? 0)}d</td>
            <td><span class="pill">${this.escapeHtml(this.formatScopeStatus(sc.status))}</span></td>
          </tr>
        `).join('')
      : '<tr><td colspan="4">No formal scope change requests recorded on this project.</td></tr>';

    const renderEvidenceCard = (ev: any, title: string, subtitle: string, showAi: boolean) => {
      const key = this.getEvidencePathKey(ev);
      const dataUrl = key ? this.resolvedPrintImages.get(key) : '';
      const flags = this.getNonRejectionFlags(ev.fraud_flags);
      const extUrl = this.getSafeExternalUrl(ev.asset_url);
      return `
        <div class="ev-card">
          <div class="ev-card-head">
            <div>
              <strong>${this.escapeHtml(title)}</strong>
              <div class="muted">${this.escapeHtml(subtitle)}</div>
            </div>
            <span class="pill ${showAi && Number(ev.ai_match_score || 0) >= 80 ? 'pill-green' : ''}">${this.escapeHtml(String(ev.status || 'verified').toUpperCase())}</span>
          </div>
          <div class="ev-card-body">
            ${dataUrl ? `<div class="ev-img-wrap"><img src="${dataUrl}" alt="${this.escapeHtml(ev.original_filename || title)}" /></div>` : '<div class="ev-no-img">File / Link Evidence</div>'}
            <div class="ev-meta">
              <div><strong>Filename:</strong> ${this.escapeHtml(ev.original_filename || ev.file_path || 'Captured Deliverable')}</div>
              <div><strong>Method:</strong> ${this.escapeHtml(ev.capture_method || 'verified_capture')} • <strong>Server Timestamp:</strong> ${this.escapeHtml(ev.server_receipt_timestamp || '')}</div>
              <div><strong>SHA-256:</strong> <code>${this.escapeHtml(ev.sha256_hash || '')}</code></div>
              ${ev.location ? `<div><strong>Location / GPS:</strong> ${this.escapeHtml(ev.location)}</div>` : ''}
              ${extUrl ? `<div><strong>Asset Link:</strong> ${this.escapeHtml(extUrl)}</div>` : ''}
              ${showAi ? `<div><strong>AI Match:</strong> ${this.escapeHtml(ev.ai_match_score ?? '-')}% • <strong>Anti-Spoof:</strong> ${flags.length ? this.escapeHtml(flags.join(', ')) : 'Passed (Clean)'}</div>` : ''}
              ${ev.analysis_notes ? `<div class="ev-notes"><strong>Analysis Notes:</strong><br>${this.escapeHtml(ev.analysis_notes)}</div>` : ''}
            </div>
          </div>
        </div>
      `;
    };

    const beforeCardsHtml = beforeEvidence.length
      ? beforeEvidence.map((b: any, i: number) =>
          renderEvidenceCard(
            b,
            `Baseline Before-Evidence #${i + 1}`,
            b.original_filename || 'Pre-work authoritative reference',
            false
          )
        ).join('')
      : '<div class="box">No baseline before-evidence submitted on file.</div>';

    const approvedMsCardsHtml = milestoneEvidence.length
      ? milestoneEvidence.map((m: any) =>
          renderEvidenceCard(
            m,
            `Milestone ${(Number(m.milestone_index) || 0) + 1}: ${m.milestone_title || 'Approved Deliverable'}`,
            `$${Number(m.milestone_amount || 0).toFixed(2)} USD • Status: ${String(m.milestone_status || 'approved').toUpperCase()}`,
            true
          )
        ).join('')
      : '<div class="box">No accepted evidence from buyer-approved milestones is currently on file.</div>';

    win.document.open();
    win.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>ProofLens Evidence Dossier - ${this.escapeHtml(d.dossier_id)}</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; margin: 1.75rem; line-height: 1.45; }
            h1 { margin: 0 0 0.2rem; color: #001435; font-size: 1.35rem; }
            h2 { margin: 1.4rem 0 0.5rem; font-size: 0.98rem; color: #003087; border-bottom: 1.5px solid #cbd5e1; padding-bottom: 0.25rem; }
            h3 { margin: 0.9rem 0 0.4rem; font-size: 0.88rem; color: #1e293b; }
            .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.45rem 1.25rem; background: #f8fafc; border: 1px solid #cbd5e1; padding: 0.9rem; border-radius: 8px; margin-top: 0.75rem; font-size: 0.82rem; }
            .box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 0.75rem 0.9rem; border-radius: 6px; white-space: pre-wrap; font-size: 0.82rem; }
            .policy-banner { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e3a8a; padding: 0.6rem 0.85rem; border-radius: 6px; font-size: 0.8rem; margin-bottom: 0.75rem; }
            table { width: 100%; border-collapse: collapse; margin-top: 0.45rem; font-size: 0.78rem; }
            th, td { border: 1px solid #cbd5e1; padding: 0.45rem 0.55rem; text-align: left; vertical-align: top; }
            th { background: #f1f5f9; }
            code { font-family: monospace; font-size: 0.72rem; word-break: break-all; }
            .muted { color: #64748b; font-size: 0.74rem; margin-top: 0.15rem; }
            .pill { display: inline-block; padding: 0.12rem 0.45rem; border-radius: 999px; font-size: 0.68rem; font-weight: 700; background: #e2e8f0; color: #1e293b; }
            .pill-green { background: #dcfce7; color: #166534; }
            .pill-purple { background: #f3e8ff; color: #6b21a8; }
            .pill-slate { background: #f1f5f9; color: #475569; }
            .ev-card { border: 1px solid #cbd5e1; border-radius: 8px; padding: 0.75rem; margin-bottom: 0.75rem; break-inside: avoid; background: #ffffff; }
            .ev-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.75rem; border-bottom: 1px solid #f1f5f9; padding-bottom: 0.45rem; margin-bottom: 0.55rem; }
            .ev-card-body { display: grid; grid-template-columns: 165px 1fr; gap: 0.85rem; align-items: start; }
            .ev-img-wrap img { width: 100%; max-height: 155px; object-fit: cover; border-radius: 6px; border: 1px solid #cbd5e1; }
            .ev-no-img { width: 100%; min-height: 90px; display: flex; align-items: center; justify-content: center; background: #f1f5f9; color: #475569; border-radius: 6px; font-size: 0.75rem; font-weight: 600; text-align: center; padding: 0.5rem; box-sizing: border-box; }
            .ev-meta { font-size: 0.78rem; display: flex; flex-direction: column; gap: 0.25rem; }
            .ev-notes { margin-top: 0.25rem; background: #f8fafc; border: 1px solid #e2e8f0; padding: 0.45rem 0.6rem; border-radius: 5px; white-space: pre-wrap; font-size: 0.74rem; }
            @media print { body { margin: 1rem; } }
          </style>
        </head>
        <body>
          <h1>ProofLens Authoritative Forensic Evidence Dossier</h1>
          <div>Project: <strong>${this.escapeHtml(d.project_title)}</strong> (#${this.escapeHtml(d.project_id)}) • Escrow: $${this.escapeHtml(d.total_escrow_amount)} ${this.escapeHtml(d.currency || 'USD')}</div>
          <div class="meta">
            <div><strong>Dossier ID:</strong> ${this.escapeHtml(d.dossier_id)}</div>
            <div><strong>Compiled At:</strong> ${this.escapeHtml(d.compiled_at)}</div>
            <div><strong>AI Classification:</strong> ${this.escapeHtml(this.formatClassification(d.ai_dispute_classification))}</div>
            <div><strong>AI Validity Flag:</strong> ${this.escapeHtml(d.ai_validity_flag)} (${this.escapeHtml(d.ai_confidence_score)}%)</div>
            <div><strong>Claimant:</strong> ${this.escapeHtml(d.claimant)}</div>
            <div><strong>PayPal Sync:</strong> ${this.escapeHtml(d.paypal_dispute_id || d.paypal_sync_status || 'Internal Dossier Ready')}</div>
          </div>
          <h2>Dispute Claim</h2>
          <div class="box">${this.escapeHtml(d.dispute_claim)}</div>
          <h2>Executive Summary</h2>
          <div class="box">${this.escapeHtml(d.executive_summary || '')}</div>
          <h2>Adjudication Analysis &amp; Findings</h2>
          <div class="box">${this.escapeHtml(d.adjudication_analysis || '')}</div>
          <h2>Recommended Adjudication</h2>
          <div class="box">${this.escapeHtml(d.recommended_adjudication || '')}</div>

          <h2>Project Agreement &amp; Contractual Baseline (v${this.escapeHtml(cb.agreement_version || 1)})</h2>
          <div class="meta">
            <div><strong>Agreement Status:</strong> ${this.escapeHtml(cb.agreement_status || 'ACTIVE')}</div>
            <div><strong>Domain &amp; Deadline:</strong> ${this.escapeHtml(cb.project_domain || 'physical')} • Due ${this.escapeHtml(cb.target_deadline || 'Not specified')}</div>
            <div><strong>Milestones Approved:</strong> ${this.escapeHtml(cb.approved_milestones_count ?? 0)} / ${this.escapeHtml(cb.total_milestones_count ?? milestones.length)}</div>
            <div><strong>Warranty / Retainage:</strong> ${Number(cb.warranty_days || 0)} days (${this.escapeHtml(cb.lock_in_type || 'NONE')}${Number(cb.lock_in_amount || 0) > 0 ? ` • $${Number(cb.lock_in_amount).toFixed(2)}` : ''})</div>
          </div>
          ${cb.project_description ? `<h3>Project Scope Description</h3><div class="box">${this.escapeHtml(cb.project_description)}</div>` : ''}
          <h3>Legal Contract Terms (Section 1.0)</h3>
          <div class="box">${this.escapeHtml(cb.legal_terms || '')}</div>
          <h3>Specific Verification &amp; Evidence Requirements</h3>
          <div class="box">${this.escapeHtml(cb.evidence_requirements || '')}</div>
          <h3>Agreed Milestone Schedule</h3>
          <table>
            <thead><tr><th>MS</th><th>Deliverable &amp; Proof Required</th><th>Escrow</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>${milestoneRows}</tbody>
          </table>
          <h3>Scope Change Requests &amp; Addendums</h3>
          <table>
            <thead><tr><th>ID</th><th>Requested Modification</th><th>Proposed Delta</th><th>Status</th></tr></thead>
            <tbody>${scopeChangeRows}</tbody>
          </table>

          <h2>Authoritative Evidences (Approved Milestones Only)</h2>
          <div class="policy-banner">
            <strong>Evidence Audit Policy:</strong> Only buyer-approved milestone evidences (${this.escapeHtml(this.getApprovedMilestoneNumbersText())}) and authoritative baseline proofs are included in forensic adjudication. ${excludedCount > 0 ? `${excludedCount} unapproved milestone upload(s) or prior buyer-rejected/superseded resubmission(s) were excluded.` : ''}
          </div>
          <h3>Baseline Before-Evidence (${beforeEvidence.length})</h3>
          ${beforeCardsHtml}
          <h3>Approved Milestone Evidences (${milestoneEvidence.length})</h3>
          ${approvedMsCardsHtml}
          <script>
            (function() {
              function triggerPrint() { setTimeout(function() { window.print(); }, 150); }
              var imgs = Array.prototype.slice.call(document.images || []);
              if (imgs.length === 0) { triggerPrint(); return; }
              var pending = imgs.length;
              function done() { pending -= 1; if (pending <= 0) triggerPrint(); }
              imgs.forEach(function(img) {
                if (img.complete) { done(); }
                else {
                  img.addEventListener('load', done, { once: true });
                  img.addEventListener('error', done, { once: true });
                }
              });
            })();
          </script>
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
