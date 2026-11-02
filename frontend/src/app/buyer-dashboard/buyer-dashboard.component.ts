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
  can_delete?: boolean;
  delete_disabled_reason?: string;
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
  templateUrl: './buyer-dashboard.component.html',
  styleUrl: './buyer-dashboard.component.scss'
})
export class BuyerDashboardComponent implements OnInit {
  currentView: 'dashboard' | 'create' = 'dashboard';
  wizardStep = 1;

  // Projects list for AG Grid
  projects: ProjectRow[] = [];
  filteredProjects: ProjectRow[] = [];
  searchQuery = '';
  isLoadingProjects = true;
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
  paginationPageSize = 10;

  // Scope Drawer State
  isScopeDrawerOpen = false;
  isLoadingDrawerDetails = false;
  selectedDrawerData: any = null;
  drawerError = '';

  // Delete Project Modal State
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

  // AG Grid Column Definitions
  columnDefs: ColDef[] = [
    {
      field: 'id',
      headerName: 'Escrow ID',
      width: 125,
      sortable: true,
      cellRenderer: (params: any) => {
        return `
          <div style="display:flex; align-items:center; height:100%;">
            <span style="font-family:'JetBrains Mono',monospace; font-weight:700; background:#F1F5F9; color:#0F172A; padding:4px 8px; border-radius:6px; border:1px solid #E2E8F0; font-size:11.5px; letter-spacing:0.02em;">#PL-${params.value}</span>
          </div>`;
      }
    },
    {
      field: 'title',
      headerName: 'Project Scope & Industry',
      flex: 2,
      minWidth: 240,
      filter: true,
      sortable: true,
      cellRenderer: (params: any) => {
        const id = params.data?.id;
        const title = params.data?.title || 'Untitled Scope';
        const ind = params.data?.industry_type || 'General Service';
        return `
          <div class="project-scope-cell-interactive" 
               onclick="window.dispatchEvent(new CustomEvent('openScopeDrawer', {detail: ${id}}))"
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
      field: 'total_price',
      headerName: 'Escrow Budget',
      width: 155,
      sortable: true,
      cellRenderer: (params: any) => {
        const val = Number(params.value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return `
          <div style="display:flex; align-items:center; height:100%;">
            <span style="font-weight:800; color:#0F172A; font-size:14px; font-family:'Plus Jakarta Sans',sans-serif;">$${val}</span>
            <span style="font-size:10px; font-weight:800; color:#64748B; background:#F1F5F9; padding:2px 5px; border-radius:4px; margin-left:6px; border:1px solid #E2E8F0;">USD</span>
          </div>
        `;
      }
    },
    {
      field: 'status',
      headerName: 'Escrow Status',
      width: 200,
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
          bg = '#EEF2FF'; color = '#4338CA'; border = '#C7D2FE'; dot = '#6366F1'; label = 'INVITE SENT';
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
      field: 'version',
      headerName: 'Version',
      width: 100,
      cellRenderer: (params: any) => {
        const v = params.value || 1;
        return `
          <div style="display:flex; align-items:center; height:100%;">
            <span style="background:#F8FAFC; color:#334155; border:1px solid #CBD5E1; font-size:11px; font-weight:700; padding:3px 8px; border-radius:6px; font-family:'JetBrains Mono',monospace;">v${v}.0</span>
          </div>
        `;
      }
    },
    {
      field: 'seller_email',
      headerName: 'Contractor',
      width: 190,
      cellRenderer: (params: any) => {
        const seller = params.value;
        if (seller && seller !== 'Awaiting Seller') {
          const initial = seller.charAt(0).toUpperCase();
          return `
            <div style="display:flex; align-items:center; gap:8px; height:100%; min-width:0; overflow:hidden;">
              <div style="width:24px; height:24px; min-width:24px; min-height:24px; flex-shrink:0; border-radius:50%; background:#FEF3C7; color:#B45309; font-weight:800; font-size:11px; display:flex; align-items:center; justify-content:center; border:1px solid #FDE68A;">${initial}</div>
              <span style="font-size:12px; font-weight:600; color:#1E293B; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; flex:1;">${seller}</span>
            </div>
          `;
        }
        return `
          <div style="display:flex; align-items:center; height:100%;">
            <span style="font-size:11.5px; color:#94A3B8; font-style:italic; background:#F8FAFC; padding:2px 8px; border-radius:4px; border:1px dashed #CBD5E1;">Awaiting Contractor</span>
          </div>
        `;
      }
    },
    {
      field: 'created_at',
      headerName: 'Timeline',
      width: 155,
      cellRenderer: (params: any) => {
        const init = params.value || 'Nov 01, 2026';
        const deadline = params.data?.deadline ? `<span style="font-size:11px; font-weight:700; color:#D97706; display:block; margin-top:2px;">Due: ${params.data.deadline}</span>` : '';
        return `
          <div style="display:flex; flex-direction:column; justify-content:center; height:100%; line-height:1.3;">
            <span style="font-size:12px; color:#64748B;">${init}</span>
            ${deadline}
          </div>
        `;
      }
    },
    {
      headerName: 'Actions',
      width: 275,
      cellRenderer: (params: any) => {
        const id = params.data?.id;
        const token = params.data?.invite_token;
        const status = (params.data?.status || '').toLowerCase();
        const canDelete = params.data?.can_delete !== false && !['accepted', 'active', 'in_review'].includes(status);
        const disabledReason = params.data?.delete_disabled_reason || 'Cannot delete: Active PayPal escrow funds are held in vault.';

        const copyBtnHtml = token
          ? `
            <button onclick="window.dispatchEvent(new CustomEvent('copyToken', {detail: '${token}'}))"
                    title="Copy contractor invite link"
                    class="btn-grid-copy"
                    style="background: #ffffff; color: #0070BA; border: 1.5px solid #CBD5E1; min-width: 76px; height: 28px; padding: 0 8px; border-radius: 6px; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all 0.15s ease; display: inline-flex; align-items: center; justify-content: center;">
              Copy Link
            </button>
          `
          : `
            <button disabled
                    title="No contractor invite link active for this project"
                    class="btn-grid-copy-disabled"
                    style="background: #F8FAFC; color: #94A3B8; border: 1.5px solid #E2E8F0; min-width: 76px; height: 28px; padding: 0 8px; border-radius: 6px; font-size: 11.5px; font-weight: 700; cursor: not-allowed; opacity: 0.55; display: inline-flex; align-items: center; justify-content: center;">
              Copy Link
            </button>
          `;

        const deleteBtnHtml = canDelete
          ? `
            <button onclick="window.dispatchEvent(new CustomEvent('deleteProjectPrompt', {detail: ${id}}))"
                    title="Delete Project #${id}"
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

        return `
          <div style="display: flex; gap: 6px; align-items: center; height: 100%;">
            <button onclick="window.dispatchEvent(new CustomEvent('openRoom', {detail: ${id}}))"
                    title="Open Negotiation Room"
                    style="background: linear-gradient(180deg, #0079C1 0%, #00457C 100%); color: white; border: 1px solid rgba(0,44,102,0.4); min-width: 95px; height: 28px; padding: 0 10px; border-radius: 6px; font-size: 11.5px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; box-shadow: 0 1px 3px rgba(0,112,186,0.25);">
              <span>Open Room</span>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M7 17l9.2-9.2M17 17V7H7"/></svg>
            </button>
            ${copyBtnHtml}
            ${deleteBtnHtml}
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
    window.addEventListener('openScopeDrawer', (event: any) => {
      this.openProjectScopeDrawer(event.detail);
    });
    window.addEventListener('deleteProjectPrompt', (event: any) => {
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
          this.deleteSuccessToast = `Project #PL-${id} has been permanently deleted.`;
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

  copyDrawerInviteLink(token: string) {
    if (!token) return;
    const url = `http://localhost:4200/invite/${token}`;
    navigator.clipboard.writeText(url);
    alert('Contractor invite link copied to clipboard:\n' + url);
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
    if (s === 'invite_sent') return 'INVITE SENT';
    if (s === 'rejected') return 'REJECTED';
    return 'DRAFT';
  }

  loadProjects() {
    this.isLoadingProjects = true;
    const start = Date.now();
    this.http.get<ProjectRow[]>(`${API_BASE_URL}/api/projects`)
      .subscribe({
        next: (data) => {
          this.projects = data || [];
          this.filteredProjects = [...this.projects];
          this.calculateKpis();
          const elapsed = Date.now() - start;
          const remaining = Math.max(0, 450 - elapsed);
          setTimeout(() => {
            this.isLoadingProjects = false;
          }, remaining);
        },
        error: () => {
          this.projects = [];
          this.filteredProjects = [];
          this.isLoadingProjects = false;
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

  onChatInputKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.sendAiClarification();
    }
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
