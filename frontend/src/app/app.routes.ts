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
import { authGuard } from './auth.guard';

export const routes: Routes = [
  { path: '', component: LoginComponent },
  { path: 'login', component: LoginComponent },
  { path: 'verify-email', redirectTo: 'login' },
  { path: 'buyer', component: BuyerDashboardComponent, canActivate: [authGuard] },
  { path: 'seller', component: SellerDashboardComponent, canActivate: [authGuard] },
  { path: 'dashboard', redirectTo: 'buyer' },
  { path: 'wizard', component: BuyerWizardComponent, canActivate: [authGuard] },
  { path: 'invite/:token', component: SellerInviteComponent },
  { path: 'project/:id/negotiate', component: NegotiationRoomComponent, canActivate: [authGuard] },
  { path: 'project/:id/fulfillment', component: MilestoneFulfillmentComponent, canActivate: [authGuard] },
  { path: 'project/:id/dashboard', component: MilestoneFulfillmentComponent, canActivate: [authGuard] },
  { path: 'project/:id/revision', component: RevisionRoomComponent, canActivate: [authGuard] },
  { path: 'project/:id/dispute-room', component: DisputeRoomComponent, canActivate: [authGuard] },
  { path: 'project/:id/dispute', component: DisputeRoomComponent, canActivate: [authGuard] },
  { path: '**', redirectTo: '' }
];
