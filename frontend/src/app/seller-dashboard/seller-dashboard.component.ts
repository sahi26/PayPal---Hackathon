import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AgGridAngular } from 'ag-grid-angular';
import { ColDef, ModuleRegistry, AllCommunityModule, GridReadyEvent, GridApi } from 'ag-grid-community';
import { API_BASE_URL } from '../api.config';
import { LiveCameraComponent } from '../live-camera/live-camera.component';

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
  version: number;
  has_agreement: boolean;
  is_accepted: boolean;
}

@Component({
  selector: 'app-seller-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, AgGridAngular, LiveCameraComponent],
  template: `
    <div class="seller-shell">
      <!-- Persistent Milestone Deadline Approaching Warning Banner (Phase 4) -->
      @if (activeAlerts && activeAlerts.length > 0) {
        @for (alertItem of activeAlerts; track alertItem.project_id) {
          <div class="seller-deadline-alert-banner">
            <div class="alert-banner-icon">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b45309" stroke-width="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
            </div>
            <div class="alert-banner-text">
              <strong>{{ alertItem.message }}</strong>
              <div class="alert-banner-sub">
                Project: <strong>{{ alertItem.project_title }}</strong> &bull; Milestone: <strong>{{ alertItem.milestone_title }}</strong> &bull; Target Due: {{ alertItem.formatted_deadline || alertItem.deadline }}
              </div>
            </div>
            <button (click)="openProject(alertItem.project_id)" class="btn-alert-fulfill">
              Open Negotiation Room & Submit Proof →
            </button>
          </div>
        }
      }

      <!-- Seller Profile Header -->
      <section class="profile-header-card">
        <div class="header-main-row">
          <div class="profile-meta-group">
            <div class="contractor-avatar">
              <span>S</span>
            </div>
            <div>
              <div class="name-badge-row">
                <h1 class="portal-heading">Seller & Contractor Portal</h1>
                <span class="verified-pill">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span>Verified Contractor</span>
                </span>
              </div>
              <div class="portal-subtext">contractor&#64;prooflens.com &bull; PayPal Escrow Payouts Ready</div>
            </div>
          </div>

          <div class="header-action-group">
            <button (click)="loadProjects()" class="btn-refresh-offers">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
              <span>Refresh Offers</span>
            </button>
          </div>
        </div>

        <!-- Metric KPI Cards -->
        <div class="kpi-metric-grid">
          <div class="kpi-metric-card">
            <span class="kpi-metric-label">TOTAL EARNINGS IN ESCROW</span>
            <div class="kpi-metric-value value-green">\${{ totalEarnings.toFixed(2) }}</div>
            <span class="kpi-metric-hint">Funds guaranteed upon verification</span>
          </div>

          <div class="kpi-metric-card">
            <span class="kpi-metric-label">OFFERS RECEIVED</span>
            <div class="kpi-metric-value">{{ projects.length }}</div>
            <span class="kpi-metric-hint">Total incoming buyer contracts</span>
          </div>

          <div class="kpi-metric-card">
            <span class="kpi-metric-label">ACTIVE NEGOTIATIONS</span>
            <div class="kpi-metric-value value-amber">{{ negotiatingCount }}</div>
            <span class="kpi-metric-hint">Terms currently under discussion</span>
          </div>

          <div class="kpi-metric-card">
            <span class="kpi-metric-label">FINALIZED AGREEMENTS</span>
            <div class="kpi-metric-value">{{ acceptedCount }}</div>
            <span class="kpi-metric-hint">Ready for work & evidence submission</span>
          </div>
        </div>
      </section>

      <!-- Phase 4: Sequential Milestone Orchestration & Active Milestone Screen -->
      @if (activeProject && activeMilestones && activeMilestones.length > 0) {
        <section class="active-project-card">
          <div class="active-card-head">
            <div class="active-badge-tag">ACTIVE ESCROW PROJECT FULFILLMENT</div>
            <div class="active-head-row">
              <div>
                <h3>{{ activeProject.title }}</h3>
                <p class="active-card-sub">Sequential Milestone Execution Desk &bull; Total Escrow Value: \${{ Number(activeProject.total_price).toFixed(2) }} USD</p>
              </div>
              <div style="display:flex; gap:0.5rem; align-items:center;">
                <button (click)="openProject(activeProject.id)" class="btn-open-full-room" style="background:#f8fafc; color:#0070ba; border:1px solid #cbd5e1;">
                  View Terms
                </button>
                <button (click)="openFulfillment(activeProject.id)" class="btn-open-full-room">
                  Open Dedicated Fulfillment Page →
                </button>
              </div>
            </div>
          </div>

          <!-- Sequential Milestone Track -->
          <div class="sequential-progress-track">
            @for (ms of activeMilestones; track $index) {
              <div
                class="progress-step-node"
                [class.is-approved]="isMilestoneApproved(ms)"
                [class.is-active]="$index === activeMilestoneIndex"
                [class.is-locked]="$index > activeMilestoneIndex"
              >
                <div class="step-circle">
                  @if (isMilestoneApproved(ms)) {
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                  } @else if ($index > activeMilestoneIndex) {
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  } @else {
                    {{ $index + 1 }}
                  }
                </div>
                <div class="step-meta">
                  <span class="step-title">Milestone {{ $index + 1 }}</span>
                  <span class="step-name">{{ ms.title }}</span>
                  <span class="step-status-tag">
                    @if (isMilestoneApproved(ms)) {
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                      <span>Approved</span>
                    } @else if (isMilestoneResubmission(ms)) {
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                      <span>Resubmission</span>
                    } @else if ($index === activeMilestoneIndex && isMilestoneInReview(ms)) {
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                      <span>Awaiting Review</span>
                    } @else if ($index === activeMilestoneIndex) {
                      <span class="active-dot"></span>
                      <span>Active Screen</span>
                    } @else {
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      <span>Locked</span>
                    }
                  </span>
                </div>
              </div>
            }
          </div>

          <!-- Active Milestone Focus Card: Only displays UI & capture tools for the current active milestone -->
          @if (activeMilestones[activeMilestoneIndex]; as currMs) {
            <div class="active-milestone-stage-box">
              <div class="stage-header">
                <div class="stage-title-col">
                  <span class="stage-num-badge">ACTIVE SCREEN: MILESTONE {{ activeMilestoneIndex + 1 }} OF {{ activeMilestones.length }}</span>
                  <h4>{{ currMs.title }}</h4>
                  <p class="stage-desc">{{ currMs.description }}</p>
                </div>
                <div class="stage-price-badge">
                  \${{ Number(currMs.price_allocation).toFixed(2) }} USD
                </div>
              </div>

              <div class="stage-req-box">
                <div class="req-title">Mandatory Visual Evidence Requirement (Escrow Unlock):</div>
                <p class="req-text">{{ currMs.proof_required }}</p>
                <div class="req-deadline">
                  Target Due Date: <strong>{{ currMs.deadline }}</strong>
                  @if (currMs.relative_deadline) {
                    <span class="rel-tag">({{ currMs.relative_deadline }})</span>
                  }
                </div>
              </div>

              <!-- Unlock Trigger & Review States -->
              @if (isMilestoneApproved(currMs)) {
                <div class="approved-notice-card">
                  <div class="approved-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div class="approved-text">
                    <strong>Milestone {{ activeMilestoneIndex + 1 }} Approved by Buyer</strong>
                    <p>Escrow funds have been authorized for release. If another milestone exists, the dashboard automatically transitions to the next active screen.</p>
                  </div>
                </div>
              } @else if (isMilestoneResubmission(currMs)) {
                <div class="resubmission-requested-card">
                  <div class="resubmission-head">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                    <strong>Buyer Requested Evidence Resubmission: Milestone {{ activeMilestoneIndex + 1 }}</strong>
                  </div>
                  <div class="resubmission-reason-box">
                    <strong>Buyer Feedback & Instructions:</strong>
                    <p>"{{ currMs.rejection_reason || 'Buyer requested updated evidence resubmission.' }}"</p>
                  </div>
                  <p class="resubmission-instruction">
                    Please review the buyer's feedback above and capture a new live physical frame using the camera below.
                  </p>
                </div>
                <div class="active-cam-desk">
                  <h5>Resubmit Live Proof for Milestone {{ activeMilestoneIndex + 1 }}</h5>
                  <app-live-camera
                    [projectId]="activeProject.id"
                    evidenceType="milestone_evidence"
                    [milestoneIndex]="activeMilestoneIndex"
                    [label]="'Resubmit Live Proof for Milestone ' + (activeMilestoneIndex + 1)"
                    (evidenceUploaded)="onMilestoneEvidenceSubmitted($event)"
                  ></app-live-camera>
                </div>
              } @else if (isMilestoneInReview(currMs)) {
                <div class="awaiting-review-card">
                  <div class="awaiting-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0070ba" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  <div class="awaiting-text">
                    <strong>Evidence Submitted — Awaiting Buyer Review</strong>
                    <p>Cryptographic evidence has been recorded in the escrow ledger. Once the buyer hits the approve endpoint, this dashboard will automatically transition to display Milestone {{ activeMilestoneIndex + 2 }}.</p>
                  </div>
                  <button (click)="refreshActiveProject()" class="btn-check-approval">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                    <span>Check Buyer Approval Status</span>
                  </button>
                </div>
              } @else {
                <div class="active-cam-desk">
                  <h5>Capture Live Proof for Milestone {{ activeMilestoneIndex + 1 }}</h5>
                  <app-live-camera
                    [projectId]="activeProject.id"
                    evidenceType="milestone_evidence"
                    [milestoneIndex]="activeMilestoneIndex"
                    [label]="'Capture Live Proof for Milestone ' + (activeMilestoneIndex + 1)"
                    (evidenceUploaded)="onMilestoneEvidenceSubmitted($event)"
                  ></app-live-camera>
                </div>
              }
            </div>
          }

          <!-- Progression Lock: Milestone 2 & Milestone 3 shown as locked/greyed out without capture functionality -->
          @if (activeMilestones.length > activeMilestoneIndex + 1) {
            <div class="locked-milestones-tray">
              <div class="tray-title">Upcoming Sequential Milestones (Locked)</div>
              @for (ms of activeMilestones; track $index) {
                @if ($index > activeMilestoneIndex) {
                  <div class="locked-ms-item">
                    <div class="locked-padlock">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                    <div class="locked-ms-info">
                      <strong>Milestone {{ $index + 1 }}: {{ ms.title }} (\${{ Number(ms.price_allocation).toFixed(2) }} USD)</strong>
                      <p>{{ ms.description }}</p>
                      <span class="locked-badge">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <span>Locked — Requires Buyer Approval of Milestone {{ $index }} to unlock capture functionality</span>
                      </span>
                    </div>
                  </div>
                }
              }
            </div>
          }
        </section>
      }

      <!-- Contracts Table Card -->
      <section class="contracts-table-card">
        <div class="table-card-toolbar">
          <div class="toolbar-info">
            <h2>Incoming Client Contracts</h2>
            <p>Review specifications, request timeline adjustments, and accept escrow terms.</p>
          </div>

          <div class="toolbar-controls">
            <div class="search-box">
              <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="text"
                [(ngModel)]="searchQuery"
                (ngModelChange)="onSearchChange()"
                placeholder="Search incoming projects..."
                class="search-input-field"
              />
            </div>
          </div>
        </div>

        <!-- Filter Tabs -->
        <div class="filter-tab-bar">
          <button
            (click)="setFilterTab('all')"
            [class.active-tab]="activeFilterTab === 'all'"
            class="filter-tab-pill"
          >
            All Contracts ({{ projects.length }})
          </button>
          <button
            (click)="setFilterTab('negotiating')"
            [class.active-tab]="activeFilterTab === 'negotiating'"
            class="filter-tab-pill"
          >
            In Negotiation ({{ negotiatingCount }})
          </button>
          <button
            (click)="setFilterTab('accepted')"
            [class.active-tab]="activeFilterTab === 'accepted'"
            class="filter-tab-pill"
          >
            Accepted & Funded ({{ acceptedCount }})
          </button>
        </div>

        <!-- AG Grid Component with autoHeight to eliminate whitespace -->
        <div class="ag-grid-shell">
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
    </div>
  `,
  styles: [`
    .seller-shell {
      max-width: 1240px;
      margin: 2rem auto;
      padding: 0 1.5rem;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #001435;
    }

    /* Profile Header Card */
    .profile-header-card {
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid #e1e7eb;
      box-shadow: 0 2px 10px rgba(0, 20, 53, 0.04);
      padding: 1.75rem 2rem;
      margin-bottom: 1.5rem;
    }
    .header-main-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1.25rem;
      border-bottom: 1px solid #f1f4f8;
      padding-bottom: 1.5rem;
    }
    .profile-meta-group {
      display: flex;
      align-items: center;
      gap: 1.25rem;
    }
    .contractor-avatar {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      background: #059669;
      color: #ffffff;
      font-weight: 800;
      font-size: 1.4rem;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(5, 150, 105, 0.25);
    }
    .name-badge-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .portal-heading {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 800;
      color: #001435;
      letter-spacing: -0.01em;
    }
    .verified-pill {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      background: #e8f5e9;
      color: #1b5e20;
      font-size: 0.725rem;
      font-weight: 700;
      padding: 0.25rem 0.65rem;
      border-radius: 9999px;
      border: 1px solid #c8e6c9;
    }
    .portal-subtext {
      font-size: 0.85rem;
      color: #545d68;
      margin-top: 0.25rem;
    }
    .btn-refresh-offers {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: #ffffff;
      color: #0070ba;
      border: 1.5px solid #0070ba;
      padding: 0.6rem 1.25rem;
      border-radius: 20px;
      font-weight: 700;
      font-size: 0.875rem;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-refresh-offers:hover {
      background: #f0f7fd;
    }

    /* KPI Grid */
    .kpi-metric-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 1.25rem;
      padding-top: 1.5rem;
    }
    @media (max-width: 900px) {
      .kpi-metric-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    .kpi-metric-card {
      background: #f8fafc;
      border: 1px solid #eef2f6;
      border-radius: 12px;
      padding: 1.15rem 1.35rem;
    }
    .kpi-metric-label {
      font-size: 0.68rem;
      font-weight: 800;
      color: #64748b;
      letter-spacing: 0.05em;
      display: block;
      margin-bottom: 0.4rem;
    }
    .kpi-metric-value {
      font-size: 1.65rem;
      font-weight: 800;
      color: #001435;
      line-height: 1.1;
    }
    .value-green { color: #108a00; }
    .value-amber { color: #d97706; }
    .kpi-metric-hint {
      font-size: 0.725rem;
      color: #8c97a5;
      margin-top: 0.35rem;
      display: block;
    }

    /* Active Milestone Desk (Phase 4) */
    .active-project-card {
      background: #ffffff;
      border-radius: 14px;
      border: 1.5px solid #0070ba;
      box-shadow: 0 4px 16px rgba(0, 112, 186, 0.08);
      padding: 1.75rem 2rem;
      margin-bottom: 1.5rem;
    }
    .active-badge-tag {
      display: inline-block;
      font-size: 0.68rem;
      font-weight: 800;
      color: #0070ba;
      background: #eef6fc;
      padding: 0.2rem 0.65rem;
      border-radius: 9999px;
      letter-spacing: 0.05em;
      margin-bottom: 0.5rem;
    }
    .active-head-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
      border-bottom: 1px solid #f1f4f8;
      padding-bottom: 1rem;
      margin-bottom: 1.25rem;
    }
    .active-head-row h3 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 800;
      color: #001435;
    }
    .active-card-sub {
      margin: 0.25rem 0 0 0;
      font-size: 0.85rem;
      color: #64748b;
    }
    .btn-open-full-room {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      color: #0070ba;
      font-weight: 700;
      font-size: 0.85rem;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-open-full-room:hover {
      background: #0070ba;
      color: #ffffff;
    }

    /* Sequential Track */
    .sequential-progress-track {
      display: flex;
      align-items: center;
      gap: 1.25rem;
      margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .progress-step-node {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      background: #f8fafc;
      border: 1.5px solid #e2e8f0;
      border-radius: 10px;
      padding: 0.65rem 1rem;
      flex: 1;
      min-width: 170px;
      transition: all 0.2s;
    }
    .progress-step-node.is-active {
      background: #eff6ff;
      border-color: #0070ba;
      box-shadow: 0 2px 8px rgba(0, 112, 186, 0.15);
    }
    .progress-step-node.is-approved {
      background: #f0fdf4;
      border-color: #86efac;
    }
    .progress-step-node.is-locked {
      opacity: 0.6;
      background: #f8fafc;
      border-color: #cbd5e1;
    }
    .step-circle {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #cbd5e1;
      color: #ffffff;
      font-weight: 800;
      font-size: 0.8rem;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .is-active .step-circle {
      background: #0070ba;
    }
    .is-approved .step-circle {
      background: #16a34a;
    }
    .is-locked .step-circle {
      background: #94a3b8;
    }
    .step-meta {
      display: flex;
      flex-direction: column;
    }
    .step-title {
      font-size: 0.68rem;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
    }
    .step-name {
      font-size: 0.85rem;
      font-weight: 700;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 150px;
    }
    .step-status-tag {
      font-size: 0.72rem;
      font-weight: 700;
      color: #0070ba;
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin-top: 0.2rem;
    }
    .active-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #0070ba;
    }

    /* Active Milestone Stage Box */
    .active-milestone-stage-box {
      background: #ffffff;
      border: 1.5px solid #bae6fd;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.25rem;
    }
    .stage-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .stage-num-badge {
      font-size: 0.7rem;
      font-weight: 800;
      color: #0369a1;
      background: #e0f2fe;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
      letter-spacing: 0.04em;
    }
    .stage-title-col h4 {
      margin: 0.35rem 0 0.2rem 0;
      font-size: 1.15rem;
      font-weight: 800;
      color: #0f172a;
    }
    .stage-desc {
      margin: 0;
      font-size: 0.875rem;
      color: #475569;
      line-height: 1.45;
    }
    .stage-price-badge {
      font-size: 1.1rem;
      font-weight: 800;
      color: #0070ba;
      background: #eef6fc;
      padding: 0.4rem 0.85rem;
      border-radius: 8px;
      border: 1px solid #c8e1f5;
      white-space: nowrap;
    }
    .stage-req-box {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 4px solid #16a34a;
      border-radius: 8px;
      padding: 0.85rem 1rem;
      margin-bottom: 1.25rem;
    }
    .req-title {
      font-size: 0.75rem;
      font-weight: 800;
      color: #15803d;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .req-text {
      margin: 0.35rem 0;
      font-size: 0.875rem;
      color: #166534;
      font-weight: 600;
      line-height: 1.45;
    }
    .req-deadline {
      font-size: 0.8rem;
      color: #047857;
      margin-top: 0.35rem;
    }
    .rel-tag {
      font-size: 0.75rem;
      color: #065f46;
      margin-left: 0.35rem;
    }

    /* Awaiting Review & Approved States */
    .resubmission-requested-card {
      background: #ffffff;
      border: 1.5px solid #cbd5e1;
      border-left: 4.5px solid #0070ba;
      border-radius: 10px;
      padding: 1.15rem 1.35rem;
      margin-bottom: 1.25rem;
    }
    .resubmission-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: #001435;
      font-size: 0.95rem;
      font-weight: 700;
    }
    .resubmission-reason-box {
      margin-top: 0.65rem;
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 0.65rem 0.85rem;
    }
    .resubmission-reason-box strong {
      font-size: 0.72rem;
      color: #0070ba;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .resubmission-reason-box p {
      margin: 0.2rem 0 0 0;
      font-size: 0.88rem;
      color: #334155;
      font-style: italic;
      font-weight: 600;
    }
    .resubmission-instruction {
      margin: 0.65rem 0 0 0;
      font-size: 0.825rem;
      color: #475569;
      line-height: 1.4;
    }
    .awaiting-review-card {
      display: flex;
      align-items: center;
      gap: 1rem;
      background: #f0f7ff;
      border: 1.5px solid #bae0fd;
      border-radius: 10px;
      padding: 1.15rem 1.35rem;
    }
    .awaiting-icon {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: #e0f2fe;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .awaiting-text {
      flex: 1;
    }
    .awaiting-text strong {
      display: block;
      color: #001435;
      font-size: 0.95rem;
    }
    .awaiting-text p {
      margin: 0.25rem 0 0 0;
      font-size: 0.825rem;
      color: #334155;
      line-height: 1.4;
    }
    .btn-check-approval {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.6rem 1rem;
      border-radius: 8px;
      font-size: 0.8rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.2s;
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
    }
    .btn-check-approval:hover {
      background: #005ea6;
    }
    .approved-notice-card {
      display: flex;
      align-items: center;
      gap: 0.85rem;
      background: #f0fdf4;
      border: 1.5px solid #86efac;
      border-radius: 10px;
      padding: 1rem 1.25rem;
    }
    .approved-icon {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #dcfce7;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .approved-text strong {
      color: #166534;
      display: block;
    }
    .approved-text p {
      margin: 0.2rem 0 0 0;
      font-size: 0.825rem;
      color: #14532d;
    }
    .active-cam-desk h5 {
      margin: 0 0 0.75rem 0;
      font-size: 0.95rem;
      color: #0f172a;
      font-weight: 700;
    }

    /* Locked Tray */
    .locked-milestones-tray {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1rem 1.25rem;
    }
    .tray-title {
      font-size: 0.75rem;
      font-weight: 800;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.75rem;
    }
    .locked-ms-item {
      display: flex;
      align-items: flex-start;
      gap: 0.85rem;
      background: #ffffff;
      border: 1px dashed #cbd5e1;
      border-radius: 8px;
      padding: 0.85rem 1rem;
      margin-bottom: 0.65rem;
      opacity: 0.75;
    }
    .locked-padlock {
      margin-top: 0.15rem;
    }
    .locked-ms-info strong {
      font-size: 0.875rem;
      color: #475569;
    }
    .locked-ms-info p {
      margin: 0.2rem 0;
      font-size: 0.8rem;
      color: #64748b;
    }
    .locked-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.7rem;
      font-weight: 600;
      color: #475569;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      padding: 0.2rem 0.55rem;
      border-radius: 6px;
    }
      color: #b45309;
      background: #fef3c7;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }

    /* Contracts Table Card */
    .contracts-table-card {
      background: #ffffff;
      border-radius: 14px;
      border: 1px solid #e1e7eb;
      box-shadow: 0 2px 10px rgba(0, 20, 53, 0.04);
      padding: 1.75rem 2rem;
    }
    .table-card-toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.25rem;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .toolbar-info h2 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 800;
      color: #001435;
    }
    .toolbar-info p {
      margin: 0.25rem 0 0 0;
      font-size: 0.85rem;
      color: #545d68;
    }
    .search-box {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-icon {
      position: absolute;
      left: 12px;
      color: #94a3b8;
      pointer-events: none;
    }
    .search-input-field {
      padding: 0.55rem 1rem 0.55rem 2.25rem;
      border-radius: 20px;
      border: 1px solid #cbd5e1;
      font-size: 0.85rem;
      outline: none;
      width: 250px;
      transition: border-color 0.2s;
    }
    .search-input-field:focus {
      border-color: #0070ba;
      box-shadow: 0 0 0 3px rgba(0, 112, 186, 0.12);
    }

    /* Filter Tabs */
    .filter-tab-bar {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1.25rem;
      border-bottom: 1px solid #f1f4f8;
      padding-bottom: 0.75rem;
    }
    .filter-tab-pill {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      padding: 0.4rem 0.95rem;
      border-radius: 20px;
      font-size: 0.8rem;
      font-weight: 700;
      color: #475569;
      cursor: pointer;
      transition: all 0.2s;
    }
    .filter-tab-pill:hover {
      background: #e2e8f0;
      color: #001435;
    }
    .filter-tab-pill.active-tab {
      background: #0070ba;
      color: #ffffff;
      border-color: #0070ba;
      box-shadow: 0 2px 6px rgba(0, 112, 186, 0.25);
    }
    .ag-grid-shell {
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e1e7eb;
    }

    .seller-deadline-alert-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1.25rem;
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
    .alert-banner-icon {
      flex-shrink: 0;
      width: 42px;
      height: 42px;
      border-radius: 10px;
      background: #fef3c7;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .alert-banner-text {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .alert-banner-text strong {
      color: #92400e;
      font-size: 0.98rem;
    }
    .alert-banner-sub {
      color: #b45309;
      font-size: 0.825rem;
    }
    .btn-alert-fulfill {
      background: #107c10;
      color: #ffffff;
      border: none;
      padding: 0.65rem 1.15rem;
      border-radius: 8px;
      font-size: 0.88rem;
      font-weight: 700;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .btn-alert-fulfill:hover {
      background: #0b5a0b;
    }
  `]
})
export class SellerDashboardComponent implements OnInit {
  Number = Number;
  projects: ProjectRow[] = [];
  filteredProjects: ProjectRow[] = [];
  searchQuery = '';
  activeFilterTab: 'all' | 'negotiating' | 'accepted' = 'all';
  private gridApi!: GridApi;

