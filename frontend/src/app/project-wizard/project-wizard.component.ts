import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';

@Component({
  selector: 'app-project-wizard',
  standalone: true,
  templateUrl: './project-wizard.component.html',
  styleUrl: './project-wizard.component.scss'
})
export class ProjectWizardComponent implements OnInit {
  constructor(private router: Router) {}

  ngOnInit(): void {
    this.router.navigate(['/']);
  }
}
