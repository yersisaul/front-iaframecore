import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { AppRole } from '../domain/entities/role.enum';
import { AppEnvironment } from '../config/app-environment';
import { LoginRequestDTO } from '../../data/repositories/dtos/login-request.dto';
import { AuthResponseDTO } from '../../data/repositories/dtos/auth-response.dto';
import { UserDTO } from '../../data/repositories/dtos/user-dto';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  const mockUserDTO: UserDTO = {
    user_id: '123',
    usuario: 'testadmin',
    nombre: 'Test Admin',
    rol: AppRole.ADMIN,
    created_at: '2026-06-08T00:00:00.000Z'
  };

  const mockAuthResponse: AuthResponseDTO = {
    user: mockUserDTO
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AuthService
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should be created and have initial null state', () => {
    expect(service).toBeTruthy();
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.isAdmin()).toBe(false);
  });

  describe('login', () => {
    it('should authenticate user and update signals on success', () => {
      const credentials: LoginRequestDTO = { username: 'testadmin', contrasena: 'secret' };

      service.login(credentials).subscribe(user => {
        expect(user).toBeTruthy();
        expect(user.id).toBe('123');
        expect(user.role).toBe(AppRole.ADMIN);
        
        expect(service.currentUser()).toEqual(user);
        expect(service.isAuthenticated()).toBe(true);
        expect(service.isAdmin()).toBe(true);
      });

      const req = httpMock.expectOne(`${AppEnvironment.apiUrl}/auth/login`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(credentials);
      req.flush(mockAuthResponse);
    });

    it('should clear user signal and throw error on failed login', () => {
      const credentials: LoginRequestDTO = { username: 'testadmin', contrasena: 'wrong' };

      service.login(credentials).subscribe({
        next: () => expect.fail('should have failed'),
        error: (err) => {
          expect(err).toBeTruthy();
          expect(service.currentUser()).toBeNull();
          expect(service.isAuthenticated()).toBe(false);
        }
      });

      const req = httpMock.expectOne(`${AppEnvironment.apiUrl}/auth/login`);
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    });
  });

  describe('logout', () => {
    it('should clear user signal and call logout endpoint', () => {
      service.currentUser.set({
        id: '123',
        username: 'testadmin',
        name: 'Test Admin',
        role: AppRole.ADMIN,
        createdAt: new Date()
      });

      service.logout().subscribe(() => {
        expect(service.currentUser()).toBeNull();
        expect(service.isAuthenticated()).toBe(false);
      });

      const req = httpMock.expectOne(`${AppEnvironment.apiUrl}/auth/logout`);
      expect(req.request.method).toBe('POST');
      req.flush({});
    });
  });

  describe('checkSession', () => {
    it('should restore user state if session is valid', () => {
      service.checkSession().subscribe(user => {
        expect(user).toBeTruthy();
        expect(user?.id).toBe('123');
        expect(service.currentUser()).toEqual(user);
        expect(service.isAuthenticated()).toBe(true);
      });

      const req = httpMock.expectOne(`${AppEnvironment.apiUrl}/auth/session`);
      expect(req.request.method).toBe('GET');
      req.flush(mockAuthResponse);
    });

    it('should return null and clear user state if session check fails', () => {
      service.checkSession().subscribe(user => {
        expect(user).toBeNull();
        expect(service.currentUser()).toBeNull();
        expect(service.isAuthenticated()).toBe(false);
      });

      const req = httpMock.expectOne(`${AppEnvironment.apiUrl}/auth/session`);
      req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
    });
  });
});
