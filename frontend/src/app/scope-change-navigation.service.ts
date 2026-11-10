import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import { ScopeChangeOpenStore } from './scope-change-navigation.mjs';

@Injectable({ providedIn: 'root' })
export class ScopeChangeNavigationService {
  private readonly store = new ScopeChangeOpenStore();
  readonly openRequested$ = new Subject<number>();

  requestOpen(projectId: number): void {
    const numericId = Number(projectId);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return;
    }
    this.store.requestOpen(numericId);
    this.openRequested$.next(numericId);
  }

  consumePending(projectId: number): boolean {
    return this.store.consumePending(projectId);
  }
}
