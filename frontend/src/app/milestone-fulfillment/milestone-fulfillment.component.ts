import { Component, OnInit } from '@angular/core';
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
  template: `
    <div class="fulfillment-shell">
      @if (isLoading) {
        <div class="loading-state-card">
          <div class="spinner"></div>
          <p>Loading project fulfillment desk...</p>
        </div>
      } @else if (!projectData) {
        <div class="error-state-card">
          <h3>Project Not Found</h3>
          <p>Unable to retrieve project details.</p>
          <button (click)="goBack()" class="btn-primary-action">Return to Dashboard</button>
        </div>
      } @else if (!isProjectAccepted()) {
        <!-- Guard Card: Not yet accepted -->
        <div class="unaccepted-guard-card">
          <div class="guard-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2.2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
          <h2>Milestone Fulfillment Locked</h2>
          <p class="guard-sub">
            The agreement terms for <strong>"{{ projectData.project.title }}"</strong> must be accepted by the contractor before milestone fulfillment and camera evidence tools can unlock.
          </p>
          <div class="guard-status-pill">
            Current Status: <strong>{{ formatStatus(projectData.project.status) }}</strong>
          </div>
          <div class="guard-actions">
            <button (click)="goToAgreement()" class="btn-primary-action">
              ← Open Agreement & Review Terms
            </button>
          </div>
        </div>
      } @else {
        <!-- ACCEPTED PROJECT FULFILLMENT DESK -->
        <header class="fulfillment-header-card">
          <div class="header-top-row">
            <div class="header-left-col">
              <button (click)="goToAgreement()" class="btn-back-link">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
                <span>View Agreement & Scope</span>
              </button>
              <div class="title-meta-cluster">
                <h1>{{ projectData.project.title }}</h1>
                <div class="badges-row">
                  <span class="badge-industry">{{ projectData.project.industry_type || 'General' }}</span>
                  <span class="badge-status-accepted">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                    </svg>
                    <span>TERMS LOCKED & ESCROW FUNDED</span>
                  </span>
                  @if (getEffectiveProjectDeadline()) {
                    <span class="badge-deadline">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/>
                        <line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                      <span>Target Due: {{ getEffectiveProjectDeadline() }}</span>
                    </span>
                  }
                  <span class="badge-verified-protocol">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>PayPal Escrow Protected</span>
                  </span>
                </div>
              </div>
            </div>

            <div class="header-right-col">
              <div class="escrow-budget-card">
                <span class="budget-label">TOTAL ESCROW SUM</span>
                <span class="budget-val">\${{ Number(projectData.project.total_price).toFixed(2) }} USD</span>
              </div>
              <button (click)="openRevisionRoom()" class="btn-scope-change" title="Request or view project scope changes and addenda">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <span>Request Scope Change</span>
                @if (activeScopeChange && activeScopeChange.status !== 'ACCEPTED') {
                  <span class="active-scope-badge">{{ activeScopeChange.status === 'PENDING_FUNDS' ? 'Pending Escrow' : 'Negotiating' }}</span>
                }
              </button>
              <button (click)="toggleRole()" class="btn-switch-role" title="Switch between Contractor and Buyer perspectives">
                <span>View as: <strong>{{ currentRole | uppercase }}</strong></span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Sequential Milestone Progression Bar -->
          @if (milestones && milestones.length > 0) {
            <div class="sequential-progress-container">
              <div class="progress-bar-title">Sequential Milestone Progress & Escrow Release Status</div>
              <div class="milestones-track-row">
                @for (ms of milestones; track $index) {
                  <div
                    class="track-step-node"
                    [class.is-approved]="isMilestoneApproved($index)"
                    [class.is-selected]="selectedMilestoneIndex === $index"
                    [class.is-locked]="!isMilestoneUnlocked($index)"
                    [class.is-addendum]="ms.is_addendum"
                    (click)="selectMilestone($index)"
                  >
                    <div class="step-marker" [class.marker-addendum]="ms.is_addendum">
                      @if (isMilestoneApproved($index)) {
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                      } @else if (!isMilestoneUnlocked($index)) {
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      } @else if (isMilestoneAwaitingReview($index)) {
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      } @else {
                        <span>{{ $index + 1 }}</span>
                      }
                    </div>
                    <div class="step-info">
                      <div class="step-title-line">
                        <span class="step-num">Milestone {{ $index + 1 }}</span>
                        @if (ms.is_addendum) {
                          <span class="addendum-timeline-tag">Addendum (v{{ ms.version || 2 }})</span>
                        }
                      </div>
                      <span class="step-title">{{ ms.title }}</span>
                      <span class="step-price">\${{ Number(ms.price_allocation).toFixed(2) }} USD</span>
                    </div>
                  </div>
                  @if ($index < milestones.length - 1) {
                    <div class="track-connector" [class.is-passed]="isMilestoneApproved($index)"></div>
                  }
                }
              </div>
            </div>
          }
        </header>

        <!-- Main Section 3.0 Fulfillment Desk -->
        <main class="fulfillment-body">
          <div class="fulfillment-desk-card">
            <div class="clause-heading">
              <div class="clause-num-tag">Section 3.0</div>
              <div class="clause-title-group">
                <h2>Cryptographic Milestone Fulfillment Desk</h2>
                <p class="clause-subtitle">
                  Direct hardware live camera capture and sequential evidence submissions. ProofLens AI compares seller submissions against agreed criteria and buyer's baseline evidence.
                </p>
              </div>
            </div>

            <!-- Milestone Selector Tabs -->
            @if (milestones && milestones.length > 0) {
              <div class="ms-selector-tabs">
                @for (ms of milestones; track $index) {
                  <button
                    type="button"
                    (click)="selectMilestone($index)"
                    [class.active-ms-tab]="selectedMilestoneIndex === $index"
                    class="btn-select-ms"
                  >
                    <div class="ms-tab-header">
                      <div class="tab-label-group">
                        <span class="tab-ms-num">Milestone {{ $index + 1 }}</span>
                        @if (ms.is_addendum) {
                          <span class="tab-addendum-tag">Addendum</span>
                        }
                      </div>
                      <span class="tab-ms-price">\${{ Number(ms.price_allocation).toFixed(2) }}</span>
                    </div>
                    <div class="tab-ms-name">{{ ms.title }}</div>
                    <div class="tab-ms-status">
                      @if (isMilestoneApproved($index)) {
                        <span class="pill-verified">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                          <span>Approved</span>
                        </span>
                      } @else if (isMilestoneResubmissionRequested($index)) {
                        <span class="pill-resubmission">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                          <span>Resubmission</span>
                        </span>
                      } @else if (isMilestoneFlagged($index)) {
                        <span class="pill-flagged">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                          <span>Action Required</span>
                        </span>
                      } @else if (isMilestoneAwaitingReview($index)) {
                        <span class="pill-review">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                          <span>In Review</span>
                        </span>
                      } @else if (!isMilestoneUnlocked($index)) {
                        <span class="pill-locked">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                          <span>Locked</span>
                        </span>
                      } @else {
                        <span class="pill-needed">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                          <span>{{ currentRole === 'buyer' ? 'Awaiting Proof' : 'Active Proof Screen' }}</span>
                        </span>
                      }
                    </div>
                  </button>
                }
              </div>

              <!-- Selected Milestone Focus Card -->
              @if (milestones[selectedMilestoneIndex]; as targetMs) {
                <div class="target-ms-card">
                  <div class="target-ms-top">
                    <div class="target-title-col">
                      <div class="target-badge-row">
                        <span class="target-badge">Selected for Verification: Milestone {{ selectedMilestoneIndex + 1 }}</span>
                        @if (targetMs.is_addendum) {
                          <span class="badge-addendum-prominent">Supplementary Addendum Milestone (v{{ targetMs.version || 2 }})</span>
                        }
                      </div>
                      <h4>{{ targetMs.title }}</h4>
                      <p class="target-desc">{{ targetMs.description }}</p>
                    </div>
                    <div class="target-price-tag">
                      \${{ Number(targetMs.price_allocation).toFixed(2) }} USD
                    </div>
                  </div>

                  <div class="target-ms-req">
                    <div class="req-title-tag">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      </svg>
                      <span>Mandatory Verification Requirement (PayPal Release Gate):</span>
                    </div>
                    <p class="req-text">{{ targetMs.proof_required }}</p>
                    <div class="target-due-row">
                      Target Due Date: <strong>{{ targetMs.deadline || getMilestoneFallbackDeadline(selectedMilestoneIndex) }}</strong>
                    </div>
                  </div>

                  @if (getBeforeEvidence()) {
                    <div class="target-baseline-indicator">
                      <span class="indicator-dot"></span>
                      <span>AI Multimodal comparison will check this live capture against Buyer Baseline Before-Evidence.</span>
                    </div>
                  }
                </div>

                <!-- Execution Stage States -->
                <div class="stage-action-area">
                  @if (!isMilestoneUnlocked(selectedMilestoneIndex)) {
                    <!-- Sequential Lock -->
                    <div class="evidence-locked-card">
                      <div class="locked-icon-shield">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2">
                          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                        </svg>
                      </div>
                      <div class="locked-content">
                        <h4>Milestone {{ selectedMilestoneIndex + 1 }} is Sequentially Locked</h4>
                        <p>
                          Sequential Milestone Restriction: Evidence can only be captured for Milestone {{ selectedMilestoneIndex + 1 }} after Milestone {{ selectedMilestoneIndex }} is strictly marked as APPROVED by the buyer.
                        </p>
                      </div>
                    </div>
                  } @else if (isMilestoneApproved(selectedMilestoneIndex)) {
                    <!-- Approved Notice -->
                    <div class="before-captured-card is-success-border">
                      <div class="captured-head">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <strong>Milestone {{ selectedMilestoneIndex + 1 }} Verified & Approved</strong>
                      </div>
                      <p class="approved-desc">
                        The buyer has reviewed and approved the cryptographic evidence for this milestone. Escrow funds (\${{ Number(targetMs.price_allocation).toFixed(2) }} USD) have been authorized for release.
                      </p>
                    </div>
                  } @else if (isMilestoneResubmissionRequested(selectedMilestoneIndex)) {
                    <!-- Buyer Requested Resubmission State -->
                    <div class="before-captured-card is-corp-notice">
                      <div class="captured-head is-navy-text">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.5">
                          <circle cx="12" cy="12" r="10"/>
                          <line x1="12" y1="8" x2="12" y2="12"/>
                          <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <strong>Evidence Resubmission Requested for Milestone {{ selectedMilestoneIndex + 1 }}</strong>
                      </div>
                      <div class="rejection-feedback-banner">
                        <div class="rejection-feedback-label">BUYER FEEDBACK & RESUBMISSION CRITERIA:</div>
                        <p class="rejection-feedback-text">"{{ getMilestoneRejectionReason(selectedMilestoneIndex) }}"</p>
                      </div>

                      @if (currentRole === 'seller') {
                        <div class="seller-recapture-container">
                          <div class="recapture-callout">
                            <span class="recapture-badge">ACTION REQUIRED FOR CONTRACTOR</span>
                            <p>
                              @if (isDigitalProject()) {
                                Please review the buyer's feedback above and submit updated deliverable files or images below. ProofLens AI will re-audit the deliverable for scope compliance and synthetic AI watermarks.
                              } @else {
                                Please review the buyer's feedback above and capture a new live physical frame directly with the camera below.
                              }
                            </p>
                          </div>
                          @if (isDigitalProject()) {
                            <div class="digital-submission-desk">
                              <div class="digital-tabs-bar">
                                <button
                                  type="button"
                                  class="digital-tab-btn"
                                  [class.is-active]="digitalSubmissionMode === 'upload'"
                                  (click)="digitalSubmissionMode = 'upload'"
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                  <span>Upload Corrected Files</span>
                                </button>
                                <button
                                  type="button"
                                  class="digital-tab-btn"
                                  [class.is-active]="digitalSubmissionMode === 'camera'"
                                  (click)="digitalSubmissionMode = 'camera'"
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                                  <span>Live Camera</span>
                                </button>
                              </div>

                              @if (digitalSubmissionMode === 'upload') {
                                <div class="digital-upload-container">
                                  <div
                                    class="digital-dropzone"
                                    [class.is-dragging]="isDragOverDropzone"
                                    [class.has-file]="!!selectedDigitalFile"
                                    (dragover)="onDragOver($event)"
                                    (dragleave)="onDragLeave($event)"
                                    (drop)="onDigitalFileDropped($event)"
                                    (click)="resubmitFileInput.click()"
                                  >
                                    <input
                                      #resubmitFileInput
                                      type="file"
                                      style="display: none;"
                                      accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,application/zip,.fig,.ai,.psd"
                                      (change)="onDigitalFileSelected($event)"
                                    />
                                    @if (!selectedDigitalFile) {
                                      <div class="dropzone-empty">
                                        <div class="dropzone-icon">
                                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                        </div>
                                        <div class="dropzone-main-text">Click or drag updated deliverable to resubmit</div>
                                        <div class="dropzone-sub-text">PNG, JPG, WebP, SVG, PDF, ZIP, AI, FIG, PSD (Max 50MB)</div>
                                      </div>
                                    } @else {
                                      <div class="dropzone-selected-preview" (click)="$event.stopPropagation()">
                                        @if (digitalFilePreviewUrl) {
                                          <img [src]="digitalFilePreviewUrl" alt="Selected deliverable" class="preview-img" />
                                        } @else {
                                          <div class="preview-file-icon">
                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                          </div>
                                        }
                                        <div class="preview-file-info">
                                          <span class="preview-file-name">{{ selectedDigitalFile.name }}</span>
                                          <span class="preview-file-size">{{ formatFileSize(selectedDigitalFile.size) }}</span>
                                        </div>
                                        <button type="button" class="btn-clear-file" (click)="clearSelectedFile()">
                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                          <span>Remove</span>
                                        </button>
                                      </div>
                                    }
                                  </div>

                                  @if (digitalUploadError) {
                                    <div class="upload-error-notice">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                      <span>{{ digitalUploadError }}</span>
                                    </div>
                                  }

                                  <div class="digital-actions-bar">
                                    <button
                                      type="button"
                                      class="btn-submit-digital"
                                      [disabled]="!selectedDigitalFile || isUploadingDigitalFile"
                                      (click)="submitDigitalDeliverable()"
                                    >
                                      @if (isUploadingDigitalFile) {
                                        <span class="btn-spinner"></span>
                                        <span>Auditing AI Watermarks & Resubmitting...</span>
                                      } @else {
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                        <span>Resubmit Deliverable & Run AI Audit</span>
                                      }
                                    </button>
                                  </div>
                                </div>
                              } @else {
                                <div class="recapture-active-box">
                                  <app-live-camera
                                    [projectId]="projectId"
                                    evidenceType="milestone_evidence"
                                    [milestoneIndex]="selectedMilestoneIndex"
                                    [label]="'Resubmit Proof for Milestone ' + (selectedMilestoneIndex + 1)"
                                    (evidenceUploaded)="handleRecaptureSuccess($event)"
                                  ></app-live-camera>
                                </div>
                              }
                            </div>
                          } @else {
                            <div class="recapture-active-box">
                              <div class="recapture-box-head">
                                <span><strong>Live Camera Resubmission Desk:</strong></span>
                              </div>
                              <app-live-camera
                                [projectId]="projectId"
                                evidenceType="milestone_evidence"
                                [milestoneIndex]="selectedMilestoneIndex"
                                [label]="'Resubmit Live Proof for Milestone ' + (selectedMilestoneIndex + 1)"
                                (evidenceUploaded)="handleRecaptureSuccess($event)"
                              ></app-live-camera>
                            </div>
                          }
                        </div>
                      } @else {
                        <div class="buyer-flagged-box">
                          <div class="flagged-status-badge">AWAITING CONTRACTOR RESUBMISSION</div>
                          <p>
                            You have requested updated evidence for this milestone. Escrow release will remain locked until the contractor submits updated proof for your review.
                          </p>
                          <button type="button" (click)="fetchProject()" class="btn-refresh-status">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                            <span>Check for Updated Capture</span>
                          </button>
                        </div>
                      }
                    </div>
                  } @else if (isMilestoneFlagged(selectedMilestoneIndex)) {
                    <!-- Clean Corporate Verification Action Card (Never Garish Red) -->
                    <div class="before-captured-card is-corp-notice">
                      <div class="captured-head is-navy-text">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.5">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                        @if (hasSpoofingFlag(getAllEvidenceForMilestone(selectedMilestoneIndex))) {
                          <strong>AI Anti-Spoofing Alert: Evidence Flagged for Milestone {{ selectedMilestoneIndex + 1 }}</strong>
                        } @else if (isDigitalProject()) {
                          <strong>AI Watermark Alert: Clean Digital Deliverable Required for Milestone {{ selectedMilestoneIndex + 1 }}</strong>
                        } @else {
                          <strong>Physical Evidence Recapture Required for Milestone {{ selectedMilestoneIndex + 1 }}</strong>
                        }
                      </div>
                      <p class="review-desc is-corp-desc">
                        @if (hasSpoofingFlag(getAllEvidenceForMilestone(selectedMilestoneIndex))) {
                          The AI verification engine detected potential spoofing (e.g. Moiré interference, screen display reproduction, or visible display bezels). Escrow disbursement is locked in PayPal escrow until authentic deliverable proof is provided.
                        } @else if (isDigitalProject()) {
                          The automated visual integrity audit detected indicators of synthetic generative AI watermarking or metadata parameters (e.g. Google SynthID, OpenAI DALL-E, Midjourney, or Stable Diffusion). Escrow disbursement is held in PayPal escrow pending authentic original assets created by the contractor.
                        } @else {
                          The automated visual integrity audit detected indicators of display reflection or specification deviation. Escrow disbursement is held in PayPal escrow pending authentic physical workpiece capture.
                        }
                      </p>

                      @if (currentRole === 'seller') {
                        <!-- Seller Recapture Desk -->
                        <div class="seller-recapture-container">
                          <div class="recapture-callout">
                            <span class="recapture-badge">ACTION REQUIRED FOR CONTRACTOR</span>
                            <p>
                              @if (hasSpoofingFlag(getAllEvidenceForMilestone(selectedMilestoneIndex))) {
                                Please provide authentic original deliverable files or genuine direct capture.
                                <strong>Do not photograph a phone, monitor, or screen display.</strong>
                              } @else if (isDigitalProject()) {
                                Please provide authentic digital source files (e.g. SVG, layered PSD, original high-res export) created through genuine craftsmanship without synthetic AI watermarks or parameters.
                              } @else {
                                Please capture genuine live proof of the physical deliverable under natural workshop lighting.
                                <strong>Do not photograph a phone, monitor, or screen display.</strong>
                              }
                            </p>
                          </div>
                          @if (isDigitalProject()) {
                            <div class="digital-submission-desk">
                              <div class="digital-tabs-bar">
                                <button
                                  type="button"
                                  class="digital-tab-btn"
                                  [class.is-active]="digitalSubmissionMode === 'upload'"
                                  (click)="digitalSubmissionMode = 'upload'"
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                  <span>Upload Clean Deliverable</span>
                                </button>
                                <button
                                  type="button"
                                  class="digital-tab-btn"
                                  [class.is-active]="digitalSubmissionMode === 'camera'"
                                  (click)="digitalSubmissionMode = 'camera'"
                                >
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                                  <span>Live Camera</span>
                                </button>
                              </div>

                              @if (digitalSubmissionMode === 'upload') {
                                <div class="digital-upload-container">
                                  <div
                                    class="digital-dropzone"
                                    [class.is-dragging]="isDragOverDropzone"
                                    [class.has-file]="!!selectedDigitalFile"
                                    (dragover)="onDragOver($event)"
                                    (dragleave)="onDragLeave($event)"
                                    (drop)="onDigitalFileDropped($event)"
                                    (click)="flaggedFileInput.click()"
                                  >
                                    <input
                                      #flaggedFileInput
                                      type="file"
                                      style="display: none;"
                                      accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,application/zip,.fig,.ai,.psd"
                                      (change)="onDigitalFileSelected($event)"
                                    />
                                    @if (!selectedDigitalFile) {
                                      <div class="dropzone-empty">
                                        <div class="dropzone-icon">
                                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                        </div>
                                        <div class="dropzone-main-text">Upload authentic deliverable without AI watermarks</div>
                                        <div class="dropzone-sub-text">Supported: PNG, JPG, WebP, SVG, PDF, ZIP, AI, FIG, PSD</div>
                                      </div>
                                    } @else {
                                      <div class="dropzone-selected-preview" (click)="$event.stopPropagation()">
                                        @if (digitalFilePreviewUrl) {
                                          <img [src]="digitalFilePreviewUrl" alt="Selected deliverable" class="preview-img" />
                                        } @else {
                                          <div class="preview-file-icon">
                                            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                                          </div>
                                        }
                                        <div class="preview-file-info">
                                          <span class="preview-file-name">{{ selectedDigitalFile.name }}</span>
                                          <span class="preview-file-size">{{ formatFileSize(selectedDigitalFile.size) }}</span>
                                        </div>
                                        <button type="button" class="btn-clear-file" (click)="clearSelectedFile()">
                                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                          <span>Remove</span>
                                        </button>
                                      </div>
                                    }
                                  </div>

                                  @if (digitalUploadError) {
                                    <div class="upload-error-notice">
                                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                                      <span>{{ digitalUploadError }}</span>
                                    </div>
                                  }

                                  <div class="digital-actions-bar">
                                    <button
                                      type="button"
                                      class="btn-submit-digital"
                                      [disabled]="!selectedDigitalFile || isUploadingDigitalFile"
                                      (click)="submitDigitalDeliverable()"
                                    >
                                      @if (isUploadingDigitalFile) {
                                        <span class="btn-spinner"></span>
                                        <span>Auditing AI Watermarks & Resubmitting...</span>
                                      } @else {
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                                        <span>Submit Clean Deliverable & Run AI Audit</span>
                                      }
                                    </button>
                                  </div>
                                </div>
                              } @else {
                                <div class="recapture-active-box">
                                  <app-live-camera
                                    [projectId]="projectId"
                                    evidenceType="milestone_evidence"
                                    [milestoneIndex]="selectedMilestoneIndex"
                                    [label]="'Recapture Proof for Milestone ' + (selectedMilestoneIndex + 1)"
                                    (evidenceUploaded)="handleRecaptureSuccess($event)"
                                  ></app-live-camera>
                                </div>
                              }
                            </div>
                          } @else {
                            @if (!isRecapturing) {
                              <button type="button" (click)="isRecapturing = true" class="btn-corp-primary">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                                </svg>
                                <span>Recapture Live Proof for Milestone {{ selectedMilestoneIndex + 1 }}</span>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                  <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>
                                </svg>
                              </button>
                            } @else {
                              <div class="recapture-active-box">
                                <div class="recapture-box-head">
                                  <span><strong>Hardware Live Camera Recapture Desk:</strong></span>
                                  <button type="button" (click)="isRecapturing = false" class="btn-recapture-cancel">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                                    <span>Cancel Recapture</span>
                                  </button>
                                </div>
                                <app-live-camera
                                  [projectId]="projectId"
                                  evidenceType="milestone_evidence"
                                  [milestoneIndex]="selectedMilestoneIndex"
                                  [label]="'Recapture Live Proof for Milestone ' + (selectedMilestoneIndex + 1)"
                                  (evidenceUploaded)="handleRecaptureSuccess($event)"
                                ></app-live-camera>
                              </div>
                            }
                          }
                        </div>
                      } @else {
                        <!-- Buyer Flagged State Notice -->
                        <div class="buyer-flagged-box">
                          <div class="flagged-status-badge">ESCROW RELEASE HELD</div>
                          <p>
                            @if (isDigitalProject()) {
                              This submission was flagged by the automated AI watermark audit. The contractor has been instructed to upload authentic original files without generative AI watermarks. Escrow release will remain locked until authentic proof is verified.
                            } @else {
                              This submission was flagged by the automated anti-spoofing audit. The contractor has been instructed to recapture physical proof of work. Escrow release will remain locked until authentic physical proof is verified.
                            }
                          </p>
                          <div class="buyer-review-actions-row">
                            <button type="button" (click)="fetchProject()" class="btn-refresh-status">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                              <span>Check for Updated Capture</span>
                            </button>
                            <button type="button" (click)="openRejectModal(selectedMilestoneIndex)" class="btn-reject-escrow">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                              <span>Reject Evidence & Request Resubmission</span>
                            </button>
                          </div>
                        </div>
                      }
                    </div>
                  } @else if (isMilestoneAwaitingReview(selectedMilestoneIndex)) {
                    <!-- Awaiting Review Notice -->
                    <div class="before-captured-card is-corp-notice">
                      <div class="captured-head is-navy-text">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.5">
                          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        <strong>Evidence Submitted — Awaiting Buyer Review</strong>
                      </div>
                      <p class="review-desc is-corp-desc">
                        Cryptographic proof has been recorded in the escrow ledger. The milestone is currently under review by the buyer.
                      </p>
                      @if (currentRole === 'buyer') {
                        <div class="buyer-review-actions-row">
                          <button type="button" (click)="approveMilestone(selectedMilestoneIndex)" class="btn-approve-escrow">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                            <span>Approve Milestone {{ selectedMilestoneIndex + 1 }} & Release Escrow Payout</span>
                          </button>
                          <button type="button" (click)="openRejectModal(selectedMilestoneIndex)" class="btn-reject-escrow">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                            <span>Reject Evidence & Request Resubmission</span>
                          </button>
                        </div>
                      } @else {
                        <div class="seller-waiting-note">
                          <span>Waiting for buyer to review and release funds...</span>
                          <button type="button" (click)="isRecapturing = !isRecapturing" class="btn-add-angle-subtle">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                              @if (isRecapturing) {
                                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                              } @else {
                                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                              }
                            </svg>
                            <span>{{ isRecapturing ? 'Cancel Recapture' : 'Add Another Angle / Recapture' }}</span>
                          </button>
                          <button (click)="fetchProject()" class="btn-refresh-status">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                            <span>Refresh Status</span>
                          </button>
                        </div>
                        @if (isRecapturing) {
                          <div class="recapture-active-box">
                            <app-live-camera
                              [projectId]="projectId"
                              evidenceType="milestone_evidence"
                              [milestoneIndex]="selectedMilestoneIndex"
                              [label]="'Capture Additional Proof for Milestone ' + (selectedMilestoneIndex + 1)"
                              (evidenceUploaded)="handleRecaptureSuccess($event)"
                            ></app-live-camera>
                          </div>
                        }
                      }
                    </div>
                  } @else if (currentRole === 'buyer') {
                    <!-- Buyer View: Awaiting Contractor Evidence Submission -->
                    <div class="awaiting-contractor-card">
                      <div class="awaiting-icon-box">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2">
                          <circle cx="12" cy="12" r="10"/>
                          <polyline points="12 6 12 12 16 14"/>
                        </svg>
                      </div>
                      <div class="awaiting-text">
                        <h4>Awaiting Contractor Evidence Submission</h4>
                        <p>
                          The Contractor has not yet submitted live evidence for <strong>Milestone {{ selectedMilestoneIndex + 1 }}</strong>. Camera capture is reserved strictly for the seller to document physical proof of work.
                        </p>
                        <div class="awaiting-badge-row">
                          <span class="badge-role-guard">Contractor Action Required</span>
                          <span class="badge-role-info">You will be notified once evidence is submitted for your review and escrow payout release.</span>
                        </div>
                      </div>
                    </div>
                  } @else {
                    @if (isDigitalProject()) {
                      <!-- Seller View: Digital Deliverable Upload Desk -->
                      <div class="digital-submission-desk">
                        <div class="digital-tabs-bar">
                          <button
                            type="button"
                            class="digital-tab-btn"
                            [class.is-active]="digitalSubmissionMode === 'upload'"
                            (click)="digitalSubmissionMode = 'upload'"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                            <span>Upload Files & Images</span>
                            <span class="tab-recommended-badge">Digital Deliverable</span>
                          </button>
                          <button
                            type="button"
                            class="digital-tab-btn"
                            [class.is-active]="digitalSubmissionMode === 'camera'"
                            (click)="digitalSubmissionMode = 'camera'"
                          >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                            <span>Live Hardware Camera</span>
                          </button>
                        </div>

                        @if (digitalSubmissionMode === 'upload') {
                          <div class="digital-upload-container">
                            <div class="digital-info-banner">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.2">
                                <circle cx="12" cy="12" r="10"/>
                                <line x1="12" y1="16" x2="12" y2="12"/>
                                <line x1="12" y1="8" x2="12.01" y2="8"/>
                              </svg>
                              <div>
                                <strong>DIGITAL ASSET SUBMISSION DESK:</strong> Upload deliverable files (.png, .jpg, .svg, .pdf, .zip, etc.). ProofLens AI runs an automated scan to ensure scope compliance and audits against synthetic AI watermarks (Google SynthID, OpenAI DALL-E, Midjourney, Adobe Firefly).
                              </div>
                            </div>

                            <!-- Dropzone -->
                            <div
                              class="digital-dropzone"
                              [class.is-dragging]="isDragOverDropzone"
                              [class.has-file]="!!selectedDigitalFile"
                              (dragover)="onDragOver($event)"
                              (dragleave)="onDragLeave($event)"
                              (drop)="onDigitalFileDropped($event)"
                              (click)="mainFileInput.click()"
                            >
                              <input
                                #mainFileInput
                                type="file"
                                style="display: none;"
                                accept="image/png,image/jpeg,image/webp,image/svg+xml,application/pdf,application/zip,.fig,.ai,.psd"
                                (change)="onDigitalFileSelected($event)"
                              />
                              @if (!selectedDigitalFile) {
                                <div class="dropzone-empty">
                                  <div class="dropzone-icon">
                                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2">
                                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                      <polyline points="17 8 12 3 7 8"/>
                                      <line x1="12" y1="3" x2="12" y2="15"/>
                                    </svg>
                                  </div>
                                  <div class="dropzone-main-text">
                                    <strong>Drag and drop deliverable files or click to browse</strong>
                                  </div>
                                  <div class="dropzone-sub-text">
                                    Supported: PNG, JPG, WebP, SVG, PDF, ZIP, AI, FIG, PSD (Max 50MB)
                                  </div>
                                </div>
                              } @else {
                                <div class="dropzone-selected-preview" (click)="$event.stopPropagation()">
                                  @if (digitalFilePreviewUrl) {
                                    <img [src]="digitalFilePreviewUrl" alt="Selected deliverable" class="preview-img" />
                                  } @else {
                                    <div class="preview-file-icon">
                                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                        <polyline points="14 2 14 8 20 8"/>
                                      </svg>
                                    </div>
                                  }
                                  <div class="preview-file-info">
                                    <span class="preview-file-name">{{ selectedDigitalFile.name }}</span>
                                    <span class="preview-file-size">{{ formatFileSize(selectedDigitalFile.size) }}</span>
                                    <span class="preview-file-type">{{ selectedDigitalFile.type || 'Deliverable File' }}</span>
                                  </div>
                                  <button type="button" class="btn-clear-file" (click)="clearSelectedFile()">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                      <line x1="18" y1="6" x2="6" y2="18"/>
                                      <line x1="6" y1="6" x2="18" y2="18"/>
                                    </svg>
                                    <span>Remove</span>
                                  </button>
                                </div>
                              }
                            </div>

                            <!-- Optional Asset URL Input (e.g. Figma, GitHub, Demo) -->
                            <div class="asset-url-row">
                              <label class="url-input-label">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                                </svg>
                                <span>Optional Cloud Asset URL (Figma, GitHub PR, Hosted Preview):</span>
                              </label>
                              <input
                                type="url"
                                [(ngModel)]="digitalAssetUrl"
                                placeholder="https://www.figma.com/file/... or https://github.com/..."
                                class="url-text-field"
                              />
                            </div>

                            @if (digitalUploadError) {
                              <div class="upload-error-notice">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5">
                                  <circle cx="12" cy="12" r="10"/>
                                  <line x1="12" y1="8" x2="12" y2="12"/>
                                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                                <span>{{ digitalUploadError }}</span>
                              </div>
                            }

                            <!-- Submit Button -->
                            <div class="digital-actions-bar">
                              <button
                                type="button"
                                class="btn-submit-digital"
                                [disabled]="!selectedDigitalFile || isUploadingDigitalFile"
                                (click)="submitDigitalDeliverable()"
                              >
                                @if (isUploadingDigitalFile) {
                                  <span class="btn-spinner"></span>
                                  <span>Auditing for AI Watermarks & Submitting...</span>
                                } @else {
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                    <polyline points="17 8 12 3 7 8"/>
                                    <line x1="12" y1="3" x2="12" y2="15"/>
                                  </svg>
                                  <span>Submit Deliverable & Run AI Watermark Audit</span>
                                }
                              </button>
                            </div>
                          </div>
                        } @else {
                          <div class="live-cam-embed">
                            <app-live-camera
                              [projectId]="projectId"
                              evidenceType="milestone_evidence"
                              [milestoneIndex]="selectedMilestoneIndex"
                              [label]="'Capture Live Proof for Milestone ' + (selectedMilestoneIndex + 1)"
                              (evidenceUploaded)="handleEvidenceSuccess($event)"
                            ></app-live-camera>
                          </div>
                        }
                      </div>
                    } @else {
                      <!-- Seller View: Hardware Live Camera Capture Active Screen (Strict for Physical) -->
                      <div class="live-cam-embed">
                        <div class="cam-instructions-banner">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.2">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                          </svg>
                          <span><strong>MANDATORY HARDWARE LIVE CAPTURE:</strong> Position camera to capture proof according to the criteria above. File uploads are disabled for anti-tamper compliance.</span>
                        </div>
                        <app-live-camera
                          [projectId]="projectId"
                          evidenceType="milestone_evidence"
                          [milestoneIndex]="selectedMilestoneIndex"
                          [label]="'Capture Live Proof for Milestone ' + (selectedMilestoneIndex + 1)"
                          (evidenceUploaded)="handleEvidenceSuccess($event)"
                        ></app-live-camera>
                      </div>
                    }
                  }
                </div>

                <!-- Sleek Corporate Forensic Assessment & Certificate (Never Loud Amber/Red) -->
                @if (getAllEvidenceForMilestone(selectedMilestoneIndex); as milestoneEvList) {
                  @if (milestoneEvList.length > 0) {
                    <div class="ms-ai-certificate">
                      <div class="cert-head">
                        <div class="cert-title-row">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" [attr.stroke]="hasFraudInMilestone(milestoneEvList) ? '#dc2626' : '#16a34a'" stroke-width="2.5">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                          </svg>
                          <strong>{{ getCertificateTitle(milestoneEvList) }}</strong>
                        </div>
                        <span class="cert-confidence-pill" [class.is-fraud]="hasFraudInMilestone(milestoneEvList)">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            @if (hasFraudInMilestone(milestoneEvList)) {
                              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                            } @else {
                              <polyline points="20 6 9 17 4 12"/>
                            }
                          </svg>
                          <span>{{ milestoneEvList[0].ai_confidence_score }}% Match {{ getCertificateBadgeText(milestoneEvList) }}</span>
                        </span>
                      </div>

                      <!-- Forensic Findings Panel (Subtle & Dignified) -->
                      @if (hasFraudInMilestone(milestoneEvList)) {
                        <div class="corp-audit-notice-panel">
                          <div class="audit-notice-title">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.2">
                              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                            </svg>
                            <span>Forensic Observation: {{ getForensicObservationTitle(milestoneEvList) }}</span>
                          </div>
                          <p class="audit-notice-desc">
                            {{ getForensicObservationDescription(milestoneEvList) }}
                          </p>
                          <div class="flags-chips-row">
                            @for (flag of getMilestoneFraudFlags(milestoneEvList); track flag) {
                              <span class="audit-flag-tag" [class.is-ai-watermark]="isWatermarkFlag(flag)">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                                </svg>
                                <span>{{ flag }}</span>
                              </span>
                            }
                          </div>
                        </div>
                      }

                      <div class="cert-angles-strip">
                        @for (ev of milestoneEvList; track ev.id; let aIdx = $index) {
                          <div class="cert-angle-card">
                            @if (ev.file_path && isPreviewableImage(ev.file_path)) {
                              <img [src]="getEvidenceUrl(ev.file_path)" alt="Deliverable {{ aIdx + 1 }}" class="cert-thumb" />
                            } @else {
                              <div class="cert-doc-thumb">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                              </div>
                            }
                            <span class="angle-label">{{ ev.capture_method === 'file_upload' ? ('Deliverable ' + (aIdx + 1)) : ('Angle ' + (aIdx + 1)) }}</span>
                            <span class="cert-hash" title="{{ ev.file_hash }}">SHA: {{ ev.file_hash ? ev.file_hash.slice(0, 8) : 'Locked' }}</span>
                          </div>
                        }
                      </div>

                      <div class="cert-notes">
                        <div class="cert-analysis">{{ milestoneEvList[0].ai_analysis_notes }}</div>
                      </div>
                    </div>
                  }
                }
              }
            }

            <!-- Secured Evidence Audit Log Gallery -->
            @if (evidenceList.length > 0) {
              <div class="secured-evidence-gallery">
                <div class="gallery-title">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                  <span>Cryptographically Secured Live Evidence & Audit Ledger ({{ evidenceList.length }})</span>
                </div>
                <div class="evidence-cards-grid">
                  @for (item of evidenceList; track item.id) {
                    <div class="evidence-item-card">
                      <div class="item-badge-bar">
                        <span class="item-method-pill" [class.is-upload]="item.capture_method === 'file_upload'">
                          {{ item.capture_method === 'file_upload' ? 'DIGITAL ASSET' : (item.evidence_type === 'before_evidence' ? 'BUYER BASELINE' : ('MILESTONE ' + (Number(item.milestone_index) + 1))) }}
                        </span>
                        <span class="item-conf-pill" [class.is-fraud]="item.status === 'possible_mismatch' || isItemFlagged(item)">
                          {{ (item.status === 'possible_mismatch' || isItemFlagged(item)) ? (item.ai_confidence_score + '% Match (FLAGGED)') : (item.ai_confidence_score + '% Match') }}
                        </span>
                      </div>
                      @if (item.file_path && isPreviewableImage(item.file_path)) {
                        <img [src]="getEvidenceUrl(item.file_path)" alt="Evidence frame" class="item-media-preview" />
                      } @else {
                        <div class="item-doc-preview">
                          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                          <span class="item-doc-label">{{ item.original_filename || 'Digital Deliverable File' }}</span>
                        </div>
                      }
                      <div class="item-meta-details">
                        <span class="item-hash" title="{{ item.file_hash }}">SHA-256: {{ item.file_hash?.slice(0, 16) }}...</span>
                        <span class="item-time">Recorded: {{ item.server_receipt_timestamp || 'Server Authoritative' }}</span>
                      </div>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </main>
      }

      <!-- Buyer Reject & Request Resubmission Modal -->
      @if (showRejectModal && rejectingMilestoneIndex !== null) {
        <div class="modal-backdrop" (click)="closeRejectModal()">
          <div class="reject-modal-card" (click)="$event.stopPropagation()">
            <div class="reject-modal-header">
              <div class="reject-header-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="15" y1="9" x2="9" y2="15"/>
                  <line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
              </div>
              <div class="reject-header-text">
                <h3>Reject Evidence & Request Resubmission</h3>
                <p class="reject-modal-sub">Milestone {{ rejectingMilestoneIndex + 1 }}: {{ milestones[rejectingMilestoneIndex]?.title }}</p>
              </div>
            </div>

            <div class="reject-modal-body">
              <p class="reject-instruction">
                Please specify why the submitted evidence is unsatisfactory. Escrow funds (\${{ Number(milestones[rejectingMilestoneIndex]?.price_allocation).toFixed(2) }} USD) remain held safely in PayPal escrow until satisfactory proof is verified.
              </p>

              <div class="quick-reasons-block">
                <label class="reject-label">Quick Feedback Suggestions:</label>
                <div class="quick-chips-grid">
                  <button type="button" class="quick-chip" (click)="setQuickRejectionReason('Evidence does not match agreed specifications or scope.')">Scope Mismatch</button>
                  <button type="button" class="quick-chip" (click)="setQuickRejectionReason('Suspected screen reflection or re-photographed display.')">Screen Reflection</button>
                  <button type="button" class="quick-chip" (click)="setQuickRejectionReason('Suspected generative AI content or unauthorized AI watermark detected.')">AI Watermark Detected</button>
                  <button type="button" class="quick-chip" (click)="setQuickRejectionReason('Evidence is blurry, low resolution, or poorly lit.')">Blurry / Low Light</button>
                  <button type="button" class="quick-chip" (click)="setQuickRejectionReason('Missing required measurement, tape measure, or caliper check.')">Missing Measurement</button>
                  <button type="button" class="quick-chip" (click)="setQuickRejectionReason('Workmanship appears incomplete or requires finish refinement.')">Incomplete Work</button>
                </div>
              </div>

              <div class="textarea-block">
                <label class="reject-label">Feedback & Instructions for Contractor:</label>
                <textarea
                  [(ngModel)]="rejectionReasonText"
                  placeholder="Explain what needs correction, missing criteria, or preferred camera angle..."
                  class="reject-textarea"
                  rows="3"
                ></textarea>
              </div>
            </div>

            <div class="reject-modal-footer">
              <button type="button" (click)="closeRejectModal()" class="btn-modal-cancel" [disabled]="isSubmittingRejection">
                Cancel
              </button>
              <button
                type="button"
                (click)="submitRejection()"
                class="btn-modal-confirm-reject"
                [disabled]="isSubmittingRejection"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
                <span>{{ isSubmittingRejection ? 'Submitting...' : 'Send Rejection & Request Resubmission' }}</span>
              </button>
            </div>
          </div>
        </div>
      }

      <!-- Scope Changes Revision Room Modal Sub-View -->
      @if (showRevisionRoom) {
        <app-revision-room
          [projectId]="projectId"
          [currentRole]="currentRole"
          [projectTitle]="projectData?.project?.title || ''"
          [initialScopeChange]="activeScopeChange"
          (closed)="closeRevisionRoom()"
          (scopeAccepted)="onScopeChangeAccepted($event)"
        ></app-revision-room>
      }
    </div>
  `,
  styles: [`
    .fulfillment-shell {
      max-width: 1200px;
      margin: 2rem auto;
      padding: 0 1.5rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      color: #001435;
    }

    /* Loading & Error States */
    .loading-state-card, .error-state-card {
      background: #ffffff;
      border: 1px solid #e1e7eb;
      border-radius: 14px;
      padding: 3rem 2rem;
      text-align: center;
      box-shadow: 0 2px 12px rgba(0, 20, 53, 0.04);
    }
    .spinner {
      width: 36px;
      height: 36px;
      border: 3.5px solid #e2e8f0;
      border-top-color: #0070ba;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 1rem auto;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* Unaccepted Guard Card */
    .unaccepted-guard-card {
      background: #ffffff;
      border: 1.5px solid #fde68a;
      border-radius: 16px;
      padding: 3.5rem 2rem;
      text-align: center;
      max-width: 680px;
      margin: 3rem auto;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
    }
    .guard-icon {
      width: 64px;
      height: 64px;
      background: #fef3c7;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 1.25rem auto;
    }
    .unaccepted-guard-card h2 {
      margin: 0 0 0.5rem 0;
      font-size: 1.5rem;
      color: #001435;
    }
    .guard-sub {
      color: #545d68;
      font-size: 0.95rem;
      line-height: 1.5;
      margin-bottom: 1.5rem;
    }
    .guard-status-pill {
      display: inline-block;
      background: #f1f5f9;
      color: #334155;
      font-size: 0.85rem;
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      border: 1px solid #cbd5e1;
      margin-bottom: 1.75rem;
    }
    .btn-primary-action {
      background: #0070ba;
      color: white;
      border: none;
      padding: 0.85rem 1.6rem;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-primary-action:hover {
      background: #005ea6;
    }

    /* Header Card */
    .fulfillment-header-card {
      background: #ffffff;
      border: 1px solid #e1e7eb;
      border-radius: 14px;
      padding: 1.75rem 2rem;
      box-shadow: 0 2px 10px rgba(0, 20, 53, 0.04);
      margin-bottom: 1.5rem;
    }
    .header-top-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1.5rem;
      flex-wrap: wrap;
    }
    .header-left-col {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .btn-back-link {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: none;
      border: none;
      color: #0070ba;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      padding: 0;
    }
    .btn-back-link:hover {
      text-decoration: underline;
    }
    .title-meta-cluster h1 {
      margin: 0 0 0.5rem 0;
      font-size: 1.6rem;
      font-weight: 800;
      color: #001435;
    }
    .badges-row {
      display: flex;
      gap: 0.65rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .badge-industry {
      background: #f1f5f9;
      color: #475569;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
    }
    .badge-status-accepted {
      background: #dcfce7;
      color: #15803d;
      border: 1px solid #86efac;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
      letter-spacing: 0.03em;
    }
    .badge-verified-protocol {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #0070ba;
      color: #ffffff;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }
    .badge-deadline {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #fffbeb;
      color: #b45309;
      border: 1px solid #fde68a;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
    }
    .header-right-col {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.65rem;
    }
    .escrow-budget-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 0.65rem 1rem;
      text-align: right;
    }
    .budget-label {
      display: block;
      font-size: 0.68rem;
      font-weight: 800;
      color: #64748b;
      letter-spacing: 0.04em;
    }
    .budget-val {
      font-size: 1.15rem;
      font-weight: 800;
      color: #001435;
    }
    .btn-switch-role {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      padding: 0.35rem 0.75rem;
      border-radius: 8px;
      font-size: 0.78rem;
      color: #334155;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .btn-scope-change {
      background: #eff6ff;
      border: 1.5px solid #bfdbfe;
      padding: 0.45rem 0.85rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 700;
      color: #0070ba;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.15s, border-color 0.15s;
    }
    .btn-scope-change:hover {
      background: #dbeafe;
      border-color: #93c5fd;
    }
    .active-scope-badge {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
      font-size: 0.68rem;
      font-weight: 800;
      padding: 0.1rem 0.4rem;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }

    /* Sequential Progress Bar */
    .sequential-progress-container {
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 1px solid #f1f4f8;
    }
    .progress-bar-title {
      font-size: 0.75rem;
      font-weight: 800;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.85rem;
    }
    .milestones-track-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      overflow-x: auto;
      padding-bottom: 0.5rem;
    }
    .track-step-node {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      padding: 0.6rem 0.85rem;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s;
      min-width: 170px;
    }
    .track-step-node.is-selected {
      border-color: #0070ba;
      background: #f0f7ff;
    }
    .track-step-node.is-approved {
      border-color: #86efac;
      background: #f0fdf4;
    }
    .track-step-node.is-locked {
      opacity: 0.6;
    }
    .track-step-node.is-addendum {
      border: 1.5px dashed #6366f1;
      background: #faf5ff;
    }
    .step-marker.marker-addendum {
      background: #ede9fe;
      color: #6366f1;
      border: 1px solid #c7d2fe;
    }
    .step-title-line {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      flex-wrap: wrap;
    }
    .addendum-timeline-tag {
      background: #ede9fe;
      color: #5b21b6;
      border: 1px solid #ddd6fe;
      font-size: 0.62rem;
      font-weight: 800;
      padding: 0.08rem 0.35rem;
      border-radius: 3px;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .tab-label-group {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .tab-addendum-tag {
      background: #ede9fe;
      color: #5b21b6;
      border: 1px solid #ddd6fe;
      font-size: 0.62rem;
      font-weight: 800;
      padding: 0.08rem 0.35rem;
      border-radius: 3px;
      text-transform: uppercase;
    }
    .target-badge-row {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.35rem;
      flex-wrap: wrap;
    }
    .badge-addendum-prominent {
      background: #ede9fe;
      color: #5b21b6;
      border: 1px solid #c7d2fe;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 0.15rem 0.55rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .step-marker {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: #cbd5e1;
      color: #334155;
      font-size: 0.75rem;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .track-step-node.is-approved .step-marker {
      background: #16a34a;
      color: #ffffff;
    }
    .track-step-node.is-selected .step-marker {
      background: #0070ba;
      color: #ffffff;
    }
    .step-info {
      display: flex;
      flex-direction: column;
      line-height: 1.25;
    }
    .step-num {
      font-size: 0.68rem;
      font-weight: 700;
      color: #64748b;
    }
    .step-title {
      font-size: 0.8rem;
      font-weight: 700;
      color: #001435;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 130px;
    }
    .step-price {
      font-size: 0.72rem;
      font-weight: 800;
      color: #0070ba;
    }
    .track-connector {
      flex: 1;
      height: 2px;
      background: #e2e8f0;
      min-width: 20px;
    }
    .track-connector.is-passed {
      background: #16a34a;
    }

    /* Desk Card */
    .fulfillment-desk-card {
      background: #ffffff;
      border: 1px solid #e1e7eb;
      border-radius: 14px;
      padding: 1.75rem 2rem;
      box-shadow: 0 2px 10px rgba(0, 20, 53, 0.04);
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    .clause-heading {
      display: flex;
      align-items: flex-start;
      gap: 0.85rem;
      border-bottom: 1px solid #f1f4f8;
      padding-bottom: 1rem;
    }
    .clause-num-tag {
      background: #0070ba;
      color: #ffffff;
      font-size: 0.75rem;
      font-weight: 800;
      padding: 0.3rem 0.65rem;
      border-radius: 6px;
    }
    .clause-title-group h2 {
      margin: 0 0 0.25rem 0;
      font-size: 1.35rem;
      color: #001435;
    }
    .clause-subtitle {
      margin: 0;
      font-size: 0.875rem;
      color: #545d68;
    }

    /* Milestone Tabs */
    .ms-selector-tabs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 0.85rem;
    }
    .btn-select-ms {
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 10px;
      padding: 0.85rem 1rem;
      text-align: left;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      transition: all 0.2s;
    }
    .btn-select-ms.active-ms-tab {
      background: #ffffff;
      border-color: #0070ba;
      box-shadow: 0 4px 12px rgba(0, 112, 186, 0.12);
    }
    .ms-tab-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .tab-ms-num {
      font-size: 0.75rem;
      font-weight: 800;
      color: #64748b;
    }
    .tab-ms-price {
      font-size: 0.85rem;
      font-weight: 800;
      color: #0070ba;
    }
    .tab-ms-name {
      font-size: 0.88rem;
      font-weight: 700;
      color: #001435;
    }
    .pill-verified {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #ecfdf5;
      color: #065f46;
      border: 1px solid #a7f3d0;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }
    .pill-resubmission {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #eff6ff;
      color: #1e40af;
      border: 1px solid #bfdbfe;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }
    .pill-flagged {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #f8fafc;
      color: #475569;
      border: 1px solid #cbd5e1;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }
    .pill-review {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #f0f7ff;
      color: #0070ba;
      border: 1px solid #bae0fd;
      font-size: 0.7rem;
      font-weight: 700;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }
    .pill-locked {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #f1f5f9;
      color: #64748b;
      border: 1px solid #cbd5e1;
      font-size: 0.7rem;
      font-weight: 600;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }
    .pill-needed {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #f0f7ff;
      color: #0070ba;
      border: 1.5px solid #0070ba;
      font-size: 0.7rem;
      font-weight: 800;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }

    /* Selected Milestone Card */
    .target-ms-card {
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 12px;
      padding: 1.25rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .target-ms-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
    }
    .target-badge {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 800;
      color: #0284c7;
      background: #e0f2fe;
      padding: 0.15rem 0.55rem;
      border-radius: 4px;
      letter-spacing: 0.04em;
    }
    .target-title-col h4 {
      margin: 0.35rem 0 0.2rem 0;
      font-size: 1.15rem;
      font-weight: 800;
      color: #001435;
    }
    .target-desc {
      margin: 0;
      font-size: 0.875rem;
      color: #475569;
    }
    .target-price-tag {
      font-size: 1.25rem;
      font-weight: 800;
      color: #0070ba;
    }
    .target-ms-req {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-left: 3.5px solid #16a34a;
      border-radius: 8px;
      padding: 0.85rem 1rem;
    }
    .req-title-tag {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.72rem;
      font-weight: 800;
      color: #15803d;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.3rem;
    }
    .req-text {
      margin: 0;
      font-size: 0.88rem;
      font-weight: 600;
      color: #166534;
      line-height: 1.45;
    }
    .target-due-row {
      margin-top: 0.4rem;
      font-size: 0.78rem;
      color: #64748b;
    }
    .target-baseline-indicator {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: #0284c7;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      padding: 0.5rem 0.85rem;
      border-radius: 6px;
    }
    .indicator-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #0284c7;
    }

    /* Stage Action Cards */
    .evidence-locked-card {
      display: flex;
      align-items: flex-start;
      gap: 1rem;
      background: #fffbeb;
      border: 1.5px solid #fde68a;
      border-left: 4.5px solid #b45309;
      border-radius: 10px;
      padding: 1.25rem 1.5rem;
    }
    .locked-icon-shield {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #fef3c7;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .locked-content h4 {
      margin: 0 0 0.25rem 0;
      font-size: 1rem;
      color: #78350f;
    }
    .locked-content p {
      margin: 0;
      font-size: 0.85rem;
      color: #92400e;
      line-height: 1.45;
    }

    .before-captured-card {
      border-radius: 10px;
      padding: 1.25rem 1.5rem;
    }
    .before-captured-card.is-success-border {
      background: #f0fdf4;
      border: 1.5px solid #86efac;
    }
    .before-captured-card.is-amber-border {
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
    }
    .before-captured-card.is-corp-notice {
      background: #ffffff;
      border: 1.5px solid #cbd5e1;
      border-left: 4.5px solid #0070ba;
      box-shadow: 0 2px 10px rgba(0, 20, 53, 0.04);
    }
    .captured-head.is-navy-text {
      color: #001435;
      font-size: 1.05rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .is-corp-desc {
      color: #334155;
      font-size: 0.88rem;
      line-height: 1.5;
      margin: 0.5rem 0 0.85rem 0;
    }
    .btn-corp-primary {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.75rem 1.4rem;
      border-radius: 8px;
      font-size: 0.925rem;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.55rem;
      transition: background 0.2s, transform 0.1s;
    }
    .btn-corp-primary:hover {
      background: #005ea6;
      transform: translateY(-1px);
    }
    .seller-recapture-container {
      margin-top: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .recapture-callout {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 3px solid #0070ba;
      border-radius: 8px;
      padding: 0.85rem 1rem;
    }
    .recapture-badge {
      display: inline-block;
      background: #001435;
      color: #ffffff;
      font-size: 0.68rem;
      font-weight: 800;
      padding: 0.2rem 0.55rem;
      border-radius: 4px;
      margin-bottom: 0.35rem;
      letter-spacing: 0.03em;
    }
    .recapture-callout p {
      margin: 0;
      color: #334155;
      font-size: 0.85rem;
      line-height: 1.45;
    }
    .recapture-active-box {
      margin-top: 0.5rem;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .recapture-box-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.85rem;
      color: #001435;
    }
    .btn-recapture-cancel {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #cbd5e1;
      padding: 0.25rem 0.65rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }
    .buyer-flagged-box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.85rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .flagged-status-badge {
      display: inline-block;
      align-self: flex-start;
      background: #001435;
      color: #ffffff;
      font-size: 0.7rem;
      font-weight: 800;
      padding: 0.2rem 0.55rem;
      border-radius: 4px;
      letter-spacing: 0.03em;
    }
    .buyer-flagged-box p {
      margin: 0;
      color: #334155;
      font-size: 0.85rem;
      line-height: 1.45;
    }
    .pill-flagged {
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #f87171;
      padding: 0.15rem 0.5rem;
      border-radius: 9999px;
      font-size: 0.72rem;
      font-weight: 800;
    }
    .btn-add-angle-subtle {
      background: #ffffff;
      color: #0284c7;
      border: 1px solid #bae6fd;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }
    .btn-add-angle-subtle:hover {
      background: #f0f9ff;
    }
    .captured-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 1rem;
      color: #15803d;
    }
    .captured-head.is-amber-text {
      color: #b45309;
    }
    .approved-desc, .review-desc {
      margin: 0.5rem 0 0 0;
      font-size: 0.875rem;
      color: #166534;
      line-height: 1.45;
    }
    .review-desc {
      color: #92400e;
    }
    .buyer-approval-box {
      margin-top: 1rem;
    }
    .btn-approve-escrow {
      background: #16a34a;
      color: #ffffff;
      border: none;
      padding: 0.75rem 1.4rem;
      border-radius: 8px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-approve-escrow:hover {
      background: #15803d;
    }
    .buyer-review-actions-row {
      margin-top: 1rem;
      display: flex;
      gap: 0.75rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .btn-reject-escrow {
      background: #ffffff;
      color: #dc2626;
      border: 1.5px solid #f87171;
      padding: 0.72rem 1.25rem;
      border-radius: 8px;
      font-size: 0.92rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-reject-escrow:hover {
      background: #fef2f2;
      border-color: #dc2626;
      transform: translateY(-1px);
    }
    .rejection-feedback-banner {
      background: #fef2f2;
      border-left: 3.5px solid #dc2626;
      padding: 0.75rem 1rem;
      border-radius: 6px;
      margin-top: 0.75rem;
    }
    .rejection-feedback-label {
      font-size: 0.72rem;
      font-weight: 800;
      color: #991b1b;
      letter-spacing: 0.04em;
    }
    .rejection-feedback-text {
      margin: 0.25rem 0 0 0;
      font-size: 0.88rem;
      font-weight: 600;
      color: #7f1d1d;
      font-style: italic;
    }
    .seller-resubmit-desk {
      margin-top: 1rem;
    }

    /* Modal styles */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 20, 53, 0.65);
      backdrop-filter: blur(4px);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }
    .reject-modal-card {
      background: #ffffff;
      border-radius: 16px;
      max-width: 560px;
      width: 100%;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      border: 1.5px solid #fecaca;
      overflow: hidden;
      animation: popIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes popIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .reject-modal-header {
      background: #fef2f2;
      padding: 1.25rem 1.5rem;
      border-bottom: 1px solid #fee2e2;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .reject-header-icon {
      width: 42px;
      height: 42px;
      background: #fee2e2;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .reject-header-text h3 {
      margin: 0;
      font-size: 1.15rem;
      color: #991b1b;
      font-weight: 700;
    }
    .reject-modal-sub {
      margin: 0.15rem 0 0 0;
      font-size: 0.82rem;
      color: #7f1d1d;
    }
    .reject-modal-body {
      padding: 1.5rem;
    }
    .reject-instruction {
      margin: 0 0 1rem 0;
      font-size: 0.88rem;
      color: #475569;
      line-height: 1.45;
    }
    .reject-label {
      display: block;
      font-size: 0.8rem;
      font-weight: 700;
      color: #334155;
      margin-bottom: 0.4rem;
    }
    .quick-chips-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      margin-bottom: 1rem;
    }
    .quick-chip {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 9999px;
      font-size: 0.74rem;
      font-weight: 600;
      color: #334155;
      padding: 0.28rem 0.65rem;
      cursor: pointer;
      transition: all 0.15s;
    }
    .quick-chip:hover {
      background: #fee2e2;
      border-color: #f87171;
      color: #991b1b;
    }
    .reject-textarea {
      width: 100%;
      box-sizing: border-box;
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.7rem;
      font-size: 0.88rem;
      font-family: inherit;
      color: #0f172a;
      resize: vertical;
    }
    .reject-textarea:focus {
      outline: none;
      border-color: #dc2626;
      box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.12);
    }
    .reject-modal-footer {
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 1rem 1.5rem;
      display: flex;
      justify-content: flex-end;
      gap: 0.75rem;
    }
    .btn-modal-cancel {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #475569;
      padding: 0.65rem 1.2rem;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-modal-confirm-reject {
      background: #dc2626;
      border: none;
      color: #ffffff;
      padding: 0.65rem 1.4rem;
      border-radius: 8px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-modal-confirm-reject:hover:not(:disabled) {
      background: #b91c1c;
    }
    .btn-modal-confirm-reject:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }
    .seller-waiting-note {
      margin-top: 0.75rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      font-size: 0.85rem;
      color: #78350f;
    }
    .btn-refresh-status {
      background: #ffffff;
      color: #92400e;
      border: 1px solid #fcd34d;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      cursor: pointer;
    }

    .awaiting-contractor-card {
      display: flex;
      gap: 1.15rem;
      background: #f0f9ff;
      border: 1.5px solid #bae6fd;
      border-radius: 12px;
      padding: 1.35rem;
      align-items: flex-start;
    }
    .awaiting-icon-box {
      background: #e0f2fe;
      border: 1px solid #7dd3fc;
      border-radius: 50%;
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .awaiting-text h4 {
      margin: 0 0 0.35rem 0;
      color: #0369a1;
      font-size: 1.05rem;
      font-weight: 800;
    }
    .awaiting-text p {
      margin: 0 0 0.85rem 0;
      color: #0c4a6e;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .awaiting-badge-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }
    .badge-role-guard {
      background: #0284c7;
      color: #ffffff;
      font-size: 0.72rem;
      font-weight: 800;
      padding: 0.2rem 0.6rem;
      border-radius: 6px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-role-info {
      font-size: 0.82rem;
      color: #0369a1;
      font-weight: 500;
    }

    .live-cam-embed {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .cam-instructions-banner {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: #f0f7ff;
      border: 1px solid #bae0fd;
      padding: 0.65rem 1rem;
      border-radius: 8px;
      font-size: 0.825rem;
      color: #0369a1;
    }

    /* AI Certificates */
    .ms-ai-certificate {
      background: #f0fdf4;
      border: 1.5px solid #86efac;
      border-radius: 10px;
      padding: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .ms-ai-certificate.has-fraud-warning {
      background: #fffbeb;
      border-color: #fde68a;
    }
    .cert-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .cert-title-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #15803d;
      font-size: 0.925rem;
    }
    .cert-confidence-pill {
      background: #16a34a;
      color: #ffffff;
      font-size: 0.75rem;
      font-weight: 800;
      padding: 0.2rem 0.6rem;
      border-radius: 9999px;
    }
    .cert-confidence-pill.is-fraud {
      background: #dc2626;
      color: #ffffff;
      border: 1px solid #b91c1c;
    }
    .ms-ai-certificate.has-fraud-warning {
      background: #fffbeb;
      border-color: #f59e0b;
    }
    .cert-head.is-flagged .cert-title-row {
      color: #b91c1c;
    }
    .cert-angles-strip {
      display: flex;
      gap: 0.85rem;
      overflow-x: auto;
    }
    .cert-angle-card {
      background: #ffffff;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      padding: 0.5rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
    }
    .cert-thumb {
      width: 90px;
      height: 65px;
      object-fit: cover;
      border-radius: 4px;
    }
    .angle-label {
      font-size: 0.7rem;
      font-weight: 700;
      color: #15803d;
    }
    .cert-hash {
      font-family: monospace;
      font-size: 0.68rem;
      color: #64748b;
    }
    .cert-notes {
      font-size: 0.825rem;
      color: #166534;
      background: #ffffff;
      border: 1px solid #bbf7d0;
      padding: 0.65rem 0.85rem;
      border-radius: 6px;
    }
    .corp-audit-notice-panel {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 3.5px solid #0070ba;
      border-radius: 8px;
      padding: 0.85rem 1.15rem;
      margin-top: 0.75rem;
    }
    .audit-notice-title {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #001435;
      font-size: 0.86rem;
      font-weight: 700;
    }
    .audit-notice-desc {
      margin: 0.35rem 0 0.65rem 0;
      font-size: 0.82rem;
      color: #475569;
      line-height: 1.45;
    }
    .flags-chips-row {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
    }
    .audit-flag-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #ffffff;
      color: #334155;
      border: 1px solid #cbd5e1;
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
    }

    /* Evidence Gallery */
    .secured-evidence-gallery {
      margin-top: 1.5rem;
      border-top: 1px solid #f1f4f8;
      padding-top: 1.25rem;
    }
    .gallery-title {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      font-size: 0.95rem;
      font-weight: 800;
      color: #001435;
      margin-bottom: 1rem;
    }
    .evidence-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
    }
    .evidence-item-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 0.65rem;
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .item-badge-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .item-method-pill {
      font-size: 0.68rem;
      font-weight: 800;
      color: #0369a1;
      background: #e0f2fe;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }
    .item-conf-pill {
      font-size: 0.68rem;
      font-weight: 700;
      color: #16a34a;
    }
    .item-conf-pill.is-fraud {
      color: #dc2626;
      background: #fee2e2;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      border: 1px solid #fca5a5;
    }
    .evidence-item-card.is-fraud-item {
      border-color: #f87171;
      background: #fff5f5;
    }
    .item-media-preview {
      width: 100%;
      height: 120px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
    }
    .item-meta-details {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      font-size: 0.72rem;
    }
    .item-hash {
      font-family: monospace;
      color: #0070ba;
    }
    .item-time {
      color: #64748b;
    }

    /* Digital Deliverable Submission Desk */
    .digital-submission-desk {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .digital-tabs-bar {
      display: flex;
      gap: 0.5rem;
      background: #f1f5f9;
      padding: 4px;
      border-radius: 8px;
      width: fit-content;
    }
    .digital-tab-btn {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.84rem;
      font-weight: 600;
      border: none;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .digital-tab-btn.is-active {
      background: #ffffff;
      color: #001435;
      box-shadow: 0 1px 3px rgba(0, 20, 53, 0.08);
    }
    .tab-recommended-badge {
      background: #e0f2fe;
      color: #0284c7;
      font-size: 0.68rem;
      font-weight: 700;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .digital-upload-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1.25rem;
    }
    .digital-info-banner {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      color: #166534;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.825rem;
      line-height: 1.45;
    }
    .digital-dropzone {
      border: 2px dashed #94a3b8;
      border-radius: 10px;
      padding: 2.25rem 1.5rem;
      text-align: center;
      background: #f8fafc;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .digital-dropzone:hover, .digital-dropzone.is-dragging {
      border-color: #0070ba;
      background: #f0f7ff;
    }
    .digital-dropzone.has-file {
      padding: 1rem;
      border-style: solid;
      border-color: #cbd5e1;
      background: #ffffff;
    }
    .dropzone-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.45rem;
    }
    .dropzone-icon {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #e0f2fe;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 0.25rem;
    }
    .dropzone-main-text {
      font-size: 0.95rem;
      color: #001435;
      font-weight: 600;
    }
    .dropzone-sub-text {
      font-size: 0.78rem;
      color: #64748b;
    }
    .dropzone-selected-preview {
      display: flex;
      align-items: center;
      gap: 1rem;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 0.75rem 1rem;
    }
    .preview-img {
      width: 64px;
      height: 64px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
    }
    .preview-file-icon {
      width: 48px;
      height: 48px;
      background: #e0f2fe;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .preview-file-info {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
      flex: 1;
      text-align: left;
    }
    .preview-file-name {
      font-weight: 700;
      font-size: 0.88rem;
      color: #001435;
      word-break: break-all;
    }
    .preview-file-size {
      font-size: 0.75rem;
      color: #64748b;
    }
    .preview-file-type {
      font-size: 0.7rem;
      color: #0369a1;
      font-weight: 600;
      text-transform: uppercase;
    }
    .btn-clear-file {
      background: #fee2e2;
      color: #dc2626;
      border: 1px solid #fca5a5;
      border-radius: 6px;
      padding: 0.4rem 0.75rem;
      font-size: 0.78rem;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.35rem;
      cursor: pointer;
    }
    .btn-clear-file:hover {
      background: #fecaca;
    }
    .asset-url-row {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .url-input-label {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      font-weight: 600;
      color: #475569;
    }
    .url-text-field {
      padding: 0.6rem 0.85rem;
      border: 1.5px solid #cbd5e1;
      border-radius: 6px;
      font-size: 0.85rem;
      color: #001435;
      background: #f8fafc;
    }
    .url-text-field:focus {
      outline: none;
      border-color: #0070ba;
      background: #ffffff;
    }
    .upload-error-notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      padding: 0.6rem 0.85rem;
      color: #b91c1c;
      font-size: 0.82rem;
      font-weight: 500;
    }
    .digital-actions-bar {
      display: flex;
      justify-content: flex-end;
    }
    .btn-submit-digital {
      background: #0070ba;
      color: #ffffff;
      border: none;
      border-radius: 8px;
      padding: 0.75rem 1.5rem;
      font-size: 0.92rem;
      font-weight: 700;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .btn-submit-digital:hover:not(:disabled) {
      background: #005ea6;
    }
    .btn-submit-digital:disabled {
      opacity: 0.55;
      cursor: not-allowed;
    }
    .btn-spinner {
      width: 16px;
      height: 16px;
      border: 2.5px solid rgba(255, 255, 255, 0.3);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    .cert-doc-thumb {
      width: 58px;
      height: 58px;
      background: #f1f5f9;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #cbd5e1;
    }
    .audit-flag-tag.is-ai-watermark {
      background: #fef2f2;
      color: #991b1b;
      border: 1px solid #fecaca;
      font-weight: 700;
    }
    .item-method-pill.is-upload {
      background: #f3e8ff;
      color: #7e22ce;
    }
    .item-doc-preview {
      width: 100%;
      height: 120px;
      background: #f1f5f9;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.35rem;
      padding: 0.5rem;
      text-align: center;
    }
    .item-doc-label {
      font-size: 0.72rem;
      color: #475569;
      font-weight: 600;
      max-width: 90%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Responsive Media Queries */
    @media (max-width: 900px) {
      .fulfillment-shell {
        padding: 0 1rem;
        margin: 1.25rem auto;
      }
      .header-top-row {
        flex-direction: column;
        align-items: stretch;
        gap: 1rem;
      }
      .header-right-col {
        width: 100%;
        align-items: stretch;
        gap: 0.75rem;
      }
      .escrow-budget-card {
        text-align: left;
      }
    }

    @media (max-width: 640px) {
      .fulfillment-shell {
        padding: 0 0.5rem;
        margin: 0.75rem auto;
      }
      .fulfillment-header-card {
        padding: 1.25rem 1rem;
      }
      .title-meta-cluster h1 {
        font-size: 1.25rem;
      }
      .header-right-col {
        flex-direction: column;
        align-items: stretch;
      }
      .escrow-budget-card, .btn-scope-change, .btn-switch-role {
        width: 100%;
        box-sizing: border-box;
        justify-content: center;
      }
      .badges-row {
        gap: 0.35rem;
      }
      .milestones-status-grid {
        grid-template-columns: 1fr;
      }
      .selected-ms-banner {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.5rem;
      }
      .verification-action-zone {
        padding: 1.25rem 0.95rem;
      }
      .stepper-row {
        flex-direction: column;
        gap: 0.75rem;
      }
    }
  `]
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

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private http: HttpClient
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
    });
  }

  fetchProject() {
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
        },
        error: (err) => {
          this.isLoading = false;
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
    return s === 'accepted' || s === 'completed' || s === 'active' || s === 'work_in_progress';
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
    if (!this.projectId) return;
    this.http.post<any>(`${API_BASE_URL}/api/milestones/${this.projectId}_${index}/approve`, {})
      .subscribe({
        next: (res) => {
          if (this.milestones[index]) {
            this.milestones[index].status = 'approved';
          }
          if (res.next_active_milestone_index !== null && res.next_active_milestone_index !== undefined) {
            this.selectedMilestoneIndex = res.next_active_milestone_index;
          }
          this.fetchProject();
        },
        error: (err) => alert(err.error?.detail || err.message || 'Approval failed')
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
}