  totalEarnings = 0;
  negotiatingCount = 0;
  acceptedCount = 0;
  activeAlerts: any[] = [];

  // Active Milestone Execution Desk (Phase 4)
  activeProject: any = null;
  activeMilestones: any[] = [];
  activeMilestoneIndex = 0;

  columnDefs: ColDef[] = [
    {
      field: 'id',
      headerName: 'Escrow ID',
      width: 110,
      cellRenderer: (params: any) => `
        <div style="display:flex; align-items:center; height:100%;">
          <span style="font-family:monospace; font-weight:800; background:#f1f5f9; color:#334155; padding:3px 7px; border-radius:6px; border:1px solid #cbd5e1; font-size:11px;">#PL-${params.value}</span>
        </div>`
    },
    {
      field: 'title',
      headerName: 'Project Scope',
      flex: 2,
      minWidth: 200,
      cellRenderer: (params: any) => `
        <div style="display:flex; flex-direction:column; justify-content:center; height:100%; line-height:1.25;">
          <span style="font-weight:700; color:#001435; font-size:13px;">${params.data.title || 'Untitled Project'}</span>
          <span style="font-size:11px; color:#0070ba; font-weight:600;">${params.data.industry_type || 'General'}</span>
        </div>`
    },
    {
      field: 'buyer_email',
      headerName: 'Client (Buyer)',
      flex: 1.5,
      minWidth: 170,
      cellRenderer: (params: any) => `
        <div style="display:flex; align-items:center; height:100%; font-size:12px; color:#334155; font-weight:600;">
          ${params.value || 'buyer@prooflens.com'}
        </div>`
    },
    {
      field: 'total_price',
      headerName: 'Payout Value',
      width: 145,
      cellRenderer: (params: any) => `
        <div style="display:flex; align-items:center; height:100%;">
          <span style="font-weight:800; color:#001435; font-size:13px;">\$${Number(params.value || 0).toFixed(2)}</span>
          <span style="font-size:10px; font-weight:700; color:#64748b; margin-left:4px;">USD</span>
        </div>`
    },
    {
      field: 'status',
      headerName: 'Contract Status',
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
          bg = '#ede9fe'; color = '#6d28d9'; border = '#ddd6fe'; label = 'OPEN INVITE';
        }

        return `
          <div style="display:flex; align-items:center; height:100%;">
            <span style="background:${bg}; color:${color}; border:1px solid ${border}; font-size:11px; font-weight:800; padding:3px 9px; border-radius:9999px; letter-spacing:0.03em;">${label}</span>
          </div>
        `;
      }
    },
    {
      field: 'created_at',
      headerName: 'Date',
      width: 125,
      cellRenderer: (params: any) => `<div style="display:flex; align-items:center; height:100%; font-size:12px; color:#64748b;">${params.value || 'Nov 01, 2026'}</div>`
    },
    {
      headerName: 'Actions',
      width: 190,
      cellRenderer: (params: any) => {
        const id = params.data.id;
        const isAccepted = (params.data.status || '').toLowerCase() === 'accepted';
        return `
          <div style="display:flex; align-items:center; gap:6px; height:100%;">
            <button onclick="window.dispatchEvent(new CustomEvent('sellerOpenRoom', {detail: ${id}}))"
                    style="background:#f1f5f9; color:#0070ba; border:1px solid #cbd5e1; padding:5px 9px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:4px;">
              <span>Terms</span>
            </button>
            ${isAccepted ? `
            <button onclick="window.dispatchEvent(new CustomEvent('sellerOpenFulfillment', {detail: ${id}}))"
                    style="background:#16a34a; color:white; border:none; padding:5px 10px; border-radius:6px; font-size:11px; font-weight:700; cursor:pointer; display:flex; align-items:center; gap:4px;">
              <span>Fulfill</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
            </button>` : ''}
          </div>
        `;
      }
    }
  ];

  defaultColDef: ColDef = { resizable: true, sortable: true };

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit() {
    this.loadProjects();

    window.addEventListener('sellerOpenRoom', (event: any) => {
      this.router.navigate(['/project', event.detail, 'negotiate'], { queryParams: { role: 'seller' } });
    });
    window.addEventListener('sellerOpenFulfillment', (event: any) => {
      this.openFulfillment(event.detail);
    });
  }

  openFulfillment(projectId: number) {
    this.router.navigate(['/project', projectId, 'fulfillment'], { queryParams: { role: 'seller' } });
  }

  loadProjects() {
    this.http.get<ProjectRow[]>(`${API_BASE_URL}/api/projects`)
      .subscribe({
        next: (data) => {
          this.projects = data || [];
          this.calculateKpis();
          this.applyFilters();
          this.loadActiveAlerts();

          const accepted = this.projects.find(p => (p.status || '').toLowerCase() === 'accepted');
          if (accepted && (!this.activeProject || this.activeProject.id !== accepted.id)) {
            this.activeProject = accepted;
            this.loadActiveMilestones(accepted.id);
          }
        },
        error: () => {
          this.projects = [];
          this.filteredProjects = [];
        }
      });
  }

  loadActiveMilestones(projectId: number) {
    this.http.get<any>(`${API_BASE_URL}/api/projects/${projectId}/milestones`)
      .subscribe({
        next: (res) => {
          this.activeMilestones = res.milestones || [];
          this.activeMilestoneIndex = res.active_milestone_index !== undefined ? res.active_milestone_index : 0;
        },
        error: (err) => console.warn('Could not load milestones:', err)
      });
  }

  isMilestoneApproved(ms: any): boolean {
    return (ms?.status || '').toLowerCase() === 'approved';
  }

  isMilestoneResubmission(ms: any): boolean {
    const st = (ms?.status || '').toLowerCase();
    return st === 'resubmission_requested' || st === 'rejected';
  }

  isMilestoneInReview(ms: any): boolean {
    return (ms?.status || '').toLowerCase() === 'awaiting_buyer_review';
  }

  onMilestoneEvidenceSubmitted(event: any) {
    if (this.activeMilestones[this.activeMilestoneIndex]) {
      this.activeMilestones[this.activeMilestoneIndex].status = 'awaiting_buyer_review';
    }
  }

  refreshActiveProject() {
    if (this.activeProject?.id) {
      this.loadActiveMilestones(this.activeProject.id);
    }
  }

  loadActiveAlerts() {
    this.http.get<any>(`${API_BASE_URL}/api/contractor/active-alerts`)
      .subscribe({
        next: (res) => {
          this.activeAlerts = res.alerts || [];
        },
        error: (err) => console.warn('Could not load contractor alerts:', err)
      });
  }

  openProject(projectId: number) {
    this.router.navigate(['/project', projectId, 'negotiate'], { queryParams: { role: 'seller' } });
  }

  calculateKpis() {
    this.totalEarnings = this.projects.reduce((acc, p) => acc + (Number(p.total_price) || 0), 0);
    this.negotiatingCount = this.projects.filter(p => (p.status || '').toLowerCase() === 'negotiating' || (p.status || '').toLowerCase() === 'seller_joined').length;
    this.acceptedCount = this.projects.filter(p => (p.status || '').toLowerCase() === 'accepted').length;
  }

  setFilterTab(tab: 'all' | 'negotiating' | 'accepted') {
    this.activeFilterTab = tab;
    this.applyFilters();
  }

  applyFilters() {
    let list = [...this.projects];

    if (this.activeFilterTab === 'negotiating') {
      list = list.filter(p => (p.status || '').toLowerCase() === 'negotiating' || (p.status || '').toLowerCase() === 'seller_joined');
    } else if (this.activeFilterTab === 'accepted') {
      list = list.filter(p => (p.status || '').toLowerCase() === 'accepted');
    }

    const q = this.searchQuery.toLowerCase().trim();
    if (q) {
      list = list.filter(p =>
        (p.title && p.title.toLowerCase().includes(q)) ||
        (p.buyer_email && p.buyer_email.toLowerCase().includes(q)) ||
        (p.status && p.status.toLowerCase().includes(q))
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
}
