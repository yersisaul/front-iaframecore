import { Injectable, signal, computed, inject, Injector } from '@angular/core';
import { Observable, throwError, of } from 'rxjs';
import { tap, map, catchError, switchMap } from 'rxjs/operators';
import { User } from '../domain/entities/user.entity';
import { LoginRequestDTO } from '../../data/repositories/dtos/login-request.dto';
import { IAuthRepository } from '../domain/repositories/auth.repository';
import { AppEnvironment } from '../config/app-environment';
import { PermissionsService } from './permissions.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private injector = inject(Injector);

  private get permissionsService(): PermissionsService {
    return this.injector.get(PermissionsService);
  }

  // Signals de estado
  readonly currentUser = signal<User | null>(null);

  // Signals computados derivados
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  // isAdmin: verdadero si el usuario tiene el permiso exclusivo de administración (roles.create)
  readonly isAdmin = computed(() =>
    this.permissionsService.activePermissionCodes().has('roles.create')
  );

  constructor(private authRepository: IAuthRepository) { }

  login(credentials: LoginRequestDTO): Observable<User> {
    return this.authRepository.login(credentials.email, credentials.password).pipe(
      switchMap(res => {
        sessionStorage.setItem('auth_token', res.accessToken);
        sessionStorage.setItem('auth_user', JSON.stringify({
          id: res.user.id,
          email: res.user.email,
          name: res.user.name,
          role: res.user.role,
          roleId: res.user.roleId || '',
          createdAt: res.user.createdAt.toISOString()
        }));
        
        // Establecer el usuario actual en la señal antes de cargar los permisos
        // para que loadUserPermissions() pueda encontrarlo y actualizar su rol.
        this.currentUser.set(res.user);
        
        const roleId = res.user.roleId || '';
        return this.permissionsService.loadUserPermissions(roleId).pipe(
          map(() => this.currentUser()!)
        );
      }),
      tap(user => {
        this.currentUser.set(user);
      }),
      catchError(err => {
        sessionStorage.removeItem('auth_token');
        sessionStorage.removeItem('auth_user');
        this.permissionsService.clearPermissions();
        this.currentUser.set(null);
        return throwError(() => err);
      })
    );
  }

  logout(): Observable<void> {
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    this.permissionsService.clearPermissions();
    this.currentUser.set(null);
    return of(undefined);
  }

  checkSession(): Observable<User | null> {
    // 1. Priorizar la sesión dinámica activa en sessionStorage
    try {
      const token = sessionStorage.getItem('auth_token');
      const userJson = sessionStorage.getItem('auth_user');
      if (token && userJson) {
        const parsed = JSON.parse(userJson);
        const user: User = {
          id: parsed.id,
          email: parsed.email,
          name: parsed.name,
          role: parsed.role,
          roleId: parsed.roleId,
          createdAt: new Date(parsed.createdAt)
        };
        this.currentUser.set(user);
        return of(user);
      }
    } catch (e) {
      // Ignorar errores de parseo y limpiar
      sessionStorage.removeItem('auth_token');
      sessionStorage.removeItem('auth_user');
    }

    this.currentUser.set(null);
    return of(null);
  }
}
