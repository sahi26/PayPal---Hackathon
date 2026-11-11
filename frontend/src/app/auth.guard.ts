import { inject } from '@angular/core';
import { Router, CanActivateFn } from '@angular/router';

export const authGuard: CanActivateFn = (route, state) => {
  const router = inject(Router);

  if (typeof localStorage === 'undefined') {
    return router.parseUrl('/login');
  }

  let storedUser: string | null = null;
  try {
    storedUser = localStorage.getItem('prooflens_user');
  } catch {
    storedUser = null;
  }

  if (!storedUser) {
    return router.parseUrl('/login');
  }

  try {
    const user = JSON.parse(storedUser);
    if (!user || (!user.id && !user.email)) {
      return router.parseUrl('/login');
    }
    return true;
  } catch {
    return router.parseUrl('/login');
  }
};
