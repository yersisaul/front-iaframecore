import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { authInterceptor } from './auth.interceptor';

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
  });

  afterEach(() => {
    httpTestingController.verify();
  });

  it('should attach withCredentials to api requests', () => {
    httpClient.get('/api/users').subscribe();

    const req = httpTestingController.expectOne('/api/users');
    expect(req.request.withCredentials).toBe(true);
    req.flush({});
  });

  it('should not attach withCredentials to other requests', () => {
    httpClient.get('/other/assets').subscribe();

    const req = httpTestingController.expectOne('/other/assets');
    expect(req.request.withCredentials).toBe(false);
    req.flush({});
  });

  it('should not leak credentials to third-party endpoints containing api in the path', () => {
    httpClient.get('https://external.com/api/data').subscribe();

    const req = httpTestingController.expectOne('https://external.com/api/data');
    expect(req.request.withCredentials).toBe(false);
    req.flush({});
  });
});
