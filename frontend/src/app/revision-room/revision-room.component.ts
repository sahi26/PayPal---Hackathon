import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../api.config';

export interface ScopeMilestone {
  title: string;
  description: string;
  price_allocation: number;
  relative_deadline?: string;
  deadline?: string;
  proof_required: string;
  is_addendum?: boolean;
  status?: string;
}

export interface ScopeChangeItem {
  id: number;
  project_id: number;
  requested_by_id?: number;
  description: string;
  proposed_extra_cost: number;
  proposed_extra_days: number;
  status: 'DRAFT' | 'NEGOTIATING' | 'PENDING_FUNDS' | 'ACCEPTED' | 'REJECTED';
  addendum_contract?: string;
  proposed_milestones?: ScopeMilestone[];
  chat_history?: Array<{
    sender: string;
    sender_name?: string;
    message: string;
    proposed_extra_cost?: number;
    proposed_extra_days?: number;
    timestamp?: string;
  }>;
  paypal_order_id?: string;
  paypal_approval_url?: string;
  created_at?: string;
  updated_at?: string;
}

@Component({
  selector: 'app-revision-room',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="revision-modal-backdrop" (click)="onBackdropClick($event)">
      <div class="revision-modal-container" (click)="$event.stopPropagation()">
        <!-- Header -->
        <div class="revision-modal-header">
          <div class="header-titles">
            <div class="modal-badge-row">
              <span class="room-tag">Scope Changes & Revisions</span>
              @if (activeScopeChange) {
                <span class="status-pill" [attr.data-status]="activeScopeChange.status">
                  {{ formatStatus(activeScopeChange.status) }}
                </span>
              }
            </div>
            <h2 class="room-title">
              {{ projectTitle || 'Project Scope Revisions' }}
            </h2>
          </div>
          <button (click)="close()" class="btn-close-modal" aria-label="Close Revision Room">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="revision-modal-body">
          @if (isLoading) {
            <div class="loading-panel">
              <div class="spinner"></div>
              <span>Processing scope change data...</span>
            </div>
          } @else {
            <!-- If no active scope change: Request Form -->
            @if (!activeScopeChange) {
              <div class="init-request-card">
                <div class="init-intro">
                  <div class="icon-wrap-blue">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </div>
                  <div class="intro-text">
                    <h3>Request Scope Revision & Supplementary Milestones</h3>
                    <p>
                      Either party can propose additions or modifications to the active agreement.
                      Our Legal AI (gemini-4-argon) will automatically draft a legally binding Agreement Addendum
                      and establish supplementary milestone checkpoints.
                    </p>
                  </div>
                </div>

                <div class="init-params-row">
                  <div class="init-param-col">
                    <label for="initDaysInput">Timeline Extension (Days)</label>
                    <div class="input-with-prefix">
                      <span class="prefix">+</span>
                      <input
                        id="initDaysInput"
                        type="number"
                        [(ngModel)]="initExtraDays"
                        min="0"
                        step="1"
                        class="form-control-sm"
                        placeholder="0"
                      />
                      <span class="suffix">Days</span>
                    </div>
                  </div>
                  <div class="init-param-col">
                    <label for="initCostInput">Additional Escrow ($ USD)</label>
                    <div class="input-with-prefix">
                      <span class="prefix">$</span>
                      <input
                        id="initCostInput"
                        type="number"
                        [(ngModel)]="initExtraCost"
                        min="0"
                        step="5"
                        class="form-control-sm"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                </div>

                <div class="form-group">
                  <label for="descInput">Reason / Scope Description for Extension</label>
                  <textarea
                    id="descInput"
                    [(ngModel)]="newDescription"
                    rows="4"
                    class="form-control"
                    placeholder="E.g., Supply chain delay in timber delivery; need 7 additional days for proper wood drying and precision joinery..."
                  ></textarea>
                </div>

                <div class="form-actions-right">
                  <button
                    (click)="submitInit()"
                    [disabled]="!newDescription.trim() || isSubmitting"
                    class="btn-primary-action"
                  >
                    @if (isSubmitting) {
                      <span class="mini-spinner"></span>
                      <span>Drafting Addendum with gemini-4-argon...</span>
                    } @else {
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                      </svg>
                      <span>Draft Agreement Addendum</span>
                    }
                  </button>
                </div>
              </div>
            } @else {
              <!-- Active Scope Change View -->
              <div class="active-scope-layout">
                <!-- Top Summary Cards -->
                <div class="metrics-grid">
                  <div class="metric-card">
                    <span class="metric-label">PROPOSED EXTRA ESCROW</span>
                    <span class="metric-val">+\${{ Number(activeScopeChange.proposed_extra_cost).toFixed(2) }} USD</span>
                  </div>
                  <div class="metric-card">
                    <span class="metric-label">PROPOSED TIMELINE EXTENSION</span>
                    <span class="metric-val">+{{ activeScopeChange.proposed_extra_days }} Calendar Days</span>
                  </div>
                  <div class="metric-card">
                    <span class="metric-label">AGREEMENT REVISION STATE</span>
                    <span class="metric-val-status">{{ formatStatus(activeScopeChange.status) }}</span>
                  </div>
                </div>

                <!-- Scope Change Description -->
                <div class="scope-desc-box">
                  <div class="desc-header">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <circle cx="12" cy="12" r="10"/>
                      <line x1="12" y1="16" x2="12" y2="12"/>
                      <line x1="12" y1="8" x2="12.01" y2="8"/>
                    </svg>
                    <span>Requested Scope Change</span>
                  </div>
                  <p class="desc-text">{{ activeScopeChange.description }}</p>
                </div>

                <!-- Agreement Addendum Details (Collapsible) -->
                @if (activeScopeChange.addendum_contract) {
                  <div class="addendum-card">
                    <div class="addendum-header" (click)="toggleAddendumView()">
                      <div class="header-left">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                          <polyline points="14 2 14 8 20 8"/>
                          <line x1="16" y1="13" x2="8" y2="13"/>
                          <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                        <span>AI-Drafted Agreement Addendum (gemini-4-argon)</span>
                      </div>
                      <span class="toggle-link">{{ showAddendumText ? 'Hide Contract Terms' : 'View Contract Terms' }}</span>
                    </div>

                    @if (showAddendumText) {
                      <div class="addendum-body">
                        <pre class="legal-text">{{ activeScopeChange.addendum_contract }}</pre>
                      </div>
                    }

                    <!-- Supplementary Milestones Preview -->
                    @if (activeScopeChange.proposed_milestones && activeScopeChange.proposed_milestones.length > 0) {
                      <div class="proposed-ms-section">
                        <div class="proposed-ms-title">Supplementary Addendum Milestones to Append:</div>
                        <div class="proposed-ms-list">
                          @for (pms of activeScopeChange.proposed_milestones; track $index) {
                            <div class="pms-item">
                              <div class="pms-top">
                                <div class="pms-tag-row">
                                  <span class="badge-addendum-pill">Addendum Milestone</span>
                                  <span class="pms-name">{{ pms.title }}</span>
                                </div>
                                <span class="pms-cost">\${{ Number(pms.price_allocation).toFixed(2) }} USD</span>
                              </div>
                              <p class="pms-desc">{{ pms.description }}</p>
                              <div class="pms-proof-req">
                                <strong>Proof Required:</strong> {{ pms.proof_required }}
                              </div>
                            </div>
                          }
                        </div>
                      </div>
                    }
                  </div>
                }

                <!-- Pending Funds Escrow Gateway -->
                @if (activeScopeChange.status === 'PENDING_FUNDS') {
                  <div class="escrow-auth-banner">
                    <div class="auth-icon-wrap">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="4" width="20" height="16" rx="2"/>
                        <line x1="6" y1="12" x2="18" y2="12"/>
                        <line x1="10" y1="8" x2="14" y2="8"/>
                      </svg>
                    </div>
                    <div class="auth-content">
                      <h4>PayPal Supplemental Escrow Deposit Required</h4>
                      <p>
                        The scope change has been agreed. To protect both parties, the additional amount of
                        <strong>\${{ Number(activeScopeChange.proposed_extra_cost).toFixed(2) }} USD</strong>
                        must be authorized in PayPal Escrow before work begins.
                      </p>
                      <div class="auth-btn-row">
                        @if (activeScopeChange.paypal_approval_url) {
                          <a
                            [href]="activeScopeChange.paypal_approval_url"
                            target="_blank"
                            class="btn-paypal-escrow"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944 3.72a.641.641 0 0 1 .632-.544h7.521c3.155 0 5.487 1.096 5.807 4.168.32 3.072-1.745 5.568-4.664 6.27-.408.098-.795.158-1.168.188l-1.072 6.804a.641.641 0 0 1-.632.544l-3.292.187z"/>
                            </svg>
                            <span>Authorize Extra Funds via PayPal</span>
                          </a>
                        }
                        <button
                          (click)="authorizeFunds()"
                          [disabled]="isAuthorizing"
                          class="btn-confirm-funds"
                        >
                          @if (isAuthorizing) {
                            <span class="mini-spinner"></span>
                            <span>Verifying PayPal Authorization...</span>
                          } @else {
                            <span>I Have Authorized PayPal Deposit</span>
                          }
                        </button>
                      </div>
                    </div>
                  </div>
                }

                <!-- Revision Room Chat & Counter-Offer Deck -->
                <div class="negotiation-chat-card">
                  <div class="chat-card-header">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span>Revision Negotiation History & Counter-Offers</span>
                  </div>

                  <div class="chat-thread">
                    @for (chat of (activeScopeChange.chat_history || []); track $index) {
                      <div class="chat-entry" [class.is-seller]="chat.sender === 'seller'" [class.is-buyer]="chat.sender === 'buyer'" [class.is-system]="chat.sender === 'system'">
                        <div class="chat-meta">
                          <span class="chat-author">{{ chat.sender_name || (chat.sender | uppercase) }}</span>
                          @if (chat.timestamp) {
                            <span class="chat-time">{{ formatTime(chat.timestamp) }}</span>
                          }
                        </div>
                        <div class="chat-msg">{{ chat.message }}</div>
                        @if (chat.proposed_extra_cost !== undefined || chat.proposed_extra_days !== undefined) {
                          <div class="chat-terms-tag">
                            <span>Terms: +\${{ Number(chat.proposed_extra_cost || 0).toFixed(2) }} USD</span>
                            <span>•</span>
                            <span>+{{ chat.proposed_extra_days || 0 }} Days</span>
                          </div>
                        }
                      </div>
                    }
                  </div>

                  <!-- Counter-Offer Form (Available when NEGOTIATING) -->
                  @if (activeScopeChange.status === 'NEGOTIATING') {
                    <div class="counter-offer-deck">
                      <div class="deck-title">Propose Counter-Offer: Adjust Delta Cost and Schedule Extension</div>
                      <div class="counter-inputs-row">
                        <div class="input-col">
                          <label for="costInput">Additional Cost ($ USD)</label>
                          <div class="input-with-prefix">
                            <span class="prefix">$</span>
                            <input
                              id="costInput"
                              type="number"
                              [(ngModel)]="counterCost"
                              min="0"
                              step="5"
                              class="form-control-sm"
                            />
                          </div>
                        </div>

                        <div class="input-col">
                          <label for="daysInput">Additional Time (Days)</label>
                          <div class="input-with-prefix">
                            <span class="prefix">+</span>
                            <input
                              id="daysInput"
                              type="number"
                              [(ngModel)]="counterDays"
                              min="0"
                              step="1"
                              class="form-control-sm"
                            />
                            <span class="suffix">Days</span>
                          </div>
                        </div>

                        <div class="input-col note-col">
                          <label for="msgInput">Counter-Offer Note</label>
                          <input
                            id="msgInput"
                            type="text"
                            [(ngModel)]="counterMessage"
                            placeholder="Reason for adjustment / deliverable specs..."
                            class="form-control-sm"
                          />
                        </div>

                        <div class="input-col btn-col">
                          <label>&nbsp;</label>
                          <button
                            (click)="submitCounterOffer()"
                            [disabled]="isSubmittingCounter"
                            class="btn-send-counter"
                          >
                            @if (isSubmittingCounter) {
                              <span class="mini-spinner"></span>
                            } @else {
                              <span>Send Counter-Offer</span>
                            }
                          </button>
                        </div>
                      </div>
                    </div>
                  }
                </div>

                <!-- Acceptance Actions Bar -->
                @if (activeScopeChange.status === 'NEGOTIATING') {
                  <div class="acceptance-actions-bar">
                    <div class="action-info">
                      <strong>Accepting this Scope Revision</strong> will supersede the current Agreement, increment the project to Version N+1,
                      append the supplementary milestone(s), and automatically shift all uncompleted milestone deadlines by +{{ activeScopeChange.proposed_extra_days }} days.
                    </div>
                    <button
                      (click)="acceptScopeChange()"
                      [disabled]="isAccepting"
                      class="btn-accept-scope"
                    >
                      @if (isAccepting) {
                        <span class="mini-spinner"></span>
                        <span>Updating Agreement Version...</span>
                      } @else {
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                        <span>Accept Scope Revision & Append Milestones</span>
                      }
                    </button>
                  </div>
                }

                @if (activeScopeChange.status === 'ACCEPTED') {
                  <div class="accepted-success-banner">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <span>Agreement Version Updated. Supplementary milestones are active on the project fulfillment timeline.</span>
                  </div>
                }
              </div>
            }
          }
        </div>
      </div>
    </div>
  `,
  styles: [`
    .revision-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 20, 53, 0.6);
      backdrop-filter: blur(4px);
      z-index: 1050;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1.5rem;
    }

    .revision-modal-container {
      background: #ffffff;
      width: 100%;
      max-width: 900px;
      max-height: 90vh;
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0, 20, 53, 0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #cbd5e1;
    }

    .revision-modal-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 1.25rem 1.75rem;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
    }

    .modal-badge-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.25rem;
    }

    .room-tag {
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #0070ba;
    }

    .status-pill {
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.15rem 0.55rem;
      border-radius: 9999px;
      text-transform: uppercase;
      background: #f1f5f9;
      color: #475569;
    }

    .status-pill[data-status="NEGOTIATING"] {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
    }

    .status-pill[data-status="PENDING_FUNDS"] {
      background: #e0e7ff;
      color: #3730a3;
      border: 1px solid #c7d2fe;
    }

    .status-pill[data-status="ACCEPTED"] {
      background: #d1fae5;
      color: #065f46;
      border: 1px solid #a7f3d0;
    }

    .room-title {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 700;
      color: #001435;
    }

    .btn-close-modal {
      background: transparent;
      border: none;
      color: #64748b;
      cursor: pointer;
      padding: 0.4rem;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, color 0.15s;
    }

    .btn-close-modal:hover {
      background: #e2e8f0;
      color: #0f172a;
    }

    .revision-modal-body {
      padding: 1.5rem 1.75rem;
      overflow-y: auto;
      flex: 1;
    }

    .loading-panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      padding: 3rem;
      color: #475569;
      font-size: 0.95rem;
    }

    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #e2e8f0;
      border-top-color: #0070ba;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    .mini-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255, 255, 255, 0.4);
      border-top-color: #ffffff;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      display: inline-block;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Init Card */
    .init-request-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 1.75rem;
    }

    .init-intro {
      display: flex;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }

    .icon-wrap-blue {
      width: 44px;
      height: 44px;
      border-radius: 10px;
      background: #eff6ff;
      color: #0070ba;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .intro-text h3 {
      margin: 0 0 0.35rem 0;
      font-size: 1.1rem;
      font-weight: 700;
      color: #001435;
    }

    .intro-text p {
      margin: 0;
      font-size: 0.88rem;
      color: #64748b;
      line-height: 1.45;
    }

    .init-params-row {
      display: flex;
      gap: 1.25rem;
      margin-bottom: 1.25rem;
    }

    .init-param-col {
      flex: 1;
    }

    .init-param-col label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: #334155;
      margin-bottom: 0.4rem;
    }

    .form-group label {
      display: block;
      font-size: 0.85rem;
      font-weight: 600;
      color: #334155;
      margin-bottom: 0.5rem;
    }

    .form-control {
      width: 100%;
      box-sizing: border-box;
      padding: 0.75rem 1rem;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      font-size: 0.92rem;
      font-family: inherit;
      color: #1e293b;
      resize: vertical;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .form-control:focus {
      border-color: #0070ba;
      box-shadow: 0 0 0 3px rgba(0, 112, 186, 0.15);
    }

    .form-actions-right {
      display: flex;
      justify-content: flex-end;
      margin-top: 1.25rem;
    }

    .btn-primary-action {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.65rem 1.25rem;
      border-radius: 7px;
      font-size: 0.9rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.15s;
    }

    .btn-primary-action:hover:not(:disabled) {
      background: #005a9c;
    }

    .btn-primary-action:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    /* Active Scope Layout */
    .active-scope-layout {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }

    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
    }

    .metric-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .metric-label {
      font-size: 0.72rem;
      font-weight: 700;
      color: #64748b;
      letter-spacing: 0.04em;
    }

    .metric-val {
      font-size: 1.25rem;
      font-weight: 700;
      color: #001435;
    }

    .metric-val-status {
      font-size: 0.95rem;
      font-weight: 700;
      color: #0070ba;
    }

    .scope-desc-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #0070ba;
      border-radius: 6px;
      padding: 0.85rem 1.15rem;
    }

    .desc-header {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.78rem;
      font-weight: 700;
      color: #0070ba;
      text-transform: uppercase;
      margin-bottom: 0.35rem;
    }

    .desc-text {
      margin: 0;
      font-size: 0.9rem;
      color: #1e293b;
      line-height: 1.45;
    }

    /* Addendum Card */
    .addendum-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }

    .addendum-header {
      padding: 0.85rem 1.15rem;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      cursor: pointer;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.88rem;
      font-weight: 600;
      color: #001435;
    }

    .toggle-link {
      font-size: 0.82rem;
      font-weight: 600;
      color: #0070ba;
    }

    .addendum-body {
      padding: 1rem 1.15rem;
      background: #fafafa;
      border-bottom: 1px solid #e2e8f0;
    }

    .legal-text {
      margin: 0;
      font-size: 0.82rem;
      font-family: Menlo, Monaco, Consolas, monospace;
      color: #334155;
      white-space: pre-wrap;
      line-height: 1.5;
    }

    .proposed-ms-section {
      padding: 1rem 1.15rem;
    }

    .proposed-ms-title {
      font-size: 0.82rem;
      font-weight: 700;
      color: #475569;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-bottom: 0.75rem;
    }

    .proposed-ms-list {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .pms-item {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-left: 3px solid #6366f1;
      border-radius: 6px;
      padding: 0.85rem 1rem;
    }

    .pms-top {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.35rem;
    }

    .pms-tag-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .badge-addendum-pill {
      background: #ede9fe;
      color: #5b21b6;
      font-size: 0.72rem;
      font-weight: 700;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .pms-name {
      font-size: 0.92rem;
      font-weight: 700;
      color: #001435;
    }

    .pms-cost {
      font-size: 0.95rem;
      font-weight: 700;
      color: #0070ba;
    }

    .pms-desc {
      margin: 0 0 0.4rem 0;
      font-size: 0.85rem;
      color: #475569;
    }

    .pms-proof-req {
      font-size: 0.8rem;
      color: #334155;
    }

    /* Escrow Auth Banner */
    .escrow-auth-banner {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 8px;
      padding: 1.25rem;
      display: flex;
      gap: 1rem;
      align-items: flex-start;
    }

    .auth-icon-wrap {
      width: 40px;
      height: 40px;
      border-radius: 8px;
      background: #dcfce7;
      color: #15803d;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .auth-content h4 {
      margin: 0 0 0.35rem 0;
      font-size: 1rem;
      font-weight: 700;
      color: #14532d;
    }

    .auth-content p {
      margin: 0 0 1rem 0;
      font-size: 0.88rem;
      color: #166534;
      line-height: 1.45;
    }

    .auth-btn-row {
      display: flex;
      gap: 0.75rem;
      align-items: center;
    }

    .btn-paypal-escrow {
      background: #0070ba;
      color: #ffffff;
      padding: 0.55rem 1rem;
      border-radius: 6px;
      font-size: 0.88rem;
      font-weight: 600;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.15s;
    }

    .btn-paypal-escrow:hover {
      background: #005a9c;
    }

    .btn-confirm-funds {
      background: #15803d;
      color: #ffffff;
      border: none;
      padding: 0.55rem 1rem;
      border-radius: 6px;
      font-size: 0.88rem;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      transition: background 0.15s;
    }

    .btn-confirm-funds:hover:not(:disabled) {
      background: #166534;
    }

    /* Chat Card */
    .negotiation-chat-card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      overflow: hidden;
    }

    .chat-card-header {
      padding: 0.75rem 1.15rem;
      background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      font-size: 0.82rem;
      font-weight: 700;
      color: #475569;
      display: flex;
      align-items: center;
      gap: 0.45rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .chat-thread {
      max-height: 240px;
      overflow-y: auto;
      padding: 1rem 1.15rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      background: #ffffff;
    }

    .chat-entry {
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.88rem;
      max-width: 85%;
    }

    .chat-entry.is-buyer {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      align-self: flex-start;
    }

    .chat-entry.is-seller {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      align-self: flex-end;
    }

    .chat-entry.is-system {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      align-self: center;
      max-width: 95%;
      font-size: 0.82rem;
    }

    .chat-meta {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.25rem;
      font-size: 0.75rem;
    }

    .chat-author {
      font-weight: 700;
      color: #001435;
    }

    .chat-time {
      color: #64748b;
    }

    .chat-msg {
      color: #1e293b;
      line-height: 1.4;
    }

    .chat-terms-tag {
      margin-top: 0.4rem;
      font-size: 0.75rem;
      font-weight: 700;
      color: #0070ba;
      display: flex;
      gap: 0.4rem;
    }

    /* Counter Offer Deck */
    .counter-offer-deck {
      padding: 1rem 1.15rem;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
    }

    .deck-title {
      font-size: 0.8rem;
      font-weight: 700;
      color: #334155;
      margin-bottom: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .counter-inputs-row {
      display: flex;
      gap: 0.75rem;
      align-items: flex-end;
    }

    .input-col {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .input-col label {
      font-size: 0.75rem;
      font-weight: 600;
      color: #475569;
    }

    .note-col {
      flex: 1;
    }

    .input-with-prefix {
      display: flex;
      align-items: center;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 0 0.5rem;
    }

    .input-with-prefix .prefix,
    .input-with-prefix .suffix {
      font-size: 0.82rem;
      color: #64748b;
      font-weight: 600;
    }

    .form-control-sm {
      border: none;
      padding: 0.5rem 0.4rem;
      font-size: 0.88rem;
      color: #1e293b;
      outline: none;
      width: 100%;
      box-sizing: border-box;
      font-family: inherit;
    }

    .note-col .form-control-sm {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 0.5rem 0.75rem;
    }

    .btn-send-counter {
      background: #001435;
      color: #ffffff;
      border: none;
      padding: 0.55rem 1rem;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }

    .btn-send-counter:hover:not(:disabled) {
      background: #003087;
    }

    /* Actions Bar */
    .acceptance-actions-bar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 1.5rem;
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      padding: 1rem 1.25rem;
    }

    .action-info {
      font-size: 0.85rem;
      color: #1e3a8a;
      line-height: 1.45;
    }

    .btn-accept-scope {
      background: #0070ba;
      color: #ffffff;
      border: none;
      padding: 0.7rem 1.35rem;
      border-radius: 7px;
      font-size: 0.9rem;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 0.5rem;
      white-space: nowrap;
      transition: background 0.15s;
    }

    .btn-accept-scope:hover:not(:disabled) {
      background: #005a9c;
    }

    .accepted-success-banner {
      background: #ecfdf5;
      border: 1px solid #a7f3d0;
      border-radius: 8px;
      padding: 1rem 1.25rem;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      color: #065f46;
      font-size: 0.92rem;
      font-weight: 600;
    }
  `]
})
export class RevisionRoomComponent implements OnInit {
  @Input() projectId!: number;
  @Input() currentRole: string = 'buyer';
  @Input() projectTitle: string = '';
  @Input() initialScopeChange: ScopeChangeItem | null = null;

  @Output() closed = new EventEmitter<void>();
  @Output() scopeAccepted = new EventEmitter<any>();

  Number = Number;
  isLoading = false;
  isSubmitting = false;
  isSubmittingCounter = false;
  isAccepting = false;
  isAuthorizing = false;

  activeScopeChange: ScopeChangeItem | null = null;
  newDescription: string = '';
  initExtraDays: number = 0;
  initExtraCost: number = 0;
  showAddendumText: boolean = false;

  counterCost: number = 0;
  counterDays: number = 0;
  counterMessage: string = '';

  constructor(private http: HttpClient) {}

  ngOnInit(): void {
    if (this.initialScopeChange) {
      this.activeScopeChange = this.initialScopeChange;
      this.initCounterValues();
    } else if (this.projectId) {
      this.loadScopeChanges();
    }
  }

  loadScopeChanges(): void {
    this.isLoading = true;
    this.http.get<{ active_scope_change: ScopeChangeItem; scope_changes: ScopeChangeItem[] }>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-changes`
    ).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.activeScopeChange = res.active_scope_change || null;
        this.initCounterValues();
      },
      error: () => {
        this.isLoading = false;
      }
    });
  }

  initCounterValues(): void {
    if (this.activeScopeChange) {
      this.counterCost = Number(this.activeScopeChange.proposed_extra_cost || 0);
      this.counterDays = Number(this.activeScopeChange.proposed_extra_days || 0);
    }
  }

  submitInit(): void {
    if (!this.newDescription.trim() || !this.projectId) return;

    this.isSubmitting = true;
    const payload = {
      description: this.newDescription.trim(),
      proposed_extra_days: Number(this.initExtraDays) || 0,
      proposed_extra_cost: Number(this.initExtraCost) || 0,
      user_email: localStorage.getItem('user_email') || (this.currentRole === 'buyer' ? 'buyer@prooflens.com' : 'contractor@prooflens.com')
    };

    this.http.post<{ message: string; scope_change: ScopeChangeItem }>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-change/init`,
      payload
    ).subscribe({
      next: (res) => {
        this.isSubmitting = false;
        this.activeScopeChange = res.scope_change;
        this.initCounterValues();
      },
      error: (err) => {
        this.isSubmitting = false;
        alert('Failed to initialize scope change: ' + (err.error?.detail || err.message));
      }
    });
  }

  submitCounterOffer(): void {
    if (!this.activeScopeChange) return;

    this.isSubmittingCounter = true;
    const payload = {
      scope_change_id: this.activeScopeChange.id,
      sender_role: this.currentRole === 'seller' ? 'seller' : 'buyer',
      sender_email: localStorage.getItem('user_email') || (this.currentRole === 'seller' ? 'Contractor' : 'Buyer'),
      message: this.counterMessage.trim() || undefined,
      proposed_extra_cost: Number(this.counterCost),
      proposed_extra_days: Number(this.counterDays)
    };

    this.http.post<{ message: string; scope_change: ScopeChangeItem }>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-change/negotiate`,
      payload
    ).subscribe({
      next: (res) => {
        this.isSubmittingCounter = false;
        this.activeScopeChange = res.scope_change;
        this.counterMessage = '';
      },
      error: (err) => {
        this.isSubmittingCounter = false;
        alert('Counter-offer failed: ' + (err.error?.detail || err.message));
      }
    });
  }

  acceptScopeChange(): void {
    if (!this.activeScopeChange) return;

    this.isAccepting = true;
    const payload = {
      scope_change_id: this.activeScopeChange.id,
      user_email: localStorage.getItem('user_email') || undefined
    };

    this.http.post<any>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-change/accept`,
      payload
    ).subscribe({
      next: (res) => {
        this.isAccepting = false;
        if (res.scope_change) {
          this.activeScopeChange = res.scope_change;
        }
        if (res.status === 'ACCEPTED' || res.status === 'PENDING_FUNDS') {
          this.scopeAccepted.emit(res);
        }
      },
      error: (err) => {
        this.isAccepting = false;
        alert('Failed to accept scope change: ' + (err.error?.detail || err.message));
      }
    });
  }

  authorizeFunds(): void {
    if (!this.activeScopeChange) return;

    this.isAuthorizing = true;
    const payload = {
      scope_change_id: this.activeScopeChange.id,
      paypal_order_id: this.activeScopeChange.paypal_order_id
    };

    this.http.post<{ status: string; scope_change: ScopeChangeItem }>(
      `${API_BASE_URL}/api/projects/${this.projectId}/scope-change/authorize-funds`,
      payload
    ).subscribe({
      next: (res) => {
        this.isAuthorizing = false;
        this.activeScopeChange = res.scope_change;
        this.scopeAccepted.emit(res);
      },
      error: (err) => {
        this.isAuthorizing = false;
        alert('Failed to confirm PayPal authorization: ' + (err.error?.detail || err.message));
      }
    });
  }

  toggleAddendumView(): void {
    this.showAddendumText = !this.showAddendumText;
  }

  formatStatus(status: string): string {
    switch (status) {
      case 'NEGOTIATING': return 'Under Negotiation';
      case 'PENDING_FUNDS': return 'Pending Escrow Authorization';
      case 'ACCEPTED': return 'Accepted & Active';
      case 'REJECTED': return 'Rejected';
      default: return status || 'Active';
    }
  }

  formatTime(isoStr: string): string {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    this.close();
  }
}
