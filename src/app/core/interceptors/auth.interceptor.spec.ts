import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';
import { AppEnvironment } from '../config/app-environment';

describe('authInterceptor', () => {
  let httpClient: HttpClient;
  let httpTestingController: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting()
      ]
    });

    httpClient = TestBed.inject(HttpClient);
    httpTestingController = TestBed.inject(HttpTestingController);
    sessionStorage.clear();
    // Reset AppEnvironment.apiKey to ensure test isolation
    AppEnvironment.apiKey = 'REPLACE_WITH_YOUR_JWT_API_KEY';
  });

  afterEach(() => {
    httpTestingController.verify();
    sessionStorage.clear();
  });

  it('should attach Authorization header to api requests when token exists', () => {
    sessionStorage.setItem('auth_token', 'test-token-123');
    httpClient.get('/api/users').subscribe();

    const req = httpTestingController.expectOne('/api/users');
    expect(req.request.headers.has('Authorization')).toBe(true);
    expect(req.request.headers.get('Authorization')).toBe('Bearer test-token-123');
    req.flush({});
  });

  it('should not attach Authorization header to non-api requests', () => {
    sessionStorage.setItem('auth_token', 'test-token-123');
    httpClient.get('/other/assets').subscribe();

    const req = httpTestingController.expectOne('/other/assets');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('should not attach Authorization header if no token exists', () => {
    httpClient.get('/api/users').subscribe();

    const req = httpTestingController.expectOne('/api/users');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('should prioritize token from localStorage over AppEnvironment.apiKey', () => {
    AppEnvironment.apiKey = 'config-jwt-token';
    sessionStorage.setItem('auth_token', 'local-token');
    httpClient.get('/api/users').subscribe();

    const req = httpTestingController.expectOne('/api/users');
    expect(req.request.headers.has('Authorization')).toBe(true);
    expect(req.request.headers.get('Authorization')).toBe('Bearer local-token');
    req.flush({});
  });
});
