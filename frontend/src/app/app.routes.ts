import { Routes } from '@angular/router';
import { LoginComponent } from './login/login.component';
import { BuyerDashboardComponent } from './buyer-dashboard/buyer-dashboard.component';
import { SellerDashboardComponent } from './seller-dashboard/seller-dashboard.component';
import { BuyerWizardComponent } from './buyer-wizard/buyer-wizard.component';
import { SellerInviteComponent } from './seller-invite/seller-invite.component';
import { NegotiationRoomComponent } from './negotiation-room/negotiation-room.component';
import { MilestoneFulfillmentComponent } from './milestone-fulfillment/milestone-fulfillment.component';
import { RevisionRoomComponent } from './revision-room/revision-room.component';
import { DisputeRoomComponent } from './dispute-room/dispute-room.component';

export const routes: Routes = [
  { path: '', component: LoginComponent },
  { path: 'login', component: LoginComponent },
  { path: 'verify-email', redirectTo: 'login' },
  { path: 'buyer', component: BuyerDashboardComponent },
  { path: 'seller', component: SellerDashboardComponent },
  { path: 'dashboard', redirectTo: 'buyer' },
  { path: 'wizard', component: BuyerWizardComponent },
  { path: 'invite/:token', component: SellerInviteComponent },
  { path: 'project/:id/negotiate', component: NegotiationRoomComponent },
  { path: 'project/:id/fulfillment', component: MilestoneFulfillmentComponent },
  { path: 'project/:id/dashboard', component: MilestoneFulfillmentComponent },
  { path: 'project/:id/revision', component: RevisionRoomComponent },
  { path: 'project/:id/dispute-room', component: DisputeRoomComponent },
  { path: 'project/:id/dispute', component: DisputeRoomComponent },
  { path: '**', redirectTo: '' }
];
