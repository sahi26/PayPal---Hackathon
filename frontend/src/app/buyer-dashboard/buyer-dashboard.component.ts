import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ModuleRegistry, AllCommunityModule, GridReadyEvent, GridApi } from 'ag-grid-community';
import { API_BASE_URL } from '../api.config';
import { LiveCameraComponent } from '../live-camera/live-camera.component';

// Register AG Grid Community modules
ModuleRegistry.registerModules([AllCommunityModule]);

interface ProjectRow {
  id: number;
  title: string;
  industry_type: string;
  description: string;
  total_price: number;
  status: string;
  invite_token: string;
  buyer_email: string;
  seller_email: string;
  created_at: string;
  deadline?: string;
  version: number;
  has_agreement: boolean;
  is_accepted: boolean;
}

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
}

interface DraftChatResponse {
  status: 'asking' | 'complete';
  ai_response_text: string;
  milestones: MilestoneItem[];
  project_domain?: 'physical' | 'digital';
  is_renovation?: boolean;
  requires_baseline_evidence?: boolean;
}

@Component({
  selector: 'app-buyer-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, AgGridAngular, LiveCameraComponent],
  template: `
    <div class="paypal-shell">
      <!-- PayPal Style Header Banner -->
      <section class="pp-header-card">
        <div class="pp-header-content">
          <div class="user-profile-row">
            <div class="pp-monogram">P</div>
            <div>
              <div class="user-greeting">
                <span class="greeting-name">Welcome, ProofLens Buyer</span>
                <span class="pp-verified-badge">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>PayPal Verified</span>
                </span>
              </div>
              <div class="user-email-meta">buyer&#64;prooflens.com • Escrow Protection Active</div>
            </div>
          </div>

          <div class="header-right-actions">
            @if (currentView === 'dashboard') {
              <button (click)="openCreateProject()" class="btn-pp-primary">
                + Create New Project
              </button>
            } @else {
              <button (click)="closeCreateProject()" class="btn-pp-secondary">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
                <span>Back to Dashboard</span>
              </button>
            }
          </div>
        </div>

        <!-- Metric KPI Cards (PayPal Standard Style) -->
        <div class="pp-kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">TOTAL ESCROW VALUE</div>
            <div class="kpi-value">\${{ totalEscrowValue.toFixed(2) }}</div>
            <div class="kpi-sub">Protected by ProofLens Escrow</div>
          </div>

          <div class="kpi-card">
            <div class="kpi-label">ACTIVE PROJECTS</div>
            <div class="kpi-value">{{ projects.length }}</div>
            <div class="kpi-sub">Total managed contracts</div>
          </div>

          <div class="kpi-card">
            <div class="kpi-label">IN NEGOTIATION</div>
            <div class="kpi-value kpi-warning">{{ negotiatingCount }}</div>
            <div class="kpi-sub">Awaiting seller/buyer review</div>
          </div>

          <div class="kpi-card">
            <div class="kpi-label">ACCEPTED & FUNDED</div>
            <div class="kpi-value kpi-success">{{ acceptedCount }}</div>
            <div class="kpi-sub">Terms locked in escrow</div>
          </div>
        </div>
      </section>

      <!-- VIEW 1: AG GRID DASHBOARD -->
      @if (currentView === 'dashboard') {
        <section class="grid-section">
          <div class="section-toolbar">
            <div class="toolbar-left">
              <h3>Your Escrow Agreements</h3>
              <p class="toolbar-sub">Manage project contracts, invite contractors, and negotiate terms.</p>
            </div>
            <div class="toolbar-right">
              <input
                type="text"
                [(ngModel)]="searchQuery"
                (ngModelChange)="onSearchChange()"
                placeholder="Search projects or industries..."
                class="search-input"
              />
              <button (click)="loadProjects()" class="btn-refresh">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
                <span>Refresh</span>
              </button>
            </div>
          </div>

          <!-- Filter Tabs -->
          <div class="grid-filter-tabs">
            <button
              (click)="setFilterTab('all')"
              [class.active-tab]="activeFilterTab === 'all'"
              class="tab-btn"
            >
              All Contracts ({{ projects.length }})
            </button>
            <button
              (click)="setFilterTab('negotiating')"
              [class.active-tab]="activeFilterTab === 'negotiating'"
              class="tab-btn"
            >
              In Negotiation ({{ negotiatingCount }})
            </button>
            <button
              (click)="setFilterTab('accepted')"
              [class.active-tab]="activeFilterTab === 'accepted'"
              class="tab-btn"
            >
              Accepted & Funded ({{ acceptedCount }})
            </button>
            <button
              (click)="setFilterTab('invite_sent')"
              [class.active-tab]="activeFilterTab === 'invite_sent'"
              class="tab-btn"
            >
              Invites Pending ({{ inviteSentCount }})
            </button>
            <button
              (click)="setFilterTab('draft')"
              [class.active-tab]="activeFilterTab === 'draft'"
              class="tab-btn"
            >
              Drafts ({{ draftCount }})
            </button>
          </div>

          <!-- AG Grid Component with autoHeight -->
          <div class="ag-grid-wrapper">
            <ag-grid-angular
              class="ag-theme-quartz"
              style="width: 100%; min-height: 120px;"
              [domLayout]="'autoHeight'"
              [rowData]="filteredProjects"
              [columnDefs]="columnDefs"
              [defaultColDef]="defaultColDef"
              [rowHeight]="54"
              [headerHeight]="44"
              [pagination]="true"
              [paginationPageSize]="10"
              (gridReady)="onGridReady($event)"
            >
            </ag-grid-angular>
          </div>
        </section>
      }

      <!-- VIEW 2: CREATE PROJECT WIZARD (CLEAN PLACEHOLDERS ONLY) -->
      @if (currentView === 'create') {
        <section class="create-wizard-section">
          <!-- Wizard Step 1: Blank form with Placeholders -->
          @if (wizardStep === 1) {
            <div class="form-card">
              <div class="form-header">
                <span class="pp-step-tag">Step 1 of 3: Project Specifications</span>
                <h2>Create a New Escrow Project</h2>
                <p class="form-sub">Enter the details of what you are ordering. All fields are fresh—fill them in to begin AI legal drafting.</p>
              </div>

              @if (formError) {
                <div class="alert-error">{{ formError }}</div>
              }

              <div class="form-grid">
                <div class="form-group full-width">
                  <label>Project Title *</label>
                  <input
                    type="text"
                    [(ngModel)]="newProject.title"
                    placeholder="e.g. Custom Oak Dining Table, Brand Identity Design, Kitchen Sink Installation"
                    class="pp-input"
                  />
                </div>

                <div class="form-group">
                  <label>Industry / Category *</label>
                  <input
                    type="text"
                    [(ngModel)]="newProject.industry_type"
                    placeholder="e.g. Carpentry, Digital Art, Home Renovation, Software"
                    class="pp-input"
                  />
                </div>

                <div class="form-group">
                  <label>Escrow Budget (USD) *</label>
                  <input
                    type="number"
                    [(ngModel)]="newProject.total_price"
                    placeholder="e.g. 500"
                    class="pp-input"
                  />
                </div>

                <div class="form-group">
                  <label>Target Completion Deadline *</label>
                  <input
                    type="date"
                    [(ngModel)]="newProject.deadline"
                    class="pp-input"
                  />
                </div>

                <div class="form-group">
                  <label>Your Email Address (Buyer) *</label>
                  <input
                    type="email"
                    [(ngModel)]="newProject.buyer_email"
                    placeholder="e.g. buyer@example.com"
                    class="pp-input"
                  />
                </div>

                <div class="form-group full-width">
                  <label>Initial Scope Description *</label>
                  <textarea
                    [(ngModel)]="newProject.description"
                    rows="4"
                    placeholder="Describe what you expect delivered, including dimensions, materials, deliverables, or special requirements..."
                    class="pp-textarea"
                  ></textarea>
                </div>
              </div>

              <div class="form-actions">
                <button (click)="closeCreateProject()" class="btn-pp-secondary">Cancel</button>
                <button
                  (click)="submitInitProject()"
                  [disabled]="isSubmitting || !newProject.title || !newProject.description || !newProject.total_price || !newProject.deadline"
                  class="btn-pp-primary"
                >
                  {{ isSubmitting ? 'Initializing Project...' : 'Consult AI Legal Assistant →' }}
                </button>
              </div>
            </div>
          }

          <!-- Wizard Step 2: Interactive AI Chatbot -->
          @if (wizardStep === 2) {
            <div class="form-card chat-card">
              <div class="form-header">
                <div class="chat-header-row">
                  <div>
                    <span class="pp-step-tag">Step 2 of 3: Seller Scoping Consultation</span>
                    <h2>Contractor / Seller Scope & Specification Advisor</h2>
                  </div>
                  <div class="project-pill-tag">
                    {{ newProject.title }} • \${{ newProject.total_price }}
                  </div>
                </div>
                <p class="form-sub">ProofLens AI is acting in the role of your expert fulfillment seller, gathering technical specifications and drafting your escrow agreement.</p>
              </div>

              <!-- Chat Stream -->
              <div class="chat-stream-box">
                @for (msg of chatMessages; track $index) {
                  <div class="chat-row" [class.user-row]="msg.role === 'user'">
                    <div class="chat-avatar" [class.assistant-avatar]="msg.role === 'assistant'" [class.user-avatar]="msg.role === 'user'">
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
                    <div class="chat-bubble" [class.user-bubble]="msg.role === 'user'">
                      {{ msg.content }}
                    </div>
                  </div>
                }

                @if (isAiThinking) {
                  <div class="chat-row">
                    <div class="chat-avatar assistant-avatar">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 3v18M3 9l9-6 9 6M3 9a4 4 0 0 0 8 0M13 9a4 4 0 0 0 8 0"/>
                      </svg>
                    </div>
                    <div class="chat-bubble typing">
                      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
                    </div>
                  </div>
                }
              </div>

              <!-- Input bar (ALWAYS active until Finalize is clicked) -->
              <div class="chat-bar">
                <input
                  type="text"
                  [(ngModel)]="chatInput"
                  (keydown.enter)="sendAiClarification()"
                  [placeholder]="isDraftComplete ? 'Text AI to refine milestones, adjust terms, or add requirements... (Press Enter)' : 'Answer AI questions or add specifications... (Press Enter)'"
                  class="pp-input chat-input-field"
                  [disabled]="isAiThinking"
                />
                <button (click)="sendAiClarification()" [disabled]="!chatInput.trim() || isAiThinking" class="btn-pp-send">
                  Send
                </button>
              </div>

              @if (isDraftComplete) {
                <div class="chat-refine-hint">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2">
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
                      Total Allocation: \${{ newProject.total_price }} USD
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
                              @if (ms.deadline) {
                                <div class="milestone-deadline-pill">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                    <line x1="16" y1="2" x2="16" y2="6"/>
                                    <line x1="8" y1="2" x2="8" y2="6"/>
                                    <line x1="3" y1="10" x2="21" y2="10"/>
                                  </svg>
                                  <span>Due: {{ ms.deadline }}</span>
                                </div>
                              }
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
                              [projectId]="createdProjectId"
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
                                  [projectId]="createdProjectId"
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
                              <span><strong>MANDATORY DIGITAL BASELINE:</strong> Please upload screenshots or links to your current digital assets / existing website or design before redesign.</span>
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
                    <button (click)="finalizeProject()" [disabled]="isSubmitting || !canFinalizeDraft()" class="btn-finalize-milestones">
                      <span>{{ isSubmitting ? 'Generating Invitation...' : 'Finalize & Generate Invite Link →' }}</span>
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

          <!-- Wizard Step 3: Success Share Screen -->
          @if (wizardStep === 3) {
            <div class="form-card success-card">
              <div class="success-check-badge">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h2>Seller Invitation Link Ready!</h2>
              <p class="form-sub">Send this private invite link to your seller/contractor. When they open it, they can view the terms and enter the negotiation room.</p>

              <div class="invite-copy-container">
                <input type="text" [value]="createdInviteUrl" readonly class="invite-url-input" />
                <button (click)="copyInviteLink()" class="btn-copy-pp">
                  {{ copyBtnText }}
                </button>
              </div>

              <div class="success-actions-row">
                <button (click)="openSellerPreview()" class="btn-pp-secondary">
                  <span>Preview Seller Page</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>
                </button>
                <button (click)="enterNegotiationRoom(createdProjectId!)" class="btn-pp-secondary">
                  <span>Open Negotiation Room</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
                <button (click)="closeCreateProject()" class="btn-pp-primary">
                  Done & Return to Dashboard
                </button>
              </div>
            </div>
          }
        </section>
      }
    </div>
  `,
  styles: [`
    .paypal-shell {
      max-width: 1240px;
      margin: 1.5rem auto;
      padding: 0 1rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #001435;
    }

    /* PayPal Header Card */
    .pp-header-card {
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid #e1e7eb;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04);
      padding: 1.5rem 2rem;
      margin-bottom: 1.5rem;
    }
    .pp-header-content {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      border-bottom: 1px solid #f1f4f8;
      padding-bottom: 1.25rem;
    }
    .user-profile-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .pp-monogram {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #003087 0%, #0070ba 100%);
      color: #ffffff;
      font-weight: 800;
      font-size: 1.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 48, 135, 0.2);
    }
    .user-greeting {
      display: flex;
      align-items: center;
      gap: 0.65rem;
    }
    .greeting-name {
      font-size: 1.25rem;
      font-weight: 700;
      color: #001435;
    }
    .pp-verified-badge {
      background: #e8f5e9;
      color: #1b5e20;
      font-size: 0.725rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
    }
    .user-email-meta {
      font-size: 0.85rem;
      color: #545d68;
      margin-top: 0.2rem;
    }
    .btn-pp-primary {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.65rem 1.35rem;
      border-radius: 24px;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
      box-shadow: 0 2px 6px rgba(0, 112, 186, 0.2);
    }
    .btn-pp-primary:hover:not(:disabled) {
      background: #005ea6;
    }
    .btn-pp-primary:disabled {
      background: #a8d1f0;
      cursor: not-allowed;
    }
    .btn-pp-secondary {
      background: #ffffff;
      color: #0070ba;
      border: 1.5px solid #0070ba;
      padding: 0.65rem 1.25rem;
      border-radius: 24px;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.2s;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }
    .btn-pp-secondary:hover {
      background: #f0f7fc;
    }
    .btn-pp-success {
      background: #108a00;
      color: #ffffff;
      border: none;
      padding: 0.65rem 1.35rem;
      border-radius: 24px;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
    }

    /* KPI Grid */
    .pp-kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1rem;
      padding-top: 1.25rem;
    }
    @media (max-width: 860px) {
      .pp-kpi-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    .kpi-card {
      background: #fbfcfe;
      border: 1px solid #eef2f6;
      border-radius: 12px;
      padding: 1rem 1.25rem;
    }
    .kpi-label {
      font-size: 0.7rem;
      font-weight: 700;
      color: #68717d;
      letter-spacing: 0.05em;
      margin-bottom: 0.35rem;
    }
    .kpi-value {
      font-size: 1.65rem;
      font-weight: 800;
      color: #001435;
    }
    .kpi-warning { color: #d97706; }
    .kpi-success { color: #108a00; }
    .kpi-sub {
      font-size: 0.75rem;
      color: #8c97a5;
      margin-top: 0.25rem;
    }

    /* Grid Section */
    .grid-section {
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid #e1e7eb;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04);
      padding: 1.5rem;
    }
    .section-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .toolbar-left h3 {
      margin: 0;
      font-size: 1.2rem;
      font-weight: 700;
      color: #001435;
    }
    .toolbar-sub {
      margin: 0.2rem 0 0 0;
      font-size: 0.85rem;
      color: #545d68;
    }
    .toolbar-right {
      display: flex;
      gap: 0.65rem;
      align-items: center;
    }
    .search-input {
      padding: 0.55rem 0.95rem;
      border-radius: 20px;
      border: 1px solid #cbd5e1;
      font-size: 0.875rem;
      outline: none;
      width: 240px;
    }
    .search-input:focus {
      border-color: #0070ba;
    }
    .btn-refresh {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 0.55rem 0.95rem;
      border-radius: 20px;
      font-size: 0.85rem;
      font-weight: 600;
      color: #334155;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-refresh:hover {
      background: #e2e8f0;
      color: #001435;
    }
    .grid-filter-tabs {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
      flex-wrap: wrap;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 0.75rem;
    }
    .tab-btn {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 0.45rem 0.95rem;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 700;
      color: #475569;
      cursor: pointer;
      transition: all 0.2s;
    }
    .tab-btn:hover {
      background: #e2e8f0;
      color: #001435;
    }
    .tab-btn.active-tab {
      background: #0070ba;
      color: #ffffff;
      border-color: #0070ba;
      box-shadow: 0 2px 6px rgba(0, 112, 186, 0.3);
    }
    .ag-grid-wrapper {
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e1e7eb;
    }

    /* Form Card */
    .form-card {
      background: #ffffff;
      border-radius: 16px;
      border: 1px solid #e1e7eb;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
      padding: 2rem;
    }
    .pp-step-tag {
      font-size: 0.75rem;
      font-weight: 800;
      color: #0070ba;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .form-header h2 {
      margin: 0.35rem 0 0.5rem 0;
      font-size: 1.5rem;
      color: #001435;
    }
    .form-sub {
      margin: 0 0 1.5rem 0;
      color: #545d68;
      font-size: 0.925rem;
      line-height: 1.5;
    }
    .form-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 1.25rem;
    }
    .full-width {
      grid-column: span 2;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .form-group label {
      font-size: 0.85rem;
      font-weight: 700;
      color: #2c333a;
    }
    .pp-input, .pp-textarea {
      width: 100%;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      border: 1.5px solid #cbd5e1;
      font-size: 0.95rem;
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.2s;
    }
    .pp-input:focus, .pp-textarea:focus {
      border-color: #0070ba;
      box-shadow: 0 0 0 3px rgba(0, 112, 186, 0.12);
    }
    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 1rem;
      margin-top: 1.75rem;
      padding-top: 1.25rem;
      border-top: 1px solid #f1f4f8;
    }

    /* Chat Card */
    .chat-header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .project-pill-tag {
      background: #e8f4fd;
      color: #0070ba;
      font-weight: 700;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      border: 1px solid #bfdbfe;
    }
    .chat-stream-box {
      max-height: 360px;
      overflow-y: auto;
      background: #f8fafc;
      border: 1px solid #e1e7eb;
      border-radius: 12px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
      margin-bottom: 1rem;
    }
    .chat-row {
      display: flex;
      gap: 0.65rem;
      max-width: 85%;
    }
    .chat-row.user-row {
      align-self: flex-end;
      flex-direction: row-reverse;
    }
    .chat-avatar {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: #ffffff;
      border: 1px solid #e1e7eb;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1rem;
      flex-shrink: 0;
    }
    .chat-bubble {
      background: #ffffff;
      border: 1px solid #e1e7eb;
      padding: 0.75rem 1rem;
      border-radius: 12px;
      font-size: 0.925rem;
      color: #001435;
      line-height: 1.5;
    }
    .user-bubble {
      background: #0070ba;
      color: #ffffff;
      border: none;
    }
    .draft-preview-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1.25rem;
      box-shadow: 0 2px 8px rgba(0, 20, 53, 0.04);
    }
    .draft-preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 0.75rem;
      border-bottom: 1px solid #e2e8f0;
    }
    .draft-preview-title {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .preview-badge-pill {
      background: #0070ba;
      color: #ffffff;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
    }
    .preview-sub-note {
      font-size: 0.8rem;
      color: #64748b;
      font-weight: 500;
    }
    .draft-preview-content {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .preview-section-block {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 1rem;
    }
    .evidence-block {
      background: #f0fdf4;
      border-color: #bbf7d0;
      border-left: 4px solid #16a34a;
    }
    .preview-block-label {
      display: block;
      font-size: 0.78rem;
      font-weight: 800;
      color: #001435;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.5rem;
    }
    .preview-pre-text {
      margin: 0;
      font-family: inherit;
      font-size: 0.875rem;
      color: #334155;
      line-height: 1.6;
      white-space: pre-wrap;
    }
    .chat-bar {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .btn-pp-send {
      background: #003087;
      color: white;
      border: none;
      padding: 0 1.25rem;
      border-radius: 10px;
      font-weight: 700;
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
    .finalize-cta-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-top: 1rem;
      border-top: 1px solid #f1f4f8;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .finalize-hint {
      font-size: 0.85rem;
      color: #545d68;
    }

    /* Success Card */
    .success-card {
      text-align: center;
      padding: 3rem 2rem;
    }
    .success-check-badge {
      width: 64px;
      height: 64px;
      background: #e8f5e9;
      color: #108a00;
      font-size: 2rem;
      font-weight: 800;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1rem auto;
      border: 2px solid #a5d6a7;
    }
    .invite-copy-container {
      display: flex;
      gap: 0.5rem;
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      padding: 0.5rem;
      border-radius: 12px;
      max-width: 650px;
      margin: 1.5rem auto;
    }
    .invite-url-input {
      flex: 1;
      border: none;
      background: transparent;
      padding: 0.5rem;
      font-family: monospace;
      font-size: 0.9rem;
      outline: none;
    }
    .btn-copy-pp {
      background: #0070ba;
      color: white;
      border: none;
      padding: 0.55rem 1.15rem;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
    }
    .success-actions-row {
      display: flex;
      justify-content: center;
      gap: 1rem;
      margin-top: 1.5rem;
      flex-wrap: wrap;
    }
    .alert-error {
      background: #fdf2f2;
      border: 1px solid #f8b4b4;
      color: #9b1c1c;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.9rem;
      margin-bottom: 1.25rem;
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

    /* Milestones Timeline Card (PayPal Corporate standard) */
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
      padding-top: 1rem;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.5rem;
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
    .btn-finalize-milestones:disabled {
      background: #94a3b8;
      box-shadow: none;
      cursor: not-allowed;
    }
    .finalize-hint-warning {
      color: #b45309;
      font-size: 0.82rem;
      font-weight: 600;
      margin: 0;
      text-align: right;
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
    .exemption-card {
      background: #f0f9ff;
      border: 1.5px solid #bae6fd;
      border-radius: 10px;
      padding: 1rem 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .exemption-badge-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #0369a1;
      font-size: 0.95rem;
    }
    .exemption-card p {
      margin: 0;
      font-size: 0.85rem;
      color: #334155;
      line-height: 1.45;
    }
    .btn-switch-to-cam {
      align-self: flex-start;
      background: #ffffff;
      color: #0284c7;
      border: 1px solid #bae6fd;
      padding: 0.35rem 0.8rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }
    .capture-zone {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .baseline-blocked-alert {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      background: #fffbeb;
      border: 1.5px solid #fde68a;
      border-left: 4px solid #b45309;
      padding: 0.85rem 1rem;
      border-radius: 8px;
      color: #92400e;
      font-size: 0.85rem;
    }
    .baseline-blocked-alert strong {
      display: block;
      margin-bottom: 0.2rem;
      color: #78350f;
    }
    .baseline-blocked-alert p {
      margin: 0;
    }
    .physical-cam-wrapper {
      margin-top: 0.5rem;
    }
    .scratch-panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .baseline-choice-buttons {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
    .btn-choice-exemption {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #f8fafc;
      color: #0f172a;
      border: 1.5px solid #cbd5e1;
      padding: 0.75rem 1.15rem;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-choice-exemption:hover {
      border-color: #0284c7;
      background: #f0f9ff;
    }
    .primary-scratch-btn {
      background: #f0f9ff;
      border-color: #7dd3fc;
      color: #0369a1;
      font-weight: 700;
    }
    .btn-choice-camera {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #ffffff;
      color: #334155;
      border: 1.5px solid #cbd5e1;
      padding: 0.75rem 1.15rem;
      border-radius: 8px;
      font-size: 0.875rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-choice-camera:hover, .btn-choice-camera.is-active {
      border-color: #0070ba;
      color: #0070ba;
      background: #f0f7ff;
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
export class BuyerDashboardComponent implements OnInit {
  currentView: 'dashboard' | 'create' = 'dashboard';
  wizardStep = 1;

  // Projects list for AG Grid
  projects: ProjectRow[] = [];
  filteredProjects: ProjectRow[] = [];
  searchQuery = '';
  private gridApi!: GridApi;

  // KPI Metrics
  totalEscrowValue = 0;
  negotiatingCount = 0;
  acceptedCount = 0;
  inviteSentCount = 0;
  draftCount = 0;
  activeFilterTab: 'all' | 'negotiating' | 'accepted' | 'invite_sent' | 'draft' = 'all';

  // Blank Form Inputs with ZERO pre-defined values
  newProject = {
    title: '',
    industry_type: '',
    total_price: null as number | null,
    deadline: '',
    buyer_email: '',
    description: ''
  };

  formError = '';
  isSubmitting = false;

  // Chat & Milestones State
  createdProjectId: number | null = null;
  createdInviteToken = '';
  createdInviteUrl = '';
  copyBtnText = 'Copy Invite Link';

  chatMessages: ChatMsg[] = [];
  chatInput = '';
  isAiThinking = false;
  isDraftComplete = false;
  milestones: MilestoneItem[] = [];

  // Before Evidence State
  projectDomain: 'physical' | 'digital' = 'physical';
  isRenovation = false;
  requiresBaselineEvidence = false;
  digitalAssetFile: File | null = null;
  digitalAssetUrl = '';
  isUploadingDigitalAsset = false;
  uploadError = '';

  beforeEvidenceCaptured = false;
  beforeEvidenceExempt = false;
  beforeEvidenceItem: any = null;
  isDeclaringExemption = false;
  baselineEvidenceBlocked = false;
  baselineBlockedMessage = '';
  isShowingLiveCamera = false;

  // AG Grid Column Definitions
  columnDefs: ColDef[] = [
    {
      field: 'id',
      headerName: 'Escrow ID',
      width: 105,
      sortable: true,
      cellRenderer: (params: any) => {
        return `<div style="display:flex; align-items:center; height:100%;"><span style="font-family:monospace; font-weight:800; background:#f1f5f9; color:#334155; padding:3px 7px; border-radius:6px; border:1px solid #cbd5e1; font-size:11px;">#PL-${params.value}</span></div>`;
      }
    },
    {
      field: 'title',
      headerName: 'Project Scope',
      flex: 2,
      minWidth: 200,
      filter: true,
      sortable: true,
      cellRenderer: (params: any) => {
        const title = params.data.title || 'Untitled Scope';
        const ind = params.data.industry_type || 'General';
        return `
          <div style="display:flex; flex-direction:column; justify-content:center; height:100%; line-height:1.25;">
            <span style="font-weight:700; color:#001435; font-size:13px;">${title}</span>
            <span style="font-size:11px; color:#0070ba; font-weight:600;">${ind}</span>
          </div>
        `;
      }
    },
    {
      field: 'total_price',
      headerName: 'Escrow Budget',
      width: 145,
      sortable: true,
      cellRenderer: (params: any) => {
        const val = Number(params.value || 0).toFixed(2);
        return `
          <div style="display:flex; align-items:center; height:100%;">
            <span style="font-weight:800; color:#001435; font-size:13px;">\$${val}</span>
            <span style="font-size:10px; font-weight:700; color:#64748b; margin-left:4px;">USD</span>
          </div>
        `;
      }
    },
    {
      field: 'status',
      headerName: 'Escrow Status',
      width: 185,
      cellRenderer: (params: any) => {
        const val = (params.value || 'draft').toLowerCase();
        let bg = '#f1f5f9';
        let color = '#475569';
        let border = '#e2e8f0';
        let label = 'DRAFT';

        if (val === 'accepted') {
          bg = '#dcfce7'; color = '#15803d'; border = '#86efac'; label = 'ACCEPTED & FUNDED';
        } else if (val === 'negotiating') {
          bg = '#fef3c7'; color = '#b45309'; border = '#fde68a'; label = 'IN NEGOTIATION';
        } else if (val === 'seller_joined') {
          bg = '#e0f2fe'; color = '#0369a1'; border = '#bae6fd'; label = 'SELLER JOINED';
        } else if (val === 'invite_sent') {
          bg = '#ede9fe'; color = '#6d28d9'; border = '#ddd6fe'; label = 'INVITE SENT';
        }

        return `
          <div style="display:flex; align-items:center; height:100%;">
            <span style="background:${bg}; color:${color}; border:1px solid ${border}; font-size:11px; font-weight:800; padding:3px 9px; border-radius:9999px; letter-spacing:0.03em;">${label}</span>
          </div>
        `;
      }
    },
    {
      field: 'version',
      headerName: 'Version',
      width: 95,
      cellRenderer: (params: any) => {
        const v = params.value || 1;
        return `
          <div style="display:flex; align-items:center; height:100%;">
            <span style="background:#f8fafc; color:#0f172a; border:1px solid #cbd5e1; font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px;">v${v}.0</span>
          </div>
        `;
      }
    },
    {
      field: 'seller_email',
      headerName: 'Contractor',
      width: 175,
      cellRenderer: (params: any) => {
        const seller = params.value;
        const display = seller && seller !== 'Awaiting Seller'
          ? `<span style="font-size:12px; font-weight:600; color:#334155;">${seller}</span>`
          : `<span style="font-size:11px; color:#94a3b8; font-style:italic;">Awaiting Contractor</span>`;
        return `<div style="display:flex; align-items:center; height:100%;">${display}</div>`;
      }
    },
    {
      field: 'created_at',
      headerName: 'Timeline',
      width: 145,
      cellRenderer: (params: any) => {
        const init = params.value || 'Nov 01, 2026';
        const deadline = params.data?.deadline ? `<span style="font-size:11px; font-weight:700; color:#b45309; display:block;">Due: ${params.data.deadline}</span>` : '';
        return `
          <div style="display:flex; flex-direction:column; justify-content:center; height:100%; line-height:1.3;">
            <span style="font-size:12px; color:#64748b;">${init}</span>
            ${deadline}
          </div>
        `;
      }
    },
    {
      headerName: 'Actions',
      width: 200,
      cellRenderer: (params: any) => {
        const id = params.data.id;
        const token = params.data.invite_token;
        return `
          <div style="display: flex; gap: 6px; align-items: center; height: 100%;">
            <button onclick="window.dispatchEvent(new CustomEvent('openRoom', {detail: ${id}}))"
                    style="background: #0070ba; color: white; border: none; padding: 5px 12px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px;">
              <span>Room</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
            </button>
            ${token ? `
            <button onclick="window.dispatchEvent(new CustomEvent('copyToken', {detail: '${token}'}))"
                    style="background: #ffffff; color: #0070ba; border: 1.5px solid #0070ba; padding: 4px 9px; border-radius: 6px; font-size: 11px; font-weight: 700; cursor: pointer;">
              Copy Link
            </button>` : ''}
          </div>
        `;
      }
    }
  ];

  defaultColDef: ColDef = {
    resizable: true,
    sortable: true
  };

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit() {
    this.loadProjects();

    // Listen to AG Grid custom event button clicks
    window.addEventListener('openRoom', (event: any) => {
      this.enterNegotiationRoom(event.detail);
    });
    window.addEventListener('copyToken', (event: any) => {
      const url = `http://localhost:4200/invite/${event.detail}`;
      navigator.clipboard.writeText(url);
      alert('Invite link copied to clipboard:\n' + url);
    });
  }

  loadProjects() {
    this.http.get<ProjectRow[]>(`${API_BASE_URL}/api/projects`)
      .subscribe({
        next: (data) => {
          this.projects = data || [];
          this.filteredProjects = [...this.projects];
          this.calculateKpis();
        },
        error: () => {
          this.projects = [];
          this.filteredProjects = [];
        }
      });
  }

  calculateKpis() {
    this.totalEscrowValue = this.projects.reduce((acc, p) => acc + (Number(p.total_price) || 0), 0);
    this.negotiatingCount = this.projects.filter(p => (p.status || '').toLowerCase() === 'negotiating' || (p.status || '').toLowerCase() === 'seller_joined').length;
    this.acceptedCount = this.projects.filter(p => (p.status || '').toLowerCase() === 'accepted').length;
    this.inviteSentCount = this.projects.filter(p => (p.status || '').toLowerCase() === 'invite_sent').length;
    this.draftCount = this.projects.filter(p => (p.status || '').toLowerCase() === 'draft').length;
    this.applyFilters();
  }

  setFilterTab(tab: 'all' | 'negotiating' | 'accepted' | 'invite_sent' | 'draft') {
    this.activeFilterTab = tab;
    this.applyFilters();
  }

  applyFilters() {
    let list = [...this.projects];

    if (this.activeFilterTab === 'negotiating') {
      list = list.filter(p => (p.status || '').toLowerCase() === 'negotiating' || (p.status || '').toLowerCase() === 'seller_joined');
    } else if (this.activeFilterTab === 'accepted') {
      list = list.filter(p => (p.status || '').toLowerCase() === 'accepted');
    } else if (this.activeFilterTab === 'invite_sent') {
      list = list.filter(p => (p.status || '').toLowerCase() === 'invite_sent');
    } else if (this.activeFilterTab === 'draft') {
      list = list.filter(p => (p.status || '').toLowerCase() === 'draft');
    }

    const q = this.searchQuery.toLowerCase().trim();
    if (q) {
      list = list.filter(p =>
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.industry_type && p.industry_type.toLowerCase().includes(q)) ||
        (p.status && p.status.toLowerCase().includes(q)) ||
        (p.seller_email && p.seller_email.toLowerCase().includes(q))
      );
    }

    this.filteredProjects = list;
  }

  onGridReady(params: GridReadyEvent) {
    this.gridApi = params.api;
  }

  onSearchChange() {
    this.applyFilters();
  }

  openCreateProject() {
    // Reset to pure empty values
    this.newProject = {
      title: '',
      industry_type: '',
      total_price: null,
      deadline: '',
      buyer_email: '',
      description: ''
    };
    this.wizardStep = 1;
    this.formError = '';
    this.isDraftComplete = false;
    this.milestones = [];
    this.chatMessages = [];
    this.projectDomain = 'physical';
    this.isRenovation = false;
    this.requiresBaselineEvidence = false;
    this.beforeEvidenceCaptured = false;
    this.beforeEvidenceExempt = false;
    this.beforeEvidenceItem = null;
    this.digitalAssetFile = null;
    this.digitalAssetUrl = '';
    this.baselineEvidenceBlocked = false;
    this.baselineBlockedMessage = '';
    this.isShowingLiveCamera = false;
    this.currentView = 'create';
  }

  closeCreateProject() {
    this.currentView = 'dashboard';
    this.loadProjects();
  }

  submitInitProject() {
    this.formError = '';
    if (!this.newProject.title.trim() || !this.newProject.description.trim() || !this.newProject.total_price || !this.newProject.deadline) {
      this.formError = 'Please fill out all required fields including project title, budget, deadline, and description.';
      return;
    }

    this.isSubmitting = true;
    this.isDraftComplete = false;
    this.milestones = [];

    const payload = {
      title: this.newProject.title.trim(),
      industry_type: this.newProject.industry_type.trim() || 'General',
      description: this.newProject.description.trim(),
      total_price: Number(this.newProject.total_price),
      deadline: this.newProject.deadline,
      buyer_email: this.newProject.buyer_email.trim() || 'buyer@prooflens.com'
    };

    this.http.post<any>(`${API_BASE_URL}/api/projects/init`, payload)
      .subscribe({
        next: (res) => {
          this.createdProjectId = res.project_id;
          this.projectDomain = (res.project_domain as 'physical' | 'digital') || 'physical';
          this.isRenovation = !!res.is_renovation;
          this.requiresBaselineEvidence = !!res.requires_baseline_evidence;
          this.beforeEvidenceCaptured = false;
          this.beforeEvidenceExempt = false;
          this.beforeEvidenceItem = null;
          this.digitalAssetFile = null;
          this.digitalAssetUrl = '';
          this.wizardStep = 2;
          this.isAiThinking = true;
          this.isSubmitting = false;

          const initialMessage = `Project created: "${this.newProject.title}" (${this.newProject.industry_type || 'General'}) with budget $${Number(this.newProject.total_price || 0).toFixed(2)}, target delivery deadline: ${this.newProject.deadline}. Scope: ${this.newProject.description}`;
          this.http.post<DraftChatResponse>(`${API_BASE_URL}/api/projects/${this.createdProjectId}/draft-chat`, { user_message: initialMessage })
            .subscribe({
              next: (chatRes) => {
                this.isAiThinking = false;
                if (chatRes.project_domain) {
                  this.projectDomain = chatRes.project_domain;
                }
                if (chatRes.is_renovation !== undefined) {
                  this.isRenovation = !!chatRes.is_renovation;
                }
                if (chatRes.requires_baseline_evidence !== undefined) {
                  this.requiresBaselineEvidence = !!chatRes.requires_baseline_evidence;
                }
                this.chatMessages = [
                  {
                    role: 'assistant',
                    content: chatRes.ai_response_text
                  }
                ];
                if (chatRes.status === 'complete' && chatRes.milestones && chatRes.milestones.length > 0) {
                  this.isDraftComplete = true;
                  this.milestones = chatRes.milestones;
                }
              },
              error: (chatErr) => {
                this.isAiThinking = false;
                console.warn('Draft chat init error:', chatErr);
                this.chatMessages = [
                  {
                    role: 'assistant',
                    content: `Hello! I am your AI scoping assistant for "${this.newProject.title}" ($${Number(this.newProject.total_price || 0).toFixed(2)} USD). To break this project down into milestone-based escrow payments, what are the exact dimensions/sizes, base materials, and target delivery deadline?`
                  }
                ];
              }
            });
        },
        error: (err) => {
          this.isSubmitting = false;
          console.error('Project init error:', err);
          this.formError = err.error?.detail || err.message || 'Failed to initialize project.';
        }
      });
  }

  sendAiClarification() {
    const text = this.chatInput.trim();
    if (!text || this.isAiThinking || !this.createdProjectId) return;

    this.chatMessages.push({ role: 'user', content: text });
    this.chatInput = '';
    this.isAiThinking = true;

    this.http.post<DraftChatResponse>(`${API_BASE_URL}/api/projects/${this.createdProjectId}/draft-chat`, { user_message: text })
      .subscribe({
        next: (res) => {
          this.isAiThinking = false;
          if (res.project_domain) {
            this.projectDomain = res.project_domain;
          }
          if (res.is_renovation !== undefined) {
            this.isRenovation = !!res.is_renovation;
          }
          if (res.requires_baseline_evidence !== undefined) {
            this.requiresBaselineEvidence = !!res.requires_baseline_evidence;
          }
          this.chatMessages.push({
            role: 'assistant',
            content: res.ai_response_text
          });

          if (res.status === 'complete' && res.milestones && res.milestones.length > 0) {
            this.isDraftComplete = true;
            this.milestones = res.milestones;
          }
        },
        error: (err) => {
          this.isAiThinking = false;
          console.error('Draft chat error:', err);
          this.chatMessages.push({
            role: 'assistant',
            content: `Understood! I've logged: "${text}". Please specify required verification proof or timeline to complete the milestone breakdown.`
          });
        }
      });
  }

  isHomeRenovation(): boolean {
    if (this.isRenovation) return true;
    const text = `${this.newProject.title || ''} ${this.newProject.industry_type || ''} ${this.newProject.description || ''}`.toLowerCase();
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
    if (!this.createdProjectId) {
      this.beforeEvidenceExempt = true;
      return;
    }
    this.isDeclaringExemption = true;
    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.createdProjectId}/declare-before-exemption`, {})
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
    if (!this.createdProjectId) return;

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

    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.createdProjectId}/evidence`, formData)
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

  getEvidenceUrl(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    return `${API_BASE_URL}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
  }

  finalizeProject() {
    if (!this.createdProjectId) return;
    if (!this.canFinalizeDraft()) {
      if (this.projectDomain === 'physical' && this.isRenovation) {
        alert('Mandatory: A live physical camera capture of the existing site/asset is strictly required for physical renovation projects before generating the seller invite link.');
      } else if (this.projectDomain === 'digital' && this.isRenovation) {
        alert('Mandatory: A baseline file upload (PDF/PNG) or asset URL is strictly required for digital redesign projects before generating the seller invite link.');
      } else {
        alert('Please click "[No appropriate evidence can be provided (Built from scratch)]" to unlock link generation.');
      }
      return;
    }
    this.isSubmitting = true;

    const payload = {
      contract_terms: this.milestones.map((m, i) => `${i + 1}. ${m.title} ($${m.price_allocation.toFixed(2)}): ${m.description}`).join('\n\n'),
      evidence_requirements: this.milestones.map((m, i) => `• Milestone ${i + 1} (${m.title}): ${m.proof_required}`).join('\n'),
      milestones: this.milestones
    };

    this.http.post<any>(`${API_BASE_URL}/api/projects/${this.createdProjectId}/finalize-draft`, payload)
      .subscribe({
        next: (res) => {
          this.isSubmitting = false;
          this.createdInviteToken = res.invite_token;
          this.createdInviteUrl = res.invite_url;
          this.wizardStep = 3;
        },
        error: (err) => {
          this.isSubmitting = false;
          alert('Failed to finalize draft: ' + (err.error?.detail || err.message));
        }
      });
  }

  copyInviteLink() {
    navigator.clipboard.writeText(this.createdInviteUrl);
    this.copyBtnText = 'Copied to Clipboard';
    setTimeout(() => {
      this.copyBtnText = 'Copy Invite Link';
    }, 2000);
  }

  openSellerPreview() {
    this.router.navigate(['/invite', this.createdInviteToken]);
  }

  enterNegotiationRoom(projectId: number) {
    this.router.navigate(['/project', projectId, 'negotiate'], { queryParams: { role: 'buyer' } });
  }
}
