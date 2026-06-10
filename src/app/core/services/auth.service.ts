import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError, of, timeout } from 'rxjs';
import { tap, map, catchError } from 'rxjs/operators';
import { User } from '../domain/entities/user.entity';
import { AppRole } from '../domain/entities/role.enum';
import { AppEnvironment } from '../config/app-environment';
import { LoginRequestDTO } from '../../data/repositories/dtos/login-request.dto';
import { AuthResponseDTO } from '../../data/repositories/dtos/auth-response.dto';
import { UserMapper } from '../../data/mappers/user.mapper';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/auth`;

  // Signals de estado
  readonly currentUser = signal<User | null>(null);

  // Signals computados derivados
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly isAdmin = computed(() => this.currentUser()?.role === AppRole.ADMIN);

  constructor(private http: HttpClient) {}

  login(credentials: LoginRequestDTO): Observable<User> {
    return this.http.post<AuthResponseDTO>(`${this.apiUrl}/login`, credentials).pipe(
      map(response => UserMapper.toDomain(response.user)),
      tap(user => this.currentUser.set(user)),
      catchError(err => {
        this.currentUser.set(null);
        return throwError(() => err);
      })
    );
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/logout`, {}).pipe(
      tap(() => this.currentUser.set(null)),
      catchError(err => {
        this.currentUser.set(null);
        return throwError(() => err);
      })
    );
  }

  checkSession(): Observable<User | null> {
    return this.http.get<AuthResponseDTO>(`${this.apiUrl}/session`).pipe(
      timeout(5000),
      map(response => UserMapper.toDomain(response.user)),
      tap(user => this.currentUser.set(user)),
      catchError(() => {
        this.currentUser.set(null);
        return of(null);
      })
    );
  }
}


