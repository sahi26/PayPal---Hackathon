import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { API_BASE_URL } from '../api.config';
import { EvidenceFileService } from '../evidence-file.service';
import { requiresDigitalWarrantyHold } from '../project-warranty.utils';
import { LiveCameraComponent } from '../live-camera/live-camera.component';

interface ChatMsg {
  role: 'assistant' | 'user';
  content: string;
}

interface MilestoneItem {
  title: string;
  description: string;
  price_allocation: number;
  proof_required: string;
  deadline?: string;
  relative_deadline?: string;
  status?: string;
}

interface DraftChatResponse {
  status: 'asking' | 'complete';
  ai_response_text: string;
  milestones: MilestoneItem[];
  requires_baseline_evidence?: boolean;
  project_domain?: 'physical' | 'digital';
  is_renovation?: boolean;
  warranty_days?: number;
}

@Component({
  selector: 'app-buyer-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, LiveCameraComponent],
  templateUrl: './buyer-wizard.component.html',
  styleUrl: './buyer-wizard.component.scss'
})
export class BuyerWizardComponent implements OnInit {
  step = 1;
  isLoading = false;
  errorMessage = '';

  // Step 1 Project Inputs (Empty by default with pure placeholders)
  title = '';
  industryType = '';
  totalPrice: number | null = null;
  deadline = '';
  buyerEmail = '';
  description = '';

  // State
  projectId: number | null = null;
  inviteToken = '';
  inviteUrl = '';
  copyBtnText = 'Copy Link';
  paymentStatusMessage = '';
  aiWarrantyDays: number | null = null;
  private handledPaypalCallback = false;

  // Step 2 Chat & Milestones
  userMessage = '';
  chatMessages: ChatMsg[] = [];
  isDraftComplete = false;
  milestones: MilestoneItem[] = [];

  // Before Evidence State
  projectDomain: 'physical' | 'digital' = 'physical';
  isRenovation = false;
  digitalAssetFile: File | null = null;
  digitalAssetUrl = '';
  isUploadingDigitalAsset = false;
  uploadError = '';

  beforeEvidenceCaptured = false;
  beforeEvidenceExempt = false;
  beforeEvidenceItem: any = null;
  isDeclaringExemption = false;
  requiresBaselineEvidence = false;
  baselineEvidenceBlocked = false;
  baselineBlockedMessage = '';
  isShowingLiveCamera = false;

  // Reactive Form for Warranty Lock-In (Retainage)
  warrantyForm: FormGroup;

  constructor(
    private http: HttpClient,
    private router: Router,
    private route: ActivatedRoute,
    private fb: FormBuilder,
    private evidenceFiles: EvidenceFileService
  ) {
    this.warrantyForm = this.fb.group({
      lockInType: ['NONE', Validators.required],
      lockInAmount: [0, [Validators.min(0)]]
    });
  }

  ngOnInit(): void {
    try {
      const stored = localStorage.getItem('prooflens_user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u.email && !this.buyerEmail) {
          this.buyerEmail = u.email.trim();
        }
      }
    } catch (_) {}

