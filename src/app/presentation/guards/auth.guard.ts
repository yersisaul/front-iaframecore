import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PermissionsService } from '../../core/services/permissions.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const permissionsService = inject(PermissionsService);
  const router = inject(Router);

  if (!authService.isAuthenticated()) {
    router.navigate(['/login']);
    return false;
  }

  // Verificar permisos requeridos (basado en códigos de permiso del backend, no en nombres de rol)
  const requiredPermissions = route.data?.['permissions'] as string[];
  if (requiredPermissions && requiredPermissions.length > 0) {
    const activeCodes = permissionsService.activePermissionCodes();
    const hasAll = requiredPermissions.every(p => activeCodes.has(p));
    if (!hasAll) {
      router.navigate(['/dashboard']);
      return false;
    }
  }

  return true;
};
