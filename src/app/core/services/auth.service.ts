import { Injectable, signal, computed } from '@angular/core';
import { Observable, throwError, of } from 'rxjs';
import { tap, map, catchError } from 'rxjs/operators';
import { User } from '../domain/entities/user.entity';
import { AppRole } from '../domain/entities/role.enum';
import { LoginRequestDTO } from '../../data/repositories/dtos/login-request.dto';
import { ApiKeyConfig } from '../config/api-key.config';
import { IAuthRepository } from '../domain/repositories/auth.repository';
import { AppEnvironment } from '../config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  // Signals de estado
  readonly currentUser = signal<User | null>(null);

  // Signals computados derivados
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly isAdmin = computed(() => this.currentUser()?.role === AppRole.ADMIN);

  constructor(private authRepository: IAuthRepository) { }

  login(credentials: LoginRequestDTO): Observable<User> {
    return this.authRepository.login(credentials.username, credentials.contrasena).pipe(
      map(res => {
        sessionStorage.setItem('auth_token', res.accessToken);
        sessionStorage.setItem('auth_user', JSON.stringify({
          id: res.user.id,
          username: res.user.username,
          name: res.user.name,
          role: res.user.role,
          createdAt: res.user.createdAt.toISOString()
        }));
        return res.user;
      }),
      tap(user => {
        this.currentUser.set(user);
      }),
      catchError(err => {
        sessionStorage.removeItem('auth_token');
        sessionStorage.removeItem('auth_user');
        this.currentUser.set(null);
        return throwError(() => err);
      })
    );
  }

  logout(): Observable<void> {
    sessionStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_user');
    this.currentUser.set(null);
    return of(undefined);
  }

  checkSession(): Observable<User | null> {
    // 1. Priorizar la sesión dinámica activa en localStorage
    try {
      const token = sessionStorage.getItem('auth_token');
      const userJson = sessionStorage.getItem('auth_user');
      if (token && userJson) {
        const parsed = JSON.parse(userJson);
        const user: User = {
          id: parsed.id,
          username: parsed.username,
          name: parsed.name,
          role: parsed.role,
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

    // 2. Si no hay sesión activa en localStorage, verificar si hay una clave estática configurada en api-key.config.ts
    const isDevMode = !AppEnvironment.production;
    const configKey = ApiKeyConfig?.apiKey;
    const hasConfigKey = isDevMode &&
      configKey &&
      configKey !== 'REPLACE_WITH_YOUR_JWT_API_KEY' &&
      configKey !== 'INSERTAR_AQUI_TU_JWT_API_KEY' &&
      configKey.trim() !== '';

    if (hasConfigKey) {
      const staticUser: User = {
        id: 'api_key_user',
        username: 'apikeyuser',
        name: 'API Key User',
        role: AppRole.ADMIN,
        createdAt: new Date()
      };
      this.currentUser.set(staticUser);
      return of(staticUser);
    }

    this.currentUser.set(null);
    return of(null);
  }
}