    this.route.queryParamMap.subscribe(params => {
      const projectId = Number(params.get('project_id'));
      if (!Number.isInteger(projectId) || projectId <= 0) return;

      this.projectId = projectId;
      const token = params.get('token') || params.get('order_id');
      const paypalReturned = params.get('paypal_return') === '1';
      const paypalCancelled = params.get('paypal_cancelled') === '1';

      if (paypalReturned && token && !this.handledPaypalCallback) {
        this.handledPaypalCallback = true;
        this.isLoading = true;
        this.paymentStatusMessage = 'Confirming PayPal escrow authorization...';
        this.loadProject(projectId, () => this.confirmEscrowAuthorization(token));
      } else if (paypalReturned && !token) {
        this.paymentStatusMessage = 'PayPal returned without an order token. Retry escrow authorization.';
        this.step = 3;
        this.clearPaypalReturnParams(projectId);
      } else if (paypalCancelled) {
        this.loadProject(projectId, () => {
          this.paymentStatusMessage = 'PayPal authorization was not completed. Retry escrow authorization to create the seller invitation.';
          this.step = 3;
          this.clearPaypalReturnParams(projectId);
        });
      } else {
        this.loadProject(projectId, () => {
          if (this.inviteToken) {
            this.inviteUrl = `${window.location.origin}/invite/${this.inviteToken}`;
            this.step = 3;
          }
        });
      }
    });
  }

  private loadProject(projectId: number, onLoaded: () => void): void {
    this.http.get<any>(`${API_BASE_URL}/api/projects/${projectId}`).subscribe({
      next: (res) => {
        const project = res?.project || {};
        this.title = project.title || this.title;
        this.industryType = project.industry_type || this.industryType;
        this.description = project.description || this.description;
        this.totalPrice = Number(project.total_price ?? this.totalPrice) || 0;
        this.deadline = project.deadline || this.deadline;
        this.projectId = project.id || projectId;
        this.projectDomain = project.project_domain || this.projectDomain;
        this.isRenovation = !!project.is_renovation;
        this.inviteToken = project.invite_token || '';
        this.milestones = res?.agreement?.milestones || this.milestones;
        onLoaded();
      },
      error: (err) => {
        this.isLoading = false;
        this.errorMessage = err.error?.detail || err.message || 'Could not load project after PayPal checkout.';
        this.paymentStatusMessage = this.errorMessage;
        this.step = 3;
      }
    });
  }

  private confirmEscrowAuthorization(token: string): void {
    this.http.post<any>(
      `${API_BASE_URL}/api/escrow/confirm-authorization?order_id=${encodeURIComponent(token)}`,
      {}
    ).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.inviteUrl = res?.seller_invite_link || '';
        this.inviteToken = this.inviteUrl.split('/').pop() || '';
        this.step = 3;
        this.paymentStatusMessage = this.inviteUrl
          ? 'Escrow is authorized. Your seller invitation is ready.'
          : 'Escrow authorization is confirmed.';
        this.clearPaypalReturnParams(this.projectId);
      },
      error: (err) => {
        this.isLoading = false;
        this.paymentStatusMessage = err.error?.detail || err.message || 'PayPal authorization could not be confirmed.';
        this.step = 3;
        this.clearPaypalReturnParams(this.projectId);
      }
    });
  }

  private clearPaypalReturnParams(projectId: number | null): void {
    if (!projectId) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { project_id: projectId },
      replaceUrl: true
    });
  }

  isHomeRenovation(): boolean {
    if (this.isRenovation) return true;
    const text = `${this.title || ''} ${this.industryType || ''} ${this.description || ''}`.toLowerCase();
    const keywords = ['renovat', 'remodel', 'home renovation', 'bath', 'bathroom', 'kitchen', 'plumb', 'drywall', 'tile', 'flooring', 'paint', 'roof', 'house'];
    return keywords.some(k => text.includes(k));
  }

  onLockInTypeSelect(type: 'NONE' | 'FINAL_MILESTONE' | 'CUSTOM') {
    if (this.isSimpleDigitalProject()) {
      this.warrantyForm.patchValue({ lockInType: 'NONE', lockInAmount: 0 });
      return;
    }
    this.warrantyForm.patchValue({ lockInType: type });
    if (type === 'NONE') {
      this.warrantyForm.patchValue({ lockInAmount: 0 });
    } else if (type === 'FINAL_MILESTONE') {
      const finalAmt = this.getFinalMilestoneAmount();
      this.warrantyForm.patchValue({
        lockInAmount: finalAmt
      });
    } else if (type === 'CUSTOM') {
      const budget = Number(this.totalPrice) || 0;
      let curr = Number(this.warrantyForm.value.lockInAmount) || 0;
      if (curr <= 0 || curr >= budget) {
        curr = Math.round(budget * 0.1) || 50;
      }
      this.warrantyForm.patchValue({
        lockInAmount: curr
      });
    }
  }

  onCustomAmountInput(event: any) {
    const val = parseFloat(event.target.value) || 0;
    this.warrantyForm.patchValue({ lockInAmount: val });
  }

  getFinalMilestoneAmount(): number {
    if (!this.milestones || this.milestones.length === 0) return 0;
    return Number(this.milestones[this.milestones.length - 1].price_allocation) || 0;
  }

  getAvailableBudgetForMilestones(): number {
    const budget = Number(this.totalPrice) || 0;
    const type = this.warrantyForm.value.lockInType;
    if (type === 'NONE') return budget;
    if (type === 'FINAL_MILESTONE') {
      return Math.max(0, budget - this.getFinalMilestoneAmount());
    }
    if (type === 'CUSTOM') {
      const lockIn = Number(this.warrantyForm.value.lockInAmount) || 0;
      return Math.max(0, budget - lockIn);
    }
    return budget;
  }

  getMilestonesTotalSum(): number {
    if (!this.milestones) return 0;
    return this.milestones.reduce((acc, m) => acc + (Number(m.price_allocation) || 0), 0);
  }

  isWarrantyBudgetValid(): boolean {
    const budget = Number(this.totalPrice) || 0;
    if (budget <= 0) return true;
    const type = this.warrantyForm.value.lockInType;

    if (type === 'NONE') {
      return Math.abs(this.getMilestonesTotalSum() - budget) <= 0.25;
    }
    if (type === 'FINAL_MILESTONE') {
      const finalAmt = this.getFinalMilestoneAmount();
      const sum = this.getMilestonesTotalSum();
      return Math.abs(sum - budget) <= 0.25 && finalAmt > 0 && (this.aiWarrantyDays ?? 0) > 0;
    }
    if (type === 'CUSTOM') {
      const lockInAmt = Number(this.warrantyForm.value.lockInAmount) || 0;
      const days = this.aiWarrantyDays ?? 0;
      if (lockInAmt <= 0 || lockInAmt >= budget || days <= 0) return false;
      const msSum = this.getMilestonesTotalSum();
      // Enforces sum(milestones) + lock_in_amount == total_budget
      return Math.abs((msSum + lockInAmt) - budget) <= 0.25;
    }
    return true;
  }

  autoBalanceMilestones() {
    if (!this.milestones || this.milestones.length === 0) return;
    const budget = Number(this.totalPrice) || 0;
    const type = this.warrantyForm.value.lockInType;

    if (type === 'CUSTOM') {
      const lockInAmt = Number(this.warrantyForm.value.lockInAmount) || 0;
      const available = Math.max(0, budget - lockInAmt);
      const count = this.milestones.length;
      const share = Math.floor((available / count) * 100) / 100;
      let rem = available;
      this.milestones.forEach((m, idx) => {
        if (idx === count - 1) {
          m.price_allocation = Math.round(rem * 100) / 100;
        } else {
          m.price_allocation = share;
          rem -= share;
        }
      });
    } else if (type === 'FINAL_MILESTONE') {
      const count = this.milestones.length;
      if (count === 1) {
        this.milestones[0].price_allocation = budget;
        this.warrantyForm.patchValue({ lockInAmount: budget });
        return;
      }
      let finalAmt = Number(this.warrantyForm.value.lockInAmount) || Math.round(budget * 0.2);
      if (finalAmt >= budget || finalAmt <= 0) finalAmt = Math.round(budget * 0.2);
      this.milestones[count - 1].price_allocation = finalAmt;
      this.warrantyForm.patchValue({ lockInAmount: finalAmt });

      const remainingBudget = budget - finalAmt;
      const otherCount = count - 1;
      const share = Math.floor((remainingBudget / otherCount) * 100) / 100;
      let rem = remainingBudget;
      for (let i = 0; i < otherCount; i++) {
        if (i === otherCount - 1) {
          this.milestones[i].price_allocation = Math.round(rem * 100) / 100;
        } else {
          this.milestones[i].price_allocation = share;
          rem -= share;
        }
      }
    } else {
      const count = this.milestones.length;
      const share = Math.floor((budget / count) * 100) / 100;
      let rem = budget;
      this.milestones.forEach((m, idx) => {
        if (idx === count - 1) {
          m.price_allocation = Math.round(rem * 100) / 100;
        } else {
          m.price_allocation = share;
          rem -= share;
        }
      });
    }
  }

  isDigitalProject(): boolean {
    if (this.projectDomain === 'digital') return true;
    const text = `${this.title || ''} ${this.industryType || ''} ${this.description || ''}`.toLowerCase();
    const digitalKeywords = ['digital', 'software', 'app', 'website', 'design', 'figma', 'code', 'api', 'copywriting', 'art', 'logo', 'ui', 'ux', 'frontend', 'backend'];
    return digitalKeywords.some(k => text.includes(k));
  }

  isSimpleDigitalProject(): boolean {
    return this.isDigitalProject() && !requiresDigitalWarrantyHold(this.title, this.industryType, this.description);
  }

  canFinalizeDraft(): boolean {
    if (this.aiWarrantyDays === null) {
      return false;
    }
    if (!this.isWarrantyBudgetValid()) {
      return false;
    }
    if (this.isRenovation) {
      return this.beforeEvidenceCaptured;
    }
    return this.beforeEvidenceCaptured || this.beforeEvidenceExempt;
  }

  declareScratchExemption() {
    if (!this.projectId) {
      this.beforeEvidenceExempt = true;
      return;
    }
    this.isDeclaringExemption = true;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/declare-before-exemption`, {})
      .subscribe({
        next: () => {
          this.isDeclaringExemption = false;
          this.beforeEvidenceExempt = true;
          this.baselineEvidenceBlocked = false;
        },
        error: () => {
          this.isDeclaringExemption = false;
          this.beforeEvidenceExempt = true;
          this.baselineEvidenceBlocked = false;
        }
      });
  }

  openLiveCameraCapture() {
    this.isShowingLiveCamera = true;
    this.baselineEvidenceBlocked = false;
  }

  onNoBaselineEvidenceClicked() {
    if (this.isRenovation) {
      this.baselineEvidenceBlocked = true;
      if (this.projectDomain === 'digital') {
        this.baselineBlockedMessage = 'The AI legal assistant has determined this project type requires baseline evidence to protect both parties. You must upload your existing logo, screenshots, or design files to generate the seller invite link.';
      } else {
        this.baselineBlockedMessage = 'The AI legal assistant has determined this project type requires baseline evidence to protect both parties. You must capture before-pictures to generate the seller invite link.';
        this.isShowingLiveCamera = true;
      }
      alert(this.baselineBlockedMessage);
      return;
    }

    this.baselineEvidenceBlocked = false;
    this.declareScratchExemption();
  }

  onDigitalFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (file) {
      this.digitalAssetFile = file;
      this.uploadError = '';
    }
  }

  uploadDigitalBaselineAsset() {
    if (!this.digitalAssetFile && !this.digitalAssetUrl.trim()) {
      alert('Please select an existing logo/screenshot file or provide an asset link.');
      return;
    }
    if (!this.projectId) return;

    this.isUploadingDigitalAsset = true;
    this.uploadError = '';

    const formData = new FormData();
    if (this.digitalAssetFile) {
      formData.append('file', this.digitalAssetFile, this.digitalAssetFile.name);
    }
    formData.append('capture_method', 'file_upload');
    formData.append('evidence_type', 'before_evidence');
    if (this.digitalAssetUrl.trim()) {
      formData.append('asset_url', this.digitalAssetUrl.trim());
    }

    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/evidence`, formData)
      .subscribe({
        next: (res) => {
          this.isUploadingDigitalAsset = false;
          this.beforeEvidenceCaptured = true;
          this.beforeEvidenceItem = {
            id: res.evidence_id,
            file_path: res.file_path,
            file_hash: res.file_hash,
            server_receipt_timestamp: res.server_receipt_timestamp,
            asset_url: this.digitalAssetUrl.trim()
          };
          this.baselineEvidenceBlocked = false;
        },
        error: (err) => {
          this.isUploadingDigitalAsset = false;
          this.uploadError = err.error?.detail || err.message || 'File upload failed';
          alert('Upload failed: ' + this.uploadError);
        }
      });
  }

  getMilestoneDefaultDeadline(index: number): string {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const d = new Date(start);
    if (this.deadline) {
      try {
        const target = new Date(this.deadline.includes('T') ? this.deadline : this.deadline + 'T00:00:00');
        const totalDays = Math.max(1, Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);
        const count = Math.max(1, Math.min(this.milestones.length || 1, totalDays));
        const offset = Math.min(totalDays - 1, Math.ceil((totalDays / count) * (index + 1)) - 1);
        d.setDate(start.getDate() + offset);
      } catch (e) {
        d.setDate(start.getDate() + (index + 1) * 4 - 1);
      }
    } else {
      d.setDate(start.getDate() + (index + 1) * 4 - 1);
    }
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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

  onBeforeEvidenceCaptured(event: any) {
    this.beforeEvidenceCaptured = true;
    this.beforeEvidenceItem = event;
    this.baselineEvidenceBlocked = false;
  }

  retakeBeforeEvidence() {
    this.beforeEvidenceCaptured = false;
    this.beforeEvidenceItem = null;
    this.digitalAssetFile = null;
    this.digitalAssetUrl = '';
    if (this.projectDomain === 'physical') {
      this.isShowingLiveCamera = true;
    }
  }

  declareBeforeExemption() {
    if (!this.projectId) return;
    const isMandatory = this.requiresBaselineEvidence || this.isHomeRenovation();
    if (isMandatory) {
      this.baselineEvidenceBlocked = true;
      this.baselineBlockedMessage = 'The AI legal assistant has determined this project type requires baseline evidence to protect both parties. You must capture before-pictures to generate the seller invite link.';
      alert(this.baselineBlockedMessage);
      return;
    }
    this.isDeclaringExemption = true;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/declare-before-exemption`, {})
      .subscribe({
        next: (res) => {
          this.isDeclaringExemption = false;
          this.beforeEvidenceExempt = true;
        },
        error: (err) => {
          this.isDeclaringExemption = false;
          alert(err.error?.detail || err.message || 'Exemption declaration failed');
        }
      });
  }

  getEvidenceUrl(filePath: string) {
    return this.evidenceFiles.getFileUrl(filePath);
  }

  initProject() {
    this.isLoading = true;
    this.errorMessage = '';
    this.isDraftComplete = false;
    this.milestones = [];

    const payload = {
      title: this.title,
      industry_type: this.industryType,
      description: this.description,
      total_price: Number(this.totalPrice) || 0,
      deadline: this.deadline,
      buyer_email: this.buyerEmail
    };

    this.http.post<any>(`${API_BASE_URL}/api/projects/init`, payload)
      .subscribe({
        next: (res) => {
          this.projectId = res.project_id;
          if (res.project_domain) {
            this.projectDomain = res.project_domain;
          }
          if (res.is_renovation !== undefined) {
            this.isRenovation = !!res.is_renovation;
          }
          if (res.requires_baseline_evidence !== undefined) {
            this.requiresBaselineEvidence = !!res.requires_baseline_evidence;
          }
          this.step = 2;

          const initialMessage = `Project created: "${this.title}" (${this.industryType || 'General'}) with budget $${Number(this.totalPrice || 0).toFixed(2)}, target delivery deadline: ${this.deadline}. Scope: ${this.description}`;
          this.http.post<DraftChatResponse>(`${API_BASE_URL}/api/projects/${this.projectId}/draft-chat`, { user_message: initialMessage })
            .subscribe({
              next: (chatRes) => {
                this.isLoading = false;
                this.aiWarrantyDays = Number.isInteger(chatRes.warranty_days) && chatRes.warranty_days! >= 0
                  ? chatRes.warranty_days!
                  : null;
                this.chatMessages = [
                  {
                    role: 'assistant',
                    content: chatRes.ai_response_text
                  }
                ];
                if (chatRes.requires_baseline_evidence !== undefined) {
                  this.requiresBaselineEvidence = !!chatRes.requires_baseline_evidence;
                }
                if (chatRes.is_renovation !== undefined) {
                  this.isRenovation = !!chatRes.is_renovation;
                }
                if (chatRes.project_domain) {
                  this.projectDomain = chatRes.project_domain;
                }
                if (chatRes.status === 'complete' && chatRes.milestones && chatRes.milestones.length > 0) {
                  this.isDraftComplete = true;
                  this.milestones = chatRes.milestones;
                }
              },
              error: (chatErr) => {
                this.isLoading = false;
                console.warn('Draft chat init error:', chatErr);
                const defaultMilestones = this.generateFallbackMilestones();
                this.milestones = defaultMilestones;
                this.isDraftComplete = true;
                this.chatMessages = [
                  {
                    role: 'assistant',
                    content: `I have established the milestone schedule and verification criteria for "${this.title}" ($${Number(this.totalPrice || 0).toFixed(2)} USD) based on your delivery timeline (${this.deadline || 'Per Schedule'}). Review the ${defaultMilestones.length} milestones below. If you want to change any proof requirements, deadlines, or scope, simply tell me here!`
                  }
                ];
              }
            });
        },
        error: (err) => {
          this.isLoading = false;
          console.error('Project init error:', err);
          this.errorMessage = err.error?.detail || err.message || 'Failed to initialize project';
        }
      });
  }

  onUserMessageKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.sendClarification();
    }
  }

  sendClarification() {
    const text = this.userMessage.trim();
    if (!text || this.isLoading || !this.projectId) return;

    this.chatMessages.push({ role: 'user', content: text });
    this.userMessage = '';
    this.isLoading = true;

    this.http.post<DraftChatResponse>(`${API_BASE_URL}/api/projects/${this.projectId}/draft-chat`, { user_message: text })
      .subscribe({
        next: (res) => {
          this.isLoading = false;
          this.aiWarrantyDays = Number.isInteger(res.warranty_days) && res.warranty_days! >= 0
            ? res.warranty_days!
            : null;
          this.chatMessages.push({
            role: 'assistant',
            content: res.ai_response_text
          });

          if (res.requires_baseline_evidence !== undefined) {
            this.requiresBaselineEvidence = !!res.requires_baseline_evidence;
          }
          if (res.is_renovation !== undefined) {
            this.isRenovation = !!res.is_renovation;
          }
          if (res.project_domain) {
            this.projectDomain = res.project_domain;
          }

          if (res.status === 'complete' && res.milestones && res.milestones.length > 0) {
            this.isDraftComplete = true;
            this.milestones = res.milestones;
          }
        },
        error: (err) => {
          this.isLoading = false;
          console.error('Draft chat error:', err);
          this.applyUserChatInstructionLocally(text);
          this.isDraftComplete = true;
          this.chatMessages.push({
            role: 'assistant',
            content: `Agreement updated! I have adjusted the milestone specifications and proof criteria per your instruction: "${text}". Review the updated schedule and verification requirements below.`
          });
        }
      });
  }

  finalizeDraft() {
    if (!this.projectId) return;

    if (this.isSimpleDigitalProject()) {
      this.warrantyForm.patchValue({ lockInType: 'NONE', lockInAmount: 0 });
      this.autoBalanceMilestones();
    }

    if (!this.canFinalizeDraft()) {
      if (this.projectDomain === 'physical' && this.isRenovation) {
        alert('A live physical camera capture of the existing site or asset is strictly required for physical renovation projects before generating the seller invite link.');
      } else if (this.projectDomain === 'digital' && this.isRenovation) {
        alert('A baseline file upload (PDF/PNG) or asset URL is strictly required for digital redesign projects before generating the seller invite link.');
      } else {
        alert('Please click "[No appropriate evidence can be provided (Built from scratch)]" or capture baseline evidence to proceed.');
      }
      return;
    }

    this.isLoading = true;

    // Ensure all milestones have concrete deadlines from the start
    this.milestones.forEach((m, idx) => {
      if (!m.deadline || m.deadline === 'Per Schedule') {
        m.deadline = this.getMilestoneDefaultDeadline(idx);
      }
    });

    const payload = {
      contract_terms: this.milestones.map((m, i) => `${i + 1}. ${m.title} ($${m.price_allocation.toFixed(2)} USD) [Target Due: ${m.deadline}]: ${m.description}`).join('\n\n'),
      evidence_requirements: this.milestones.map((m, i) => `• Milestone ${i + 1} (${m.title}) [Due: ${m.deadline}]: ${m.proof_required}`).join('\n'),
      milestones: this.milestones,
      lock_in_type: this.warrantyForm.value.lockInType,
      lock_in_amount: Number(this.warrantyForm.value.lockInAmount) || 0,
      lock_in_days: this.aiWarrantyDays ?? 0
    };

    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/finalize-draft`, payload)
      .subscribe({
        next: (res) => {
          this.isLoading = false;
          this.projectId = res.project_id || this.projectId;
          this.inviteUrl = res.seller_invite_link || '';
          this.inviteToken = this.inviteUrl.split('/').pop() || '';
          this.isDraftComplete = true;
          this.step = 3;
          this.paymentStatusMessage = this.inviteUrl
            ? 'Agreement finalized. Share the invitation with the seller; escrow authorization starts after they join.'
            : 'Agreement finalized, but the seller invitation link was not returned.';
        },
        error: (err) => {
          this.isLoading = false;
          alert('Failed to finalize draft: ' + (err.error?.detail || err.message));
        }
      });
  }

  copyInviteLink() {
    navigator.clipboard.writeText(this.inviteUrl);
    this.copyBtnText = 'Copied to Clipboard';
    setTimeout(() => {
      this.copyBtnText = 'Copy Link';
    }, 2000);
  }

  openSellerInvite() {
    this.router.navigate(['/invite', this.inviteToken]);
  }

  goToNegotiation() {
    this.router.navigate(['/project', this.projectId, 'negotiate']);
  }

  generateFallbackMilestones(): MilestoneItem[] {
    const totalP = Number(this.totalPrice) || 0;
    const dl = this.deadline || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0];
    const corpus = `${this.title || ''} ${this.industryType || ''} ${this.description || ''}`.toLowerCase();

    const isDesign = corpus.includes('logo') || corpus.includes('brand') || corpus.includes('design') || corpus.includes('graphic');
    const isSoftware = !isDesign && (corpus.includes('app') || corpus.includes('software') || corpus.includes('web') || corpus.includes('code'));
    const isReno = corpus.includes('bath') || corpus.includes('paint') || corpus.includes('renov') || corpus.includes('plumb') || corpus.includes('sink');

    const targetDate = new Date(dl);
    const diffDays = Math.max(1, Math.round((targetDate.getTime() - Date.now()) / 86400000));

    if (diffDays <= 1) {
      // 1 day -> 1 milestone to complete in one day itself
      return [
        {
          title: isDesign ? `Complete ${this.title} & Verified Asset Handover` : (isReno ? `Trade Execution, Installation & Verified Completion` : `Full Project Execution & Verified Delivery`),
          description: `Full execution, client review, and verified handover for '${this.title}'.`,
          price_allocation: totalP,
          deadline: dl,
          proof_required: isDesign ? 'Complete verified production package including high-resolution transparent PNG lockups and vector source files.' : (isReno ? 'High-resolution inspection photos and 30-second continuous video demonstration of completed, functioning work.' : 'High-resolution inspection evidence and signed delivery handover receipt.')
        }
      ];
    } else if (diffDays === 2) {
      // 2 days -> 2 milestones
      const p1 = Math.round(totalP * 0.50 * 100) / 100;
      const p2 = Math.round((totalP - p1) * 100) / 100;
      const day1 = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      return [
        {
          title: isDesign ? 'Creative Brief Alignment, Concepts & Lockup Draft' : 'Initial Execution & Core Assembly',
          description: `Foundational work and draft preview for '${this.title}'.`,
          price_allocation: p1,
          deadline: day1,
          proof_required: isDesign ? 'Presentation deck (PDF or PNG) showing concept explorations with typography hierarchy.' : 'Photographic inspection evidence of initial assembled work.'
        },
        {
          title: isDesign ? 'Final Master Production Package & Asset Handover' : 'Final Inspection, Quality Audit & Handover',
          description: `Final deliverable polish and verified handover for '${this.title}'.`,
          price_allocation: p2,
          deadline: dl,
          proof_required: isDesign ? 'Complete downloadable production archive package (AI, EPS, SVG, and transparent PNGs).' : 'Final quality verification photos/video and signed delivery signoff.'
        }
      ];
    }

    const p1 = Math.round(totalP * 0.30 * 100) / 100;
    const p2 = Math.round(totalP * 0.40 * 100) / 100;
    const p3 = Math.round((totalP - p1 - p2) * 100) / 100;

    const d1Offset = Math.max(1, Math.round(diffDays * 0.33));
    const d2Offset = Math.max(d1Offset + 1, Math.round(diffDays * 0.67));
    const date1 = new Date(Date.now() + d1Offset * 86400000).toISOString().split('T')[0];
    const date2 = new Date(Date.now() + d2Offset * 86400000).toISOString().split('T')[0];
    const m1Date = diffDays <= 1 ? dl : date1;
    const m2Date = diffDays <= 1 ? dl : (diffDays === 2 ? dl : date2);

    if (isDesign) {
      return [
        {
          title: 'Creative Brief Alignment, Moodboard & Initial Concepts',
          description: `Develop 3 distinct creative concepts, moodboard explorations, and typography pairings for '${this.title}'.`,
          price_allocation: p1,
          deadline: m1Date,
          proof_required: 'Presentation deck (PDF or images) containing 3 distinct concept boards with color swatches and typography hierarchy.'
        },
        {
          title: 'Concept Refinement, Iterations & Lockup Variations',
          description: `Refine chosen direction with client revisions, finalize geometry, horizontal/vertical lockups, and application previews.`,
          price_allocation: p2,
          deadline: m2Date,
          proof_required: 'High-resolution mockups (PNG or PDF) showing primary mark, secondary badge, monochrome versions, and scale legibility checks.'
        },
        {
          title: 'Final Master Production Package, Style Guide & Asset Handover',
          description: `Export complete production package: vector master files (AI, EPS, SVG), print-ready PDF (CMYK), web-optimized transparent PNGs (RGB), and brand guide.`,
          price_allocation: p3,
          deadline: dl,
          proof_required: 'Downloadable production archive package containing all verified master files, exported assets, and signed brand copyright release.'
        }
      ];
    } else if (isSoftware) {
      return [
        {
          title: 'Wireframes, Architecture Schema & Design Approval',
          description: `System architecture diagram, API contract specs, and UI/UX wireframes for '${this.title}'.`,
          price_allocation: p1,
          deadline: m1Date,
          proof_required: 'Clickable Figma prototype link or approved technical architecture document.'
        },
        {
          title: 'Core Feature Implementation & Staging Demo',
          description: `Development of core user workflows and interactive demo on a live staging environment.`,
          price_allocation: p2,
          deadline: m2Date,
          proof_required: 'Live staging preview URL with screen recording demonstrating core workflows.'
        },
        {
          title: 'QA Testing, Bug Resolution & Source Repository Handover',
          description: `Automated test coverage, production readiness audit, and Git repository transfer.`,
          price_allocation: p3,
          deadline: dl,
          proof_required: 'Passing automated test suite report and GitHub repository transfer with deployment signoff.'
        }
      ];
    } else if (isReno) {
      return [
        {
          title: 'Surface Prep, Plumbing Rough-In & Moisture Barrier',
          description: `Patch drywall, prepare surface, disconnect plumbing, and seal work area for '${this.title}'.`,
          price_allocation: p1,
          deadline: m1Date,
          proof_required: 'High-resolution photos showing patched surface, moisture-resistant primer, and secure shutoff valves.'
        },
        {
          title: 'Fixture Mounting, Plumbing Reconnection & Pressure Leak Test',
          description: `Mount fixtures, hook up braided supply lines and P-trap drain, and test water flow.`,
          price_allocation: p2,
          deadline: m2Date,
          proof_required: 'Continuous 30-second video demonstrating full water flow with dry paper towel inspection showing zero leaks.'
        },
        {
          title: 'Two-Coat Finish Paint, Perimeter Silicone Seal & Final Cleanup',
          description: `Apply 2 coats of moisture-resistant paint, apply sanitary silicone caulk bead, and clean work area.`,
          price_allocation: p3,
          deadline: dl,
          proof_required: 'Wide-angle inspection photos of uniform finish and close-up of watertight perimeter silicone seal.'
        }
      ];
    } else {
      return [
        {
          title: 'Project Initiation & Specification Alignment',
          description: `Detailed kickoff, material procurement, and foundational work for '${this.title}'.`,
          price_allocation: p1,
          deadline: m1Date,
          proof_required: 'Kickoff specification document or initial raw material inspection photos.'
        },
        {
          title: 'Core Execution & Deliverable Assembly',
          description: `Primary production or fulfillment phase meeting agreed project requirements.`,
          price_allocation: p2,
          deadline: m2Date,
          proof_required: 'Photographic and video progress proof of the assembled deliverables.'
        },
        {
          title: 'Final Quality Review, Delivery & Verification',
          description: `Final inspection, verification against requirements, and completed delivery handover.`,
          price_allocation: p3,
          deadline: dl,
          proof_required: 'Completed deliverable signoff inspection and delivery confirmation receipt.'
        }
      ];
    }
  }

  applyUserChatInstructionLocally(text: string) {
    const lower = text.toLowerCase();
    const dayMatch = lower.match(/\b(\d+)\s*(day|week)s?\b/);
    const wantsThree = lower.includes('three milestones') || lower.includes('3 milestones');

    if (dayMatch && !wantsThree) {
      const count = parseInt(dayMatch[1], 10);
      const totalDays = dayMatch[2].startsWith('week') ? count * 7 : count;
      this.deadline = new Date(Date.now() + totalDays * 86400000).toISOString().split('T')[0];
      this.milestones = this.generateFallbackMilestones();
    } else if (!this.milestones || this.milestones.length === 0) {
      this.milestones = this.generateFallbackMilestones();
    }

    const targetIdx = this.milestones.length > 1 ? 1 : 0;

    // Detect color specifications (e.g. 'blue colour logo only', 'blue color', 'blue')
    const colorMatch = lower.match(/\b(blue|navy|royal blue|sky blue|cyan|teal|red|crimson|green|emerald|yellow|gold|orange|purple|violet|pink|black|white|monochrome|ivory)\b/);
    const isStrictOnly = lower.includes('only');
    const colorSpec = colorMatch ? (isStrictOnly ? `${colorMatch[1]} color only` : `${colorMatch[1]} color scheme`) : '';

    if (colorSpec) {
      const hasPng = lower.includes('png');
      const fmtDesc = hasPng ? 'transparent PNG mockups' : 'deliverable mockups';
      this.milestones[targetIdx].proof_required = `High-resolution ${fmtDesc} strictly featuring the logo in ${colorSpec} (per client specification), with horizontal and vertical lockup variations.`;
      if (!this.milestones[targetIdx].description.toLowerCase().includes(colorSpec)) {
        this.milestones[targetIdx].description += ` (Strict color specification: ${colorSpec})`;
      }
    } else if (lower.includes('png') || lower.includes('lockup')) {
      this.milestones[targetIdx].proof_required = 'High-resolution transparent PNG mockups showing primary and secondary variations with horizontal and vertical lockups.';
    }

    // Check for vector files request
    if (lower.includes('vector') || lower.includes('svg') || lower.includes('eps') || lower.includes('.ai')) {
      const lastIdx = this.milestones.length - 1;
      this.milestones[lastIdx].proof_required = 'Complete downloadable vector production archive (AI, EPS, SVG) and high-resolution master asset handover.';
    }

    // Check for Figma request
    if (lower.includes('figma')) {
      this.milestones[0].proof_required = 'Interactive Figma design workspace link with component design tokens.';
    }

    // Check for video request
    if (lower.includes('video')) {
      this.milestones[targetIdx].proof_required = 'Continuous high-definition video walkthrough demonstrating agreed deliverable functionality.';
    }

    // Check for photo request
    if (lower.includes('photo') || lower.includes('image')) {
      this.milestones[targetIdx].proof_required = 'High-resolution multi-angle photographic inspection of completed deliverable.';
    }

    // Any other custom specification
    if (!colorSpec && text.trim().length > 1 && !['png', 'vector', 'figma', 'video', 'photo'].some(k => lower.includes(k))) {
      this.milestones[targetIdx].description += ` [${text.trim()}]`;
      this.milestones[targetIdx].proof_required += ` [Inspection requirement: ${text.trim()}]`;
    }

    this.isDraftComplete = true;
  }
}
