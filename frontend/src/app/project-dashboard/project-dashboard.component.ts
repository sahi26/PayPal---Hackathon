import { Component } from '@angular/core';
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
  imports: [MilestoneFulfillmentComponent],
  templateUrl: './project-dashboard.component.html',
  styleUrl: './project-dashboard.component.scss'
})
export class ProjectDashboardComponent {}
