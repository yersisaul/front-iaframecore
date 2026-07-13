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

  // Interceptar la ruta raíz de dashboard para redirigir dinámicamente al primer módulo autorizado
  const stateUrl = state.url.split('?')[0];
  if (stateUrl === '/dashboard' || stateUrl === '/dashboard/') {
    const defaultRoute = permissionsService.getDefaultRedirectRoute();
    router.navigate([defaultRoute]);
    return false;
  }

  // Verificar permisos requeridos (basado en códigos de permiso del backend, no en nombres de rol)
  const requiredPermissions = route.data?.['permissions'] as string[];
  if (requiredPermissions && requiredPermissions.length > 0) {
    const activeCodes = permissionsService.activePermissionCodes();
    const anyPermission = route.data?.['anyPermission'] as boolean;

    const hasMatch = anyPermission
      ? requiredPermissions.some(p => activeCodes.has(p))
      : requiredPermissions.every(p => activeCodes.has(p));

    if (!hasMatch) {
      const fallback = permissionsService.getDefaultRedirectRoute();
      router.navigate([fallback]);
      return false;
    }
  }

  return true;
};
