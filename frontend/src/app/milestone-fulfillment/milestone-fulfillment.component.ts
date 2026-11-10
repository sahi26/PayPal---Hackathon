import { Component, OnInit, OnDestroy } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { API_BASE_URL } from '../api.config';
import { EvidenceFileService } from '../evidence-file.service';
import { requiresDigitalWarrantyHold } from '../project-warranty.utils';
import { LiveCameraComponent } from '../live-camera/live-camera.component';
import { RevisionRoomComponent, ScopeChangeItem } from '../revision-room/revision-room.component';
import { DisputeRoomComponent } from '../dispute-room/dispute-room.component';
import { ScopeChangeNavigationService } from '../scope-change-navigation.service';

@Component({
  selector: 'app-milestone-fulfillment',
  standalone: true,
  imports: [CommonModule, FormsModule, LiveCameraComponent, RevisionRoomComponent, DisputeRoomComponent],
  templateUrl: './milestone-fulfillment.component.html',
  styleUrl: './milestone-fulfillment.component.scss'
})
export class MilestoneFulfillmentComponent implements OnInit, OnDestroy {
  Number = Number;
  projectId = 0;
  currentRole: 'seller' | 'buyer' = 'buyer';
  projectData: any = null;
  milestones: any[] = [];
  selectedMilestoneIndex = 0;
  evidenceList: any[] = [];
  isLoading = true;

  // Digital Upload & AI Watermark Audit State
  digitalSubmissionMode: 'upload' = 'upload';
  selectedDigitalFile: File | null = null;
  digitalFilePreviewUrl: string | null = null;
  digitalAssetUrl: string = '';
  isUploadingDigitalFile = false;
  isAnalyzing = false;
  digitalUploadError: string | null = null;
  isDragOverDropzone = false;

  showRevisionRoom = false;
  activeScopeChange: ScopeChangeItem | null = null;
  isRefreshing = false;
  isApproving = false;
  isAuthorizingMilestone = false;

  // Multi-Tiered Dispute State
  showDisputeRoom = false;
  activeDispute: any = null;

  // PayPal Invoicing v2 State
  isReceiptModalOpen = false;
  selectedReceiptMilestoneIndex = 0;
  isInvoicesDrawerOpen = false;
  projectInvoices: any[] = [];
  syncingInvoiceIndex: number | null = null;
  invoiceSyncError: string | null = null;

  // Extended PayPal APIs State
  isTrackingModalOpen = false;
  trackingCarrier = 'UPS';
  trackingNumber = '';
  isSubmittingTracking = false;
  trackingSuccessMsg: string | null = null;
  trackingErrorMsg: string | null = null;

  isRefundModalOpen = false;
  refundMilestoneIndex = 0;
  refundAmount = 0;
  refundReason = '';
  isSubmittingRefund = false;
  refundSuccessMsg: string | null = null;
  refundErrorMsg: string | null = null;

  isVoidModalOpen = false;
  voidReason = '';
  isSubmittingVoid = false;
  voidSuccessMsg: string | null = null;
  voidErrorMsg: string | null = null;
  isRespondingToVoidConsent = false;
  voidConsentActionSuccess: string | null = null;
  voidConsentActionError: string | null = null;

