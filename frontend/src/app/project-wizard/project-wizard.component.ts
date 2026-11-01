import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-project-wizard',
  standalone: true,
  template: `
    <div style="padding: 3rem; text-align: center; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <p style="color: #64748b;">Redirecting to ProofLens Portal...</p>
    </div>
  `
})
export class ProjectWizardComponent implements OnInit {
  constructor(private router: Router) {}

  ngOnInit(): void {
    this.router.navigate(['/']);
  }
}
