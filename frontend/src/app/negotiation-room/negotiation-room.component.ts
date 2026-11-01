import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { API_BASE_URL } from '../api.config';
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
  template: `
    <div class="corporate-shell">
      <!-- Loading State -->
      @if (isLoading) {
        <div class="loading-state">
          <div class="corporate-spinner"></div>
          <p>Connecting to Secure Escrow Negotiation Room...</p>
        </div>
      } @else if (projectData) {
        <!-- Top Executive Bar -->
        <header class="room-topbar">
          <div class="topbar-left">
            <button (click)="goBack()" class="btn-back-nav">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/>
                <polyline points="12 19 5 12 12 5"/>
              </svg>
              <span>Back to Dashboard</span>
            </button>
            <div class="title-cluster">
              <div class="title-meta-line">
                <span class="project-id-badge">#PL-{{ projectData.project.id }}</span>
                <span class="industry-badge">{{ projectData.project.industry_type || 'General' }}</span>
                @if (getEffectiveProjectDeadline()) {
                  <span class="deadline-pill">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                      <line x1="16" y1="2" x2="16" y2="6"/>
                      <line x1="8" y1="2" x2="8" y2="6"/>
                      <line x1="3" y1="10" x2="21" y2="10"/>
                    </svg>
                    <span>Target Due: {{ getEffectiveProjectDeadline() }}</span>
                  </span>
                }
                <span class="status-pill" [attr.data-status]="projectData.project.status">
                  {{ formatStatus(projectData.project.status) }}
                </span>
              </div>
              <h1 class="project-title">{{ projectData.project.title }}</h1>
            </div>
          </div>

          <div class="topbar-right">
            <!-- Escrow Budget Box -->
            <div class="budget-stat-box">
              <span class="stat-label">PROTECTED ESCROW BUDGET</span>
              <span class="stat-value">\${{ Number(projectData.project.total_price).toFixed(2) }} <span class="currency-tag">USD</span></span>
            </div>

            <!-- Scope Change Request / Negotiation Desk -->
            @if (isProjectActive() || projectData.project.status === 'accepted') {
              <button (click)="openRevisionRoom()" class="btn-scope-change-nav" title="Request or view project scope changes and addenda">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <span>Request Scope Change</span>
                @if (activeScopeChange && activeScopeChange.status !== 'ACCEPTED') {
                  <span class="active-scope-badge-nav">{{ activeScopeChange.status === 'PENDING_FUNDS' ? 'Pending Escrow' : 'Negotiating' }}</span>
                }
              </button>
            }

            <!-- Role Badge & Seamless Switcher -->
            <div class="persona-badge" [class.is-buyer]="currentRole === 'buyer'" [class.is-seller]="currentRole === 'seller'">
              <div class="persona-icon-box">
                @if (currentRole === 'buyer') {
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                } @else {
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                  </svg>
                }
              </div>
              <div class="persona-text">
                <span class="persona-role">{{ currentRole === 'buyer' ? 'Buyer Console' : 'Seller Console' }}</span>
                <span class="persona-email">{{ currentRole === 'buyer' ? (projectData.project.buyer_email || 'buyer@prooflens.com') : (projectData.project.seller_email || 'seller@prooflens.com') }}</span>
              </div>
              <button (click)="toggleRole()" class="btn-role-switch" title="Toggle between Buyer and Seller perspectives">
                <span>Switch</span>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                </svg>
              </button>
            </div>

            <!-- Primary Agreement Action -->
            <div class="topbar-action-zone">
              @if (projectData.project.status === 'accepted') {
                <div class="accepted-seal">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>Terms Locked & Escrow Funded</span>
                </div>
                <button (click)="goToFulfillment()" class="btn-corporate-fulfillment">
                  <span>Go to Fulfillment Desk →</span>
                </button>
              } @else if (currentRole === 'seller') {
                <button
                  (click)="acceptAgreement()"
                  [disabled]="isAccepting"
                  class="btn-corporate-accept"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>{{ isAccepting ? 'Locking Terms...' : 'Accept Agreement Terms' }}</span>
                </button>
              } @else {
                <div class="buyer-awaiting-badge">
                  <span class="pulse-mini-dot"></span>
                  <span>Awaiting Seller Acceptance</span>
                </div>
              }
            </div>
          </div>
        </header>

        <!-- Persistent Milestone Deadline Approaching Warning Banner (Phase 4: Contractor Only for Active Projects) -->
        @if (currentRole === 'seller' && isProjectActive() && activeAlert) {
          <div class="persistent-deadline-warning-banner">
            <div class="warning-banner-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div class="warning-banner-text">
              <strong>{{ activeAlert.message }}</strong>
              <div class="warning-banner-sub">
                Target Deadline: <strong>{{ activeAlert.formatted_deadline || activeAlert.deadline }}</strong>
                @if (activeAlert.hours_remaining !== undefined && activeAlert.hours_remaining > 0) {
                  &bull; ({{ activeAlert.hours_remaining }}h remaining)
                }
              </div>
            </div>
          </div>
        }

        <!-- Acceptance Banner -->
        @if (projectData.project.status === 'accepted') {
          <div class="celebration-card">
            <div class="seal-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2"/>
                <path d="M4 3h16v6a8 8 0 0 1-16 0V3z"/>
                <path d="M12 17v4M8 21h8"/>
              </svg>
            </div>
            <div style="flex: 1;">
              <h3>Escrow Agreement Formally Accepted & Locked</h3>
              <p>Both Buyer and Seller have formally ratified Version {{ projectData.agreement.version || 1 }}.0. PayPal escrow deposit is secured. Milestone releases will trigger upon verification of proof-of-work evidence.</p>
            </div>
            <button (click)="goToFulfillment()" class="btn-celebration-fulfillment">
              Go to Milestone Fulfillment Desk →
            </button>
          </div>
        }

        <!-- Seller Notification: Updated terms received from buyer -->
        @if (currentRole === 'seller' && projectData.project.status !== 'accepted' && (projectData.agreement.version > 1 || projectData.agreement.latest_buyer_message)) {
          <div class="notification-banner seller-notice">
            <div class="notice-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1d4ed8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
            </div>
            <div class="notice-body">
              <strong>Updated Agreement Terms Received (Version {{ projectData.agreement.version || 1 }}.0)</strong>
              <p>The Buyer has revised the terms to accommodate your specifications: <em>"{{ projectData.agreement.latest_buyer_message || 'Terms revised per negotiation.' }}"</em></p>
              <div class="notice-cta">Please review the updated agreement on the left. Click <strong>Accept Agreement Terms</strong> above if acceptable.</div>
            </div>
          </div>
        }

        <!-- Buyer Notification: Seller requested changes -->
        @if (currentRole === 'buyer' && projectData.project.status !== 'accepted' && projectData.agreement.latest_seller_message) {
          <div class="notification-banner buyer-notice">
            <div class="notice-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <div class="notice-body">
              <strong>Action Required: Contractor Requested Scope / Schedule Adjustment</strong>
              <p>The Seller has submitted a modification request: <em>"{{ projectData.agreement.latest_seller_message }}"</em></p>
              <div class="notice-cta">Use the <strong>AI Contract Revision Desk</strong> on the right to re-draft terms and send the updated agreement back to the seller.</div>
            </div>
          </div>
        }

        <!-- Success Banner when updated terms sent -->
        @if (termsUpdateSuccessBanner) {
          <div class="notification-banner success-notice">
            <div class="notice-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="16 9 12 15 8 11"/>
              </svg>
            </div>
            <div class="notice-body">
              <strong>Agreement Terms Successfully Updated & Dispatched</strong>
              <p>Version {{ projectData.agreement.version }}.0 has been committed to the secure ledger. The seller can now review and accept the revised terms.</p>
            </div>
          </div>
        }

        <!-- Split Screen Main Layout -->
        <main class="negotiation-workspace">
          <!-- LEFT: Official Escrow Agreement Document (Statement of Work) -->
          <section class="document-section">
            <div class="corporate-card doc-card">
              <div class="doc-header">
                <div>
                  <div class="doc-kicker">OFFICIAL ESCROW STATEMENT OF WORK</div>
                  <h2>Master Service & Escrow Agreement</h2>
                </div>
                <div class="doc-version-tag">
                  Version {{ projectData.agreement.version || 1 }}.0
                </div>
              </div>

              <!-- Clause 1: Legal Terms -->
              <div class="clause-box">
                <div class="clause-heading">
                  <span class="clause-num">Section 1.0</span>
                  <span class="clause-title">Scope of Deliverables & Milestones</span>
                </div>
                @if (projectData.agreement.milestones && projectData.agreement.milestones.length > 0) {
                  <div class="room-milestones-list">
                    @for (ms of projectData.agreement.milestones; track $index) {
                      <div class="room-milestone-card">
                        <div class="room-ms-top">
                          <div class="room-ms-title-col">
                            <div class="room-ms-badge-row">
                              <span class="room-ms-badge">Milestone {{ $index + 1 }}</span>
                              @if (projectData.project.status !== 'accepted') {
                                <label class="room-ms-deadline-editable" title="Click to adjust milestone deadline directly">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                    <line x1="16" y1="2" x2="16" y2="6"/>
                                    <line x1="8" y1="2" x2="8" y2="6"/>
                                    <line x1="3" y1="10" x2="21" y2="10"/>
                                  </svg>
                                  <span>Target Due:</span>
                                  <input
                                    type="date"
                                    class="inline-ms-date-picker"
                                    [ngModel]="ms.deadline || getMilestoneFallbackDeadline($index)"
                                    (ngModelChange)="onMilestoneDateChanged($index, $event)"
                                  />
                                </label>
                              } @else {
                                <span class="room-ms-deadline-tag">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                    <line x1="16" y1="2" x2="16" y2="6"/>
                                    <line x1="8" y1="2" x2="8" y2="6"/>
                                    <line x1="3" y1="10" x2="21" y2="10"/>
                                  </svg>
                                  <span>Target Due: {{ ms.deadline || getMilestoneFallbackDeadline($index) }}</span>
                                </span>
                              }
                            </div>
                            <span class="room-ms-title">{{ ms.title }}</span>
                          </div>
                          <div class="room-ms-price" [class.zero-price]="ms.price_allocation === 0">
                            @if (ms.price_allocation === 0) {
                              <span class="zero-badge">Non-Monetary Sign-Off</span>\$0.00 USD
                            } @else {
                              \${{ Number(ms.price_allocation).toFixed(2) }} USD
                            }
                          </div>
                        </div>
                        <p class="room-ms-desc">{{ ms.description }}</p>
                        <div class="room-ms-proof">
                          <div class="room-proof-header">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                            </svg>
                            <span>Strict Visual Verification Criteria (PayPal Release):</span>
                          </div>
                          <div class="room-proof-body">{{ ms.proof_required }}</div>
                        </div>

                        <!-- Buyer Resubmission Requested Banner -->
                        @if ((ms.status || '').toLowerCase() === 'resubmission_requested') {
                          <div class="amber-fraud-banner" style="background:#fef2f2; border-color:#fca5a5;">
                            <div class="banner-title" style="color:#b91c1c;">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2.5">
                                <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                              </svg>
                              <strong>BUYER REQUESTED EVIDENCE RESUBMISSION</strong>
                            </div>
                            <p class="banner-policy" style="color:#7f1d1d; font-weight:600;">
                              Buyer Feedback: "{{ ms.rejection_reason || 'Buyer requested updated evidence resubmission.' }}"
                            </p>
                            @if (currentRole === 'seller') {
                              <div class="seller-flag-recapture-link">
                                <a [routerLink]="['/project', projectId, 'fulfillment']" [queryParams]="{ role: 'seller', ms: $index }" class="btn-recapture-cta">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                                  </svg>
                                  <span>Resubmit Live Physical Proof</span>
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                                </a>
                              </div>
                            }
                          </div>
                        }

                        <!-- AI Milestone Verification Certificate -->
                        @if (getAllEvidenceForMilestone($index); as milestoneEvList) {
                          @if (milestoneEvList.length > 0) {
                            <div class="ms-ai-certificate" [class.has-fraud-warning]="hasFraudInMilestone(milestoneEvList)">
                              @if (hasFraudInMilestone(milestoneEvList)) {
                                <div class="corp-audit-notice-panel">
                                  <div class="audit-notice-title">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#475569" stroke-width="2.2">
                                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                                    </svg>
                                    <span>Forensic Observation: Potential Screen Re-Photographing or Anomaly Detected</span>
                                  </div>
                                  <p class="audit-notice-desc">
                                    Automated integrity models detected indicators of display reproduction or criteria mismatch. Findings are recorded for human escrow dispute review.
                                  </p>
                                  <div class="flags-chips-row">
                                    @for (flag of getMilestoneFraudFlags(milestoneEvList); track flag) {
                                      <span class="audit-flag-tag">
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                                        </svg>
                                        <span>{{ flag }}</span>
                                      </span>
                                    }
                                  </div>
                                  @if (currentRole === 'seller') {
                                    <div class="seller-flag-recapture-link">
                                      <a [routerLink]="['/project', projectId, 'fulfillment']" [queryParams]="{ role: 'seller', ms: $index }" class="btn-recapture-cta">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>
                                        </svg>
                                        <span>Recapture Live Physical Proof</span>
                                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                                      </a>
                                    </div>
                                  }
                                </div>
                              }

                              <div class="cert-head" [class.is-flagged]="hasFraudInMilestone(milestoneEvList)">
                                <div class="cert-title-row">
                                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" [attr.stroke]="hasFraudInMilestone(milestoneEvList) ? '#dc2626' : '#16a34a'" stroke-width="2.5">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                  </svg>
                                  <strong>{{ hasFraudInMilestone(milestoneEvList) ? 'ProofLens Anti-Spoofing Audit — FLAGGED FOR REVIEW' : ('ProofLens Multi-Angle Verification Certificate (' + milestoneEvList.length + ' Angle' + (milestoneEvList.length > 1 ? 's' : '') + ')') }}</strong>
                                </div>
                                <span class="cert-confidence-pill" [class.is-fraud]="hasFraudInMilestone(milestoneEvList)">{{ milestoneEvList[0].ai_confidence_score }}% {{ hasFraudInMilestone(milestoneEvList) ? 'MATCH (FLAGGED)' : 'MATCH' }}</span>
                              </div>

                              <div class="cert-angles-strip">
                                @for (ev of milestoneEvList; track ev.id; let aIdx = $index) {
                                  <div class="cert-angle-card">
                                    @if (ev.file_path) {
                                      <img [src]="getEvidenceUrl(ev.file_path)" alt="Angle {{ aIdx + 1 }}" class="cert-thumb" />
                                    }
                                    <span class="angle-label">Angle {{ aIdx + 1 }}</span>
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
                      </div>
                    }
                  </div>
                } @else {
                  <div class="clause-body">
                    {{ projectData.agreement.ai_generated_contract || projectData.project.description }}
                  </div>
                }
              </div>

              <!-- Clause 2: Evidence Requirements -->
              <div class="clause-box evidence-clause">
                <div class="clause-heading">
                  <span class="clause-num">Section 2.0</span>
                  <span class="clause-title">Proof-of-Work Verification Criteria</span>
                </div>
                <div class="evidence-subtext">
                  PayPal escrow funds release exclusively upon electronic verification of the following criteria:
                </div>
                <div class="clause-body evidence-content">
                  {{ projectData.agreement.evidence_requirements || 'Photographic and video proof of completed deliverables.' }}
                </div>
              </div>

              <!-- Clause 2.5: Buyer Pre-Work Baseline Evidence -->
              <div class="clause-box baseline-clause">
                <div class="clause-heading">
                  <span class="clause-num">Section 2.5</span>
                  <span class="clause-title">Buyer Pre-Work Baseline Evidence</span>
                </div>
                <div class="evidence-subtext">
                  Authoritative pre-work condition recorded by the buyer. ProofLens AI compares seller milestone submissions directly against this baseline.
                </div>
                @if (getBeforeEvidence(); as beforeEv) {
                  <div class="baseline-record-card">
                    <div class="baseline-card-top">
                      <span class="badge-baseline-locked">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <span>BASELINE SECURED</span>
                      </span>
                      <span class="baseline-timestamp">Recorded: {{ beforeEv.server_receipt_timestamp || 'Pre-Work' }}</span>
                    </div>
                    <div class="baseline-card-body">
                      @if (beforeEv.file_path) {
                        <img [src]="getEvidenceUrl(beforeEv.file_path)" alt="Buyer Baseline" class="baseline-preview-img" />
                      }
                      <div class="baseline-card-meta">
                        <strong>Pre-Work Site Condition (Buyer Live Capture)</strong>
                        <span class="baseline-hash">SHA-256: {{ beforeEv.file_hash?.slice(0, 20) }}...</span>
                        <p class="baseline-desc">Authoritative reference frame used by AI Multimodal Comparison to audit contractor progression.</p>
                      </div>
                    </div>
                  </div>
                } @else if (isBeforeEvidenceExempt()) {
                  <div class="baseline-exempt-card">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0284c7" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                    <div>
                      <strong>Before Evidence Exemption Active</strong>
                      <p>Deliverable is fabricated from scratch / raw stock. AI evaluates seller submissions directly against contract specifications.</p>
                    </div>
                  </div>
                } @else {
                  <div class="baseline-pending-card">
                    <p>No baseline before-evidence recorded yet.</p>
                    @if (currentRole === 'buyer' && projectData.project.is_home_renovation) {
                      <div class="buyer-baseline-prompt">
                        <span class="badge-mandatory">MANDATORY FOR HOME RENOVATION</span>
                        <p>Please capture your pre-work site baseline photo now:</p>
                        <app-live-camera
                          [projectId]="projectId"
                          evidenceType="before_evidence"
                          label="Buyer Pre-Work Site Baseline Capture"
                          (evidenceUploaded)="handleEvidenceSuccess($event)"
                        ></app-live-camera>
                      </div>
                    }
                  </div>
                }
              </div>

              <!-- Section 3.0: Cryptographic Milestone Fulfillment Desk (Only visible when seller accepts agreement) -->
              @if (isProjectActive()) {
                <div class="clause-box fulfillment-nav-clause">
                  <div class="clause-heading">
                    <span class="clause-num">Section 3.0</span>
                    <span class="clause-title">Cryptographic Milestone Fulfillment Desk</span>
                  </div>
                  <div class="evidence-subtext">
                    Hardware live camera capture, sequential milestone submissions, and PayPal escrow payout releases are managed on the dedicated fulfillment desk.
                  </div>
                  <div class="fulfillment-nav-card">
                    <div class="nav-icon-seal">
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                      </svg>
                    </div>
                    <div class="nav-desc-col">
                      <h4>Agreement Terms Formally Ratified & Locked</h4>
                      <p>Hardware live camera capture, sequential milestone submissions, and PayPal escrow payout approvals have transitioned to the Fulfillment Desk.</p>
                    </div>
                    <button type="button" (click)="goToFulfillment()" class="btn-open-fulfillment-page">
                      <span>Open Milestone Fulfillment Desk →</span>
                    </button>
                  </div>
                </div>
              }

              <!-- Escrow Certification Seal -->
              <div class="doc-footer-seal">
                <div class="seal-badge">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                  </svg>
                  <span>PROOFLENS VERIFIED</span>
                </div>
                <div class="seal-text">
                  This agreement is cryptographic proof-bound and backed by the PayPal Sandbox Escrow Protection Protocol.
                </div>
              </div>
            </div>
          </section>

          <!-- RIGHT: Negotiation Console & AI Revision Desk -->
          <section class="negotiation-section">
            <div class="corporate-card negotiation-card">
              <div class="card-title-row">
                <div>
                  <div class="card-kicker">COMMUNICATION & AUDIT TRAIL</div>
                  <h3>Negotiation Console</h3>
                </div>
                <span class="active-role-tag">{{ currentRole === 'buyer' ? 'Buyer Perspective' : 'Seller Perspective' }}</span>
              </div>

              <!-- Negotiation Message Stream -->
              <div class="activity-feed">
                <!-- Seller Request Card -->
                @if (projectData.agreement.latest_seller_message) {
                  <div class="activity-card seller-activity">
                    <div class="activity-header">
                      <div class="activity-avatar seller-avatar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
                          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
                        </svg>
                      </div>
                      <div class="activity-meta">
                        <span class="activity-author">Seller / Contractor</span>
                        <span class="activity-sub">Requested Scope Adjustment</span>
                      </div>
                    </div>
                    <div class="activity-message">
                      "{{ projectData.agreement.latest_seller_message }}"
                    </div>
                  </div>
                }

                <!-- Buyer Response Card -->
                @if (projectData.agreement.latest_buyer_message) {
                  <div class="activity-card buyer-activity">
                    <div class="activity-header">
                      <div class="activity-avatar buyer-avatar">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                        </svg>
                      </div>
                      <div class="activity-meta">
                        <span class="activity-author">Buyer / Client</span>
                        <span class="activity-sub">Revised Terms Response</span>
                      </div>
                    </div>
                    <div class="activity-message">
                      "{{ projectData.agreement.latest_buyer_message }}"
                    </div>
                  </div>
                }

                <!-- Empty state if fresh -->
                @if (!projectData.agreement.latest_seller_message && !projectData.agreement.latest_buyer_message) {
                  <div class="empty-activity">
                    <div class="empty-icon">
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                        <line x1="16" y1="13" x2="8" y2="13"/>
                        <line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                    </div>
                    <p>No changes requested yet. Both parties can propose adjustments or accept the agreement as drafted.</p>
                  </div>
                }
              </div>

              <!-- ============================================== -->
              <!-- BUYER CONSOLE: AI RE-DRAFT & SEND REVISED TERMS -->
              <!-- ============================================== -->
              @if (currentRole === 'buyer' && projectData.project.status !== 'accepted') {
                <div class="buyer-ai-desk">
                  <div class="desk-header">
                    <div class="desk-title">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.2">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
                      </svg>
                      <h4>AI Contract Revision Desk</h4>
                    </div>
                    <span class="desk-hint">Draft Version {{ (projectData.agreement.version || 1) + 1 }}.0</span>
                  </div>

                  <p class="desk-desc">
                    Respond to the seller's request. ProofLens Legal AI will regenerate the formal clauses and required proof criteria.
                  </p>

                  <div class="input-group">
                    <label>Your Response / Revision Instructions for AI</label>
                    <textarea
                      [(ngModel)]="buyerRevisionNote"
                      rows="3"
                      placeholder="e.g., I accept the 5-day delivery schedule, provided contractor submits daily progress photos and video of completed installation..."
                      class="corporate-textarea"
                    ></textarea>
                  </div>

                  <!-- Action Button: Regenerate with AI -->
                  <div class="desk-action-bar">
                    <button
                      (click)="regenerateAgreementWithAi()"
                      [disabled]="!buyerRevisionNote.trim() || isRegenerating"
                      class="btn-pp-ai-draft"
                    >
                      <span>{{ isRegenerating ? 'AI Drafting Revised Terms...' : 'Re-draft Agreement with AI' }}</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                        <polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </button>
                  </div>

                  <!-- AI Preview Card if generated -->
                  @if (regeneratedPreview) {
                    <div class="ai-preview-card">
                      <div class="preview-header">
                        <span class="preview-badge">AI Draft Preview (v{{ (projectData.agreement.version || 1) + 1 }}.0)</span>
                        <span class="changes-count">Ready to Dispatch</span>
                      </div>

                      <div class="summary-pill">
                        <strong>Summary of Revisions:</strong> {{ regeneratedPreview.summary_of_changes }}
                      </div>

                      <div class="preview-clause">
                        <div class="preview-label">Updated Legal Terms:</div>
                        <div class="preview-text">{{ regeneratedPreview.contract_terms }}</div>
                      </div>

                      <div class="preview-clause">
                        <div class="preview-label">Updated Evidence Proof Criteria:</div>
                        <div class="preview-text">{{ regeneratedPreview.evidence_requirements }}</div>
                      </div>

                      @if (regeneratedPreview.milestones && regeneratedPreview.milestones.length > 0) {
                        <div class="preview-clause">
                          <div class="preview-label">Updated Milestone Schedule & Deadlines:</div>
                          <div class="preview-ms-chips">
                            @for (ms of regeneratedPreview.milestones; track $index) {
                              <div class="preview-ms-chip">
                                <div class="preview-ms-left">
                                  <span class="preview-ms-num">M{{ $index + 1 }}</span>
                                  <span class="preview-ms-name">{{ ms.title }}</span>
                                </div>
                                <div class="preview-ms-right">
                                  <span class="preview-ms-deadline">
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                                      <line x1="16" y1="2" x2="16" y2="6"/>
                                      <line x1="8" y1="2" x2="8" y2="6"/>
                                    </svg>
                                    Due: {{ ms.deadline || 'Per Schedule' }}
                                  </span>
                                  <span class="preview-ms-price">\${{ Number(ms.price_allocation).toFixed(2) }}</span>
                                </div>
                              </div>
                            }
                          </div>
                        </div>
                      }

                      <div class="preview-actions">
                        <button
                          (click)="sendUpdatedTermsToSeller()"
                          [disabled]="isSavingTerms"
                          class="btn-dispatch-terms"
                        >
                          <span>{{ isSavingTerms ? 'Sending to Seller...' : 'Send Updated Terms (v' + ((projectData.agreement.version || 1) + 1) + ') to Seller' }}</span>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <line x1="22" y1="2" x2="11" y2="13"/>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                  }
                </div>
              }

              <!-- ============================================== -->
              <!-- SELLER CONSOLE: REQUEST CHANGES OR ACCEPT     -->
              <!-- ============================================== -->
              @if (currentRole === 'seller' && projectData.project.status !== 'accepted') {
                <div class="seller-action-box">
                  <div class="seller-box-header">
                    <h4>Request Term or Schedule Changes</h4>
                    <span class="seller-hint">Sends counter-proposal to buyer</span>
                  </div>

                  <div class="input-group">
                    <label>Requested Modifications</label>
                    <textarea
                      [(ngModel)]="sellerProposalMessage"
                      rows="3"
                      placeholder="e.g., Need 5 days instead of 3 due to materials ordering, and total budget adjusted to $550..."
                      class="corporate-textarea"
                    ></textarea>
                  </div>

                  <div class="seller-action-row">
                    <button
                      (click)="sendSellerProposal()"
                      [disabled]="!sellerProposalMessage.trim() || isSending"
                      class="btn-send-seller-request"
                    >
                      <span>Send Change Request to Buyer</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                        <polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </button>
                  </div>
                </div>
              }
            </div>
          </section>
        </main>

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
      }
    </div>
  `,
  styles: [`
    .corporate-shell {
      max-width: 1360px;
      margin: 2rem auto 3.5rem auto;
      padding: 0 1.5rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #001435;
    }

    /* Topbar */
    .room-topbar {
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid #e1e7eb;
      box-shadow: 0 2px 10px rgba(0, 20, 53, 0.04);
      padding: 1.25rem 1.75rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
      gap: 1.25rem;
    }
    .topbar-left {
      display: flex;
      flex-direction: column;
      gap: 0.65rem;
    }
    .btn-back-nav {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: transparent;
      border: none;
      color: #0070ba;
      font-size: 0.85rem;
      font-weight: 700;
      cursor: pointer;
      padding: 0;
      transition: color 0.2s;
    }
    .btn-back-nav:hover {
      color: #003087;
      text-decoration: underline;
    }
    .title-cluster {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .title-meta-line {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .project-id-badge {
      font-family: monospace;
      font-weight: 700;
      background: #f1f5f9;
      color: #475569;
      font-size: 0.75rem;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
    }
    .industry-badge {
      background: #e0f2fe;
      color: #0369a1;
      font-size: 0.75rem;
      font-weight: 700;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
    }
    .deadline-pill {
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
    .status-pill {
      font-size: 0.72rem;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 0.2rem 0.65rem;
      border-radius: 9999px;
      background: #f1f5f9;
      color: #475569;
    }
    .status-pill[data-status="accepted"] {
      background: #dcfce7;
      color: #15803d;
      border: 1px solid #bbf7d0;
    }
    .status-pill[data-status="negotiating"] {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fde68a;
    }
    .status-pill[data-status="invite_sent"] {
      background: #ede9fe;
      color: #6d28d9;
      border: 1px solid #ddd6fe;
    }
    .status-pill[data-status="seller_joined"] {
      background: #e0f2fe;
      color: #0369a1;
      border: 1px solid #bae6fd;
    }
    .project-title {
      margin: 0;
      font-size: 1.45rem;
      font-weight: 800;
      color: #001435;
      letter-spacing: -0.02em;
    }
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      flex-wrap: wrap;
    }
    .btn-scope-change-nav {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 0.48rem 0.95rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 700;
      color: #001435;
      cursor: pointer;
      transition: all 0.2s ease;
      position: relative;
    }
    .btn-scope-change-nav:hover {
      background: #f0f7ff;
      border-color: #0070ba;
      color: #0070ba;
      box-shadow: 0 1px 3px rgba(0, 112, 186, 0.12);
    }
    .active-scope-badge-nav {
      background: #dbeafe;
      color: #0284c7;
      border: 1px solid #93c5fd;
      font-size: 0.68rem;
      font-weight: 700;
      padding: 0.15rem 0.45rem;
      border-radius: 9999px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .budget-stat-box {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      background: #f8fafc;
      padding: 0.45rem 0.95rem;
      border-radius: 10px;
      border: 1px solid #e2e8f0;
    }
    .stat-label {
      font-size: 0.65rem;
      font-weight: 800;
      letter-spacing: 0.05em;
      color: #64748b;
    }
    .stat-value {
      font-size: 1.15rem;
      font-weight: 800;
      color: #001435;
    }
    .currency-tag {
      font-size: 0.75rem;
      color: #0070ba;
      font-weight: 700;
    }
    .persona-badge {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      padding: 0.4rem 0.85rem;
      border-radius: 24px;
    }
    .persona-badge.is-buyer {
      border-color: #93c5fd;
      background: #eff6ff;
    }
    .persona-badge.is-seller {
      border-color: #fde68a;
      background: #fffbeb;
    }
    .persona-icon-box {
      display: flex;
      align-items: center;
      color: #0070ba;
    }
    .persona-text {
      display: flex;
      flex-direction: column;
    }
    .persona-role {
      font-size: 0.78rem;
      font-weight: 800;
      color: #001435;
    }
    .persona-email {
      font-size: 0.7rem;
      color: #64748b;
    }
    .btn-role-switch {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      color: #0070ba;
      padding: 0.25rem 0.65rem;
      border-radius: 12px;
      font-size: 0.725rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-role-switch:hover {
      background: #0070ba;
      color: #ffffff;
    }
    .btn-corporate-accept {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #107c10;
      color: #ffffff;
      border: none;
      padding: 0.75rem 1.4rem;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(16, 124, 16, 0.25);
      transition: all 0.2s;
    }
    .btn-corporate-accept:hover:not(:disabled) {
      background: #0b5a0b;
      transform: translateY(-1px);
    }
    .accepted-seal {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: #dcfce7;
      color: #15803d;
      font-size: 0.88rem;
      font-weight: 800;
      padding: 0.6rem 1.1rem;
      border-radius: 8px;
      border: 1.5px solid #86efac;
    }
    .btn-corporate-fulfillment {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: #0070ba;
      color: #ffffff;
      font-size: 0.88rem;
      font-weight: 800;
      padding: 0.6rem 1.1rem;
      border-radius: 8px;
      border: none;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-corporate-fulfillment:hover {
      background: #005ea6;
    }
    .btn-celebration-fulfillment {
      background: #16a34a;
      color: #ffffff;
      border: none;
      padding: 0.75rem 1.4rem;
      border-radius: 8px;
      font-size: 0.925rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      margin-left: auto;
      transition: background 0.2s;
    }
    .btn-celebration-fulfillment:hover {
      background: #15803d;
    }
    .fulfillment-nav-clause {
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 12px;
      padding: 1.5rem;
      margin-top: 1.5rem;
    }
    .fulfillment-nav-card {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      background: #ffffff;
      border: 1.5px solid #86efac;
      border-radius: 12px;
      padding: 1.5rem;
      margin-top: 1rem;
    }
    .nav-icon-seal {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: #dcfce7;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .nav-desc-col {
      flex: 1;
    }
    .nav-desc-col h4 {
      margin: 0 0 0.25rem 0;
      font-size: 1.05rem;
      color: #14532d;
    }
    .nav-desc-col p {
      margin: 0;
      font-size: 0.88rem;
      color: #475569;
      line-height: 1.45;
    }
    .btn-open-fulfillment-page {
      background: #16a34a;
      color: #ffffff;
      border: none;
      padding: 0.85rem 1.5rem;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.2s;
    }
    .btn-open-fulfillment-page:hover {
      background: #15803d;
    }
    .buyer-awaiting-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #eff6ff;
      color: #1d4ed8;
      font-size: 0.85rem;
      font-weight: 700;
      padding: 0.6rem 1.1rem;
      border-radius: 8px;
      border: 1.5px solid #bfdbfe;
    }
    .pulse-mini-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #2563eb;
      animation: pulse-dot 1.8s infinite;
    }
    @keyframes pulse-dot {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    /* Banners */
    .persistent-deadline-warning-banner {
      display: flex;
      align-items: center;
      gap: 1.15rem;
      background: #fffbeb;
      border: 2px solid #f59e0b;
      border-radius: 12px;
      padding: 1.1rem 1.5rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 4px 12px rgba(245, 158, 11, 0.15);
      animation: alertPulse 3s infinite ease-in-out;
    }
    @keyframes alertPulse {
      0%, 100% { border-color: #f59e0b; }
      50% { border-color: #d97706; }
    }
    .warning-banner-icon {
      flex-shrink: 0;
      width: 42px;
      height: 42px;
      border-radius: 10px;
      background: #fef3c7;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .warning-banner-text {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .warning-banner-text strong {
      color: #92400e;
      font-size: 0.98rem;
    }
    .warning-banner-sub {
      color: #b45309;
      font-size: 0.825rem;
    }
    .evidence-locked-card {
      display: flex;
      align-items: flex-start;
      gap: 1.25rem;
      background: #f8fafc;
      border: 1.5px dashed #cbd5e1;
      border-radius: 12px;
      padding: 1.5rem;
      margin-top: 1rem;
    }
    .locked-icon-shield {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .locked-content h4 {
      margin: 0 0 0.35rem 0;
      color: #1e293b;
      font-size: 1.05rem;
    }
    .locked-content p {
      margin: 0 0 0.85rem 0;
      color: #64748b;
      font-size: 0.875rem;
      line-height: 1.5;
    }
    .btn-unlock-accept-cta {
      background: #107c10;
      color: #ffffff;
      border: none;
      padding: 0.65rem 1.2rem;
      border-radius: 8px;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-unlock-accept-cta:hover {
      background: #0b5a0b;
    }

    .celebration-card {
      background: #f0fdf4;
      border: 1.5px solid #86efac;
      padding: 1.25rem 1.75rem;
      border-radius: 14px;
      margin-bottom: 1.5rem;
      display: flex;
      gap: 1.25rem;
      align-items: center;
    }
    .celebration-card h3 {
      margin: 0 0 0.35rem 0;
      color: #14532d;
      font-size: 1.15rem;
    }
    .celebration-card p {
      margin: 0;
      color: #166534;
      font-size: 0.9rem;
      line-height: 1.5;
    }
    .notification-banner {
      display: flex;
      gap: 1.25rem;
      padding: 1.1rem 1.5rem;
      border-radius: 12px;
      margin-bottom: 1.5rem;
      align-items: flex-start;
    }
    .notice-body strong {
      font-size: 0.95rem;
      display: block;
      margin-bottom: 0.25rem;
    }
    .notice-body p {
      margin: 0 0 0.4rem 0;
      font-size: 0.88rem;
    }
    .notice-cta {
      font-size: 0.825rem;
      font-weight: 600;
    }
    .seller-notice {
      background: #eff6ff;
      border: 1.5px solid #93c5fd;
      color: #1e3a8a;
    }
    .buyer-notice {
      background: #fffbeb;
      border: 1.5px solid #fde68a;
      color: #78350f;
    }
    .success-notice {
      background: #f0fdf4;
      border: 1.5px solid #86efac;
      color: #14532d;
    }

    /* Split Workspace */
    .negotiation-workspace {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 1.5rem;
      align-items: start;
    }
    @media (max-width: 1024px) {
      .negotiation-workspace {
        grid-template-columns: 1fr;
      }
    }
    .corporate-card {
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid #e1e7eb;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.04);
      padding: 2rem;
    }

    /* Left Document Card */
    .doc-kicker {
      font-size: 0.72rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      color: #0070ba;
      margin-bottom: 0.25rem;
    }
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #f1f4f8;
      padding-bottom: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .doc-header h2 {
      margin: 0;
      font-size: 1.35rem;
      color: #001435;
      font-weight: 800;
    }
    .doc-version-tag {
      background: #001435;
      color: #ffffff;
      font-size: 0.78rem;
      font-weight: 800;
      padding: 0.35rem 0.85rem;
      border-radius: 20px;
    }
    .clause-box {
      margin-bottom: 1.75rem;
    }
    .clause-heading {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      margin-bottom: 0.75rem;
    }
    .clause-num {
      font-family: monospace;
      font-weight: 800;
      color: #0070ba;
      font-size: 0.85rem;
      background: #f1f5f9;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      border: 1px solid #cbd5e1;
    }
    .clause-title {
      font-weight: 800;
      font-size: 1rem;
      color: #001435;
    }
    .clause-body {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1.25rem;
      font-size: 0.925rem;
      line-height: 1.65;
      color: #334155;
      white-space: pre-wrap;
    }
    .room-milestones-list {
      display: flex;
      flex-direction: column;
      gap: 0.85rem;
    }
    .room-milestone-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      padding: 1rem 1.15rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .room-ms-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .room-ms-title-col {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.35rem;
    }
    .room-ms-badge-row {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      flex-wrap: wrap;
    }
    .room-ms-badge {
      font-size: 0.72rem;
      font-weight: 800;
      background: #eef2f6;
      color: #0070ba;
      border: 1px solid #cbd5e1;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .room-ms-deadline-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      font-size: 0.72rem;
      font-weight: 700;
      color: #0369a1;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      padding: 0.12rem 0.5rem;
      border-radius: 4px;
    }
    .room-ms-deadline-editable {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.72rem;
      font-weight: 700;
      color: #0369a1;
      background: #f0f9ff;
      border: 1px dashed #0284c7;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .room-ms-deadline-editable:hover {
      background: #e0f2fe;
      border-style: solid;
    }
    .inline-ms-date-picker {
      border: 1px solid #94a3b8;
      border-radius: 4px;
      background: #ffffff;
      color: #0f172a;
      font-size: 0.75rem;
      font-family: inherit;
      font-weight: 600;
      padding: 0.1rem 0.35rem;
      cursor: pointer;
      outline: none;
    }
    .inline-ms-date-picker:focus {
      border-color: #0070ba;
      box-shadow: 0 0 0 2px rgba(0, 112, 186, 0.15);
    }
    .room-ms-price.zero-price {
      color: #475569;
      background: #f8fafc;
      border-color: #cbd5e1;
    }
    .zero-badge {
      font-size: 0.65rem;
      font-weight: 700;
      color: #0369a1;
      background: #e0f2fe;
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      margin-right: 0.35rem;
      text-transform: uppercase;
    }
    .preview-ms-chips {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-top: 0.35rem;
    }
    .preview-ms-chip {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 0.4rem 0.65rem;
      border-radius: 6px;
      font-size: 0.8rem;
    }
    .preview-ms-left {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      flex: 1;
    }
    .preview-ms-num {
      font-weight: 800;
      color: #0070ba;
      background: #e0f2fe;
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
      font-size: 0.7rem;
    }
    .preview-ms-name {
      font-weight: 600;
      color: #1e293b;
    }
    .preview-ms-right {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .preview-ms-deadline {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      color: #0369a1;
      font-weight: 700;
      font-size: 0.75rem;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      padding: 0.12rem 0.45rem;
      border-radius: 4px;
    }
    .preview-ms-price {
      font-weight: 700;
      color: #0070ba;
      font-size: 0.85rem;
    }
    .room-ms-title {
      font-size: 0.95rem;
      font-weight: 800;
      color: #001435;
    }
    .room-ms-price {
      font-size: 0.9rem;
      font-weight: 800;
      color: #0070ba;
      background: #eef6fc;
      border: 1px solid #c8e1f5;
      padding: 0.15rem 0.55rem;
      border-radius: 6px;
    }
    .room-ms-desc {
      margin: 0;
      font-size: 0.85rem;
      color: #475569;
      line-height: 1.5;
    }
    .room-ms-proof {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 3px solid #16a34a;
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
      font-size: 0.82rem;
    }
    .room-proof-header {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-weight: 700;
      color: #15803d;
      margin-bottom: 0.2rem;
    }
    .room-proof-body {
      color: #166534;
      line-height: 1.4;
    }
    .evidence-clause .clause-num {
      color: #d97706;
      border-color: #fde68a;
      background: #fffbeb;
    }
    .evidence-subtext {
      font-size: 0.825rem;
      color: #64748b;
      margin-bottom: 0.65rem;
      font-style: italic;
    }
    .evidence-content {
      border-left: 4px solid #d97706;
      background: #fffbeb;
      color: #78350f;
    }

    /* Milestone AI Verification Certificate */
    .ms-ai-certificate {
      background: #f0fdf4;
      border: 1.5px solid #86efac;
      border-radius: 8px;
      padding: 0.85rem;
      margin-top: 0.45rem;
    }
    .ms-ai-certificate.has-fraud-warning {
      border-color: #cbd5e1;
      background: #f8fafc;
    }
    .corp-audit-notice-panel {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 3.5px solid #0070ba;
      border-radius: 8px;
      padding: 0.75rem 1rem;
      margin-bottom: 0.75rem;
    }
    .audit-notice-title {
      display: flex;
      align-items: center;
      gap: 0.45rem;
      color: #001435;
      font-size: 0.82rem;
      font-weight: 700;
      margin-bottom: 0.25rem;
    }
    .audit-notice-desc {
      font-size: 0.76rem;
      color: #475569;
      line-height: 1.45;
      margin: 0.2rem 0 0.45rem 0;
    }
    .flags-chips-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .audit-flag-tag {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #ffffff;
      color: #334155;
      border: 1px solid #cbd5e1;
      font-size: 0.68rem;
      font-weight: 600;
      padding: 0.15rem 0.45rem;
      border-radius: 6px;
    }
    .badge-baseline-locked {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #f1f5f9;
      color: #0070ba;
      border: 1px solid #cbd5e1;
      font-size: 0.68rem;
      font-weight: 800;
      padding: 0.2rem 0.55rem;
      border-radius: 9999px;
      letter-spacing: 0.04em;
    }
    .cert-angles-strip {
      display: flex;
      gap: 0.65rem;
      overflow-x: auto;
      padding: 0.5rem 0;
      margin-bottom: 0.5rem;
    }
    .cert-angle-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
      flex-shrink: 0;
    }
    .cert-angle-card .cert-thumb {
      width: 90px;
      height: 65px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
    }
    .angle-label {
      font-size: 0.68rem;
      font-weight: 800;
      color: #001435;
    }
    .evidence-fraud-flag-pill {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fde68a;
      font-size: 0.68rem;
      font-weight: 700;
      padding: 0.2rem 0.45rem;
      border-radius: 6px;
      margin-top: 0.35rem;
      line-height: 1.35;
    }
    .item-gps-loc {
      font-size: 0.68rem;
      color: #0284c7;
      font-family: monospace;
      margin-top: 0.2rem;
    }
    .seller-flag-recapture-link {
      margin-top: 0.65rem;
    }
    .btn-recapture-cta {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      background: #0070ba;
      color: #ffffff;
      padding: 0.45rem 0.95rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      text-decoration: none;
      transition: background 0.2s;
    }
    .btn-recapture-cta:hover {
      background: #005ea6;
    }
    .cert-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.6rem;
    }
    .cert-title-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      color: #15803d;
      font-size: 0.85rem;
    }
    .cert-confidence-pill {
      font-size: 0.72rem;
      font-weight: 800;
      background: #dcfce7;
      color: #166534;
      padding: 0.15rem 0.5rem;
      border-radius: 12px;
      border: 1px solid #86efac;
    }
    .cert-confidence-pill.is-fraud {
      background: #001435;
      color: #ffffff;
      border-color: #002c6c;
    }
    .cert-head.is-flagged .cert-title-row {
      color: #b91c1c;
    }
    .cert-body {
      display: flex;
      gap: 0.85rem;
      align-items: flex-start;
    }
    .cert-thumb {
      width: 80px;
      height: 60px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid #bbf7d0;
    }
    .cert-notes {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .cert-hash {
      font-family: monospace;
      font-size: 0.72rem;
      color: #0369a1;
      background: #ffffff;
      padding: 0.15rem 0.35rem;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
      align-self: flex-start;
    }
    .cert-analysis {
      font-size: 0.78rem;
      color: #1e293b;
      line-height: 1.45;
      white-space: pre-line;
    }
    .ms-pending-evidence-box {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 0.65rem 0.85rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.45rem;
    }
    .badge-pending-evidence {
      font-size: 0.68rem;
      font-weight: 800;
      background: #fef3c7;
      color: #b45309;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      margin-right: 0.5rem;
    }
    .pending-warn-text {
      font-size: 0.78rem;
      color: #78350f;
    }
    .btn-goto-capture {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.35rem 0.75rem;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
      cursor: pointer;
    }

    /* Baseline Pre-Work Clause */
    .baseline-clause .clause-num {
      color: #7c3aed;
      border-color: #ddd6fe;
      background: #f5f3ff;
    }
    .baseline-record-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.85rem;
    }
    .baseline-card-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .badge-baseline-locked {
      font-size: 0.72rem;
      font-weight: 800;
      background: #ede9fe;
      color: #6d28d9;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }
    .baseline-timestamp {
      font-size: 0.72rem;
      color: #64748b;
    }
    .baseline-card-body {
      display: flex;
      gap: 0.85rem;
      align-items: center;
    }
    .baseline-preview-img {
      width: 90px;
      height: 65px;
      object-fit: cover;
      border-radius: 6px;
      border: 1px solid #cbd5e1;
    }
    .baseline-card-meta strong {
      display: block;
      font-size: 0.825rem;
      color: #001435;
      margin-bottom: 0.2rem;
    }
    .baseline-hash {
      font-family: monospace;
      font-size: 0.7rem;
      color: #6d28d9;
      background: #f5f3ff;
      padding: 0.1rem 0.35rem;
      border-radius: 4px;
    }
    .baseline-desc {
      margin: 0.25rem 0 0 0;
      font-size: 0.75rem;
      color: #64748b;
    }
    .baseline-exempt-card {
      background: #f8fafc;
      border: 1.5px dashed #0284c7;
      border-radius: 8px;
      padding: 0.85rem;
      display: flex;
      gap: 0.65rem;
      align-items: center;
    }
    .baseline-exempt-card strong {
      font-size: 0.85rem;
      color: #0284c7;
      display: block;
    }
    .baseline-exempt-card p {
      margin: 0.15rem 0 0 0;
      font-size: 0.78rem;
      color: #475569;
    }
    .baseline-pending-card {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 0.85rem;
      font-size: 0.82rem;
      color: #92400e;
    }
    .badge-mandatory {
      background: #dc2626;
      color: #ffffff;
      font-size: 0.68rem;
      font-weight: 800;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }

    /* Milestone Selector Tabs */
    .ms-selector-tabs {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 0.65rem;
      margin-bottom: 1rem;
    }
    .btn-select-ms {
      background: #ffffff;
      border: 1.5px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.65rem 0.85rem;
      cursor: pointer;
      text-align: left;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .btn-select-ms:hover {
      border-color: #0070ba;
      background: #f0f9ff;
    }
    .btn-select-ms.active-ms-tab {
      border-color: #0070ba;
      background: #f0f9ff;
      box-shadow: 0 0 0 2px rgba(0, 112, 186, 0.2);
    }
    .ms-tab-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 0.75rem;
      font-weight: 800;
    }
    .tab-ms-num {
      color: #0070ba;
    }
    .tab-ms-price {
      color: #001435;
    }
    .tab-ms-name {
      font-size: 0.78rem;
      font-weight: 700;
      color: #1e293b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tab-ms-status {
      margin-top: 0.15rem;
    }
    .pill-verified {
      font-size: 0.65rem;
      font-weight: 800;
      color: #15803d;
      background: #dcfce7;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
    }
    .pill-needed {
      font-size: 0.65rem;
      font-weight: 800;
      color: #b45309;
      background: #fef3c7;
      padding: 0.1rem 0.4rem;
      border-radius: 4px;
    }
    .target-ms-card {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 0.85rem 1rem;
      margin-bottom: 1rem;
    }
    .target-ms-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 0.5rem;
    }
    .target-badge {
      font-size: 0.68rem;
      font-weight: 800;
      color: #0070ba;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .target-title-col h4 {
      margin: 0.15rem 0 0 0;
      color: #001435;
      font-size: 0.95rem;
    }
    .target-price-tag {
      font-weight: 800;
      color: #0070ba;
      font-size: 0.95rem;
      background: #e0f2fe;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
    }
    .target-ms-req strong {
      display: block;
      font-size: 0.75rem;
      color: #15803d;
      margin-bottom: 0.15rem;
    }
    .target-ms-req p {
      margin: 0;
      font-size: 0.825rem;
      color: #334155;
      line-height: 1.4;
    }
    .target-baseline-indicator {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.75rem;
      color: #6d28d9;
      margin-top: 0.5rem;
      font-weight: 600;
    }
    .indicator-dot {
      width: 6px;
      height: 6px;
      background: #7c3aed;
      border-radius: 50%;
    }
    .item-ai-score {
      font-weight: 800;
      color: #15803d;
      font-size: 0.7rem;
    }

    /* Clause 3: Cryptographic Evidence Desk */
    .evidence-desk-clause .clause-num {
      color: #0284c7;
      border-color: #bae6fd;
      background: #f0f9ff;
    }
    .live-cam-embed {
      margin-bottom: 1rem;
    }
    .secured-evidence-gallery {
      margin-top: 1.25rem;
      padding-top: 1rem;
      border-top: 1px solid #e2e8f0;
    }
    .gallery-title {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.825rem;
      font-weight: 800;
      color: #15803d;
      margin-bottom: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .evidence-cards-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 0.85rem;
    }
    .evidence-item-card {
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }
    .item-badge-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.4rem 0.6rem;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      font-size: 0.68rem;
      font-weight: 800;
    }
    .item-method-pill {
      background: #f1f5f9;
      color: #475569;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      text-transform: uppercase;
    }
    .item-method-pill.is-cam {
      background: #dbeafe;
      color: #1e40af;
    }
    .item-status-pill {
      background: #fef3c7;
      color: #92400e;
      padding: 0.15rem 0.4rem;
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.65rem;
    }
    .evidence-thumbnail {
      width: 100%;
      height: 120px;
      object-fit: cover;
      background: #0f172a;
    }
    .item-details {
      padding: 0.6rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.72rem;
    }
    .item-filename {
      font-weight: 700;
      color: #001435;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-hash {
      font-family: monospace;
      color: #0284c7;
      background: #f0f9ff;
      padding: 0.15rem 0.35rem;
      border-radius: 4px;
      border: 1px solid #bae6fd;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item-timestamp {
      color: #64748b;
      font-size: 0.68rem;
    }
    .doc-footer-seal {
      margin-top: 1.5rem;
      padding-top: 1.25rem;
      border-top: 1px dashed #cbd5e1;
      display: flex;
      align-items: center;
      gap: 0.85rem;
    }
    .seal-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.725rem;
      font-weight: 800;
      background: #0070ba;
      color: white;
      padding: 0.3rem 0.65rem;
      border-radius: 6px;
      white-space: nowrap;
    }
    .seal-text {
      font-size: 0.78rem;
      color: #64748b;
      line-height: 1.4;
    }

    /* Right Negotiation Card */
    .card-title-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #f1f4f8;
      padding-bottom: 1rem;
      margin-bottom: 1.25rem;
    }
    .card-kicker {
      font-size: 0.7rem;
      font-weight: 800;
      color: #64748b;
      letter-spacing: 0.08em;
    }
    .card-title-row h3 {
      margin: 0.15rem 0 0 0;
      font-size: 1.25rem;
      color: #001435;
    }
    .active-role-tag {
      font-size: 0.75rem;
      font-weight: 700;
      background: #f1f5f9;
      color: #334155;
      padding: 0.25rem 0.65rem;
      border-radius: 12px;
    }

    /* Activity Feed */
    .activity-feed {
      display: flex;
      flex-direction: column;
      gap: 1rem;
      margin-bottom: 1.5rem;
      max-height: 280px;
      overflow-y: auto;
    }
    .activity-card {
      border-radius: 12px;
      padding: 1rem 1.25rem;
      border: 1px solid #e2e8f0;
    }
    .seller-activity {
      background: #fffbeb;
      border-color: #fde68a;
    }
    .buyer-activity {
      background: #eff6ff;
      border-color: #bfdbfe;
    }
    .activity-header {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      margin-bottom: 0.45rem;
    }
    .activity-avatar {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .seller-avatar {
      background: #fef3c7;
      color: #b45309;
    }
    .buyer-avatar {
      background: #dbeafe;
      color: #1d4ed8;
    }
    .activity-meta {
      display: flex;
      flex-direction: column;
    }
    .activity-author {
      font-size: 0.825rem;
      font-weight: 800;
      color: #001435;
    }
    .activity-sub {
      font-size: 0.725rem;
      color: #64748b;
    }
    .activity-message {
      font-size: 0.9rem;
      line-height: 1.5;
      color: #1e293b;
      font-style: italic;
    }
    .empty-activity {
      text-align: center;
      padding: 1.75rem;
      background: #f8fafc;
      border-radius: 12px;
      border: 1px dashed #cbd5e1;
      color: #64748b;
      font-size: 0.88rem;
    }
    .empty-icon {
      margin-bottom: 0.5rem;
    }

    /* Buyer AI Desk */
    .buyer-ai-desk {
      background: #f8fafc;
      border: 1.5px solid #0070ba;
      border-radius: 14px;
      padding: 1.5rem;
    }
    .desk-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.35rem;
    }
    .desk-title {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }
    .desk-header h4 {
      margin: 0;
      font-size: 1.05rem;
      color: #003087;
      font-weight: 800;
    }
    .desk-hint {
      font-size: 0.75rem;
      font-weight: 800;
      color: #0070ba;
      background: #e0f2fe;
      padding: 0.2rem 0.5rem;
      border-radius: 6px;
    }
    .desk-desc {
      margin: 0 0 1rem 0;
      font-size: 0.85rem;
      color: #545d68;
      line-height: 1.45;
    }
    .input-group {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-bottom: 1rem;
    }
    .input-group label {
      font-size: 0.825rem;
      font-weight: 700;
      color: #001435;
    }
    .corporate-textarea {
      width: 100%;
      box-sizing: border-box;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      border: 1.5px solid #cbd5e1;
      font-size: 0.9rem;
      line-height: 1.5;
      outline: none;
      transition: border-color 0.2s;
    }
    .corporate-textarea:focus {
      border-color: #0070ba;
      box-shadow: 0 0 0 3px rgba(0, 112, 186, 0.12);
    }
    .btn-pp-ai-draft {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.75rem 1.35rem;
      border-radius: 10px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      width: 100%;
      box-shadow: 0 2px 8px rgba(0, 112, 186, 0.25);
      transition: all 0.2s;
    }
    .btn-pp-ai-draft:hover:not(:disabled) {
      background: #003087;
    }
    .btn-pp-ai-draft:disabled {
      background: #94a3b8;
      cursor: not-allowed;
    }

    /* AI Preview Card */
    .ai-preview-card {
      margin-top: 1.25rem;
      background: #ffffff;
      border: 1.5px solid #10b981;
      border-radius: 12px;
      padding: 1.25rem;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.12);
    }
    .preview-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    .preview-badge {
      font-size: 0.8rem;
      font-weight: 800;
      color: #065f46;
      background: #d1fae5;
      padding: 0.25rem 0.65rem;
      border-radius: 6px;
    }
    .changes-count {
      font-size: 0.75rem;
      color: #64748b;
      font-weight: 600;
    }
    .summary-pill {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      padding: 0.65rem 0.85rem;
      border-radius: 8px;
      font-size: 0.825rem;
      color: #14532d;
      margin-bottom: 0.85rem;
      line-height: 1.4;
    }
    .preview-clause {
      margin-bottom: 0.85rem;
    }
    .preview-label {
      font-size: 0.75rem;
      font-weight: 800;
      color: #475569;
      text-transform: uppercase;
      margin-bottom: 0.25rem;
    }
    .preview-text {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 0.65rem 0.85rem;
      border-radius: 6px;
      font-size: 0.825rem;
      max-height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
      color: #334155;
    }
    .btn-dispatch-terms {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      width: 100%;
      background: #107c10;
      color: #ffffff;
      border: none;
      padding: 0.8rem 1.25rem;
      border-radius: 10px;
      font-size: 0.95rem;
      font-weight: 800;
      cursor: pointer;
      box-shadow: 0 3px 10px rgba(16, 124, 16, 0.25);
      transition: all 0.2s;
    }
    .btn-dispatch-terms:hover:not(:disabled) {
      background: #0b5a0b;
    }

    /* Seller Action Box */
    .seller-action-box {
      background: #f8fafc;
      border: 1.5px solid #cbd5e1;
      border-radius: 14px;
      padding: 1.5rem;
    }
    .seller-box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
    }
    .seller-box-header h4 {
      margin: 0;
      font-size: 1.05rem;
      color: #001435;
    }
    .seller-hint {
      font-size: 0.75rem;
      color: #64748b;
    }
    .seller-action-row {
      display: flex;
      gap: 0.85rem;
      margin-top: 1rem;
      flex-wrap: wrap;
    }
    .btn-send-seller-request {
      flex: 1;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      background: #0070ba;
      color: white;
      border: none;
      padding: 0.75rem 1rem;
      border-radius: 10px;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }
    .btn-accept-seller-cta {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      background: #107c10;
      color: white;
      border: none;
      padding: 0.75rem 1.2rem;
      border-radius: 10px;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
    }

    /* Loading state */
    .loading-state {
      text-align: center;
      padding: 5rem 2rem;
      color: #64748b;
    }
    .corporate-spinner {
      width: 44px;
      height: 44px;
      border: 4px solid #e2e8f0;
      border-top-color: #0070ba;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin: 0 auto 1.25rem auto;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Comprehensive Responsive Media Queries */
    @media (max-width: 1024px) {
      .corporate-shell {
        margin: 1.5rem auto 3rem auto;
        padding: 0 1.25rem;
      }
      .negotiation-workspace {
        grid-template-columns: 1fr;
        gap: 1.5rem;
      }
    }

    @media (max-width: 900px) {
      .room-topbar {
        flex-direction: column;
        align-items: stretch;
        padding: 1.15rem 1.25rem;
        gap: 1rem;
      }
      .topbar-left {
        width: 100%;
      }
      .topbar-right {
        width: 100%;
        justify-content: flex-start;
        gap: 0.75rem;
      }
      .title-meta-line {
        gap: 0.4rem;
      }
    }

    @media (max-width: 640px) {
      .corporate-shell {
        margin: 1rem auto 2rem auto;
        padding: 0 0.75rem;
      }
      .project-title {
        font-size: 1.25rem;
      }
      .topbar-right {
        flex-direction: column;
        align-items: stretch;
      }
      .budget-stat-box {
        width: 100%;
        box-sizing: border-box;
        align-items: flex-start;
      }
      .persona-badge {
        width: 100%;
        box-sizing: border-box;
        justify-content: space-between;
      }
      .btn-scope-change-nav, .btn-accept-terms-nav, .btn-waiting-status {
        width: 100%;
        box-sizing: border-box;
        justify-content: center;
      }
      .corporate-card {
        padding: 1.25rem 0.95rem;
        border-radius: 12px;
      }
      .doc-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.65rem;
      }
      .room-ms-top {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.45rem;
      }
      .room-ms-price {
        align-self: flex-start;
      }
      .preview-actions {
        flex-direction: column;
      }
      .btn-dispatch-terms {
        width: 100%;
        justify-content: center;
      }
      .banner-actions {
        flex-direction: column;
        width: 100%;
      }
      .btn-accept-banner {
        width: 100%;
        text-align: center;
      }
      .btn-accept-seller-cta {
        width: 100%;
        text-align: center;
      }
    }
  `]
})
export class NegotiationRoomComponent implements OnInit {
  projectId = 0;
  isLoading = true;
  isSending = false;
  isAccepting = false;
  isRegenerating = false;
  isSavingTerms = false;
  termsUpdateSuccessBanner = false;

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
    private http: HttpClient
  ) {}

  Number = Number; // Template helper

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

  fetchProject() {
    this.http.get<any>(`${API_BASE_URL}/api/projects/${this.projectId}`)
      .subscribe({
        next: (data) => {
          this.projectData = data;
          this.isLoading = false;
          this.loadProjectEvidence();
          this.fetchProjectAlerts();
          this.fetchActiveScopeChange();
        },
        error: (err) => {
          this.isLoading = false;
          alert('Could not load project details: ' + (err.error?.detail || err.message));
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

  sendUpdatedTermsToSeller() {
    if (!this.regeneratedPreview || this.isSavingTerms) return;
    this.isSavingTerms = true;

    const payload = {
      contract_terms: this.regeneratedPreview.contract_terms,
      evidence_requirements: this.regeneratedPreview.evidence_requirements,
      buyer_message: this.buyerRevisionNote.trim(),
      milestones: this.regeneratedPreview.milestones || this.projectData.agreement.milestones
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
          this.projectData.agreement.version = res.version;
          this.projectData.project.status = res.status;
          this.sellerProposalMessage = '';
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
          this.fetchProjectAlerts();
          this.goToFulfillment();
        },
        error: (err) => {
          this.isAccepting = false;
          alert('Failed to accept agreement: ' + (err.error?.detail || err.message));
        }
      });
  }

  goToFulfillment() {
    this.router.navigate(['/project', this.projectId, 'fulfillment'], { queryParams: { role: this.currentRole } });
  }

  activeAlert: any = null;

  isProjectActive(): boolean {
    if (!this.projectData?.project?.status) return false;
    const s = this.projectData.project.status.toLowerCase();
    return s === 'active' || s === 'accepted' || s === 'work_in_progress' || s === 'completed';
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
    if (!this.projectData?.agreement?.milestones?.[index] || !newDeadline) return;
    this.projectData.agreement.milestones[index].deadline = newDeadline;
    const effective = this.getEffectiveProjectDeadline();
    if (this.projectData?.project) {
      this.projectData.project.deadline = effective;
    }
  }

  getMilestoneFallbackDeadline(index: number): string {
    const existingDeadline = this.projectData?.agreement?.milestones?.[index]?.deadline;
    if (existingDeadline && existingDeadline !== 'Per Schedule' && existingDeadline !== 'None') {
      return existingDeadline;
    }
    if (this.projectData?.project?.deadline) {
      try {
        const target = new Date(this.projectData.project.deadline);
        const now = new Date();
        const diffMs = target.getTime() - now.getTime();
        const totalDays = Math.max(3, Math.round(diffMs / (1000 * 60 * 60 * 24)));
        const count = Math.max(1, this.projectData?.agreement?.milestones?.length || 3);
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

  getEvidenceUrl(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }
    return `${API_BASE_URL}${filePath.startsWith('/') ? '' : '/'}${filePath}`;
  }
}