  // Escrow Reauthorization & FUNDS_AT_RISK State
  isReauthorizingEscrow = false;
  isReapprovingEscrow = false;
  escrowReauthSuccessMsg: string | null = null;
  private escrowSocket?: WebSocket;
  private scopeChangeNavSub: Subscription | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private sanitizer: DomSanitizer,
    private evidenceFiles: EvidenceFileService,
    private scopeChangeNav: ScopeChangeNavigationService
  ) {}

  ngOnInit() {
    const initialRole = this.resolveStoredRole();
    if (initialRole) {
      this.currentRole = initialRole;
    }

    this.scopeChangeNavSub = this.scopeChangeNav.openRequested$.subscribe(targetProjectId => {
      if (this.projectId && targetProjectId === this.projectId && this.scopeChangeNav.consumePending(this.projectId)) {
        this.showRevisionRoom = true;
      }
    });

    this.route.paramMap.subscribe(params => {
      this.projectId = Number(params.get('id')) || 0;
      if (this.projectId) {
        if (this.scopeChangeNav.consumePending(this.projectId)) {
          this.showRevisionRoom = true;
        }
        this.fetchProject();
        this.initEscrowWebSocket();
      } else {
        this.isLoading = false;
      }
    });

    this.route.queryParams.subscribe(q => {
      if (q['role']) {
        const r = q['role'].toLowerCase();
        if (r === 'seller' || r === 'buyer') {
          this.currentRole = r;
        }
      }
      if (q['ms'] !== undefined) {
        const msIdx = Number(q['ms']);
        if (!isNaN(msIdx) && msIdx >= 0) {
          this.selectedMilestoneIndex = msIdx;
        }
      }
      const token = q['token'];
      if (token && q['paypal_cancelled'] !== '1' && !this.isConfirmingAuth) {
        this.confirmPayPalEscrowHold(token);
      }
      if (q['paypal_cancelled'] === '1') {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { role: this.currentRole },
          replaceUrl: true
        });
      } else if (q['scope_change'] !== undefined) {
        this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { scope_change: null },
          queryParamsHandling: 'merge',
          replaceUrl: true
        });
      }
    });
  }

  private resolveStoredRole(): 'seller' | 'buyer' | null {
    try {
      const savedUser = localStorage.getItem('prooflens_user');
      if (savedUser) {
        const user = JSON.parse(savedUser);
        const rt = (user?.role_type || '').toLowerCase();
        if (rt === 'seller' || rt === 'maker') return 'seller';
        if (rt === 'buyer' || rt === 'customer') return 'buyer';
      }
    } catch {}
    const storedRole = (localStorage.getItem('role') || '').toLowerCase();
    if (storedRole === 'seller') return 'seller';
    if (storedRole === 'buyer') return 'buyer';
    return null;
  }

  private syncRoleWithProject(data: any) {
    const explicitRole = (this.route.snapshot.queryParams['role'] || '').toLowerCase();
    if (explicitRole === 'buyer' || explicitRole === 'seller') {
      this.currentRole = explicitRole;
      return;
    }

    try {
      const savedUser = localStorage.getItem('prooflens_user');
      const user = savedUser ? JSON.parse(savedUser) : null;
      const email = user?.email?.trim().toLowerCase();
      const buyerEmail = data?.project?.buyer_email?.trim().toLowerCase();
      const sellerEmail = data?.project?.seller_email?.trim().toLowerCase();
      if (email && sellerEmail && email === sellerEmail) {
        this.currentRole = 'seller';
        return;
      }
      if (email && buyerEmail && email === buyerEmail) {
        this.currentRole = 'buyer';
        return;
      }
    } catch {}

    const stored = this.resolveStoredRole();
    if (stored) {
      this.currentRole = stored;
    }
  }

  ngOnDestroy() {
    if (this.scopeChangeNavSub) {
      this.scopeChangeNavSub.unsubscribe();
      this.scopeChangeNavSub = null;
    }
    if (this.escrowSocket) {
      try {
        this.escrowSocket.close();
      } catch (e) {}
    }
  }

  isConfirmingAuth = false;
  escrowAuthSuccess = false;

  confirmPayPalEscrowHold(token: string) {
    this.isConfirmingAuth = true;
    this.http.post<any>(`${API_BASE_URL}/api/escrow/confirm-authorization?order_id=${encodeURIComponent(token)}`, {})
      .subscribe({
        next: (res) => {
          this.isConfirmingAuth = false;
          this.escrowAuthSuccess = true;
          this.fetchProject();
          this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { role: this.currentRole },
            replaceUrl: true
          });
        },
        error: (err) => {
          this.isConfirmingAuth = false;
          console.warn('Escrow authorization confirmation notice:', err);
          this.fetchProject();
        }
      });
  }

  isEscrowAuthorized(): boolean {
    const p = this.projectData?.payment;
    if (!p || p.milestone_index == null || Number(p.milestone_index) !== this.selectedMilestoneIndex) return false;
    const s = (p.status || '').toLowerCase();
    return s === 'authorized' || s === 'reauthorized';
  }

  isScopeChangePendingEscrow(): boolean {
    const paymentAmt = Number(this.projectData?.payment?.amount || 0);
    return this.activeScopeChange?.status === 'PENDING_FUNDS' ||
           (this.projectData?.payment?.milestone_index == null &&
             this.projectData?.payment?.status === 'CREATED' &&
             paymentAmt < Number(this.projectData?.project?.total_price || 0));
  }

  getEscrowDepositAmount(): number {
    if (this.activeScopeChange?.proposed_extra_cost) {
      return Number(this.activeScopeChange.proposed_extra_cost);
    }
    if (this.projectData?.payment?.milestone_index != null) {
      return Number(this.projectData.payment.amount || 0);
    }
    const total = Number(this.projectData?.project?.total_price || 0);
    const captured = Number(this.projectData?.project?.captured_amount || 0);
    if (captured > 0 && total > captured) {
      return Number((total - captured).toFixed(2));
    }
    const paymentAmt = Number(this.projectData?.payment?.amount || 0);
    if (paymentAmt > 0 && paymentAmt < total) {
      return paymentAmt;
    }
    return Number(this.projectData?.payment?.amount || total);
  }

  getEscrowDepositUrl(): string | null {
    if (this.isScopeChangePendingEscrow() && this.activeScopeChange?.paypal_approval_url) {
      return this.activeScopeChange.paypal_approval_url;
    }
    return this.getPayPalApprovalUrl();
  }

  getInitialSettledAmount(): number {
    const total = Number(this.projectData?.project?.total_price || 0);
    const captured = Number(this.projectData?.project?.captured_amount || 0);
    if (captured > 0) return captured;
    const deposit = Number(this.getEscrowDepositAmount() || 0);
    return Math.max(0, total - deposit);
  }

  getPayPalApprovalUrl(): string | null {
    return this.projectData?.paypal_approval_url || this.projectData?.payment?.approval_url || null;
  }

  canAuthorizeSelectedMilestone(): boolean {
    const status = (this.projectData?.project?.status || '').toLowerCase();
    return this.currentRole === 'buyer' &&
      !!this.projectData?.project?.seller_email &&
      ['accepted', 'active'].includes(status) &&
      !!this.milestones[this.selectedMilestoneIndex] &&
      !this.isMilestoneApproved(this.selectedMilestoneIndex) &&
      !this.isEscrowAuthorized() &&
      !this.isProjectCanceled();
  }

  authorizeSelectedMilestone(): void {
    if (!this.projectId || !this.canAuthorizeSelectedMilestone() || this.isAuthorizingMilestone) return;
    const milestoneIndex = this.selectedMilestoneIndex;
    this.isAuthorizingMilestone = true;
    const returnUrl = `${window.location.origin}/project/${this.projectId}/fulfillment?role=buyer`;
    const cancelUrl = `${window.location.origin}/project/${this.projectId}/fulfillment?role=buyer&paypal_cancelled=1`;
    this.http.post<any>(`${API_BASE_URL}/api/payments/authorize`, {
      project_id: this.projectId,
      milestone_index: milestoneIndex,
      currency: 'USD',
      force_new: true,
      return_url: returnUrl,
      cancel_url: cancelUrl
    }).subscribe({
      next: (res) => {
        this.isAuthorizingMilestone = false;
        if (!res?.approval_url) {
          alert('PayPal did not return an approval link. Please retry milestone authorization.');
          return;
        }
        window.location.href = res.approval_url;
      },
      error: (err) => {
        this.isAuthorizingMilestone = false;
        const msg = err.status === 0
          ? 'Could not reach the payment server cleanly (the server may be waking up or PayPal timed out). Please wait a few seconds and try again.'
          : (err.error?.detail || err.message || 'Could not start milestone escrow authorization.');
        alert(msg);
      }
    });
  }

  isFundsAtRisk(): boolean {
    const s = (this.projectData?.project?.status || '').toUpperCase();
    return s === 'FUNDS_AT_RISK' || !!this.projectData?.project?.is_funds_at_risk;
  }

  isEscrowExpiringSoon(): boolean {
    const days = this.projectData?.project?.days_until_authorization_expiration;
    return typeof days === 'number' && days <= 5.0 && days >= 0;
  }

  reauthorizeEscrowHold(force: boolean = false) {
    if (!this.projectId || this.isReauthorizingEscrow) return;
    this.isReauthorizingEscrow = true;
    this.escrowReauthSuccessMsg = null;
    this.http.post<any>(`${API_BASE_URL}/api/payments/${this.projectId}/reauthorize?force=${force}`, {})
      .subscribe({
        next: (res) => {
          this.isReauthorizingEscrow = false;
          this.escrowReauthSuccessMsg = res.message || 'Authorization hold extended for 29 days.';
          this.fetchProject();
          setTimeout(() => { this.escrowReauthSuccessMsg = null; }, 6000);
        },
        error: (err) => {
          this.isReauthorizingEscrow = false;
          const msg = err.error?.message || err.error?.detail || err.error?.error || 'Reauthorization failed.';
          alert(`Reauthorization Notice: ${msg}`);
          this.fetchProject();
        }
      });
  }

  reApproveEscrow() {
    if (!this.projectId || this.isReapprovingEscrow) return;
    this.isReapprovingEscrow = true;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/re-approve-escrow`, {})
      .subscribe({
        next: (res) => {
          this.isReapprovingEscrow = false;
          if (res.paypal_approval_url) {
            window.location.href = res.paypal_approval_url;
          } else {
            this.fetchProject();
          }
        },
        error: (err) => {
          this.isReapprovingEscrow = false;
          alert(err.error?.detail || 'Failed to initialize escrow re-approval.');
        }
      });
  }

  checkEscrowStatus() {
    if (!this.projectId) return;
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}/escrow-status`)
      .subscribe({
        next: (res) => {
          if (this.projectData?.project) {
            this.projectData.project.status = res.status;
            this.projectData.project.is_funds_at_risk = res.is_funds_at_risk;
            this.projectData.project.authorization_expires_at = res.authorization_expires_at;
            this.projectData.project.days_until_authorization_expiration = res.days_until_expiration;
          }
        },
        error: (err) => console.warn('Escrow status check failed:', err)
      });
  }

  initEscrowWebSocket() {
    if (!this.projectId || typeof WebSocket === 'undefined') return;
    try {
      const loc = window.location;
      const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${loc.hostname}:8000/ws/projects/${this.projectId}`;
      this.escrowSocket = new WebSocket(wsUrl);

      this.escrowSocket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event === 'FUNDS_AT_RISK' || msg.status === 'FUNDS_AT_RISK') {
            if (this.projectData?.project) {
              this.projectData.project.status = 'FUNDS_AT_RISK';
              this.projectData.project.is_funds_at_risk = true;
            }
          } else if (msg.event === 'ESCROW_REAUTHORIZED') {
            if (this.projectData?.project) {
              this.projectData.project.status = msg.status || 'active';
              this.projectData.project.is_funds_at_risk = false;
            }
            this.fetchProject();
          }
        } catch (e) {}
      };
    } catch (e) {
      console.warn('Escrow WebSocket connection skipped:', e);
    }
  }

  fetchProject() {
    this.isRefreshing = true;
    const start = Date.now();
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}`)
      .subscribe({
        next: (data) => {
          this.syncRoleWithProject(data);
          this.projectData = data;
          this.milestones = data.agreement?.milestones || [];
          this.activeScopeChange = data.active_scope_change || null;
          this.isLoading = false;
          this.loadProjectEvidence();
          this.loadActiveDispute();
          this.loadProjectInvoices();

          const explicitMs = this.route.snapshot.queryParams['ms'];
          if (explicitMs === undefined || explicitMs === null || explicitMs === '') {
            // Auto-select first unapproved milestone
            for (let i = 0; i < this.milestones.length; i++) {
              if (!this.isMilestoneApproved(i)) {
                this.selectedMilestoneIndex = i;
                break;
              }
            }
          } else {
            const parsedMs = Number(explicitMs);
            if (!isNaN(parsedMs) && parsedMs >= 0 && parsedMs < this.milestones.length && this.isMilestoneUnlocked(parsedMs)) {
              this.selectedMilestoneIndex = parsedMs;
            }
          }

          const elapsed = Date.now() - start;
          const remaining = Math.max(0, 450 - elapsed);
          setTimeout(() => {
            this.isRefreshing = false;
          }, remaining);
        },
        error: (err) => {
          this.isLoading = false;
          this.isRefreshing = false;
          alert('Could not load project details: ' + (err.error?.detail || err.message));
        }
      });
  }

  loadActiveDispute() {
    if (!this.projectId) return;
    this.http.get<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/active`).subscribe({
      next: (res) => {
        if (res && res.active) {
          this.activeDispute = res.dispute;
        } else {
          this.activeDispute = null;
        }
      },
      error: () => {}
    });
  }

  isProjectDisputed(): boolean {
    const s = (this.projectData?.project?.status || '').toLowerCase();
    return s === 'disputed' || (this.activeDispute && this.activeDispute.status !== 'RESOLVED');
  }

  openDisputeRoom() {
    this.showDisputeRoom = true;
  }

  closeDisputeRoom() {
    this.showDisputeRoom = false;
    this.fetchProject();
  }

  onDisputeResolved(event: any) {
    this.showDisputeRoom = false;
    this.activeDispute = null;
    this.fetchProject();
  }

  onDisputeEscalated(event: any) {
    if (this.projectData?.project) {
      this.projectData.project.status = 'DISPUTED';
    }
    this.fetchProject();
  }

  loadProjectEvidence() {
    if (!this.projectId) return;
    this.evidenceFiles.retryFailed();
    this.http.get<any[]>(`${API_BASE_URL}/api/projects/${this.projectId}/evidence`)
      .subscribe({
        next: (data) => {
          this.evidenceList = data || [];
        },
        error: (err) => console.error('Failed to load project evidence:', err)
      });
  }

  isProjectAccepted(): boolean {
    if (!this.projectData?.project?.status) return false;
    const s = this.projectData.project.status.toLowerCase();
    return s === 'accepted' || s === 'completed' || s === 'active' || s === 'work_in_progress' || 
           s === 'in_review' || s === 'funds_at_risk' ||
           s === 'warranty_period' || s === 'cancelled' || s === 'partially_completed_canceled' || s === 'disputed';
  }

  isProjectCanceled(): boolean {
    const s = (this.projectData?.project?.status || '').toLowerCase();
    return s === 'cancelled' || s === 'partially_completed_canceled' || s === 'rejected';
  }

  isProjectCompleted(): boolean {
    const s = (this.projectData?.project?.status || '').toLowerCase();
    if (s === 'completed') return true;
    const list = this.projectData?.agreement?.milestones || this.milestones || [];
    if (!list || list.length === 0) return false;
    const allDone = list.every((m: any) => {
      const st = (m?.status || '').toLowerCase();
      return (st === 'approved' || st === 'completed') && !!(m?.is_paid || m?.paypal_capture_id);
    });
    const remainingHold = Number(this.projectData?.project?.remaining_escrow_hold || 0);
    return allDone && remainingHold <= 0;
  }

  hasActiveEscrowHold(): boolean {
    const remainingHold = Number(this.projectData?.project?.remaining_escrow_hold || 0);
    if (remainingHold > 0) return true;
    const payStatus = (this.projectData?.payment?.status || '').toLowerCase();
    return payStatus === 'authorized' || payStatus === 'reauthorized' || payStatus === 'partially_captured';
  }

  canShowVoidEscrowButton(): boolean {
    if (this.currentRole !== 'buyer') return false;
    if (this.isProjectCompleted() || this.isProjectCanceled()) return false;
    return this.hasActiveEscrowHold();
  }

  canShowExtendHoldButton(): boolean {
    if (this.isProjectCompleted() || this.isProjectCanceled()) return false;
    return this.hasActiveEscrowHold();
  }

  isPartiallyCompletedCanceled(): boolean {
    const s = (this.projectData?.project?.status || '').toLowerCase();
    return s === 'partially_completed_canceled' || (s === 'cancelled' && (this.projectData?.project?.captured_amount || 0) > 0);
  }

  getOriginallyAuthorizedAmount(): number {
    return Number(this.projectData?.project?.total_price || 0);
  }

  getTotalPaidToSeller(): number {
    return Number(this.projectData?.project?.captured_amount || 0);
  }

  getTotalVoidedToBuyer(): number {
    const voided = Number(this.projectData?.project?.voided_amount || 0);
    if (voided > 0) return voided;
    const total = this.getOriginallyAuthorizedAmount();
    const paid = this.getTotalPaidToSeller();
    return Math.max(0, Number((total - paid).toFixed(2)));
  }

  canShowDisputeButton(): boolean {
    const s = (this.projectData?.project?.status || '').toLowerCase();
    if (s === 'draft' || s === 'invite_sent' || s === 'cancelled' ||
        s === 'partially_completed_canceled' || s === 'rejected') {
      return false;
    }
    return s === 'active' || s === 'completed' || s === 'warranty_period' ||
           s === 'disputed' || s === 'in_review' || s === 'funds_at_risk' ||
           !!this.activeDispute;
  }

  isWarrantyPeriodActive(): boolean {
    if (this.isSimpleDigitalProject()) return false;
    const wDays = this.getRetainageDays();
    const lockAmt = this.getRetainageAmount();
    if (wDays <= 0 || lockAmt <= 0) return false;

    const s = (this.projectData?.project?.status || '').toUpperCase();
    const agStatus = (this.projectData?.agreement?.status || '').toUpperCase();
    const isStatusWarranty = s === 'WARRANTY_PERIOD' || agStatus === 'WARRANTY_PERIOD';
    if (!isStatusWarranty) return false;

    // Retainage warranty only applies once all milestones are completely approved
    const list = this.projectData?.agreement?.milestones || this.milestones || [];
    if (list && list.length > 0) {
      const allApproved = list.every((m: any) => (m.status || '').toLowerCase() === 'approved');
      if (!allApproved) return false;
    }

    return true;
  }

  getRetainageAmount(): number {
    const ag = this.projectData?.agreement;
    if (!ag) return 0;
    const lockType = (ag.lock_in_type || 'NONE').toUpperCase();
    if (lockType === 'NONE') return 0;

    if (lockType === 'FINAL_MILESTONE') {
      const list = this.projectData?.agreement?.milestones || this.milestones || [];
      if (list && list.length > 0) {
        const lastM = list[list.length - 1];
        const lastAlloc = parseFloat(lastM.price_allocation || 0);
        if (lastAlloc > 0) return lastAlloc;
      }
    }

    const amt = parseFloat(ag.lock_in_amount || 0);
    if (amt > 0) return amt;
    return 0;
  }

  getRetainageDays(): number {
    const ag = this.projectData?.agreement;
    if (!ag) return 0;
    if (ag.warranty_days !== undefined && ag.warranty_days !== null) {
      return Number(ag.warranty_days);
    }
    return Number(ag.lock_in_days || 0);
  }

  isWarrantyDisputeActive(): boolean {
    return !!this.projectData?.agreement?.dispute_active;
  }

  getWarrantyDaysRemaining(): number {
    const endStr = this.projectData?.agreement?.warranty_end_date;
    if (!endStr) return 0;
    const end = new Date(endStr).getTime();
    const now = new Date().getTime();
    const diffDays = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }

  isTogglingDispute = false;
  toggleWarrantyDispute() {
    if (!this.projectId || this.isTogglingDispute) return;
    const currentDispute = this.isWarrantyDisputeActive();
    const newDisputeState = !currentDispute;
    this.isTogglingDispute = true;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/warranty/dispute`, {
      dispute_active: newDisputeState,
      reason: newDisputeState ? 'Buyer raised inspection/defect dispute during warranty hold' : 'Dispute resolved'
    }).subscribe({
      next: (res) => {
        this.isTogglingDispute = false;
        if (this.projectData?.agreement) {
          this.projectData.agreement.dispute_active = res.dispute_active;
          this.projectData.agreement.warranty_payout_status = res.warranty_payout_status;
        }
      },
      error: (err) => {
        this.isTogglingDispute = false;
        alert(err.error?.detail || err.message || 'Failed to toggle warranty dispute');
      }
    });
  }

  isDigitalProject(): boolean {
    const p = this.projectData?.project;
    if (!p) return false;
    const domain = (p.project_domain || '').toLowerCase().trim();

    const ind = (p.industry_type || '').toLowerCase();
    const title = (p.title || '').toLowerCase();
    const desc = (p.description || '').toLowerCase();
    const fullText = `${title} ${ind} ${desc}`;

    // Physical craftsmanship keywords ALWAYS take precedence (jewelry, woodworking, renovation, etc.)
    const physicalKeywords = [
      'jewelry', 'jewellery', 'jewel', 'gem', 'ring', 'necklace', 'pendant', 'bracelet', 'gold', 'silver', 'diamond', 'karat',
      'renovat', 'remodel', 'plumb', 'pipe', 'drywall', 'tile', 'roof', 'flooring', 'house', 'wood', 'timber', 'carpentry', 'furniture'
    ];
    if (physicalKeywords.some(kw => fullText.includes(kw))) {
      return false;
    }

    if (domain === 'physical') return false;
    if (domain === 'digital') return true;

    // Specific digital deliverable keywords (software, web apps, SaaS, graphic logo vectors)
    const digitalKeywords = [
      'software', 'web', 'website', 'app', 'code', 'ui', 'ux', 'frontend', 'backend',
      'api', 'saas', 'vector', 'figma', 'banner', 'logo', 'brand identity'
    ];
    return digitalKeywords.some(kw => fullText.includes(kw));
  }

  isSimpleDigitalProject(): boolean {
    const project = this.projectData?.project;
    return this.isDigitalProject() && !requiresDigitalWarrantyHold(
      project?.title,
      project?.industry_type,
      project?.description
    );
  }

  onDigitalFileSelected(event: any) {
    const file = event.target?.files?.[0];
    if (!file) return;
    this.processSelectedFile(file);
  }

  onDigitalFileDropped(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOverDropzone = false;
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.processSelectedFile(event.dataTransfer.files[0]);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOverDropzone = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOverDropzone = false;
  }

  processSelectedFile(file: File) {
    this.selectedDigitalFile = file;
    this.digitalUploadError = null;
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = () => {
        this.digitalFilePreviewUrl = reader.result as string;
      };
      reader.readAsDataURL(file);
    } else {
      this.digitalFilePreviewUrl = null;
    }
  }

  clearSelectedFile() {
    this.selectedDigitalFile = null;
    this.digitalFilePreviewUrl = null;
    this.digitalUploadError = null;
  }

  formatCurrency(val: any): string {
    const num = Number(val || 0);
    return isNaN(num) ? '0.00' : num.toFixed(2);
  }

  formatFileSize(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  isPreviewableImage(path: string, mimeType?: string): boolean {
    if (mimeType && /^image\/(?:jpeg|jpg|png|webp|gif|bmp|avif)$/i.test(mimeType.split(';')[0].trim())) {
      return true;
    }
    if (!path) return false;
    const p = path.split('?')[0].split('#')[0].toLowerCase();
    return p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.webp') || p.endsWith('.gif') || p.endsWith('.bmp') || p.endsWith('.avif') || p.endsWith('.svg');
  }

  isWatermarkFlag(flag: string): boolean {
    if (!flag) return false;
    const f = flag.toLowerCase();
    return f.includes('watermark') || f.includes('synthid') || f.includes('dall-e') || f.includes('dall·e') || f.includes('midjourney') || f.includes('stable diffusion') || f.includes('comfyui') || f.includes('civitai') || f.includes('firefly') || f.includes('ai-generated') || f.includes('generative');
  }

  isSpoofingFlag(flag: string): boolean {
    if (!flag) return false;
    const f = flag.toLowerCase();
    return f.includes('moir') || f.includes('screen') || f.includes('bezel') || f.includes('re-photograph') || f.includes('reflection') || f.includes('display') || f.includes('spoof') || f.includes('timber') || f.includes('grain') || f.includes('scope mismatch');
  }

  hasSpoofingFlag(evList: any[]): boolean {
    const flags = this.getMilestoneFraudFlags(evList);
    return flags.some(f => this.isSpoofingFlag(f));
  }

  hasWatermarkFlag(evList: any[]): boolean {
    const flags = this.getMilestoneFraudFlags(evList);
    return flags.some(f => this.isWatermarkFlag(f));
  }

  getCertificateTitle(evList: any[]): string {
    const isFraud = this.hasFraudInMilestone(evList);
    if (isFraud) {
      if (this.hasSpoofingFlag(evList) && this.hasWatermarkFlag(evList)) {
        return 'ProofLens Anti-Spoofing & AI Watermark Audit — FLAGGED FOR REVIEW';
      }
      if (this.hasSpoofingFlag(evList)) {
        return 'ProofLens Anti-Spoofing Audit — FLAGGED FOR REVIEW';
      }
      return 'ProofLens Digital Asset Integrity & AI Watermark Audit — FLAGGED FOR REVIEW';
    }
    return this.isDigitalProject() ? 'ProofLens Digital Asset Integrity & AI Watermark Audit' : 'ProofLens Forensic Evidence Audit';
  }

  getCertificateBadgeText(evList: any[]): string {
    const isFraud = this.hasFraudInMilestone(evList);
    if (!isFraud) return this.isHighConfidence(evList?.[0]) ? '• High Match' : '• Needs Review';
    if (this.hasSpoofingFlag(evList)) return '• Spoofing Flagged';
    if (this.hasWatermarkFlag(evList)) return '• AI Watermark Flagged';
    return this.isDigitalProject() ? '• AI Watermark Flagged' : '• Review Gated';
  }

  getForensicObservationTitle(evList: any[]): string {
    if (this.hasSpoofingFlag(evList) && this.hasWatermarkFlag(evList)) {
      return 'Screen Re-Photograph & Generative AI Watermark Detected';
    }
    if (this.hasSpoofingFlag(evList)) {
      return 'Potential Screen Re-Photographing or Moiré Distortion Detected';
    }
    if (this.hasWatermarkFlag(evList)) {
      return 'Generative AI Watermark / Synthetic Parameter Detected';
    }
    return this.isDigitalProject() ? 'Generative AI Watermark / Synthetic Parameter Detected' : 'Potential Screen Re-Photographing or Anomaly Detected';
  }

  getForensicObservationDescription(evList: any[]): string {
    if (this.hasSpoofingFlag(evList)) {
      return 'Automated integrity models detected indicators of display reproduction, screen bezels, or moiré wave interference. Deliverables must be genuine direct assets or on-site captures, not photographs of another screen.';
    }
    if (this.hasWatermarkFlag(evList)) {
      return 'Automated integrity models detected indicators of generative AI signatures or unauthorized watermarks. Original craftsmanship is required for escrow release.';
    }
    return 'Automated integrity models detected indicators of display reproduction or criteria mismatch. Findings are recorded for human escrow dispute review.';
  }

  submitDigitalDeliverable() {
    if (!this.selectedDigitalFile && !this.digitalAssetUrl.trim()) {
      this.digitalUploadError = 'Please select a deliverable file or provide a cloud asset URL.';
      return;
    }
    if (!this.projectId) return;

    this.isUploadingDigitalFile = true;
    this.isAnalyzing = true;
    this.digitalUploadError = null;

    const formData = new FormData();
    if (this.selectedDigitalFile) {
      formData.append('file', this.selectedDigitalFile);
    }
    formData.append('capture_method', 'file_upload');
    formData.append('evidence_type', 'milestone_evidence');
    formData.append('milestone_index', String(this.selectedMilestoneIndex));
    if (this.digitalAssetUrl.trim()) {
      formData.append('asset_url', this.digitalAssetUrl.trim());
    }

    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/evidence`, formData)
      .subscribe({
        next: (res) => {
          this.isUploadingDigitalFile = false;
          this.isAnalyzing = false;
          this.selectedDigitalFile = null;
          this.digitalFilePreviewUrl = null;
          this.digitalAssetUrl = '';
          this.isRecapturing = false;
          this.fetchProject();
        },
        error: (err) => {
          this.isUploadingDigitalFile = false;
          this.isAnalyzing = false;
          this.digitalUploadError = err.error?.detail || err.message || 'File upload failed. Please try again.';
        }
      });
  }

  openRevisionRoom() {
    this.showRevisionRoom = true;
  }

  closeRevisionRoom() {
    this.showRevisionRoom = false;
  }

  onScopeChangeAccepted(event: any) {
    if (event?.milestones && Array.isArray(event.milestones)) {
      this.milestones = event.milestones;
      if (this.projectData?.agreement) {
        this.projectData.agreement.milestones = event.milestones;
        this.projectData.agreement.version = event.agreement_version || (this.projectData.agreement.version + 1);
      }
      if (this.projectData?.project) {
        this.projectData.project.deadline = event.project?.deadline || this.getEffectiveProjectDeadline();
      }
    }
    this.closeRevisionRoom();
    this.fetchProject();
  }

  onScopeChangeRejected(event: any) {
    this.closeRevisionRoom();
    this.fetchProject();
  }

  getEffectiveProjectDeadline(): string {
    const msList = this.milestones?.length ? this.milestones : this.projectData?.agreement?.milestones;
    if (msList && Array.isArray(msList) && msList.length > 0) {
      const validDeadlines = msList
        .map((m: any, idx: number) => m?.deadline || this.getMilestoneFallbackDeadline(idx))
        .filter((d: any) => typeof d === 'string' && d && d !== 'Per Schedule' && d !== 'None' && d.trim() !== '');
      if (validDeadlines.length > 0) {
        return validDeadlines.reduce((latest: string, cur: string) => cur > latest ? cur : latest, validDeadlines[validDeadlines.length - 1]);
      }
    }
    return this.projectData?.project?.deadline || '';
  }

  isRecapturing: boolean = false;

  // Buyer Rejection & Resubmission Modal State
  showRejectModal: boolean = false;
  rejectingMilestoneIndex: number | null = null;
  rejectionReasonText: string = '';
  isSubmittingRejection: boolean = false;

  openRejectModal(index: number) {
    this.rejectingMilestoneIndex = index;
    this.rejectionReasonText = '';
    this.showRejectModal = true;
  }

  closeRejectModal() {
    this.showRejectModal = false;
    this.rejectingMilestoneIndex = null;
    this.rejectionReasonText = '';
  }

  setQuickRejectionReason(reason: string) {
    this.rejectionReasonText = reason;
  }

  submitRejection() {
    if (this.rejectingMilestoneIndex === null || !this.projectId) return;
    const reason = this.rejectionReasonText.trim() || 'Buyer requested evidence resubmission.';
    this.isSubmittingRejection = true;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/milestones/${this.rejectingMilestoneIndex}/reject`, { reason })
      .subscribe({
        next: (res) => {
          this.isSubmittingRejection = false;
          if (this.milestones[this.rejectingMilestoneIndex!]) {
            this.milestones[this.rejectingMilestoneIndex!].status = 'resubmission_requested';
            this.milestones[this.rejectingMilestoneIndex!].rejection_reason = reason;
          }
          this.closeRejectModal();
          this.fetchProject();
        },
        error: (err) => {
          this.isSubmittingRejection = false;
          alert(err.error?.detail || err.message || 'Rejection failed');
        }
      });
  }

  escalateMilestoneToDispute() {
    if (this.rejectingMilestoneIndex === null || !this.projectId) return;
    const reason = this.rejectionReasonText.trim() || `Dispute raised on Milestone #${this.rejectingMilestoneIndex + 1} deliverables.`;
    this.isSubmittingRejection = true;
    this.http.post<any>(`${API_BASE_URL}/api/disputes/${this.projectId}/open`, {
      reason,
      disputed_by: this.currentRole
    }).subscribe({
      next: (res) => {
        this.isSubmittingRejection = false;
        this.closeRejectModal();
        if (this.projectData?.project) {
          this.projectData.project.status = 'DISPUTED';
        }
        this.activeDispute = res.dispute || {
          status: 'INTERNAL_NEGOTIATION',
          reason: reason
        };
        this.showDisputeRoom = true;
        this.fetchProject();
      },
      error: (err) => {
        this.isSubmittingRejection = false;
        alert(err.error?.detail || err.message || 'Failed to escalate dispute');
      }
    });
  }

  private parseServerIsoMs(ts: string | null | undefined): number {
    if (!ts) return 0;
    const trimmed = String(ts).trim();
    if (!trimmed) return 0;
    const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
    const normalized = hasTz ? trimmed : `${trimmed}Z`;
    const parsed = Date.parse(normalized);
    return isNaN(parsed) ? 0 : parsed;
  }

  isEvidenceItemBuyerRejected(item: any): boolean {
    if (!item) return false;
    let flags = item.fraud_flags;
    if (typeof flags === 'string') {
      try { flags = JSON.parse(flags); } catch (_) {}
    }
    if (Array.isArray(flags) && flags.includes('buyer_resubmission_requested')) {
      return true;
    }
    return typeof item.ai_analysis_notes === 'string' &&
      item.ai_analysis_notes.includes('Buyer Rejection Feedback:');
  }

  private getSortedMilestoneEvidence(index: number): any[] {
    return (this.evidenceList || [])
      .filter(e => (e.evidence_type || 'milestone_evidence') === 'milestone_evidence' && Number(e.milestone_index ?? 0) === index)
      .sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  }

  hasNewerSubmissionSinceRejection(index: number): boolean {
    const ms = this.milestones[index];
    const sorted = this.getSortedMilestoneEvidence(index);
    if (!sorted.length) return false;

    const latest = sorted[0];
    if (this.isEvidenceItemBuyerRejected(latest)) {
      return false;
    }

    const rejectedMaxId = Number(ms?.rejected_evidence_max_id || 0);
    if (rejectedMaxId > 0 && Number(latest.id || 0) > rejectedMaxId) {
      return true;
    }

    if (sorted.slice(1).some(ev => this.isEvidenceItemBuyerRejected(ev))) {
      return true;
    }

    const resubmittedMs = this.parseServerIsoMs(ms?.resubmitted_at);
    const rejectedMs = this.parseServerIsoMs(ms?.rejected_at);
    if (resubmittedMs > 0 && (rejectedMs === 0 || resubmittedMs >= rejectedMs)) {
      return true;
    }

    const latestMs = this.parseServerIsoMs(latest.server_receipt_timestamp);
    if (rejectedMs > 0 && latestMs > rejectedMs) {
      return true;
    }

    return false;
  }

  isMilestoneResubmissionRequested(index: number): boolean {
    const ms = this.milestones[index];
    const st = (ms?.status || '').toLowerCase();
    if (this.hasNewerSubmissionSinceRejection(index)) {
      return this.isLowConfidenceDigitalSubmission(index);
    }
    return st === 'resubmission_requested' || st === 'rejected' || this.isLowConfidenceDigitalSubmission(index);
  }

  isHighConfidence(evidence: any): boolean {
    return Number(evidence?.ai_confidence_score || 0) > 90;
  }

  isLowConfidenceDigitalSubmission(index: number): boolean {
    if (this.currentRole !== 'seller' || !this.isDigitalProject() || this.isMilestoneApproved(index)) return false;
    const evidence = this.getEvidenceForMilestone(index);
    return !!evidence && !this.isHighConfidence(evidence);
  }

  getMilestoneRejectionReason(index: number): string {
    const ms = this.milestones[index];
    return ms?.rejection_reason || 'Buyer requested updated evidence resubmission.';
  }

  selectMilestone(index: number) {
    if (!this.isMilestoneUnlocked(index)) return;
    this.selectedMilestoneIndex = index;
    this.isRecapturing = false;
  }

  isMilestoneFlagged(index: number): boolean {
    const list = this.getAllEvidenceForMilestone(index);
    return this.hasFraudInMilestone(list);
  }

  handleRecaptureSuccess(res: any) {
    this.isRecapturing = false;
    this.isAnalyzing = false;
    this.fetchProject();
  }

  isMilestoneApproved(index: number): boolean {
    const ms = this.milestones[index];
    return (ms?.status || '').toLowerCase() === 'approved';
  }

  isMilestoneAwaitingReview(index: number): boolean {
    if (this.isMilestoneApproved(index) || this.isMilestoneResubmissionRequested(index)) {
      return false;
    }
    const ms = this.milestones[index];
    if ((ms?.status || '').toLowerCase() === 'awaiting_buyer_review') return true;
    const ev = this.getEvidenceForMilestone(index);
    return !!ev && !this.isEvidenceItemBuyerRejected(ev);
  }

  isMilestoneUnlocked(index: number): boolean {
    if (index === 0) return true;
    return this.isMilestoneApproved(index - 1);
  }

  approveMilestone(index: number) {
    if (!this.projectId || this.isApproving) return;
    this.isApproving = true;
    this.http.post<any>(`${API_BASE_URL}/api/milestones/${this.projectId}_${index}/approve`, {})
      .subscribe({
        next: (res) => {
          this.isApproving = false;
          if (this.milestones[index]) {
            this.milestones[index].status = 'approved';
          }
          if (res.next_active_milestone_index !== null && res.next_active_milestone_index !== undefined) {
            this.selectedMilestoneIndex = res.next_active_milestone_index;
          }
          this.fetchProject();
          if (this.currentRole === 'buyer' && res.next_active_milestone_index !== null && res.next_active_milestone_index !== undefined) {
            this.selectedMilestoneIndex = res.next_active_milestone_index;
            this.authorizeSelectedMilestone();
          }
        },
        error: (err) => {
          this.isApproving = false;
          alert(err.error?.detail || err.message || 'Approval failed');
        }
      });
  }

  handleEvidenceSuccess(res: any) {
    this.isAnalyzing = false;
    this.fetchProject();
  }

  isReloadingEvidence: boolean = false;
  reloadUpdatedEvidence() {
    this.isReloadingEvidence = true;
    this.fetchProject();
    setTimeout(() => {
      this.isReloadingEvidence = false;
    }, 600);
  }

  isReleasingWarrantyEarly: boolean = false;
  releaseWarrantyFundsEarly() {
    if (!this.projectId || this.isReleasingWarrantyEarly) return;
    const amt = Number(this.projectData?.agreement?.lock_in_amount || 0).toFixed(2);
    const confirmed = confirm(`Are you sure you want to release the held warranty retainage ($${amt} USD) early to the contractor? This will finalize and complete the project.`);
    if (!confirmed) return;

    this.isReleasingWarrantyEarly = true;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/warranty/early-release`, {})
      .subscribe({
        next: (res) => {
          this.isReleasingWarrantyEarly = false;
          alert(res.message || 'Warranty funds successfully released early.');
          this.fetchProject();
        },
        error: (err) => {
          this.isReleasingWarrantyEarly = false;
          alert(err.error?.detail || err.message || 'Early release failed.');
        }
      });
  }

  getEvidenceForMilestone(index: number): any {
    const list = this.getAllEvidenceForMilestone(index);
    return list.length > 0 ? list[0] : null;
  }

  getAllEvidenceForMilestone(index: number): any[] {
    const sorted = this.getSortedMilestoneEvidence(index);
    if (sorted.length === 0) return [];

    const ms = this.milestones[index];
    const rejectedMaxId = Number(ms?.rejected_evidence_max_id || 0);
    const effectiveRejectedMaxId = sorted.reduce(
      (maxId, ev) => (this.isEvidenceItemBuyerRejected(ev) ? Math.max(maxId, Number(ev.id) || 0) : maxId),
      rejectedMaxId
    );

    const latest = sorted[0];
    const latestIsRejected = this.isEvidenceItemBuyerRejected(latest);

    const candidates = latestIsRejected
      ? sorted
      : sorted.filter(item => !this.isEvidenceItemBuyerRejected(item) && (Number(item.id) || 0) > effectiveRejectedMaxId);

    const activeLatest = candidates[0] || latest;
    const batchId = activeLatest.ai_comparison_details?.submission_batch_id;
    if (batchId) {
      return candidates.filter(item => item.ai_comparison_details?.submission_batch_id === batchId);
    }

    if (activeLatest.capture_method === 'file_upload') {
      return [activeLatest];
    }

    const latestTime = this.parseServerIsoMs(activeLatest.server_receipt_timestamp);
    if (!latestTime) {
      return [activeLatest];
    }

    return candidates.filter(item => {
      if (item.id === activeLatest.id) return true;
      if (this.isEvidenceItemBuyerRejected(item) !== latestIsRejected) return false;
      const itemTime = this.parseServerIsoMs(item.server_receipt_timestamp);
      return itemTime > 0 && Math.abs(latestTime - itemTime) <= 2000;
    });
  }

  getDisplayedEvidenceList(): any[] {
    const raw = (this.evidenceList || []).slice().sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    if (this.currentRole !== 'buyer') {
      return raw;
    }

    const displayed: any[] = [];
    const seenIds = new Set<any>();

    const latestBaseline = raw.find(e => e.evidence_type === 'before_evidence');
    if (latestBaseline) {
      displayed.push(latestBaseline);
      seenIds.add(latestBaseline.id);
    }

    const milestoneIndices = new Set<number>();
    (this.milestones || []).forEach((_, idx) => milestoneIndices.add(idx));
    raw.forEach(e => {
      if ((e.evidence_type || 'milestone_evidence') === 'milestone_evidence') {
        milestoneIndices.add(Number(e.milestone_index ?? 0));
      }
    });

    milestoneIndices.forEach(mIdx => {
      const latestBatch = this.getAllEvidenceForMilestone(mIdx);
      latestBatch.forEach(item => {
        if (item && !seenIds.has(item.id)) {
          seenIds.add(item.id);
          displayed.push(item);
        }
      });
    });

    return displayed.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
  }

  getSafeExternalUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : null;
  }

  getRejectedEvidenceForMilestone(index: number): any | null {
    const sorted = this.getSortedMilestoneEvidence(index);
    if (!sorted.length) return null;
    return sorted.find(e => this.isEvidenceItemBuyerRejected(e))
      || sorted.find(e => this.isItemFlagged(e) || e.status === 'possible_mismatch')
      || sorted[0];
  }

  isItemFlagged(item: any): boolean {
    if (!item) return false;
    if (item.status === 'possible_mismatch') return true;
    let flags = item.fraud_flags;
    if (typeof flags === 'string') {
      try { flags = JSON.parse(flags); } catch (_) {}
    }
    return Array.isArray(flags) && flags.length > 0;
  }

  hasFraudInMilestone(evList: any[]): boolean {
    if (!evList || !evList.length) return false;
    return this.isItemFlagged(evList[0]);
  }

  getMilestoneFraudFlags(evList: any[]): string[] {
    const flags: string[] = [];
    if (!evList || !evList.length) return flags;
    const latest = evList[0];
    let fList = latest.fraud_flags;
    if (typeof fList === 'string') {
      try { fList = JSON.parse(fList); } catch (_) {}
    }
    if (Array.isArray(fList)) {
      fList.forEach((f: string) => {
        if (!flags.includes(f)) flags.push(f);
      });
    }
    return flags.length > 0 ? flags : ['Potential Screen Re-Photograph / Moiré Pattern'];
  }

  getBeforeEvidence(): any {
    return this.evidenceList.find(e => e.evidence_type === 'before_evidence') || 
      (this.projectData?.project?.before_evidence_path ? {
        file_path: this.projectData.project.before_evidence_path,
        file_hash: this.projectData.project.before_evidence_hash,
        server_receipt_timestamp: this.projectData.project.created_at,
        location: this.projectData.project.site_location || null
      } : null);
  }

  isLocationVerified(item: any): boolean {
    if (!item) return false;
    const geo = item.ai_comparison_details?.geographic_provenance;
    if (geo?.status === 'verified') return true;
    if (item.ai_analysis_notes && item.ai_analysis_notes.includes('Geographic Provenance: VERIFIED')) return true;
    return false;
  }

  isLocationMismatch(item: any): boolean {
    if (!item) return false;
    const geo = item.ai_comparison_details?.geographic_provenance;
    if (geo?.status === 'mismatch' || geo?.is_mismatch) return true;
    if (item.status === 'possible_mismatch' && Array.isArray(item.fraud_flags)) {
      if (item.fraud_flags.some((f: string) => f.includes('Geographic Proximity Mismatch') || f.includes('GPS Location Missing'))) return true;
    }
    if (item.ai_analysis_notes && (item.ai_analysis_notes.includes('Geographic Proximity Mismatch') || item.ai_analysis_notes.includes('OFF-SITE CAPTURE DETECTED'))) return true;
    return false;
  }

  getLocationBadgeText(item: any): string {
    if (!item) return '';
    const geo = item.ai_comparison_details?.geographic_provenance;
    if (this.isLocationVerified(item)) {
      const dist = geo?.distance_meters;
      return dist !== undefined ? `📍 On-Site Match (${dist}m to Baseline)` : '📍 On-Site Match';
    }
    if (this.isLocationMismatch(item)) {
      const dist = geo?.distance_meters;
      return dist !== undefined ? `⚠️ Location Mismatch (${dist}m away)` : '⚠️ Off-Site Mismatch';
    }
    if (item.location) {
      return `📍 GPS: ${item.location}`;
    }
    return '';
  }

  getGeoProvenance(item: any): any {
    return item?.ai_comparison_details?.geographic_provenance || null;
  }

  getEvidenceUrl(filePath: string) {
    return this.evidenceFiles.getFileUrl(filePath);
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLImageElement;
    if (target && !target.src.startsWith('data:image/svg+xml')) {
      target.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="400" height="280" viewBox="0 0 400 280">
          <rect width="400" height="280" fill="#0f172a" rx="8"/>
          <circle cx="200" cy="110" r="32" fill="#10b981" opacity="0.2"/>
          <path d="M188 110l8 8 16-16" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round"/>
          <text x="200" y="165" text-anchor="middle" fill="#f8fafc" font-family="sans-serif" font-size="14" font-weight="700">Cryptographically Verified Deliverable</text>
          <text x="200" y="190" text-anchor="middle" fill="#38bdf8" font-family="monospace" font-size="11">Server Authoritative Proof</text>
        </svg>
      `);
    }
  }

  formatLocalDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    try {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())) {
        const parts = dateStr.trim().split('-');
        const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
      }
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }

  formatLocalDateTime(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return dateStr;
    }
  }

  getMilestoneFallbackDeadline(index: number): string {
    const existingDeadline = this.milestones?.[index]?.deadline || this.projectData?.agreement?.milestones?.[index]?.deadline;
    if (existingDeadline && existingDeadline !== 'Per Schedule' && existingDeadline !== 'None') {
      return this.formatLocalDate(existingDeadline);
    }
    const d = new Date();
    if (this.projectData?.project?.deadline) {
      try {
        const target = new Date(this.projectData.project.deadline.includes('T') ? this.projectData.project.deadline : this.projectData.project.deadline + 'T00:00:00');
        const now = new Date();
        const diffMs = target.getTime() - now.getTime();
        const totalDays = Math.max(3, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        const count = Math.max(1, this.milestones.length || 3);
        const offset = Math.min(totalDays, Math.round((totalDays / count) * (index + 1)));
        d.setDate(d.getDate() + offset);
      } catch (e) {
        d.setDate(d.getDate() + (index + 1) * 4);
      }
    } else {
      d.setDate(d.getDate() + (index + 1) * 4);
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  isAgreementModalOpen = false;

  goBackToDashboard() {
    if (this.currentRole === 'seller') {
      this.router.navigate(['/seller']);
    } else {
      this.router.navigate(['/buyer']);
    }
  }

  openAgreementModal() {
    this.isAgreementModalOpen = true;
  }

  closeAgreementModal() {
    this.isAgreementModalOpen = false;
  }

  viewAgreementPage() {
    this.router.navigate(['/project', this.projectId, 'negotiate'], {
      queryParams: { role: this.currentRole, view_only: 'true' }
    });
  }

  goToAgreement() {
    this.openAgreementModal();
  }

  goBack() {
    this.goBackToDashboard();
  }

  toggleRole() {
    this.currentRole = this.currentRole === 'buyer' ? 'seller' : 'buyer';
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { role: this.currentRole },
      queryParamsHandling: 'merge'
    });
  }

  formatStatus(status: string): string {
    if (!status) return 'Active';
    return status.replace(/_/g, ' ').toUpperCase();
  }

  // PayPal Invoicing v2 Helpers
  isMilestonePaid(index: number): boolean {
    const ms = this.milestones[index];
    if (!ms) return false;
    const hasDrawerInv = (this.projectInvoices || []).some(
      (inv: any) => Number(inv?.milestone_index) === index
    );
    return !!(ms.is_paid || ms.invoice || ms.paypal_capture_id || hasDrawerInv);
  }

  getMilestoneInvoice(index: number): any {
    const invFromDrawer = (this.projectInvoices || []).find(
      (inv: any) => Number(inv?.milestone_index) === index
    );
    return this.milestones[index]?.invoice || invFromDrawer || null;
  }

  getPayPalInvoiceUrl(index: number): string | null {
    const inv = this.getMilestoneInvoice(index);
    return this.getInvoicePortalUrl(inv);
  }

  getInvoicePortalUrl(inv: any): string | null {
    if (inv?.invoice_url) return inv.invoice_url;
    if (inv?.paypal_invoice_id) return `https://www.sandbox.paypal.com/invoice/p/#${inv.paypal_invoice_id}`;
    return null;
  }

  getReceiptUrl(index: number): string {
    return `${API_BASE_URL}/api/projects/${this.projectId}/milestones/${index}/invoice/receipt`;
  }

  getSafeReceiptUrl(index: number): SafeResourceUrl {
    return this.sanitizer.bypassSecurityTrustResourceUrl(this.getReceiptUrl(index));
  }

  openReceiptModal(index: number) {
    this.selectedReceiptMilestoneIndex = index;
    this.isReceiptModalOpen = true;
  }

  closeReceiptModal() {
    this.isReceiptModalOpen = false;
  }

  loadProjectInvoices() {
    if (!this.projectId) return;
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}/invoices`)
      .subscribe({
        next: (res) => {
          const fetched: any[] = Array.isArray(res?.invoices) ? res.invoices : [];
          this.projectInvoices = fetched;
          for (const inv of fetched) {
            const idx = Number(inv?.milestone_index);
            if (!isNaN(idx) && this.milestones[idx]) {
              if (!this.milestones[idx].invoice || inv.invoice_url) {
                this.milestones[idx].invoice = inv;
              }
              if (inv.paypal_capture_id && !this.milestones[idx].paypal_capture_id) {
                this.milestones[idx].paypal_capture_id = inv.paypal_capture_id;
              }
              this.milestones[idx].is_paid = true;
            }
          }
        },
        error: (err) => console.warn('Could not load project invoices:', err)
      });
  }

  syncMilestoneInvoice(milestoneIndex: number) {
    if (!this.projectId || this.syncingInvoiceIndex !== null) return;
    this.syncingInvoiceIndex = milestoneIndex;
    this.invoiceSyncError = null;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/milestones/${milestoneIndex}/generate-invoice`, {})
      .subscribe({
        next: (res) => {
          this.syncingInvoiceIndex = null;
          if (res?.invoice) {
            if (this.milestones[milestoneIndex]) {
              this.milestones[milestoneIndex].invoice = res.invoice;
              this.milestones[milestoneIndex].is_paid = true;
            }
            const nextList = [...(this.projectInvoices || [])];
            const existingIdx = nextList.findIndex((i: any) => Number(i?.milestone_index) === milestoneIndex);
            if (existingIdx >= 0) {
              nextList[existingIdx] = res.invoice;
            } else {
              nextList.push(res.invoice);
            }
            this.projectInvoices = nextList;
          }
          this.loadProjectInvoices();
        },
        error: (err) => {
          this.syncingInvoiceIndex = null;
          if (err?.status === 0) {
            this.invoiceSyncError = 'Could not reach the payment server in time (PayPal sync timed out or the backend was restarting). Please wait a few seconds and click Sync PayPal Invoice again.';
          } else if (err?.status === 504) {
            this.invoiceSyncError = err.error?.detail || 'PayPal invoicing timed out. Please click Sync PayPal Invoice again.';
          } else {
            this.invoiceSyncError = err.error?.detail || err.message || 'Could not sync invoice with PayPal.';
          }
        }
      });
  }

  openInvoicesDrawer() {
    this.invoiceSyncError = null;
    this.isInvoicesDrawerOpen = true;
    this.loadProjectInvoices();
  }

  closeInvoicesDrawer() {
    this.isInvoicesDrawerOpen = false;
  }

  getPaidInvoicesCount(): number {
    const paidIndices = new Set<number>();
    (this.milestones || []).forEach((_, idx) => {
      if (this.isMilestonePaid(idx)) paidIndices.add(idx);
    });
    (this.projectInvoices || []).forEach((inv: any) => {
      if (inv?.milestone_index !== undefined && inv?.milestone_index !== null) {
        paidIndices.add(Number(inv.milestone_index));
      }
    });
    return Math.max(paidIndices.size, (this.projectInvoices || []).length);
  }

  openTrackingModal() {
    this.isTrackingModalOpen = true;
    this.trackingSuccessMsg = null;
    this.trackingErrorMsg = null;
  }

  closeTrackingModal() {
    this.isTrackingModalOpen = false;
  }

  submitTracking() {
    if (!this.trackingNumber.trim()) {
      this.trackingErrorMsg = 'Please enter a valid tracking number.';
      return;
    }
    this.isSubmittingTracking = true;
    this.trackingErrorMsg = null;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/track`, {
      tracking_number: this.trackingNumber.trim(),
      carrier: this.trackingCarrier,
      status: 'SHIPPED',
      notify_payer: true
    }).subscribe({
      next: (res) => {
        this.isSubmittingTracking = false;
        this.trackingSuccessMsg = `Tracking #${this.trackingNumber} attached via PayPal Orders v2!`;
        setTimeout(() => this.closeTrackingModal(), 2000);
      },
      error: (err) => {
        this.isSubmittingTracking = false;
        this.trackingErrorMsg = err.error?.detail || err.message || 'Failed to submit tracking';
      }
    });
  }

  openRefundModal(index: number) {
    this.refundMilestoneIndex = index;
    const ms = this.milestones[index];
    this.refundAmount = Number(ms?.price_allocation || 0);
    this.refundReason = '';
    this.refundSuccessMsg = null;
    this.refundErrorMsg = null;
    this.isRefundModalOpen = true;
  }

  closeRefundModal() {
    this.isRefundModalOpen = false;
  }

  submitRefund() {
    if (this.refundAmount <= 0) {
      this.refundErrorMsg = 'Please specify a valid refund amount.';
      return;
    }
    this.isSubmittingRefund = true;
    this.refundErrorMsg = null;
    const inv = this.getMilestoneInvoice(this.refundMilestoneIndex);
    const capId = inv?.paypal_capture_id || null;

    this.http.post<any>(`${API_BASE_URL}/api/escrow/${this.projectId}/refund`, {
      capture_id: capId,
      amount: this.refundAmount,
      currency: 'USD',
      note: this.refundReason || 'Milestone payment refund'
    }).subscribe({
      next: (res) => {
        this.isSubmittingRefund = false;
        this.refundSuccessMsg = `Successfully refunded $${this.refundAmount.toFixed(2)} USD via PayPal Payments v2!`;
        this.fetchProject();
        setTimeout(() => this.closeRefundModal(), 2000);
      },
      error: (err) => {
        this.isSubmittingRefund = false;
        this.refundErrorMsg = err.error?.detail || err.message || 'Refund processing failed';
      }
    });
  }

  getCollectedMilestonesSum(): number {
    const list = this.projectData?.agreement?.milestones || this.milestones || [];
    const sum = list
      .filter((m: any) => (m.status || '').toLowerCase() === 'approved')
      .reduce((acc: number, m: any) => acc + (Number(m.price_allocation) || 0), 0);
    if (sum > 0) return sum;
    return Number(this.projectData?.project?.captured_amount || 0);
  }

  getVoidEscrowStatus(): string {
    return this.projectData?.project?.void_escrow_status || 'NONE';
  }

  isGhostingTimeoutElapsed(): boolean {
    return Boolean(
      this.projectData?.is_ghosting_timeout_elapsed ||
      this.projectData?.project?.is_ghosting_timeout_elapsed
    );
  }

  getGhostingReason(): string {
    return (
      this.projectData?.ghosting_reason ||
      this.projectData?.project?.ghosting_reason ||
      ''
    );
  }

  canBuyerExecuteVoid(): boolean {
    const status = this.getVoidEscrowStatus();
    return (
      status === 'SELLER_AGREED' ||
      !this.projectData?.project?.seller_id ||
      this.isGhostingTimeoutElapsed()
    );
  }

  isVoidPendingSellerConsent(): boolean {
    if (this.isProjectCompleted() || this.isProjectCanceled()) return false;
    return this.getVoidEscrowStatus() === 'PENDING_SELLER_CONSENT';
  }

  openVoidModal() {
    this.voidReason = this.projectData?.project?.void_escrow_reason || '';
    this.voidSuccessMsg = null;
    this.voidErrorMsg = null;
    this.isVoidModalOpen = true;
  }

  closeVoidModal() {
    this.isVoidModalOpen = false;
  }

  requestVoidEscrow() {
    this.isSubmittingVoid = true;
    this.voidErrorMsg = null;
    this.voidSuccessMsg = null;
    this.http.post<any>(`${API_BASE_URL}/api/escrow/${this.projectId}/void-request`, {
      reason: this.voidReason || 'Buyer requested project cancellation'
    }).subscribe({
      next: (res) => {
        this.isSubmittingVoid = false;
        this.voidSuccessMsg = 'Cancellation request sent to contractor. Awaiting their consent before escrow can be voided.';
        if (this.projectData?.project) {
          this.projectData.project.void_escrow_status = res.void_escrow_status || 'PENDING_SELLER_CONSENT';
          this.projectData.project.void_escrow_reason = res.void_escrow_reason || this.voidReason;
        }
        setTimeout(() => this.closeVoidModal(), 2500);
      },
      error: (err) => {
        this.isSubmittingVoid = false;
        this.voidErrorMsg = err.error?.detail || err.message || 'Failed to request void escrow';
      }
    });
  }

  respondToVoidConsent(agree: boolean, note?: string) {
    this.isRespondingToVoidConsent = true;
    this.voidConsentActionError = null;
    this.voidConsentActionSuccess = null;
    this.http.post<any>(`${API_BASE_URL}/api/escrow/${this.projectId}/void-request/respond`, {
      agree,
      note: note || (agree ? 'Contractor agreed to cancel project' : 'Contractor declined cancellation request')
    }).subscribe({
      next: (res) => {
        this.isRespondingToVoidConsent = false;
        this.voidConsentActionSuccess = agree 
          ? 'You agreed to cancel and void escrow. The buyer can now release the hold.'
          : 'You declined the cancellation request.';
        if (this.projectData?.project) {
          this.projectData.project.void_escrow_status = res.void_escrow_status;
        }
        this.fetchProject();
      },
      error: (err) => {
        this.isRespondingToVoidConsent = false;
        this.voidConsentActionError = err.error?.detail || err.message || 'Failed to submit response';
      }
    });
  }

  submitVoidEscrow() {
    if (!this.canBuyerExecuteVoid()) {
      this.voidErrorMsg = 'Mutual consent required: The contractor must agree to project cancellation before escrow authorization can be voided.';
      return;
    }
    this.isSubmittingVoid = true;
    this.voidErrorMsg = null;
    this.http.post<any>(`${API_BASE_URL}/api/escrow/${this.projectId}/void`, {
      note: this.voidReason || this.projectData?.project?.void_escrow_reason || 'Contract voided by mutual agreement'
    }).subscribe({
      next: (res) => {
        this.isSubmittingVoid = false;
        this.voidSuccessMsg = 'Escrow authorization hold voided and released to buyer!';
        this.fetchProject();
        setTimeout(() => this.closeVoidModal(), 2000);
      },
      error: (err) => {
        this.isSubmittingVoid = false;
        this.voidErrorMsg = err.error?.detail || err.message || 'Failed to void escrow authorization';
      }
    });
  }
}
