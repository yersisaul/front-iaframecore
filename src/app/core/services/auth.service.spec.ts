import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { AppRole } from '../domain/entities/role.enum';
import { AppEnvironment } from '../config/app-environment';
import { LoginRequestDTO } from '../../data/repositories/dtos/login-request.dto';
import { AuthResponseDTO } from '../../data/repositories/dtos/auth-response.dto';
import { ApiKeyConfig } from '../config/api-key.config';
import { IAuthRepository } from '../domain/repositories/auth.repository';
import { AuthHttpRepository } from '../../data/repositories/auth-http.repository';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  const mockAuthResponse: AuthResponseDTO = {
    access_token: 'mock-jwt-token-xyz',
    token_type: 'bearer',
    usuario: 'testadmin',
    rol: 'ADMIN'
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AuthService,
        { provide: IAuthRepository, useClass: AuthHttpRepository }
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
    sessionStorage.clear();
    ApiKeyConfig.apiKey = 'REPLACE_WITH_YOUR_JWT_API_KEY';
  });

  afterEach(() => {
    httpMock.verify();
    sessionStorage.clear();
  });

  it('should be created and have initial null state', () => {
    expect(service).toBeTruthy();
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.isAdmin()).toBe(false);
  });

  describe('login', () => {
    it('should authenticate user, store token and update signals on success', () => {
      const credentials: LoginRequestDTO = { username: 'testadmin', contrasena: 'secret' };

      service.login(credentials).subscribe(user => {
        expect(user).toBeTruthy();
        expect(user.username).toBe('testadmin');
        expect(user.role).toBe(AppRole.ADMIN);
        
        expect(service.currentUser()).toEqual(user);
        expect(service.isAuthenticated()).toBe(true);
        expect(service.isAdmin()).toBe(true);

        expect(sessionStorage.getItem('auth_token')).toBe('mock-jwt-token-xyz');
        expect(sessionStorage.getItem('auth_user')).toContain('testadmin');
      });

      const req = httpMock.expectOne(`${AppEnvironment.apiUrl}/auth/login`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ usuario: 'testadmin', password: 'secret' });
      req.flush(mockAuthResponse);
    });

    it('should clear local storage, user signal and throw error on failed login', () => {
      const credentials: LoginRequestDTO = { username: 'testadmin', contrasena: 'wrong' };

      service.login(credentials).subscribe({
        next: () => expect.fail('should have failed'),
        error: (err) => {
          expect(err).toBeTruthy();
          expect(service.currentUser()).toBeNull();
          expect(service.isAuthenticated()).toBe(false);
          expect(sessionStorage.getItem('auth_token')).toBeNull();
        }
      });

      const req = httpMock.expectOne(`${AppEnvironment.apiUrl}/auth/login`);
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('logout', () => {
    it('should clear user signal and remove token from local storage', () => {
      sessionStorage.setItem('auth_token', 'token');
      sessionStorage.setItem('auth_user', JSON.stringify({ username: 'user' }));
      service.currentUser.set({
        id: 'testadmin',
        username: 'testadmin',
        name: 'Test Admin',
        role: AppRole.ADMIN,
        createdAt: new Date()
      });

      service.logout().subscribe(() => {
        expect(service.currentUser()).toBeNull();
        expect(service.isAuthenticated()).toBe(false);
        expect(sessionStorage.getItem('auth_token')).toBeNull();
        expect(sessionStorage.getItem('auth_user')).toBeNull();
      });
    });
  });

  describe('checkSession', () => {
    it('should restore user state from local storage if data exists', () => {
      const userDate = new Date();
      sessionStorage.setItem('auth_token', 'mock-jwt-token-xyz');
      sessionStorage.setItem('auth_user', JSON.stringify({
        id: 'testadmin',
        username: 'testadmin',
        name: 'Test Admin',
        role: AppRole.ADMIN,
        createdAt: userDate.toISOString()
      }));

      service.checkSession().subscribe(user => {
        expect(user).toBeTruthy();
        expect(user?.username).toBe('testadmin');
        expect(user?.role).toBe(AppRole.ADMIN);
        expect(service.currentUser()).toEqual(user);
        expect(service.isAuthenticated()).toBe(true);
      });
    });

    it('should return null and clear user state if no data exists in local storage', () => {
      service.checkSession().subscribe(user => {
        expect(user).toBeNull();
        expect(service.currentUser()).toBeNull();
        expect(service.isAuthenticated()).toBe(false);
      });
    });
  });
});
