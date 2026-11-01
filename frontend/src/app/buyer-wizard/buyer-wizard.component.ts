import { Component } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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
  imports: [CommonModule, FormsModule, LiveCameraComponent],
  template: `
    <div class="wizard-container">
      <!-- Step 1: Basic Project Details -->
      @if (step === 1) {
        <div class="card">
          <div class="header-box">
            <span class="badge">Step 1 of 3</span>
            <h2>Initiate Buyer Project</h2>
            <p class="subtitle">Tell us what you need built or delivered. ProofLens AI will help you craft the legal terms and proof-of-work evidence before inviting your seller.</p>
          </div>

          @if (errorMessage) {
            <div class="alert-error">{{ errorMessage }}</div>
          }

          <div class="form-body">
            <div class="form-group">
              <label>Project Title</label>
              <input type="text" [(ngModel)]="title" placeholder="e.g. Custom Hardwood Dining Table" class="input" />
            </div>

            <div class="grid-2">
              <div class="form-group">
                <label>Industry</label>
                <input type="text" [(ngModel)]="industryType" placeholder="e.g. Woodworking, Web Design, Plumbing" class="input" />
              </div>
              <div class="form-group">
                <label>Escrow Budget (USD)</label>
                <input type="number" [(ngModel)]="totalPrice" placeholder="500" class="input" />
              </div>
            </div>

            <div class="grid-2">
              <div class="form-group">
                <label>Target Completion Deadline *</label>
                <input type="date" [(ngModel)]="deadline" class="input" />
              </div>
              <div class="form-group">
                <label>Your Email (Buyer) *</label>
                <input type="email" [(ngModel)]="buyerEmail" placeholder="buyer@example.com" class="input" />
              </div>
            </div>

            <div class="form-group">
              <label>Initial Scope Description *</label>
              <textarea [(ngModel)]="description" rows="4" placeholder="Describe the item, materials, dimensions, or deliverables you are ordering..." class="textarea"></textarea>
            </div>

            <button (click)="initProject()" [disabled]="isLoading || !title || !description || !totalPrice || !deadline" class="btn-primary">
              {{ isLoading ? 'Initializing Project...' : 'Continue to AI Legal Assistant →' }}
            </button>
          </div>
        </div>
      }

      <!-- Step 2: Interactive AI Scoping -->
      @if (step === 2) {
        <div class="card chat-card">
          <div class="header-box compact">
            <div class="title-row">
              <div>
                <span class="badge">Step 2 of 3</span>
                <h2>AI Scope & Evidence Drafting</h2>
              </div>
              <div class="project-pill">{{ title }} • \${{ totalPrice }}</div>
            </div>
            <p class="subtitle">ProofLens AI is asking clarifying questions to protect your escrow payment.</p>
          </div>

          <!-- Chat Stream -->
          <div class="chat-stream">
            @for (msg of chatMessages; track $index) {
              <div class="message-row" [class.user-row]="msg.role === 'user'">
                <div class="avatar" [class.assistant-avatar]="msg.role === 'assistant'" [class.user-avatar]="msg.role === 'user'">
                  @if (msg.role === 'assistant') {
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M12 3v18M3 9l9-6 9 6M3 9a4 4 0 0 0 8 0M13 9a4 4 0 0 0 8 0"/>
                    </svg>
                  } @else {
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="7" r="4"/><path d="M4 21v-2a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v2"/>
                    </svg>
                  }
                </div>
                <div class="bubble" [class.user-bubble]="msg.role === 'user'">
                  <div class="bubble-text">{{ msg.content }}</div>
                </div>
              </div>
            }

            @if (isLoading) {
              <div class="message-row">
                <div class="avatar assistant-avatar">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 3v18M3 9l9-6 9 6M3 9a4 4 0 0 0 8 0M13 9a4 4 0 0 0 8 0"/>
                  </svg>
                </div>
                <div class="bubble typing">
                  <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                </div>
              </div>
            }
          </div>

          <!-- Chat Input Bar (ALWAYS active until Finalize is clicked) -->
          <div class="input-bar">
            <input
              type="text"
              [(ngModel)]="userMessage"
              (keydown.enter)="sendClarification()"
              [placeholder]="isDraftComplete ? 'Text AI to refine milestones, adjust terms, or add requirements... (Press Enter)' : 'Reply to AI Scoping Assistant... (Press Enter to send)'"
              class="chat-input"
              [disabled]="isLoading"
            />
            <button (click)="sendClarification()" [disabled]="!userMessage.trim() || isLoading" class="btn-send">
              Send
            </button>
          </div>

          @if (isDraftComplete) {
            <div class="chat-refine-hint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
              </svg>
              <span>You can continue messaging the AI above to adjust milestones or add criteria anytime. When satisfied, click Finalize below.</span>
            </div>
          }

          <!-- Visual Milestone Timeline & Cards (When status is complete) -->
          @if (isDraftComplete && milestones.length > 0) {
            <div class="milestones-timeline-card">
              <div class="milestones-header-row">
                <div class="milestones-badge-group">
                  <span class="badge-milestones-ready">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>Escrow Milestones Locked</span>
                  </span>
                  <h3>Project Milestones & Evidence Requirements</h3>
                </div>
                <div class="milestones-total-pill">
                  Total Allocation: \${{ totalPrice }} USD
                </div>
              </div>

              <div class="milestones-list">
                @for (ms of milestones; track $index) {
                  <div class="milestone-item-row">
                    <div class="milestone-node-col">
                      <div class="node-circle">{{ $index + 1 }}</div>
                      @if ($index < milestones.length - 1) {
                        <div class="node-track"></div>
                      }
                    </div>
                    <div class="milestone-details-box">
                      <div class="milestone-main-line">
                        <div class="milestone-name-title">{{ ms.title }}</div>
                        <div class="milestone-right-meta">
                          <div class="milestone-deadline-pill">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                              <line x1="16" y1="2" x2="16" y2="6"/>
                              <line x1="8" y1="2" x2="8" y2="6"/>
                              <line x1="3" y1="10" x2="21" y2="10"/>
                            </svg>
                            <span>Target Due: {{ ms.deadline || getMilestoneDefaultDeadline($index) }}</span>
                          </div>
                          <div class="milestone-allocated-price" [class.zero-price]="ms.price_allocation === 0">
                            @if (ms.price_allocation === 0) {
                              <span class="zero-badge">Non-Monetary Sign-Off</span>\$0.00 USD
                            } @else {
                              \${{ ms.price_allocation.toFixed(2) }} USD
                            }
                          </div>
                        </div>
                      </div>
                      <p class="milestone-work-desc">{{ ms.description }}</p>
                      <div class="milestone-proof-container">
                        <div class="proof-label-tag">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                          </svg>
                          <span>Strict Evidence Required (PayPal Release):</span>
                        </div>
                        <div class="proof-desc-text">{{ ms.proof_required }}</div>
                      </div>
                    </div>
                  </div>
                }
              </div>

              <!-- Step 2.5: Baseline Pre-Work Evidence Desk -->
              <div class="pre-evidence-section">
                <div class="pre-evidence-header">
                  <div class="pre-evidence-title-cluster">
                    <span class="pre-evidence-badge" [class.is-mandatory]="isRenovation">
                      {{ isRenovation ? 'MANDATORY BASELINE EVIDENCE (AI VERIFIED)' : 'BASELINE BEFORE-EVIDENCE' }}
                    </span>
                    <h4>Pre-Work Site / Asset Baseline Verification</h4>
                  </div>
                  <p class="pre-evidence-hint">
                    @if (isRenovation) {
                      The AI legal assistant has identified this project as an existing asset modification/renovation. To prevent fraudulent disputes, an authoritative baseline must be secured before inviting the seller.
                    } @else {
                      This project is built from scratch / raw stock. You may proceed by confirming that no baseline pre-existing condition applies.
                    }
                  </p>
                </div>

                <!-- Case 1: Already Captured -->
                @if (beforeEvidenceCaptured) {
                  <div class="before-captured-card">
                    <div class="captured-head">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      <strong>Authoritative Baseline Before-Evidence Secured</strong>
                    </div>
                    <div class="captured-meta">
                      @if (beforeEvidenceItem?.file_path) {
                        <img [src]="getEvidenceUrl(beforeEvidenceItem.file_path)" alt="Baseline" class="before-thumb" />
                      }
                      <div class="meta-texts">
                        <span class="hash-label">SHA-256: {{ beforeEvidenceItem?.file_hash ? beforeEvidenceItem.file_hash.slice(0, 16) + '...' : 'Locked' }}</span>
                        <span class="time-label">Recorded: {{ beforeEvidenceItem?.server_receipt_timestamp || 'Server Authoritative' }}</span>
                      </div>
                    </div>
                    <button type="button" (click)="retakeBeforeEvidence()" class="btn-retake-before">Retake Baseline Capture</button>
                  </div>
                }

                <!-- Case 2: Exemption Declared (Non-Renovation Only) -->
                @if (!beforeEvidenceCaptured && beforeEvidenceExempt && !isRenovation) {
                  <div class="exemption-card">
                    <div class="exemption-badge-row">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                      </svg>
                      <strong>Exemption Active: Deliverable Fabricated from Scratch / Raw Stock</strong>
                    </div>
                    <p>No before evidence is required. ProofLens AI will verify seller milestones directly against agreed contract specifications and measurements.</p>
                    <button type="button" (click)="beforeEvidenceExempt = false" class="btn-switch-to-cam">Change Mind & Provide Proof</button>
                  </div>
                }

                <!-- Case 3: Need to Capture or Declare -->
                @if (!beforeEvidenceCaptured && !beforeEvidenceExempt) {
                  <div class="capture-zone">
                    @if (baselineEvidenceBlocked) {
                      <div class="baseline-blocked-alert">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2.5">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                          <line x1="12" y1="9" x2="12" y2="13"/>
                          <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        <div>
                          <strong>Baseline Evidence Mandatory:</strong>
                          <p>{{ baselineBlockedMessage }}</p>
                        </div>
                      </div>
                    }

                    <!-- 1. Physical Renovation/Repair (physical + is_renovation = true): Require LiveCameraComponent. Do NOT show "No appropriate evidence" button -->
                    @if (projectDomain === 'physical' && isRenovation) {
                      <div class="physical-cam-wrapper">
                        <div class="digital-warning-banner" style="border-left-color: #b45309; background: #fffbeb;">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2.2">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                          </svg>
                          <span><strong>MANDATORY LIVE CAMERA BASELINE:</strong> Please capture the physical baseline (e.g., the room or asset before renovation).</span>
                        </div>
                        <app-live-camera
                          [projectId]="projectId"
                          evidenceType="before_evidence"
                          label="Capture Live Site / Asset Baseline"
                          (evidenceUploaded)="onBeforeEvidenceCaptured($event)"
                        ></app-live-camera>
                      </div>
                    }

                    <!-- 2. New Physical Build (physical + is_renovation = false): Show [No appropriate evidence can be provided (Built from scratch)] button -->
                    @if (projectDomain === 'physical' && !isRenovation) {
                      <div class="scratch-panel">
                        <p class="physical-warning-text" style="color: #475569;">
                          This project is built from scratch from raw stock. Baseline before-evidence is optional:
                        </p>
                        <div class="baseline-choice-buttons">
                          <button
                            type="button"
                            (click)="declareScratchExemption()"
                            [disabled]="isDeclaringExemption"
                            class="btn-choice-exemption primary-scratch-btn"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2">
                              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                            </svg>
                            <span>No appropriate evidence can be provided (Built from scratch)</span>
                          </button>

                          <button
                            type="button"
                            (click)="openLiveCameraCapture()"
                            class="btn-choice-camera"
                            [class.is-active]="isShowingLiveCamera"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                              <circle cx="12" cy="13" r="4"/>
                            </svg>
                            <span>Optional: Capture Raw Material Stock</span>
                          </button>
                        </div>

                        @if (isShowingLiveCamera) {
                          <div class="physical-cam-wrapper" style="margin-top: 1rem;">
                            <app-live-camera
                              [projectId]="projectId"
                              evidenceType="before_evidence"
                              label="Capture Live Raw Material Baseline"
                              (evidenceUploaded)="onBeforeEvidenceCaptured($event)"
                            ></app-live-camera>
                          </div>
                        }
                      </div>
                    }

                    <!-- 3. Digital Redesign (digital + is_renovation = true): Hide Live Camera. Require File Upload OR URL string. Do NOT show "No appropriate evidence" button -->
                    @if (projectDomain === 'digital' && isRenovation) {
                      <div class="digital-upload-panel">
                        <div class="digital-warning-banner">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2">
                            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                          </svg>
                          <span><strong>MANDATORY DIGITAL BASELINE:</strong> Please upload screenshots or links to your current digital assets / existing logo before redesign.</span>
                        </div>

                        <div class="digital-dropzone-box" (click)="fileInputRef.click()">
                          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                          </svg>
                          <span class="dropzone-title">{{ digitalAssetFile ? digitalAssetFile.name : 'Click to Upload Existing Logo, PDF, or Screenshots' }}</span>
                          <span class="dropzone-sub">Supports PNG, JPG, SVG, and PDF</span>
                          <input
                            #fileInputRef
                            type="file"
                            (change)="onDigitalFileSelected($event)"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf"
                            class="hidden-file-input"
                          />
                        </div>

                        <div class="digital-url-input-group">
                          <label>Current Website URL or Figma / Asset Link</label>
                          <input
                            type="url"
                            [(ngModel)]="digitalAssetUrl"
                            placeholder="e.g. https://mybrand.com or https://figma.com/file/..."
                            class="corporate-input"
                          />
                        </div>

                        <div class="digital-actions-row">
                          <button
                            type="button"
                            (click)="uploadDigitalBaselineAsset()"
                            [disabled]="isUploadingDigitalAsset || (!digitalAssetFile && !digitalAssetUrl.trim())"
                            class="btn-upload-digital"
                          >
                            <span>{{ isUploadingDigitalAsset ? 'Securing Baseline Asset...' : 'Upload & Secure Baseline Asset' }}</span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                              <polyline points="20 6 9 17 4 12"/>
                            </svg>
                          </button>
                        </div>
                      </div>
                    }

                    <!-- 4. New Digital Build (digital + is_renovation = false): Show [No appropriate evidence can be provided (Built from scratch)] button -->
                    @if (projectDomain === 'digital' && !isRenovation) {
                      <div class="scratch-panel">
                        <p class="physical-warning-text" style="color: #475569;">
                          This digital project is being created from scratch. No baseline pre-existing digital asset applies:
                        </p>
                        <div class="baseline-choice-buttons">
                          <button
                            type="button"
                            (click)="declareScratchExemption()"
                            [disabled]="isDeclaringExemption"
                            class="btn-choice-exemption primary-scratch-btn"
                          >
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2.2">
                              <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                            </svg>
                            <span>No appropriate evidence can be provided (Built from scratch)</span>
                          </button>
                        </div>
                      </div>
                    }
                  </div>
                }
              </div>

              <!-- Finalize CTA Action -->
              <div class="milestones-cta-box">
                <button (click)="finalizeDraft()" [disabled]="isLoading || !canFinalizeDraft()" class="btn-finalize-milestones">
                  <span>{{ isLoading ? 'Generating Agreement Link...' : 'Generate Agreement & Invite Link →' }}</span>
                </button>
                @if (!canFinalizeDraft()) {
                  <p class="finalize-hint-warning">
                    @if (projectDomain === 'physical' && isRenovation) {
                      * Mandatory: A live physical camera capture of the existing site/asset is strictly required for physical renovation projects before generating the seller invite link.
                    } @else if (projectDomain === 'digital' && isRenovation) {
                      * Mandatory: A baseline file upload (PDF/PNG) or asset URL is strictly required for digital redesign projects before generating the seller invite link.
                    } @else {
                      * Please click "[No appropriate evidence can be provided (Built from scratch)]" to unlock link generation.
                    }
                  </p>
                }
              </div>
            </div>
          }
        </div>
      }

      <!-- Step 3: Success Screen with Invite Link -->
      @if (step === 3) {
        <div class="card success-card">
          <div class="success-icon">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <h2>Seller Invitation Created!</h2>
          <p class="subtitle">Share this private link with your contractor/seller. When they open it, they can review the terms and join the negotiation room.</p>

          <div class="link-box">
            <input type="text" [value]="inviteUrl" readonly class="link-input" />
            <button (click)="copyInviteLink()" class="btn-copy">
              {{ copyBtnText }}
            </button>
          </div>

          <div class="summary-preview">
            <div class="summary-item">
              <span class="label">Project:</span>
              <span class="val">{{ title }}</span>
            </div>
            <div class="summary-item">
              <span class="label">Escrow Value:</span>
              <span class="val">\${{ totalPrice }} USD</span>
            </div>
            <div class="summary-item">
              <span class="label">Status:</span>
              <span class="status-tag">INVITE SENT</span>
            </div>
          </div>

          <div class="action-grid">
            <button (click)="openSellerInvite()" class="btn-secondary">
              <span>Preview Seller Landing Page</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
            </button>
            <button (click)="goToNegotiation()" class="btn-primary">
              <span>Enter Negotiation Room</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .wizard-container {
      max-width: 820px;
      margin: 2rem auto;
      padding: 0 1rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .card {
      background: #ffffff;
      border-radius: 16px;
      padding: 2rem;
      border: 1px solid #e2e8f0;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
    }
    .header-box {
      margin-bottom: 1.5rem;
    }
    .header-box.compact {
      margin-bottom: 1rem;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 700;
      color: #0284c7;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.25rem;
    }
    .project-pill {
      background: #eff6ff;
      color: #1d4ed8;
      border: 1px solid #bfdbfe;
      padding: 0.35rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 600;
    }
    h2 {
      margin: 0.25rem 0 0.5rem 0;
      font-size: 1.5rem;
      color: #0f172a;
    }
    .subtitle {
      color: #64748b;
      font-size: 0.95rem;
      margin: 0;
      line-height: 1.5;
    }
    .form-body {
      display: flex;
      flex-direction: column;
      gap: 1.15rem;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #334155;
    }
    .input, .textarea {
      width: 100%;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      font-size: 0.95rem;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.2s;
    }
    .input:focus, .textarea:focus {
      border-color: #0284c7;
      box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.1);
    }
    .btn-primary {
      background: #0284c7;
      color: white;
      padding: 0.85rem 1.5rem;
      border: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 1rem;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-primary:hover:not(:disabled) {
      background: #0369a1;
    }
    .btn-primary:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }
    .btn-secondary {
      background: #f1f5f9;
      color: #334155;
      padding: 0.85rem 1.5rem;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      font-weight: 600;
      font-size: 0.95rem;
      cursor: pointer;
    }

    /* Chat Section */
    .chat-stream {
      max-height: 380px;
      overflow-y: auto;
      border: 1px solid #f1f5f9;
      background: #f8fafc;
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      margin-bottom: 1rem;
    }
    .message-row {
      display: flex;
      gap: 0.65rem;
      max-width: 85%;
    }
    .message-row.user-row {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
    }
    .bubble {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      padding: 0.75rem 1rem;
      border-radius: 12px;
      font-size: 0.925rem;
      line-height: 1.5;
      color: #0f172a;
    }
    .user-bubble {
      background: #0284c7;
      color: #ffffff;
      border: none;
    }
    /* Milestones Timeline Card */
    .milestones-timeline-card {
      background: #ffffff;
      border: 1.5px solid #0070ba;
      border-radius: 14px;
      padding: 1.5rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 4px 16px rgba(0, 112, 186, 0.08);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .milestones-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.75rem;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 0.85rem;
    }
    .milestones-badge-group {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .badge-milestones-ready {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #e6f4ea;
      color: #137333;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      border: 1px solid #ceead6;
      width: fit-content;
    }
    .milestones-badge-group h3 {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 800;
      color: #001435;
    }
    .milestones-total-pill {
      background: #001435;
      color: #ffffff;
      font-weight: 700;
      font-size: 0.85rem;
      padding: 0.4rem 0.85rem;
      border-radius: 8px;
    }
    .milestones-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .milestone-item-row {
      display: flex;
      gap: 1rem;
      align-items: stretch;
    }
    .milestone-node-col {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 32px;
      flex-shrink: 0;
    }
    .node-circle {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #0070ba;
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 0.9rem;
      box-shadow: 0 2px 6px rgba(0, 112, 186, 0.3);
    }
    .node-track {
      flex: 1;
      width: 2px;
      background: #cbd5e1;
      margin: 0.35rem 0;
    }
    .milestone-details-box {
      flex: 1;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .milestone-main-line {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .milestone-name-title {
      font-size: 0.98rem;
      font-weight: 800;
      color: #001435;
    }
    .milestone-right-meta {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .milestone-deadline-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: #0369a1;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
    }
    .milestone-allocated-price {
      font-size: 0.95rem;
      font-weight: 800;
      color: #0070ba;
      background: #eef6fc;
      padding: 0.2rem 0.65rem;
      border-radius: 6px;
      border: 1px solid #c8e1f5;
      display: inline-flex;
      align-items: center;
    }
    .milestone-allocated-price.zero-price {
      color: #475569;
      background: #f8fafc;
      border-color: #cbd5e1;
    }
    .zero-badge {
      font-size: 0.68rem;
      font-weight: 700;
      color: #0369a1;
      background: #e0f2fe;
      padding: 0.12rem 0.45rem;
      border-radius: 4px;
      margin-right: 0.4rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .milestone-work-desc {
      margin: 0;
      font-size: 0.875rem;
      color: #475569;
      line-height: 1.5;
    }
    .milestone-proof-container {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 3.5px solid #16a34a;
      border-radius: 8px;
      padding: 0.65rem 0.85rem;
      margin-top: 0.25rem;
    }
    .proof-label-tag {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.72rem;
      font-weight: 800;
      color: #15803d;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.25rem;
    }
    .proof-desc-text {
      font-size: 0.85rem;
      color: #166534;
      font-weight: 600;
      line-height: 1.45;
    }
    .milestones-cta-box {
      padding-top: 0.5rem;
      display: flex;
      justify-content: flex-end;
    }
    .btn-finalize-milestones {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.85rem 1.6rem;
      border-radius: 10px;
      font-weight: 700;
      font-size: 1rem;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0, 112, 186, 0.3);
      transition: all 0.2s;
    }
    .btn-finalize-milestones:hover:not(:disabled) {
      background: #005ea6;
      transform: translateY(-1px);
    }
    .input-bar {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .chat-input {
      flex: 1;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      border: 1px solid #cbd5e1;
      font-size: 0.95rem;
      outline: none;
    }
    .btn-send {
      background: #0f172a;
      color: white;
      border: none;
      padding: 0 1.25rem;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
    }
    .chat-refine-hint {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: #f0f7ff;
      border: 1px solid #bae0fd;
      border-radius: 8px;
      padding: 0.6rem 0.85rem;
      font-size: 0.825rem;
      color: #0369a1;
      font-weight: 500;
      margin-bottom: 1.25rem;
    }
    .finalize-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 0.75rem;
      border-top: 1px solid #f1f5f9;
    }
    .hint-text {
      font-size: 0.85rem;
      color: #64748b;
    }
    .btn-finalize {
      background: #10b981;
      color: white;
      border: none;
      padding: 0.75rem 1.25rem;
      border-radius: 10px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-finalize.pulse {
      box-shadow: 0 0 15px rgba(16, 185, 129, 0.4);
    }
    .draft-preview-box {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 8px;
      padding: 0.75rem;
      margin-bottom: 0.75rem;
    }
    .preview-badge {
      font-size: 0.75rem;
      font-weight: 700;
      color: #047857;
      margin-bottom: 0.25rem;
    }
    .preview-snippet {
      font-size: 0.825rem;
      color: #065f46;
    }

    /* Success Card */
    .success-card {
      text-align: center;
    }
    .success-icon {
      font-size: 3rem;
      margin-bottom: 0.5rem;
    }
    .link-box {
      display: flex;
      gap: 0.5rem;
      margin: 1.5rem 0;
      background: #f8fafc;
      padding: 0.5rem;
      border-radius: 12px;
      border: 1px solid #cbd5e1;
    }
    .link-input {
      flex: 1;
      border: none;
      background: transparent;
      padding: 0.5rem;
      font-family: monospace;
      font-size: 0.9rem;
      color: #0f172a;
      outline: none;
    }
    .btn-copy {
      background: #0284c7;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    }
    .summary-preview {
      display: flex;
      justify-content: space-around;
      background: #f1f5f9;
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1.5rem;
    }
    .summary-item {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .summary-item .label {
      font-size: 0.75rem;
      color: #64748b;
    }
    .summary-item .val {
      font-weight: 700;
      color: #0f172a;
    }
    .status-tag {
      background: #dcfce7;
      color: #166534;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .action-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1rem;
    }
    .alert-error {
      background: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      padding: 0.75rem;
      border-radius: 8px;
      font-size: 0.9rem;
      margin-bottom: 1rem;
    }
    .typing {
      display: flex;
      gap: 4px;
      padding: 0.65rem 0.85rem;
    }
    .dot {
      width: 6px;
      height: 6px;
      background: #94a3b8;
      border-radius: 50%;
      animation: bounce 1.4s infinite ease-in-out both;
    }
    .dot:nth-child(1) { animation-delay: -0.32s; }
    .dot:nth-child(2) { animation-delay: -0.16s; }
    @keyframes bounce {
      0%, 80%, 100% { transform: scale(0); }
      40% { transform: scale(1); }
    }

    /* Pre-Evidence Desk Styles */
    .pre-evidence-section {
      margin-top: 1.5rem;
      padding: 1.25rem 1.5rem;
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 12px;
    }
    .pre-evidence-header {
      margin-bottom: 1rem;
    }
    .pre-evidence-title-cluster h4 {
      margin: 0.35rem 0 0 0;
      color: #001435;
      font-size: 1.05rem;
    }
    .pre-evidence-badge {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 800;
      background: #e0f2fe;
      color: #0284c7;
      padding: 0.2rem 0.55rem;
      border-radius: 4px;
      letter-spacing: 0.04em;
    }
    .pre-evidence-badge.is-mandatory {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fde68a;
    }
    .pre-evidence-hint {
      font-size: 0.825rem;
      color: #64748b;
      margin: 0.35rem 0 0.75rem 0;
      line-height: 1.45;
    }
    .before-captured-card {
      background: #f0fdf4;
      border: 1.5px solid #86efac;
      border-radius: 10px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .captured-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #15803d;
      font-size: 0.95rem;
    }
    .captured-meta {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .before-thumb {
      width: 100px;
      height: 70px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid #86efac;
    }
    .meta-texts {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.78rem;
    }
    .hash-label {
      font-family: monospace;
      color: #0284c7;
      background: #ffffff;
      padding: 0.2rem 0.45rem;
      border-radius: 4px;
      border: 1px solid #bae6fd;
    }
    .time-label {
      color: #64748b;
    }
    .btn-retake-before {
      align-self: flex-start;
      background: #ffffff;
      color: #334155;
      border: 1px solid #cbd5e1;
      padding: 0.35rem 0.8rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }
    .exemption-banner {
      background: #ffffff;
      border: 1.5px dashed #0284c7;
      border-radius: 10px;
      padding: 1rem;
      margin-bottom: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .exemption-text {
      font-size: 0.825rem;
      color: #334155;
    }
    .btn-declare-exemption {
      background: #f0f9ff;
      color: #0070ba;
      border: 1.5px solid #0070ba;
      padding: 0.65rem 1rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-declare-exemption:hover {
      background: #0070ba;
      color: #ffffff;
    }
    .exemption-card {
      background: #eff6ff;
      border: 1.5px solid #bfdbfe;
      border-radius: 10px;
      padding: 1.15rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .exemption-badge-row {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      color: #1d4ed8;
      font-size: 0.9rem;
    }
    .exemption-card p {
      margin: 0;
      font-size: 0.825rem;
      color: #334155;
      line-height: 1.45;
    }
    .btn-switch-to-cam {
      align-self: flex-start;
      margin-top: 0.35rem;
      background: #ffffff;
      color: #0070ba;
      border: 1px solid #cbd5e1;
      padding: 0.35rem 0.8rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }
    .baseline-choice-buttons {
      display: flex;
      flex-wrap: wrap;
      gap: 0.85rem;
      margin: 0.75rem 0 1.25rem 0;
    }
    .btn-choice-camera {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #0070ba;
      color: #ffffff;
      border: 1.5px solid #005ea6;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 112, 186, 0.2);
      transition: all 0.2s;
    }
    .btn-choice-camera:hover {
      background: #005ea6;
    }
    .btn-choice-camera.is-active {
      background: #059669;
      border-color: #047857;
    }
    .btn-choice-exemption {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #f8fafc;
      color: #475569;
      border: 1.5px solid #cbd5e1;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-choice-exemption:hover:not(:disabled) {
      background: #f1f5f9;
      color: #1e293b;
      border-color: #94a3b8;
    }
    .btn-choice-exemption.primary-scratch-btn {
      background: #eff6ff;
      border-color: #0070ba;
      color: #0070ba;
      font-weight: 800;
    }
    .btn-choice-exemption.primary-scratch-btn:hover:not(:disabled) {
      background: #dbeafe;
      border-color: #005ea6;
      color: #005ea6;
    }
    .scratch-panel {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1.25rem;
    }
    .baseline-blocked-alert {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      background: #fffbeb;
      border: 1.5px solid #fcd34d;
      border-radius: 8px;
      padding: 0.85rem 1rem;
      margin-bottom: 1rem;
      color: #92400e;
      font-size: 0.875rem;
      line-height: 1.45;
    }
    .baseline-blocked-alert p {
      margin: 0.25rem 0 0 0;
      color: #78350f;
    }
    .finalize-hint-warning {
      color: #b45309;
      font-size: 0.8rem;
      font-weight: 700;
      text-align: center;
      margin: 0.5rem 0 0 0;
    }
    .digital-upload-panel {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      background: #f8fafc;
      border: 1.5px dashed #0284c7;
      border-radius: 12px;
      padding: 1.5rem;
      margin: 0.75rem 0 1.25rem 0;
    }
    .digital-warning-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
      font-weight: 600;
      color: #0369a1;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      padding: 0.6rem 0.9rem;
      border-radius: 8px;
    }
    .digital-dropzone-box {
      background: #ffffff;
      border: 2px dashed #cbd5e1;
      border-radius: 10px;
      padding: 1.75rem 1rem;
      text-align: center;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.45rem;
      transition: all 0.2s;
    }
    .digital-dropzone-box:hover {
      border-color: #0070ba;
      background: #f0f9ff;
    }
    .dropzone-title {
      font-size: 0.95rem;
      font-weight: 700;
      color: #001435;
    }
    .dropzone-sub {
      font-size: 0.78rem;
      color: #64748b;
    }
    .hidden-file-input {
      display: none;
    }
    .digital-url-input-group {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .digital-url-input-group label {
      font-size: 0.825rem;
      font-weight: 600;
      color: #334155;
    }
    .corporate-input {
      width: 100%;
      box-sizing: border-box;
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.65rem 0.85rem;
      font-size: 0.9rem;
      color: #0f172a;
      outline: none;
      transition: border-color 0.2s;
    }
    .corporate-input:focus {
      border-color: #0070ba;
    }
    .digital-actions-row {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      flex-wrap: wrap;
    }
    .btn-upload-digital {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.75rem 1.25rem;
      border-radius: 8px;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-upload-digital:hover:not(:disabled) {
      background: #005ea6;
    }
    .btn-upload-digital:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    .physical-warning-text {
      font-size: 0.85rem;
      font-weight: 600;
      color: #b45309;
      margin: 0.5rem 0;
    }
  `]
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

  constructor(private http: HttpClient, private router: Router) {}

  isHomeRenovation(): boolean {
    if (this.isRenovation) return true;
    const text = `${this.title || ''} ${this.industryType || ''} ${this.description || ''}`.toLowerCase();
    const keywords = ['renovat', 'remodel', 'home renovation', 'bath', 'bathroom', 'kitchen', 'plumb', 'drywall', 'tile', 'flooring', 'paint', 'roof', 'house'];
    return keywords.some(k => text.includes(k));
  }

  canFinalizeDraft(): boolean {
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
      milestones: this.milestones
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
