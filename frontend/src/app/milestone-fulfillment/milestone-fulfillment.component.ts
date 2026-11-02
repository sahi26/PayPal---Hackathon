import { Component, OnInit } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_BASE_URL } from '../api.config';
import { LiveCameraComponent } from '../live-camera/live-camera.component';
import { RevisionRoomComponent, ScopeChangeItem } from '../revision-room/revision-room.component';

@Component({
  selector: 'app-milestone-fulfillment',
  standalone: true,
  imports: [CommonModule, FormsModule, LiveCameraComponent, RevisionRoomComponent],
  templateUrl: './milestone-fulfillment.component.html',
  styleUrl: './milestone-fulfillment.component.scss'
})
export class MilestoneFulfillmentComponent implements OnInit {
  Number = Number;
  projectId = 0;
  currentRole: 'seller' | 'buyer' = 'seller';
  projectData: any = null;
  milestones: any[] = [];
  selectedMilestoneIndex = 0;
  evidenceList: any[] = [];
  isLoading = true;

  // Digital Upload & AI Watermark Audit State
  digitalSubmissionMode: 'upload' | 'camera' = 'upload';
  selectedDigitalFile: File | null = null;
  digitalFilePreviewUrl: string | null = null;
  digitalAssetUrl: string = '';
  isUploadingDigitalFile = false;
  digitalUploadError: string | null = null;
  isDragOverDropzone = false;

  showRevisionRoom = false;
  activeScopeChange: ScopeChangeItem | null = null;
  isRefreshing = false;
  isApproving = false;

