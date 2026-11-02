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
  deadline?: string;
  version: number;
  has_agreement: boolean;
  is_accepted: boolean;
  can_delete?: boolean;
  delete_disabled_reason?: string;
}

@Component({
  selector: 'app-seller-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, AgGridAngular, LiveCameraComponent],
  templateUrl: './seller-dashboard.component.html',
  styleUrl: './seller-dashboard.component.scss'
})
export class SellerDashboardComponent implements OnInit {
  Number = Number;
  projects: ProjectRow[] = [];

  // PayPal Balances & Transactions State
  paypalAvailableBalance = 0;
  paypalTotalBalance = 0;
  paypalWithheldBalance = 0;
  paypalTransactions: any[] = [];
  showPayPalLedgerModal = false;
  loadingLedger = false;
  filteredProjects: ProjectRow[] = [];
  searchQuery = '';
  activeFilterTab: 'all' | 'negotiating' | 'accepted' = 'all';
  isLoadingProjects = true;
  private gridApi!: GridApi;

  totalEarnings = 0;
  negotiatingCount = 0;
  acceptedCount = 0;
  activeAlerts: any[] = [];
  isAlertsDropdownOpen = false;
  isAlertsDismissed = false;
  paginationPageSize = 10;

  // Scope Drawer State
  isScopeDrawerOpen = false;
  isLoadingDrawerDetails = false;
  selectedDrawerData: any = null;
  drawerError = '';

  // Delete Contract Modal State
  isDeleteModalOpen = false;
  projectToDelete: ProjectRow | null = null;
  isDeletingProject = false;
  deleteActionError = '';
  deleteSuccessToast = '';

  gridIcons = {
    first: '<span class="ag-fintech-nav-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="5" x2="5" y2="19"></line><polyline points="19 5 11 12 19 19"></polyline></svg></span>',
    previous: '<span class="ag-fintech-nav-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></span>',
    next: '<span class="ag-fintech-nav-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></span>',
    last: '<span class="ag-fintech-nav-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="5" x2="19" y2="19"></line><polyline points="5 5 13 12 5 19"></polyline></svg></span>',
    smallDown: '<span class="ag-fintech-nav-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg></span>',
  };

  // Active Milestone Execution Desk (Phase 4)
  activeProject: any = null;
  activeMilestones: any[] = [];
  activeMilestoneIndex = 0;

