import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { errorInterceptor } from './error.interceptor';
import { AuthService } from '../services/auth.service';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import { of } from 'rxjs';

describe('errorInterceptor', () => {
  let httpClient: HttpClient;
  let httpTestingController: HttpTestingController;
  let routerMock: any;
  let authServiceMock: any;

  beforeEach(() => {
    routerMock = {
      navigate: vi.fn()
    };

    const currentUserSignal = signal<any>({ email: 'testuser@iaframecore.com' });
    authServiceMock = {
      currentUser: currentUserSignal,
      logout: () => {
        currentUserSignal.set(null);
        return of(undefined);
      }
    };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
        { provide: Router, useValue: routerMock },
        { provide: AuthService, useValue: authServiceMock }
      ]
    });

    httpClient = TestBed.inject(HttpClient);
    httpTestingController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should redirect to /login and clear session on 401 error', () => {
    httpClient.get('/api/users').subscribe({
      next: () => expect.fail('should have failed'),
      error: (err) => {
        expect(err.status).toBe(401);
        expect(authServiceMock.currentUser()).toBeNull();
        expect(routerMock.navigate).toHaveBeenCalledWith(['/login']);
      }
    });

    const req = httpTestingController.expectOne('/api/users');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
  });

  it('should not redirect to /login on 401 error from session validation endpoint', () => {
    httpClient.get('/api/auth/session').subscribe({
      next: () => expect.fail('should have failed'),
      error: (err) => {
        expect(err.status).toBe(401);
        expect(authServiceMock.currentUser()).not.toBeNull();
        expect(routerMock.navigate).not.toHaveBeenCalled();
      }
    });

    const req = httpTestingController.expectOne('/api/auth/session');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
  });

  it('should not redirect to /login on 401 error from login endpoint', () => {
    httpClient.post('/api/auth/login', {}).subscribe({
      next: () => expect.fail('should have failed'),
      error: (err) => {
        expect(err.status).toBe(401);
        expect(authServiceMock.currentUser()).not.toBeNull();
        expect(routerMock.navigate).not.toHaveBeenCalled();
      }
    });

    const req = httpTestingController.expectOne('/api/auth/login');
    req.flush('Unauthorized', { status: 401, statusText: 'Unauthorized' });
  });

  it('should let other errors pass through without redirecting', () => {
    httpClient.get('/api/users').subscribe({
      next: () => expect.fail('should have failed'),
      error: (err) => {
        expect(err.status).toBe(500);
        expect(authServiceMock.currentUser()).not.toBeNull();
        expect(routerMock.navigate).not.toHaveBeenCalled();
      }
    });

    const req = httpTestingController.expectOne('/api/users');
    req.flush('Server Error', { status: 500, statusText: 'Internal Server Error' });
  });
});
