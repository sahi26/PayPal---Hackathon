import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_BASE_URL } from '../api.config';
import { EvidenceFileService } from '../evidence-file.service';
import { requiresDigitalWarrantyHold } from '../project-warranty.utils';
import { LiveCameraComponent } from '../live-camera/live-camera.component';
import { RevisionRoomComponent, ScopeChangeItem } from '../revision-room/revision-room.component';

interface MilestoneItem {
  title: string;
  description: string;
  price_allocation: number;
  proof_required: string;
  deadline?: string;
}

interface RegeneratePreview {
  contract_terms: string;
  evidence_requirements: string;
  summary_of_changes: string;
  project_deadline?: string;
  milestones?: MilestoneItem[];
}

@Component({
  selector: 'app-negotiation-room',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, LiveCameraComponent, RevisionRoomComponent],
  templateUrl: './negotiation-room.component.html',
  styleUrl: './negotiation-room.component.scss'
})
export class NegotiationRoomComponent implements OnInit {
  projectId = 0;
  isLoading = true;
  isSending = false;
  isAccepting = false;
  isRegenerating = false;
  isSavingTerms = false;
  termsUpdateSuccessBanner = false;

  // Contractor Agreement Rejection State
  isRejectModalOpen = false;
  rejectionReasonText = '';
  isSubmittingRejection = false;

  projectData: any = null;

  // Role: 'buyer' or 'seller' (detected from URL query param, default 'buyer')
  currentRole: 'buyer' | 'seller' = 'buyer';

  // Buyer AI Drafting Desk State
  buyerRevisionNote = '';
  regeneratedPreview: RegeneratePreview | null = null;

  // Seller Proposal Input
  sellerProposalMessage = '';

  // Evidence Desk State
  evidenceList: any[] = [];
  selectedMilestoneIndex = 0;

  getEvidenceForMilestone(index: number): any {
    return this.evidenceList.find(e => e.evidence_type === 'milestone_evidence' && Number(e.milestone_index) === index);
  }

  isMilestoneApproved(index: number): boolean {
    const ms = this.projectData?.agreement?.milestones?.[index];
    return (ms?.status || '').toLowerCase() === 'approved';
  }

  isMilestoneAwaitingReview(index: number): boolean {
    const ms = this.projectData?.agreement?.milestones?.[index];
    if ((ms?.status || '').toLowerCase() === 'awaiting_buyer_review') return true;
    const ev = this.getEvidenceForMilestone(index);
    return !!ev && !this.isMilestoneApproved(index);
  }

  isMilestoneUnlocked(index: number): boolean {
    if (index === 0) return true;
    return this.isMilestoneApproved(index - 1);
  }

  approveMilestone(index: number) {
    if (!this.projectId) return;
    this.http.post<any>(`${API_BASE_URL}/api/milestones/${this.projectId}_${index}/approve`, {})
      .subscribe({
        next: (res) => {
          if (this.projectData?.agreement?.milestones?.[index]) {
            this.projectData.agreement.milestones[index].status = 'approved';
          }
          if (res.next_active_milestone_index !== null && res.next_active_milestone_index !== undefined) {
            this.selectedMilestoneIndex = res.next_active_milestone_index;
          }
          this.fetchProject();
        },
        error: (err) => alert(err.error?.detail || err.message || 'Approval failed')
      });
  }