  columnDefs: ColDef[] = [
    {
      field: 'id',
      headerName: 'Escrow ID',
      width: 125,
      cellRenderer: (params: any) => `
        <div style="display:flex; align-items:center; height:100%;">
          <span style="font-family:'JetBrains Mono',monospace; font-weight:700; background:#F1F5F9; color:#0F172A; padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0; font-size:11.5px;">#PL-${params.value}</span>
        </div>`
    },
    {
      field: 'title',
      headerName: 'Project Scope',
      flex: 2,
      minWidth: 230,
      cellRenderer: (params: any) => {
        const id = params.data?.id;
        const title = params.data?.title || 'Untitled Project';
        const ind = params.data?.industry_type || 'General Service';
        return `
          <div class="project-scope-cell-interactive" 
               onclick="window.dispatchEvent(new CustomEvent('sellerOpenScopeDrawer', {detail: ${id}}))"
               title="Click to inspect complete project scope, specifications & milestones"
               style="display:flex; flex-direction:column; justify-content:center; height:100%; line-height:1.3; cursor:pointer;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span class="cell-scope-title" style="font-weight:750; color:#0070BA; font-size:13.5px; transition:color 0.15s ease;">${title}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#0070BA" stroke-width="2.5" style="opacity:0.8; flex-shrink:0;">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:2px;">
              <span style="font-size:10.5px; color:#00457C; font-weight:750; background:#E6F3FB; padding:1px 6px; border-radius:4px; text-transform:uppercase; letter-spacing:0.02em;">${ind}</span>
              <span style="font-size:10px; color:#64748B; font-weight:600;">• Click to view details</span>
            </div>
          </div>
        `;
      }
    },
    {
      field: 'buyer_email',
      headerName: 'Client (Buyer)',
      flex: 1.5,
      minWidth: 180,
      cellRenderer: (params: any) => {
        const email = params.value || 'buyer@prooflens.com';
        return `
          <div style="display:flex; align-items:center; gap:8px; height:100%; min-width:0; overflow:hidden;">
            <div style="width:24px; height:24px; min-width:24px; min-height:24px; flex-shrink:0; border-radius:50%; background:#E0E7FF; color:#4338CA; font-weight:800; font-size:11px; display:flex; align-items:center; justify-content:center; border:1px solid #C7D2FE;">B</div>
            <span style="font-size:12px; color:#334155; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1;">${email}</span>
          </div>`;
      }
    },
    {
      field: 'total_price',
      headerName: 'Payout Value',
      width: 155,
      cellRenderer: (params: any) => `
        <div style="display:flex; align-items:center; height:100%;">
          <span style="font-weight:800; color:#0F172A; font-size:14px; font-family:'Plus Jakarta Sans',sans-serif;">$${Number(params.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          <span style="font-size:10px; font-weight:800; color:#64748B; background:#F1F5F9; padding:2px 5px; border-radius:4px; margin-left:6px; border:1px solid #E2E8F0;">USD</span>
        </div>`
    },
    {
      field: 'status',
      headerName: 'Contract Status',
      width: 195,
      cellRenderer: (params: any) => {
        const val = (params.value || 'draft').toLowerCase();
        let bg = '#F1F5F9';
        let color = '#475569';
        let border = '#E2E8F0';
        let dot = '#94A3B8';
        let label = 'DRAFT';

        if (val === 'accepted') {
          bg = '#ECFDF5'; color = '#047857'; border = '#A7F3D0'; dot = '#10B981'; label = 'ACCEPTED & FUNDED';
        } else if (val === 'negotiating') {
          bg = '#FFFBEB'; color = '#B45309'; border = '#FDE68A'; dot = '#F59E0B'; label = 'IN NEGOTIATION';
        } else if (val === 'seller_joined') {
          bg = '#EFF6FF'; color = '#1D4ED8'; border = '#BFDBFE'; dot = '#3B82F6'; label = 'SELLER JOINED';
        } else if (val === 'invite_sent') {
          bg = '#EEF2FF'; color = '#4338CA'; border = '#C7D2FE'; dot = '#6366F1'; label = 'OPEN INVITE';
        }

        return `
          <div style="display:flex; align-items:center; height:100%;">
            <span style="background:${bg}; color:${color}; border:1px solid ${border}; font-size:11px; font-weight:800; padding:4px 10px; border-radius:9999px; letter-spacing:0.04em; display:inline-flex; align-items:center; gap:5px;">
              <span style="width:6px; height:6px; border-radius:50%; background:${dot}; display:inline-block;"></span>
              ${label}
            </span>
          </div>
        `;
      }
    },
    {
      field: 'created_at',
      headerName: 'Timeline',
      width: 135,
      cellRenderer: (params: any) => `<div style="display:flex; align-items:center; height:100%; font-size:12px; color:#64748B;">${params.value || 'Nov 01, 2026'}</div>`
    },
    {
      headerName: 'Actions',
      width: 250,
      cellRenderer: (params: any) => {
        const id = params.data.id;
        const isAccepted = (params.data.status || '').toLowerCase() === 'accepted';
        const status = (params.data?.status || '').toLowerCase();
        const canDelete = params.data?.can_delete !== false && !['accepted', 'active', 'in_review'].includes(status);
        const disabledReason = params.data?.delete_disabled_reason || 'Cannot delete: Active PayPal escrow funds are held in vault.';

        const deleteBtnHtml = canDelete
          ? `
            <button onclick="window.dispatchEvent(new CustomEvent('sellerDeletePrompt', {detail: ${id}}))"
                    title="Delete Contract #${id}"
                    class="btn-grid-delete"
                    style="background: #FFF1F2; color: #E11D48; border: 1.5px solid #FECDD3; width: 28px; min-width: 28px; height: 28px; padding: 0; border-radius: 6px; font-size: 11.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; transition: all 0.15s ease;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          `
          : `
            <button disabled
                    title="${disabledReason}"
                    class="btn-grid-delete-disabled"
                    style="background: #F8FAFC; color: #94A3B8; border: 1.5px solid #E2E8F0; width: 28px; min-width: 28px; height: 28px; padding: 0; border-radius: 6px; font-size: 11.5px; font-weight: 700; cursor: not-allowed; display: inline-flex; align-items: center; justify-content: center; opacity: 0.55;">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          `;

        const submitProofBtnHtml = isAccepted
          ? `
            <button onclick="window.dispatchEvent(new CustomEvent('sellerOpenFulfillment', {detail: ${id}}))"
                    title="Submit Milestone Proof & Fulfill"
                    class="btn-grid-proof"
                    style="background:linear-gradient(180deg, #10B981 0%, #059669 100%); color:white; border:none; min-width:105px; height:28px; padding:0 10px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; justify-content:center; gap:4px; box-shadow:0 1px 3px rgba(16,185,129,0.3); transition:all 0.15s ease;">
              <span>Submit Proof</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
            </button>
          `
          : `
            <button disabled
                    title="Submit Proof unlocks once contract terms are accepted and funded in PayPal escrow"
                    class="btn-grid-proof-disabled"
                    style="background:#F8FAFC; color:#94A3B8; border:1.5px solid #E2E8F0; min-width:105px; height:28px; padding:0 10px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:not-allowed; opacity:0.55; display:inline-flex; align-items:center; justify-content:center; gap:4px;">
              <span>Submit Proof</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
            </button>
          `;

        return `
          <div style="display:flex; align-items:center; gap:6px; height:100%;">
            <button onclick="window.dispatchEvent(new CustomEvent('sellerOpenRoom', {detail: ${id}}))"
                    title="View Terms & Negotiation Room"
                    style="background:#ffffff; color:#0070BA; border:1.5px solid #CBD5E1; min-width:56px; height:28px; padding:0 10px; border-radius:6px; font-size:11.5px; font-weight:700; cursor:pointer; display:inline-flex; align-items:center; justify-content:center;">
              <span>Terms</span>
            </button>
            ${submitProofBtnHtml}
            ${deleteBtnHtml}
          </div>
        `;
      }
    }
  ];

