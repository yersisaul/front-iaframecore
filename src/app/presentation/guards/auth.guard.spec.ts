import { TestBed } from '@angular/core/testing';
import { Router, ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { authGuard } from './auth.guard';
import { AuthService } from '../../core/services/auth.service';
import { AppRole } from '../../core/domain/entities/role.enum';
import { vi } from 'vitest';

describe('authGuard', () => {
  let routerMock: { navigate: any };
  let authServiceMock: any;

  beforeEach(() => {
    routerMock = {
      navigate: vi.fn()
    };
    
    authServiceMock = {
      currentUser: signal<any>(null),
      isAuthenticated: signal(false),
      isAdmin: signal(false)
    };

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: Router, useValue: routerMock },
        { provide: AuthService, useValue: authServiceMock }
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

  it('should return true if authenticated and no role is required', () => {
    authServiceMock.isAuthenticated.set(true);

    const result = TestBed.runInInjectionContext(() => 
      authGuard({ data: {} } as any, {} as RouterStateSnapshot)
    );

    expect(result).toBe(true);
  });

  it('should return true if authenticated and user role matches required roles', () => {
    authServiceMock.isAuthenticated.set(true);
    authServiceMock.currentUser.set({ role: AppRole.ADMIN });

    const result = TestBed.runInInjectionContext(() => 
      authGuard({ data: { roles: [AppRole.ADMIN] } } as any, {} as RouterStateSnapshot)
    );

    expect(result).toBe(true);
  });

  it('should navigate to dashboard and return false if role does not match', () => {
    authServiceMock.isAuthenticated.set(true);
    authServiceMock.currentUser.set({ role: AppRole.OPERATOR });

    const result = TestBed.runInInjectionContext(() => 
      authGuard({ data: { roles: [AppRole.ADMIN] } } as any, {} as RouterStateSnapshot)
    );

    expect(result).toBe(false);
    expect(routerMock.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});

