import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  const requiredRoles = route.data?.['roles'] as string[];
  if (requiredRoles && requiredRoles.length > 0) {
    const user = authService.currentUser();
    if (!user || !requiredRoles.includes(user.role)) {
      router.navigate(['/dashboard']);
      return false;
    }
  }

  return true;
};
