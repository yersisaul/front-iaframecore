import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const authService = inject(AuthService);

  return next(req).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401) {
        // Ignoramos la validación inicial de sesión y el login para evitar redirecciones infinitas o flujos truncados
        if (!req.url.endsWith('/session') && !req.url.endsWith('/login')) {
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
