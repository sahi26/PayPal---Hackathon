import { Component } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { Router } from '@angular/router';
import { MilestoneFulfillmentComponent } from '../milestone-fulfillment/milestone-fulfillment.component';

/**
 * ProjectDashboardComponent
 * Active project dashboard housing the Cryptographic Milestone Fulfillment Desk,
 * Sequential Milestone Progress Timeline (with Addendum distinctions),
 * and the Revision Room for scope changes and negotiations.
 */
@Component({
  selector: 'app-project-dashboard',
  standalone: true,
  imports: [CommonModule, MilestoneFulfillmentComponent],
  providers: [DatePipe],
  templateUrl: './project-dashboard.component.html',
  styleUrl: './project-dashboard.component.scss'
})
export class ProjectDashboardComponent {
  constructor(private router: Router) {}

  /**
   * Phase 1: State-Based Dashboard Routing
   * Route strictly based on project.status:
   * If status === 'DRAFT' or 'INVITE_SENT' (or negotiating/pending): Navigate to Agreement / Negotiation Room.
   * If status === 'ACTIVE', 'WARRANTY_PERIOD', or 'COMPLETED': Navigate directly to Milestone Fulfillment.
   */
  viewProject(project: any) {
    if (!project || !project.id) return;
    const status = (project.status || '').toUpperCase();
    const role = localStorage.getItem('role') || 'buyer';

    if (status === 'DRAFT' || status === 'INVITE_SENT' || status === 'NEGOTIATING' || status === 'SELLER_JOINED') {
      this.router.navigate(['/project', project.id, 'negotiate'], { queryParams: { role } });
    } else {
      // ACTIVE, ACCEPTED, WARRANTY_PERIOD, COMPLETED, DISPUTED, FUNDS_AT_RISK, etc.
      this.router.navigate(['/project', project.id, 'fulfillment'], { queryParams: { role } });
    }
  }

  formatLocalDate(dateStr: string | null | undefined): string {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return dateStr;
    }
  }
}
