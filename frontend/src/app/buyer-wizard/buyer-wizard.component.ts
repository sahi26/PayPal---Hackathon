import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { API_BASE_URL } from '../api.config';
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
}

@Component({
  selector: 'app-buyer-wizard',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, LiveCameraComponent],
  templateUrl: './buyer-wizard.component.html',
  styleUrl: './buyer-wizard.component.scss'
})
export class BuyerWizardComponent {
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

  constructor(private http: HttpClient, private router: Router, private fb: FormBuilder) {
    this.warrantyForm = this.fb.group({
      lockInType: ['NONE', Validators.required],
      lockInDays: [14, [Validators.required, Validators.min(1), Validators.max(365)]],
      lockInAmount: [0, [Validators.min(0)]]
    });
  }

  isHomeRenovation(): boolean {
    if (this.isRenovation) return true;
    const text = `${this.title || ''} ${this.industryType || ''} ${this.description || ''}`.toLowerCase();
    const keywords = ['renovat', 'remodel', 'home renovation', 'bath', 'bathroom', 'kitchen', 'plumb', 'drywall', 'tile', 'flooring', 'paint', 'roof', 'house'];
    return keywords.some(k => text.includes(k));
  }

  onLockInTypeSelect(type: 'NONE' | 'FINAL_MILESTONE' | 'CUSTOM') {
    this.warrantyForm.patchValue({ lockInType: type });
    if (type === 'NONE') {
      this.warrantyForm.patchValue({ lockInAmount: 0, lockInDays: 0 });
    } else if (type === 'FINAL_MILESTONE') {
      const finalAmt = this.getFinalMilestoneAmount();
      this.warrantyForm.patchValue({
        lockInAmount: finalAmt,
        lockInDays: this.warrantyForm.value.lockInDays || 14
      });
    } else if (type === 'CUSTOM') {
      const budget = Number(this.totalPrice) || 0;
      let curr = Number(this.warrantyForm.value.lockInAmount) || 0;
      if (curr <= 0 || curr >= budget) {
        curr = Math.round(budget * 0.1) || 50;
      }
      this.warrantyForm.patchValue({
        lockInAmount: curr,
        lockInDays: this.warrantyForm.value.lockInDays || 14
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
      return Math.abs(sum - budget) <= 0.25 && finalAmt > 0 && (Number(this.warrantyForm.value.lockInDays) || 0) > 0;
    }
    if (type === 'CUSTOM') {
      const lockInAmt = Number(this.warrantyForm.value.lockInAmount) || 0;
      const days = Number(this.warrantyForm.value.lockInDays) || 0;
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

  canFinalizeDraft(): boolean {
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
    if (this.deadline) {
      try {
        const target = new Date(this.deadline);
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

  getEvidenceUrl(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    return `${API_BASE_URL}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
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
                this.chatMessages = [
                  {
                    role: 'assistant',
                    content: `Hello! I am your AI scoping assistant for "${this.title}" ($${Number(this.totalPrice || 0).toFixed(2)} USD). To break this project down into milestone-based escrow payments, what are the exact dimensions/sizes, base materials, and target delivery deadline?`
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
          this.chatMessages.push({
            role: 'assistant',
            content: `Understood! I've logged: "${text}". Please specify required verification proof or timeline to complete the milestone breakdown.`
          });
        }
      });
  }

  finalizeDraft() {
    if (!this.projectId) return;

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
      lock_in_days: Number(this.warrantyForm.value.lockInDays) || 0
    };

    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.projectId}/finalize-draft`, payload)
      .subscribe({
        next: (res) => {
          this.isLoading = false;
          this.inviteToken = res.invite_token;
          this.inviteUrl = res.invite_url;
          this.step = 3;
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
}
