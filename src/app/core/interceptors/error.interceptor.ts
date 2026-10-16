import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AppEnvironment } from '../config/app-environment';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        // Ignoramos la validación inicial de sesión y el login para evitar redirecciones infinitas o flujos truncados.
        // En el proxy de Azor Panel, un 401 solo es sesión expirada si lo marca el propio proxy (X-Azor-Proxy-Auth);
        // cualquier otro 401 viene de Azor Panel e indica una clave de integración rechazada.
        const isAzorProxyRequest = req.url.startsWith(AppEnvironment.azorProxyUrl + '/');
        const isAzorIntegrationError = isAzorProxyRequest && error.headers?.get('X-Azor-Proxy-Auth') !== 'denied';
        if (!req.url.endsWith('/session') && !req.url.endsWith('/login') && !isAzorIntegrationError) {
          authService.logout().subscribe({
            next: () => {
              router.navigate(['/login']);
            },
            error: () => {
              // Fallback en caso de fallo
              router.navigate(['/login']);
            }
          });
        }
      }
      return throwError(() => error);
    })
  );
};
