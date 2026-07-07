import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { authGuard } from './auth.guard';
import { AuthService } from '../../core/services/auth.service';
import { PermissionsService } from '../../core/services/permissions.service';
import { vi } from 'vitest';

describe('authGuard', () => {
  let routerMock: { navigate: any };
  let authServiceMock: any;
  let permissionsServiceMock: any;

  beforeEach(() => {
    routerMock = {
      navigate: vi.fn()
    };
    
    authServiceMock = {
      currentUser: signal<any>(null),
      isAuthenticated: signal(false)
    };

    permissionsServiceMock = {
      activePermissionCodes: signal(new Set<string>())
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Router, useValue: routerMock },
        { provide: AuthService, useValue: authServiceMock },
        { provide: PermissionsService, useValue: permissionsServiceMock }
      ]
    });
  });

  it('should navigate to login and return false if not authenticated', () => {
    authServiceMock.isAuthenticated.set(false);

    const result = TestBed.runInInjectionContext(() => 
      authGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );

    expect(result).toBe(false);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('should return true if authenticated and no permission is required', () => {
    authServiceMock.isAuthenticated.set(true);

    const result = TestBed.runInInjectionContext(() => 
      authGuard({ data: {} } as any, {} as RouterStateSnapshot)
    );

    expect(result).toBe(true);
  });

  it('should return true if authenticated and user has required permission', () => {
    authServiceMock.isAuthenticated.set(true);
    // Usuario con permiso users.read
    permissionsServiceMock.activePermissionCodes.set(new Set(['users.read', 'roles.create']));

    const result = TestBed.runInInjectionContext(() => 
      authGuard({ data: { permissions: ['users.read'] } } as any, {} as RouterStateSnapshot)
    );

    expect(result).toBe(true);
  });

  it('should navigate to dashboard and return false if user lacks required permission', () => {
    authServiceMock.isAuthenticated.set(true);
    // Usuario sin permiso users.read (ej: rol básico)
    permissionsServiceMock.activePermissionCodes.set(new Set(['cameras.read']));

    const result = TestBed.runInInjectionContext(() => 
      authGuard({ data: { permissions: ['users.read'] } } as any, {} as RouterStateSnapshot)
    );

    expect(result).toBe(false);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('should allow access if all required permissions are present', () => {
    authServiceMock.isAuthenticated.set(true);
    permissionsServiceMock.activePermissionCodes.set(new Set(['users.read', 'users.create', 'roles.create']));

    const result = TestBed.runInInjectionContext(() => 
      authGuard({ data: { permissions: ['users.read', 'users.create'] } } as any, {} as RouterStateSnapshot)
    );

    expect(result).toBe(true);
  });
});