  getAllEvidenceForMilestone(index: number): any[] {
    return this.evidenceList.filter(e => e.evidence_type === 'milestone_evidence' && Number(e.milestone_index) === index);
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
        server_receipt_timestamp: this.projectData.project.created_at
      } : null);
  }

  isBeforeEvidenceExempt(): boolean {
    return this.projectData?.project?.before_evidence_status === 'exempt_no_evidence';
  }

  areAllMilestonesEvidenced(): boolean {
    const milestones = this.projectData?.agreement?.milestones || [];
    if (!milestones.length) return true;
    for (let i = 0; i < milestones.length; i++) {
      if (!this.getEvidenceForMilestone(i)) {
        return false;
      }
    }
    return true;
  }

  scrollToFulfillment(index: number) {
    this.selectedMilestoneIndex = index;
    const el = document.getElementById('fulfillment-desk');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  }

  showRevisionRoom = false;
  activeScopeChange: ScopeChangeItem | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private evidenceFiles: EvidenceFileService
  ) {}

  Number = Number; // Template helper
  Math = Math;
  userLockedMilestones: Set<number> = new Set<number>();
  private priceDebounceTimer: any = null;

  ngOnInit() {
    this.route.paramMap.subscribe(params => {
      this.projectId = Number(params.get('id')) || 0;
      if (this.projectId) {
        this.fetchProject();
      } else {
        this.isLoading = false;
      }
    });

    this.route.queryParams.subscribe(q => {
      if (q['role']) {
        const r = q['role'].toLowerCase();
        if (r === 'seller' || r === 'buyer') {
          this.currentRole = r;
          this.fetchProjectAlerts();
        }
      }
    });
  }

  private syncRoleWithProject(data: any) {
    const savedUser = localStorage.getItem('prooflens_user');
    let user: { email?: string; role_type?: string } | null = null;
    try {
      user = savedUser ? JSON.parse(savedUser) : null;
    } catch {
      user = null;
    }

    const email = user?.email?.trim().toLowerCase();
    const buyerEmail = data?.project?.buyer_email?.trim().toLowerCase();
    const sellerEmail = data?.project?.seller_email?.trim().toLowerCase();
    if (email && email === sellerEmail) {
      this.currentRole = 'seller';
    } else if (email && email === buyerEmail) {
      this.currentRole = 'buyer';
    } else if (!this.route.snapshot.queryParams['role']) {
      const role = user?.role_type?.toLowerCase();
      if (role === 'seller' || role === 'maker') this.currentRole = 'seller';
      else if (role === 'buyer' || role === 'customer') this.currentRole = 'buyer';
    }
  }

  isViewOnlyMode = false;

  fetchProject() {
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}`)
      .subscribe({
        next: (data) => {
          this.projectData = data;
          this.syncRoleWithProject(data);
          this.isLoading = false;

          // Phase 3 Route Guard:
          // If a user manually navigates to the Negotiation/Scope room for an ACTIVE project,
          // instantly redirect them to the Milestone Fulfillment route to prevent state corruption.
          const status = (data?.project?.status || '').toUpperCase();
          const isFulfillmentActive = ['ACTIVE', 'ACCEPTED', 'WARRANTY_PERIOD', 'COMPLETED', 'DISPUTED', 'FUNDS_AT_RISK', 'IN_REVIEW'].includes(status);
          const isExplicitViewOnly = this.route.snapshot.queryParams['view_only'] === 'true';

          if (isFulfillmentActive) {
            if (!isExplicitViewOnly) {
              this.router.navigate(['/project', this.projectId, 'fulfillment'], { queryParams: { role: this.currentRole } });
              return;
            } else {
              this.isViewOnlyMode = true;
            }
          }

          this.loadProjectEvidence();
          this.fetchProjectAlerts();
          this.fetchActiveScopeChange();
        },
        error: (err) => {
          this.isLoading = false;
          const msg = err.status === 0
            ? 'Network or authorization error. Please check your connection or re-login.'
            : (err.error?.detail || err.message || 'Unknown error');
          alert('Could not load project details: ' + msg);
        }
      });
  }

  goBack() {
    if (this.currentRole === 'seller') {
      this.router.navigate(['/seller']);
    } else {
      this.router.navigate(['/']);
    }
  }

  toggleRole() {
    this.currentRole = this.currentRole === 'buyer' ? 'seller' : 'buyer';
    this.fetchProjectAlerts();
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

  // --- Buyer AI Regeneration Workflow ---
  regenerateAgreementWithAi() {
    if (!this.buyerRevisionNote.trim() || this.isRegenerating) return;
    this.isRegenerating = true;
    this.termsUpdateSuccessBanner = false;

    const payload = {
      buyer_response: this.buyerRevisionNote.trim()
    };

    this.http.post<RegeneratePreview>(`${API_BASE_URL}/api/projects/${this.projectId}/regenerate-agreement`, payload)
      .subscribe({
        next: (res) => {
          this.isRegenerating = false;
          this.regeneratedPreview = res;
          // Dynamically reflect updated milestones, deadlines, and terms in left pane
          if (res.milestones && res.milestones.length > 0) {
            this.projectData.agreement.milestones = [...res.milestones];
          }
          if (res.contract_terms) {
            this.projectData.agreement.ai_generated_contract = res.contract_terms;
          }
          if (res.evidence_requirements) {
            this.projectData.agreement.evidence_requirements = res.evidence_requirements;
          }
          // Dynamically reflect updated deadline in the top header
          const effectiveDeadline = this.getEffectiveProjectDeadline();
          if (this.projectData?.project) {
            this.projectData.project.deadline = res.project_deadline || effectiveDeadline;
          }
        },
        error: (err) => {
          this.isRegenerating = false;
          alert('AI re-drafting failed: ' + (err.error?.detail || err.message));
        }
      });
  }

  canBuyerEditAgreement(): boolean {
    if (this.currentRole !== 'buyer') return false;
    const projStatus = (this.projectData?.project?.status || '').toLowerCase();
    const agrStatus = (this.projectData?.agreement?.status || '').toLowerCase();
    if (['accepted', 'active', 'completed', 'warranty_period'].includes(projStatus)) return false;
    if (agrStatus === 'accepted' || this.projectData?.agreement?.is_accepted_by_client === 1) return false;
    return true;
  }

  sendUpdatedTermsToSeller() {
    if (!this.canBuyerEditAgreement()) {
      alert('Agreement terms are locked and cannot be edited.');
      return;
    }
    if (!this.regeneratedPreview || this.isSavingTerms) return;
    this.isSavingTerms = true;

    const payload = {
      contract_terms: this.regeneratedPreview.contract_terms,
      evidence_requirements: this.regeneratedPreview.evidence_requirements,
      buyer_message: this.buyerRevisionNote.trim(),
      milestones: this.regeneratedPreview.milestones || this.projectData.agreement.milestones,
      role: this.currentRole
    };

    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/update-terms`, payload)
      .subscribe({
        next: (res) => {
          this.isSavingTerms = false;
          // Apply new terms to local view
          this.projectData.agreement.ai_generated_contract = res.contract_terms;
          this.projectData.agreement.evidence_requirements = res.evidence_requirements;
          this.projectData.agreement.version = res.version;
          this.projectData.agreement.latest_buyer_message = res.latest_buyer_message;
          if (res.milestones) {
            this.projectData.agreement.milestones = res.milestones;
          }
          this.projectData.project.status = res.status;
          const effective = this.getEffectiveProjectDeadline();
          if (this.projectData?.project) {
            this.projectData.project.deadline = res.project_deadline || effective;
          }

          // Clear preview and revision input
          this.regeneratedPreview = null;
          this.buyerRevisionNote = '';
          this.termsUpdateSuccessBanner = true;
          this.fetchProject();
        },
        error: (err) => {
          this.isSavingTerms = false;
          alert('Failed to dispatch updated terms: ' + (err.error?.detail || err.message));
        }
      });
  }

  // --- Seller Proposal Workflow ---
  sendSellerProposal() {
    if (!this.sellerProposalMessage.trim() || this.isSending) return;
    this.isSending = true;

    const payload = {
      message: this.sellerProposalMessage.trim(),
      role: 'seller'
    };

    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/negotiate`, payload)
      .subscribe({
        next: (res) => {
          this.isSending = false;
          this.projectData.agreement.latest_seller_message = this.sellerProposalMessage.trim();
          this.projectData.agreement.latest_buyer_message = null;
          this.projectData.agreement.version = res.version;
          this.projectData.project.status = res.status;
          this.sellerProposalMessage = '';
          this.fetchProject();
          alert('Your change request has been transmitted to the buyer.');
        },
        error: (err) => {
          this.isSending = false;
          alert('Failed to send negotiation message: ' + (err.error?.detail || err.message));
        }
      });
  }

  acceptAgreement() {
    this.isAccepting = true;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/accept`, {})
      .subscribe({
        next: (res) => {
          this.isAccepting = false;
          this.projectData.project.status = 'accepted';
          if (res?.approval_url) {
            this.projectData.paypal_approval_url = res.approval_url;
            if (this.projectData.payment) {
              this.projectData.payment.approval_url = res.approval_url;
            }
          }
          this.fetchProjectAlerts();

          // Defect 2.2 Fix: If user is buyer and PayPal approval URL exists, launch PayPal checkout
          if (this.currentRole === 'buyer' && res?.approval_url) {
            window.location.href = res.approval_url;
          } else {
            this.goToFulfillment();
          }
        },
        error: (err) => {
          this.isAccepting = false;
          alert('Failed to accept agreement: ' + (err.error?.detail || err.message));
        }
      });
  }

  authorizeEscrowDeposit() {
    const approvalUrl = this.getPayPalApprovalUrl();
    if (approvalUrl) {
      window.location.href = approvalUrl;
      return;
    }

    this.isAccepting = true;
    this.http.post<any>(`${API_BASE_URL}/api/payments/authorize`, {
      project_id: this.projectId,
      milestone_index: 0,
      currency: 'USD',
      return_url: `${window.location.origin}/project/${this.projectId}/fulfillment?role=buyer`,
      cancel_url: `${window.location.origin}/project/${this.projectId}/fulfillment?role=buyer&paypal_cancelled=1`
    }).subscribe({
      next: (res) => {
        this.isAccepting = false;
        if (res?.approval_url) {
          window.location.href = res.approval_url;
        } else {
          this.goToFulfillment();
        }
      },
      error: (err) => {
        this.isAccepting = false;
        alert('Failed to launch PayPal escrow authorization: ' + (err.error?.detail || err.message));
      }
    });
  }

  isEscrowAuthorized(): boolean {
    const projectStatus = (this.projectData?.project?.status || '').toLowerCase();
    if (['active', 'warranty_period', 'completed'].includes(projectStatus)) return true;
    const p = this.projectData?.payment;
    if (!p || Number(p.milestone_index) !== 0) return false;
    const s = (p.status || '').toLowerCase();
    return s === 'authorized' || s === 'reauthorized';
  }

  getFirstMilestoneAmount(): number {
    return Number(this.projectData?.agreement?.milestones?.[0]?.price_allocation || 0);
  }

  getPayPalApprovalUrl(): string | null {
    return this.projectData?.paypal_approval_url || this.projectData?.payment?.approval_url || null;
  }

  goToFulfillment() {
    this.router.navigate(['/project', this.projectId, 'fulfillment'], { queryParams: { role: this.currentRole } });
  }

  activeAlert: any = null;

  isSellerAccepted(): boolean {
    if (!this.projectData) return false;
    const projStatus = (this.projectData?.project?.status || '').toLowerCase();
    const agrStatus = (this.projectData?.agreement?.status || '').toLowerCase();
    const isAcceptedFlag = this.projectData?.agreement?.is_accepted_by_client === 1 || this.projectData?.agreement?.is_accepted_by_client === true;

    // In pre-acceptance phases, the seller/contractor has NOT accepted terms yet
    if (['draft', 'invite_sent', 'negotiating', 'seller_joined', 'rejected'].includes(projStatus)) {
      return false;
    }

    return ['accepted', 'active', 'warranty_period', 'completed', 'disputed', 'funds_at_risk', 'in_review'].includes(projStatus) ||
           agrStatus === 'accepted' || isAcceptedFlag;
  }

  isProjectActive(): boolean {
    return this.isSellerAccepted();
  }

  fetchActiveScopeChange() {
    if (!this.projectId) return;
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}/scope-change/active`)
      .subscribe({
        next: (res) => {
          if (res?.has_active_request && res.scope_change) {
            this.activeScopeChange = res.scope_change;
          } else {
            this.activeScopeChange = null;
          }
        },
        error: () => {
          this.activeScopeChange = null;
        }
      });
  }

  openRevisionRoom() {
    this.showRevisionRoom = true;
  }

  closeRevisionRoom() {
    this.showRevisionRoom = false;
    this.fetchActiveScopeChange();
  }

  onScopeChangeAccepted(event: any) {
    if (event?.milestones && Array.isArray(event.milestones)) {
      if (this.projectData?.agreement) {
        this.projectData.agreement.milestones = event.milestones;
        if (event.agreement_version) {
          this.projectData.agreement.version = event.agreement_version;
        }
      }
    }
    if (this.projectData?.project && event.project?.deadline) {
      this.projectData.project.deadline = event.project.deadline;
    }
    if (this.projectData?.project && event.project?.total_price) {
      this.projectData.project.total_price = event.project.total_price;
    }
    this.showRevisionRoom = false;
    this.fetchProject();
  }

  getEffectiveProjectDeadline(): string {
    const msList = this.projectData?.agreement?.milestones;
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

  onMilestoneDateChanged(index: number, newDeadline: string) {
    if (!this.canBuyerEditAgreement()) return;
    if (!this.projectData?.agreement?.milestones?.[index] || !newDeadline) return;
    this.projectData.agreement.milestones[index].deadline = newDeadline;
    const effective = this.getEffectiveProjectDeadline();
    if (this.projectData?.project) {
      this.projectData.project.deadline = effective;
    }
    this.scheduleMilestonesSave();
  }

  getTotalBudget(): number {
    return Number(this.projectData?.project?.total_price || 0);
  }

  getAvailableBudgetForMilestones(): number {
    const total = this.getTotalBudget();
    const lockInType = this.projectData?.agreement?.lock_in_type || 'NONE';
    const lockInAmt = Number(this.projectData?.agreement?.lock_in_amount) || 0;
    if (lockInType === 'CUSTOM') {
      return Math.max(0, Math.round((total - lockInAmt) * 100) / 100);
    }
    return total;
  }

  getAllocatedMilestonesTotal(): number {
    const msList = this.projectData?.agreement?.milestones || [];
    const sum = msList.reduce((acc: number, m: any) => acc + Number(m.price_allocation || 0), 0);
    return Math.round(sum * 100) / 100;
  }

  isBudgetBalanced(): boolean {
    const total = this.getTotalBudget();
    const lockInType = this.projectData?.agreement?.lock_in_type || 'NONE';
    const lockInAmt = Number(this.projectData?.agreement?.lock_in_amount) || 0;
    const allocated = this.getAllocatedMilestonesTotal();

    if (lockInType === 'CUSTOM') {
      return Math.abs(total - (allocated + lockInAmt)) <= 0.25;
    }
    return Math.abs(total - allocated) <= 0.25;
  }

  setLockInType(type: 'NONE' | 'FINAL_MILESTONE' | 'CUSTOM') {
    if (!this.canBuyerEditAgreement()) return;
    if (!this.projectData?.agreement) return;
    if (this.isSimpleDigitalProject()) return;
    this.projectData.agreement.lock_in_type = type;
    const budget = this.getTotalBudget();
    if (type === 'NONE') {
      this.projectData.agreement.lock_in_amount = 0;
      this.projectData.agreement.lock_in_days = 0;
    } else if (type === 'FINAL_MILESTONE') {
      const msList = this.projectData.agreement.milestones || [];
      const finalAmt = msList.length > 0 ? Number(msList[msList.length - 1].price_allocation || 0) : 0;
      this.projectData.agreement.lock_in_amount = finalAmt;
      this.projectData.agreement.lock_in_days = this.projectData.agreement.lock_in_days || 14;
    } else if (type === 'CUSTOM') {
      let curr = Number(this.projectData.agreement.lock_in_amount) || 0;
      if (curr <= 0 || curr >= budget) {
        curr = Math.round(budget * 0.1) || 50;
      }
      this.projectData.agreement.lock_in_amount = curr;
      this.projectData.agreement.lock_in_days = this.projectData.agreement.lock_in_days || 14;
    }
    this.saveMilestonesToBackend();
  }

  updateLockInDays(days: any) {
    if (!this.canBuyerEditAgreement()) return;
    if (!this.projectData?.agreement) return;
    if (this.isSimpleDigitalProject()) return;
    this.projectData.agreement.lock_in_days = Number(days) || 14;
    this.saveMilestonesToBackend();
  }

  updateCustomLockInAmount(amount: any) {
    if (!this.canBuyerEditAgreement()) return;
    if (!this.projectData?.agreement) return;
    if (this.isSimpleDigitalProject()) return;
    this.projectData.agreement.lock_in_amount = Number(amount) || 0;
    this.saveMilestonesToBackend();
  }

  isSimpleDigitalProject(): boolean {
    const project = this.projectData?.project;
    if (!project || (project.project_domain || '').toLowerCase() !== 'digital') return false;
    return !requiresDigitalWarrantyHold(project.title, project.industry_type, project.description);
  }

  isMilestoneFundReleased(ms: any, index: number): boolean {
    if (!ms) return false;
    return ms.is_paid === true ||
           (ms.status || '').toLowerCase() === 'released' ||
           (ms.status || '').toLowerCase() === 'paid';
  }

  onMilestonePriceChanged(index: number, newPriceInput: any) {
    if (!this.canBuyerEditAgreement()) return;
    const msList = this.projectData?.agreement?.milestones;
    if (!msList || !msList[index]) return;

    const totalBudget = this.getAvailableBudgetForMilestones();
    if (totalBudget <= 0) return;

    let parsedPrice = parseFloat(newPriceInput);
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      parsedPrice = 0;
    }
    parsedPrice = Math.min(totalBudget, Math.round(parsedPrice * 100) / 100);

    // Lock this milestone as user-modified
    this.userLockedMilestones.add(index);
    msList[index].price_allocation = parsedPrice;

    // Collect released vs unreleased indices
    const releasedIndices: number[] = [];
    const unreleasedIndices: number[] = [];
    for (let i = 0; i < msList.length; i++) {
      if (this.isMilestoneFundReleased(msList[i], i)) {
        releasedIndices.push(i);
      } else {
        unreleasedIndices.push(i);
      }
    }

    const releasedTotal = releasedIndices.reduce((acc, i) => acc + Number(msList[i].price_allocation || 0), 0);
    const availableForUnreleased = Math.max(0, totalBudget - releasedTotal);

    // Floating milestones: unreleased and not yet locked by user
    let floatingIndices = unreleasedIndices.filter(i => !this.userLockedMilestones.has(i));

    // If user has locked all unreleased milestones, free up the other unreleased milestones to balance
    if (floatingIndices.length === 0) {
      this.userLockedMilestones.clear();
      this.userLockedMilestones.add(index);
      floatingIndices = unreleasedIndices.filter(i => i !== index);
    }

    if (floatingIndices.length > 0) {
      const lockedSum = unreleasedIndices
        .filter(i => this.userLockedMilestones.has(i))
        .reduce((acc, i) => acc + Number(msList[i].price_allocation || 0), 0);

      const budgetForFloating = Math.max(0, availableForUnreleased - lockedSum);
      const prevFloatingSum = floatingIndices.reduce((acc, i) => acc + Math.max(0, Number(msList[i].price_allocation || 0)), 0);

      let allocatedToFloating = 0;
      for (let k = 0; k < floatingIndices.length; k++) {
        const fi = floatingIndices[k];
        if (k === floatingIndices.length - 1) {
          const finalSlice = Math.max(0, Math.round((budgetForFloating - allocatedToFloating) * 100) / 100);
          msList[fi].price_allocation = finalSlice;
        } else {
          let slice = 0;
          if (prevFloatingSum > 0) {
            const ratio = Math.max(0, Number(msList[fi].price_allocation || 0)) / prevFloatingSum;
            slice = Math.round(budgetForFloating * ratio * 100) / 100;
          } else {
            slice = Math.floor((budgetForFloating / floatingIndices.length) * 100) / 100;
          }
          msList[fi].price_allocation = slice;
          allocatedToFloating += slice;
        }
      }
    }

    // Cent rounding correction to ensure sum === totalBudget
    const currentTotal = msList.reduce((acc: number, m: any) => acc + Number(m.price_allocation || 0), 0);
    const discrepancy = Math.round((totalBudget - currentTotal) * 100) / 100;
    if (Math.abs(discrepancy) > 0 && Math.abs(discrepancy) < 1.0) {
      const targetAdjustIdx = floatingIndices.length > 0 ? floatingIndices[floatingIndices.length - 1] : (unreleasedIndices.find(i => i !== index) ?? index);
      msList[targetAdjustIdx].price_allocation = Math.max(0, Math.round((msList[targetAdjustIdx].price_allocation + discrepancy) * 100) / 100);
    }

    this.scheduleMilestonesSave();
  }

  resetMilestonesToEqualSplit() {
    if (!this.canBuyerEditAgreement()) return;
    const msList = this.projectData?.agreement?.milestones;
    if (!msList || msList.length === 0) return;
    const totalBudget = this.getTotalBudget();

    this.userLockedMilestones.clear();

    const releasedIndices: number[] = [];
    const unreleasedIndices: number[] = [];
    for (let i = 0; i < msList.length; i++) {
      if (this.isMilestoneFundReleased(msList[i], i)) {
        releasedIndices.push(i);
      } else {
        unreleasedIndices.push(i);
      }
    }

    if (unreleasedIndices.length === 0) return;

    const releasedTotal = releasedIndices.reduce((acc, i) => acc + Number(msList[i].price_allocation || 0), 0);
    const available = Math.max(0, totalBudget - releasedTotal);
    const perMilestone = Math.floor((available / unreleasedIndices.length) * 100) / 100;

    let allocated = 0;
    for (let k = 0; k < unreleasedIndices.length; k++) {
      const idx = unreleasedIndices[k];
      if (k === unreleasedIndices.length - 1) {
        msList[idx].price_allocation = Math.max(0, Math.round((available - allocated) * 100) / 100);
      } else {
        msList[idx].price_allocation = perMilestone;
        allocated += perMilestone;
      }
    }

    this.scheduleMilestonesSave();
  }

  scheduleMilestonesSave() {
    if (this.priceDebounceTimer) {
      clearTimeout(this.priceDebounceTimer);
    }
    this.priceDebounceTimer = setTimeout(() => {
      this.saveMilestonesToBackend();
    }, 600);
  }

  saveMilestonesToBackend() {
    if (!this.canBuyerEditAgreement()) return;
    if (!this.projectId || !this.projectData?.agreement?.milestones) return;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/update-milestones`, {
      milestones: this.projectData.agreement.milestones,
      lock_in_type: this.isSimpleDigitalProject() ? 'NONE' : (this.projectData.agreement.lock_in_type || 'NONE'),
      lock_in_amount: this.isSimpleDigitalProject() ? 0 : (Number(this.projectData.agreement.lock_in_amount) || 0),
      lock_in_days: this.isSimpleDigitalProject() ? 0 : (Number(this.projectData.agreement.lock_in_days) || 0),
      role: this.currentRole
    }).subscribe({
      next: () => {},
      error: (err) => {
        console.warn('Failed to auto-save milestone allocations:', err);
      }
    });
  }

  getMilestoneFallbackDeadline(index: number): string {
    const existingDeadline = this.projectData?.agreement?.milestones?.[index]?.deadline;
    if (existingDeadline && existingDeadline !== 'Per Schedule' && existingDeadline !== 'None') {
      return existingDeadline;
    }
    const parseLocalDate = (value: string): Date => {
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
      return match
        ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
        : new Date(value);
    };
    const project = this.projectData?.project;
    const created = project?.created_at ? parseLocalDate(project.created_at) : new Date();
    const start = new Date(created.getFullYear(), created.getMonth(), created.getDate() + 1);
    const target = project?.deadline ? parseLocalDate(project.deadline) : null;
    const milestoneCount = Math.max(1, this.projectData?.agreement?.milestones?.length || 1);
    const totalDays = target && !isNaN(target.getTime())
      ? Math.max(1, Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1)
      : (index + 1) * 4;
    const count = Math.max(1, Math.min(milestoneCount, totalDays));
    const offset = Math.min(totalDays - 1, Math.ceil((totalDays / count) * (index + 1)) - 1);
    start.setDate(start.getDate() + offset);
    return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
  }

  fetchProjectAlerts() {
    if (!this.projectId || this.currentRole !== 'seller') {
      this.activeAlert = null;
      return;
    }
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}/alerts`)
      .subscribe({
        next: (res) => {
          if (res && res.has_alert && this.isProjectActive()) {
            this.activeAlert = res;
          } else {
            this.activeAlert = null;
          }
        },
        error: (err) => console.warn('Milestone alert check notice:', err)
      });
  }

  // --- Cryptographic Evidence Desk Methods ---
  loadProjectEvidence() {
    if (!this.projectId) return;
    this.http.get<any[]>(`${API_BASE_URL}/api/projects/${this.projectId}/evidence`)
      .subscribe({
        next: (data) => {
          this.evidenceList = data || [];
        },
        error: (err) => {
          console.error('Failed to load project evidence:', err);
        }
      });
  }

  handleEvidenceSuccess(res: any) {
    this.loadProjectEvidence();
  }

  getEvidenceUrl(filePath: string) {
    return this.evidenceFiles.getFileUrl(filePath);
  }

  // Contractor Rejection Methods
  openRejectModal() {
    this.rejectionReasonText = '';
    this.isRejectModalOpen = true;
  }

  closeRejectModal() {
    this.isRejectModalOpen = false;
    this.rejectionReasonText = '';
  }

  addQuickReason(reason: string) {
    if (!this.rejectionReasonText) {
      this.rejectionReasonText = reason;
    } else if (!this.rejectionReasonText.includes(reason)) {
      this.rejectionReasonText = this.rejectionReasonText.trim() + ' ' + reason;
    }
  }

  submitAgreementRejection() {
    const trimmed = this.rejectionReasonText.trim();
    if (!trimmed || !this.projectId) return;

    this.isSubmittingRejection = true;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/reject`, {
      reason: trimmed,
      role: 'seller'
    }).subscribe({
      next: (res) => {
        this.isSubmittingRejection = false;
        this.isRejectModalOpen = false;
        if (this.projectData?.project) {
          this.projectData.project.status = 'rejected';
          this.projectData.project.contractor_rejection_reason = trimmed;
        }
        if (this.projectData?.agreement) {
          this.projectData.agreement.status = 'REJECTED';
          this.projectData.agreement.rejection_reason = trimmed;
          this.projectData.agreement.latest_seller_message = `AGREEMENT REJECTED: ${trimmed}`;
        }
        alert('Agreement terms rejected. Your detailed feedback was sent to the buyer.');
        if (this.currentRole === 'seller') {
          this.router.navigate(['/seller']);
        } else {
          this.router.navigate(['/buyer']);
        }
      },
      error: (err) => {
        this.isSubmittingRejection = false;
        alert('Failed to reject agreement: ' + (err.error?.detail || err.message));
      }
    });
  }

  isProjectRejected(): boolean {
    const s = (this.projectData?.project?.status || '').toLowerCase();
    return s === 'rejected';
  }

  getContractorRejectionReason(): string {
    return this.projectData?.project?.contractor_rejection_reason ||
      this.projectData?.agreement?.rejection_reason ||
      'Contractor requested adjustments to scope, pricing, or milestone schedule.';
  }

}