  defaultColDef: ColDef = { resizable: true, sortable: true };

  constructor(private http: HttpClient, private router: Router) {}

  ngOnInit() {
    this.loadProjects();
    this.fetchPayPalBalances();

    window.addEventListener('sellerOpenRoom', (event: any) => {
      this.router.navigate(['/project', event.detail, 'negotiate'], { queryParams: { role: 'seller' } });
    });
    window.addEventListener('sellerOpenFulfillment', (event: any) => {
      this.openFulfillment(event.detail);
    });
    window.addEventListener('sellerOpenScopeDrawer', (event: any) => {
      this.openProjectScopeDrawer(event.detail);
    });
    window.addEventListener('sellerDeletePrompt', (event: any) => {
      this.promptDeleteProject(event.detail);
    });
  }

  openProjectScopeDrawer(projectId: number) {
    this.isScopeDrawerOpen = true;
    this.isLoadingDrawerDetails = true;
    this.drawerError = '';

    const local = this.projects.find(p => p.id === projectId);
    if (local) {
      this.selectedDrawerData = {
        project: {
          ...local,
          can_delete: this.canDeleteProject(local),
          delete_disabled_reason: local.delete_disabled_reason
        },
        agreement: {
          milestones: (local as any).milestones || [],
          version: local.version || 1
        }
      };
    } else {
      this.selectedDrawerData = null;
    }

    this.http.get<any>(`${API_BASE_URL}/api/projects/${projectId}`)
      .subscribe({
        next: (data) => {
          this.selectedDrawerData = data;
          this.isLoadingDrawerDetails = false;
        },
        error: (err) => {
          this.isLoadingDrawerDetails = false;
          if (!this.selectedDrawerData) {
            this.drawerError = err.error?.detail || 'Unable to load full project details.';
          }
        }
      });
  }

  closeScopeDrawer() {
    this.isScopeDrawerOpen = false;
    this.selectedDrawerData = null;
    this.drawerError = '';
  }

  canDeleteProject(p: any): boolean {
    if (!p) return false;
    if (p.can_delete === false) return false;
    const st = (p.status || '').toLowerCase();
    if (['accepted', 'active', 'in_review'].includes(st)) {
      return false;
    }
    return true;
  }

  getDeleteDisabledReason(p: any): string {
    if (!p) return '';
    return p.delete_disabled_reason || 'Active PayPal escrow funds are held in vault. Must complete milestones or issue refund before deleting.';
  }

  promptDeleteProject(projectId: number) {
    const proj = this.projects.find(p => p.id === projectId);
    if (!proj) return;
    this.projectToDelete = proj;
    this.deleteActionError = '';
    this.isDeleteModalOpen = true;
  }

  closeDeleteModal() {
    if (this.isDeletingProject) return;
    this.isDeleteModalOpen = false;
    this.projectToDelete = null;
    this.deleteActionError = '';
  }

