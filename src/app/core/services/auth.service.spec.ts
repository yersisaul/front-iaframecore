import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
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
    usuario: 'testadmin@iaframecore.com',
    rol_id: '73bd9b9e-53da-4901-8bd8-9a127081e61b'
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
      const credentials: LoginRequestDTO = { email: 'testadmin@iaframecore.com', password: 'secret' };

      service.login(credentials).subscribe(user => {
        expect(user).toBeTruthy();
        expect(user.email).toBe('testadmin@iaframecore.com');
        expect(service.currentUser()).toEqual(user);
        expect(service.isAuthenticated()).toBe(true);
        // isAdmin ahora depende del permiso 'roles.create' que fue cargado desde el backend

        expect(sessionStorage.getItem('auth_token')).toBe('mock-jwt-token-xyz');
        expect(sessionStorage.getItem('auth_user')).toContain('testadmin@iaframecore.com');
      });

      const req = httpMock.expectOne(`${AppEnvironment.apiUrl}/auth/login`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'testadmin@iaframecore.com', password: 'secret' });
      req.flush(mockAuthResponse);

      const rolesReq = httpMock.expectOne(`${AppEnvironment.apiUrl}/frontend/roles/`);
      expect(rolesReq.request.method).toBe('GET');
      rolesReq.flush([
        { rol_id: '73bd9b9e-53da-4901-8bd8-9a127081e61b', nombre: 'ADMIN', descripcion: 'Admin role', id_permisos: ['p1'] }
      ]);

      const permissionsReq = httpMock.expectOne(`${AppEnvironment.apiUrl}/frontend/permisos/`);
      expect(permissionsReq.request.method).toBe('GET');
      permissionsReq.flush([
        { permiso_id: 'p1', codigo: 'roles.create', descripcion: 'Crear roles' }
      ]);
    });

    it('should clear local storage, user signal and throw error on failed login', () => {
      const credentials: LoginRequestDTO = { email: 'testadmin@iaframecore.com', password: 'wrong' };

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
      sessionStorage.setItem('auth_user', JSON.stringify({ email: 'user@iaframecore.com' }));
      service.currentUser.set({
        id: 'testadmin',
        email: 'testadmin@iaframecore.com',
        name: 'Test Admin',
        role: 'ADMIN',
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
      sessionStorage.setItem('mock-jwt-token-xyz', 'mock-jwt-token-xyz'); // Wait, checkSession uses sessionStorage auth_token
      sessionStorage.setItem('auth_token', 'mock-jwt-token-xyz');
      sessionStorage.setItem('auth_user', JSON.stringify({
        id: 'testadmin',
        email: 'testadmin@iaframecore.com',
        name: 'Test Admin',
        role: 'ADMIN',
        createdAt: userDate.toISOString()
      }));

      service.checkSession().subscribe(user => {
        expect(user).toBeTruthy();
        expect(user?.email).toBe('testadmin@iaframecore.com');
        expect(user?.role).toBe('ADMIN');
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
