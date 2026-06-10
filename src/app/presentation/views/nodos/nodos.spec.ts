import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { of } from 'rxjs';

import { Nodos } from './nodos';
import { AppEnvironment } from '../../../core/config/app-environment';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('Nodos', () => {
  let component: Nodos;
  let fixture: ComponentFixture<Nodos>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    vi.stubGlobal('innerWidth', 1280); // 1080p -> limit is 15
    await TestBed.configureTestingModule({
      imports: [Nodos],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([])
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Nodos);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create and load initial hosts list', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    // 1. Mock the dynamic filter options endpoint
    const optionsReq = httpMock.expectOne(`${AppEnvironment.apiUrl}/hosts/filters/options`);
    expect(optionsReq.request.method).toBe('GET');
    optionsReq.flush({
      os: ['Linux', 'Windows'],
      arch: ['x86_64'],
      gpu: ['RTX 4090', 'A100 Tensor Core'],
      vram: ['24 GB', '80 GB'],
      version: ['1.4.2']
    });

    // Esperamos 50ms para permitir que el debounceTime(20) de la pipeline reactiva se ejecute y dispare la petición
    await wait(50);

    // 2. Mock the query hosts list endpoint
    const req = httpMock.expectOne(request => 
      request.url.startsWith(`${AppEnvironment.apiUrl}/hosts`) && 
      !request.url.includes('/filters/options')
    );
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('limit')).toBe('6');
    req.flush({
      items: [
        {
          host_id: '1',
          hostname: 'Test Host',
          ip_address: '192.168.1.10',
          version: '1.0.0',
          status: 'active',
          hw_info: null,
          gpu_info: null
        }
      ],
      total: 1
    });

    fixture.detectChanges();
    expect(component).toBeTruthy();
    expect(component.hosts().length).toBe(1);
    expect(component.hosts()[0].hostname).toBe('Test Host');
  });

  it('should initialize signals from query parameters on load', async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Nodos],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([])
      ]
    }).compileComponents();

    const localHttpMock = TestBed.inject(HttpTestingController);
    const router = TestBed.inject(Router);

    // Navegar para establecer los parámetros de consulta reales en el enrutador
    await router.navigate([], {
      queryParams: {
        page: '3',
        limit: '40',
        os: 'Linux',
        search: '192.168'
      }
    });

    const localFixture = TestBed.createComponent(Nodos);
    const localComponent = localFixture.componentInstance;
    localFixture.detectChanges();
    await localFixture.whenStable();

    const optionsReq = localHttpMock.expectOne(`${AppEnvironment.apiUrl}/hosts/filters/options`);
    optionsReq.flush({ os: ['Linux'], arch: [], gpu: [], vram: [], version: [] });

    await wait(50);

    const req = localHttpMock.expectOne(request => 
      request.url.startsWith(`${AppEnvironment.apiUrl}/hosts`) && 
      !request.url.includes('/filters/options')
    );
    expect(req.request.params.get('page')).toBe('3');
    expect(req.request.params.get('limit')).toBe('40');
    expect(req.request.params.get('os')).toBe('Linux');
    expect(req.request.params.get('search')).toBe('192.168');
    
    req.flush({ items: [], total: 0 });
    localFixture.detectChanges();

    expect(localComponent.currentPage()).toBe(3);
    expect(localComponent.limit()).toBe(40);
    expect(localComponent.filterOS()).toBe('Linux');
    expect(localComponent.searchControl.value).toBe('192.168');

    localHttpMock.verify();
  });

  it('should navigate and update URL query params when filters are applied', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    const optionsReq = httpMock.expectOne(`${AppEnvironment.apiUrl}/hosts/filters/options`);
    optionsReq.flush({ os: ['Linux'], arch: [], gpu: [], vram: [], version: [] });

    await wait(50);

    const req1 = httpMock.expectOne(request => 
      request.url.startsWith(`${AppEnvironment.apiUrl}/hosts`) && 
      !request.url.includes('/filters/options')
    );
    req1.flush({ items: [], total: 0 });

    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    component.tempFilterOS.set('Linux');
    component.applyFilters();

    await wait(50);

    expect(navigateSpy).toHaveBeenCalled();
    const callArgs = navigateSpy.mock.calls[0];
    expect(callArgs[1]?.queryParams?.['os']).toBe('Linux');

    const req2 = httpMock.expectOne(request => 
      request.url.startsWith(`${AppEnvironment.apiUrl}/hosts`) && 
      !request.url.includes('/filters/options')
    );
    expect(req2.request.params.get('os')).toBe('Linux');
    req2.flush({ items: [], total: 0 });
  });
});