  // PayPal Invoicing v2 State
  isReceiptModalOpen = false;
  selectedReceiptMilestoneIndex = 0;
  isInvoicesDrawerOpen = false;
  projectInvoices: any[] = [];

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

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient,
    private sanitizer: DomSanitizer
  ) {}

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
        }
      }
      const token = q['token'];
      if (token && !this.isConfirmingAuth) {
        this.confirmPayPalEscrowHold(token);
      }
    });
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
    if (!p) return false;
    const s = (p.status || '').toLowerCase();
    return s === 'authorized' || s === 'partially_captured' || s === 'captured';
  }

  getPayPalApprovalUrl(): string | null {
    return this.projectData?.paypal_approval_url || this.projectData?.payment?.approval_url || null;
  }

  fetchProject() {
    this.isRefreshing = true;
    const start = Date.now();
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}`)
      .subscribe({
        next: (data) => {
          this.projectData = data;
          this.milestones = data.agreement?.milestones || [];
          this.activeScopeChange = data.active_scope_change || null;
          this.isLoading = false;
          this.loadProjectEvidence();

          // Auto-select first unapproved milestone
          for (let i = 0; i < this.milestones.length; i++) {
            if (!this.isMilestoneApproved(i)) {
              this.selectedMilestoneIndex = i;
              break;
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

  loadProjectEvidence() {
    if (!this.projectId) return;
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
    return s === 'accepted' || s === 'completed' || s === 'active' || s === 'work_in_progress' || s === 'warranty_period';
  }

  isWarrantyPeriodActive(): boolean {
    const s = (this.projectData?.project?.status || '').toUpperCase();
    const agStatus = (this.projectData?.agreement?.status || '').toUpperCase();
    return s === 'WARRANTY_PERIOD' || agStatus === 'WARRANTY_PERIOD';
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
    const domain = (this.projectData?.project?.project_domain || '').toLowerCase();
    if (domain === 'digital') return true;
    if (domain === 'physical') return false;
    const ind = (this.projectData?.project?.industry_type || '').toLowerCase();
    const title = (this.projectData?.project?.title || '').toLowerCase();
    return ind.includes('design') || ind.includes('software') || ind.includes('web') ||
           ind.includes('digital') || ind.includes('app') || ind.includes('graphic') ||
           title.includes('logo') || title.includes('app') || title.includes('digital') ||
           title.includes('software') || title.includes('design') || title.includes('branding');
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

  formatFileSize(bytes: number): string {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  isPreviewableImage(path: string): boolean {
    if (!path) return false;
    const p = path.toLowerCase();
    return p.endsWith('.png') || p.endsWith('.jpg') || p.endsWith('.jpeg') || p.endsWith('.webp') || p.endsWith('.svg');
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
    if (!isFraud) return '• Verified';
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
          this.selectedDigitalFile = null;
          this.digitalFilePreviewUrl = null;
          this.digitalAssetUrl = '';
          this.isRecapturing = false;
          this.fetchProject();
        },
        error: (err) => {
          this.isUploadingDigitalFile = false;
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

  isMilestoneResubmissionRequested(index: number): boolean {
    const ms = this.milestones[index];
    const st = (ms?.status || '').toLowerCase();
    return st === 'resubmission_requested' || st === 'rejected';
  }

  getMilestoneRejectionReason(index: number): string {
    const ms = this.milestones[index];
    return ms?.rejection_reason || 'Buyer requested updated evidence resubmission.';
  }

  selectMilestone(index: number) {
    this.selectedMilestoneIndex = index;
    this.isRecapturing = false;
  }

  isMilestoneFlagged(index: number): boolean {
    const list = this.getAllEvidenceForMilestone(index);
    return this.hasFraudInMilestone(list);
  }

  handleRecaptureSuccess(res: any) {
    this.isRecapturing = false;
    this.fetchProject();
  }

  isMilestoneApproved(index: number): boolean {
    const ms = this.milestones[index];
    return (ms?.status || '').toLowerCase() === 'approved';
  }

  isMilestoneAwaitingReview(index: number): boolean {
    const ms = this.milestones[index];
    if ((ms?.status || '').toLowerCase() === 'awaiting_buyer_review') return true;
    const ev = this.getEvidenceForMilestone(index);
    return !!ev && !this.isMilestoneApproved(index);
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
        },
        error: (err) => {
          this.isApproving = false;
          alert(err.error?.detail || err.message || 'Approval failed');
        }
      });
  }

  handleEvidenceSuccess(res: any) {
    this.fetchProject();
  }

  getEvidenceForMilestone(index: number): any {
    return this.evidenceList.find(e => e.evidence_type === 'milestone_evidence' && Number(e.milestone_index) === index);
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

  getEvidenceUrl(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    return `${API_BASE_URL}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
  }

  getMilestoneFallbackDeadline(index: number): string {
    const existingDeadline = this.milestones?.[index]?.deadline || this.projectData?.agreement?.milestones?.[index]?.deadline;
    if (existingDeadline && existingDeadline !== 'Per Schedule' && existingDeadline !== 'None') {
      return existingDeadline;
    }
    if (this.projectData?.project?.deadline) {
      try {
        const target = new Date(this.projectData.project.deadline);
        const now = new Date();
        const diffMs = target.getTime() - now.getTime();
        const totalDays = Math.max(3, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        const count = Math.max(1, this.milestones.length || 3);
        const offset = Math.min(totalDays, Math.round((totalDays / count) * (index + 1)));
        const d = new Date();
        d.setDate(d.getDate() + offset);
        return d.toISOString().split('T')[0];
      } catch (e) {}
    }
    const d = new Date();
    d.setDate(d.getDate() + (index + 1) * 4);
    return d.toISOString().split('T')[0];
  }

  goToAgreement() {
    this.router.navigate(['/project', this.projectId, 'negotiate'], { queryParams: { role: this.currentRole } });
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
    return !!(ms.is_paid || ms.invoice || ms.paypal_capture_id);
  }

  getMilestoneInvoice(index: number): any {
    return this.milestones[index]?.invoice || null;
  }

  getPayPalInvoiceUrl(index: number): string {
    const inv = this.getMilestoneInvoice(index);
    if (inv?.invoice_url) return inv.invoice_url;
    if (inv?.paypal_invoice_id) return `https://www.sandbox.paypal.com/invoice/p/#${inv.paypal_invoice_id}`;
    return 'https://www.sandbox.paypal.com';
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

  openInvoicesDrawer() {
    this.isInvoicesDrawerOpen = true;
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}/invoices`)
      .subscribe({
        next: (res) => {
          this.projectInvoices = res.invoices || [];
        },
        error: (err) => console.warn('Could not load project invoices:', err)
      });
  }

  closeInvoicesDrawer() {
    this.isInvoicesDrawerOpen = false;
  }

  getPaidInvoicesCount(): number {
    return (this.milestones || []).filter((_, idx) => this.isMilestonePaid(idx)).length;
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

  openVoidModal() {
    this.voidReason = '';
    this.voidSuccessMsg = null;
    this.voidErrorMsg = null;
    this.isVoidModalOpen = true;
  }

  closeVoidModal() {
    this.isVoidModalOpen = false;
  }

  submitVoidEscrow() {
    this.isSubmittingVoid = true;
    this.voidErrorMsg = null;
    this.http.post<any>(`${API_BASE_URL}/api/escrow/${this.projectId}/void`, {
      note: this.voidReason || 'Contract voided / cancelled'
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