  confirmDeleteProject() {
    if (!this.projectToDelete || this.isDeletingProject) return;
    const id = this.projectToDelete.id;
    this.isDeletingProject = true;
    this.deleteActionError = '';

    this.http.delete<any>(`${API_BASE_URL}/api/projects/${id}`)
      .subscribe({
        next: () => {
          this.isDeletingProject = false;
          this.isDeleteModalOpen = false;
          if (this.selectedDrawerData?.project?.id === id) {
            this.closeScopeDrawer();
          }
          this.deleteSuccessToast = `Contract #PL-${id} has been permanently deleted.`;
          setTimeout(() => {
            this.deleteSuccessToast = '';
          }, 4500);
          this.projectToDelete = null;
          this.loadProjects();
        },
        error: (err) => {
          this.isDeletingProject = false;
          this.deleteActionError = err.error?.detail || err.message || 'Failed to delete project.';
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

  formatCurrency(val: any): string {
    return Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  getStatusBadgeClass(status: string): string {
    const s = (status || '').toLowerCase();
    if (s === 'accepted' || s === 'active') return 'badge-emerald';
    if (s === 'negotiating') return 'badge-amber';
    if (s === 'seller_joined') return 'badge-blue';
    if (s === 'invite_sent') return 'badge-indigo';
    if (s === 'rejected') return 'badge-rose';
    return 'badge-slate';
  }

  getStatusLabel(status: string): string {
    const s = (status || '').toLowerCase();
    if (s === 'accepted') return 'ACCEPTED & FUNDED';
    if (s === 'active') return 'ACTIVE ESCROW';
    if (s === 'negotiating') return 'IN NEGOTIATION';
    if (s === 'seller_joined') return 'SELLER JOINED';
    if (s === 'invite_sent') return 'OPEN INVITE';
    if (s === 'rejected') return 'REJECTED';
    return 'DRAFT';
  }

  openFulfillment(projectId: number) {
    this.router.navigate(['/project', projectId, 'fulfillment'], { queryParams: { role: 'seller' } });
  }

  loadProjects() {
    this.isLoadingProjects = true;
    const start = Date.now();
    this.http.get<ProjectRow[]>(`${API_BASE_URL}/api/projects`)
      .subscribe({
        next: (data) => {
          this.projects = data || [];
          this.calculateKpis();
          this.applyFilters();
          this.loadActiveAlerts();
          const elapsed = Date.now() - start;
          const remaining = Math.max(0, 450 - elapsed);
          setTimeout(() => {
            this.isLoadingProjects = false;
          }, remaining);

          const accepted = this.projects.find(p => (p.status || '').toLowerCase() === 'accepted');
          if (accepted && (!this.activeProject || this.activeProject.id !== accepted.id)) {
            this.activeProject = accepted;
            this.loadActiveMilestones(accepted.id);
          }
        },
        error: () => {
          this.projects = [];
          this.filteredProjects = [];
          this.isLoadingProjects = false;
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

  toggleAlertsDropdown() {
    this.isAlertsDropdownOpen = !this.isAlertsDropdownOpen;
  }

  dismissAlerts() {
    this.isAlertsDismissed = true;
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

  fetchPayPalBalances() {
    this.http.get<any>(`${API_BASE_URL}/api/paypal/balances`)
      .subscribe({
        next: (res) => {
          if (res?.balances && res.balances.length > 0) {
            const b = res.balances[0];
            this.paypalAvailableBalance = Number(b.available_balance?.value || 0);
            this.paypalTotalBalance = Number(b.total_balance?.value || 0);
            this.paypalWithheldBalance = Number(b.withheld_balance?.value || 0);
          }
        },
        error: (err) => console.warn('Could not fetch PayPal balances:', err)
      });
  }

  fetchPayPalTransactions() {
    this.loadingLedger = true;
    this.http.get<any>(`${API_BASE_URL}/api/paypal/transactions?days_back=30&page_size=20`)
      .subscribe({
        next: (res) => {
          this.paypalTransactions = res?.transaction_details || [];
          this.loadingLedger = false;
        },
        error: (err) => {
          console.warn('Could not fetch PayPal transactions:', err);
          this.paypalTransactions = [];
          this.loadingLedger = false;
        }
      });
  }

  openPayPalLedger() {
    this.showPayPalLedgerModal = true;
    this.fetchPayPalBalances();
    this.fetchPayPalTransactions();
  }

  closePayPalLedger() {
    this.showPayPalLedgerModal = false;
  }
}
