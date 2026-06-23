import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { of, throwError } from 'rxjs';

import { Nodos } from './nodos';
import { AppEnvironment } from '../../../core/config/app-environment';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const MOCK_HOSTS = [
  {
    host_id: '1', fingerprint: 'FP-LINUX-1', hostname: 'linux-server-01',
    ip_address: '192.168.1.10', version: '1.4.2', status: 'online',
    hw_info: { machine_id: 'mid1', mac: '00:00:00:01', system: 'Linux', release: '5.4', arch: 'x86_64' },
    gpu_info: { GPU: 'NVIDIA RTX 4090', model: 'RTX 4090', total_memory: '24 GB', compute_capability: '8.9' }
  },
  {
    host_id: '2', fingerprint: 'FP-WIN-1', hostname: 'windows-server-02',
    ip_address: '10.0.0.5', version: '1.3.0', status: 'offline',
    hw_info: { machine_id: 'mid2', mac: '00:00:00:02', system: 'Windows', release: '10', arch: 'x86_64' },
    gpu_info: null
  }
];

import { IHostRepository } from '../../../core/domain/repositories/host.repository';
import { HostHttpRepository } from '../../../data/repositories/host-http.repository';
import { HostService } from '../../../core/services/host.service';

describe('Nodos', () => {
  let component: Nodos;
  let fixture: ComponentFixture<Nodos>;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    vi.stubGlobal('innerWidth', 1280);
    await TestBed.configureTestingModule({
      imports: [Nodos],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: IHostRepository, useClass: HostHttpRepository }
      ]
    }).compileComponents();

    httpMock = TestBed.inject(HttpTestingController);

    // Mock getHeartbeat to prevent HTTP requests for tests
    const hostService = TestBed.inject(HostService);
    vi.spyOn(hostService, 'getHeartbeat').mockImplementation((fp: string) => {
      if (fp === 'FP-WIN-1') {
        return throwError(() => new Error('Host offline'));
      }
      const now = new Date();
      return of({
        lastSeen: now,
        cpu: 15.7,
        gpu: 0,
        vram: 66.4,
        memory: 96.1,
        serverTime: now
      });
    });

    fixture = TestBed.createComponent(Nodos);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    httpMock.verify();
  });

  /** Flush the single loadAllHosts() request */
  function flushHosts(items = MOCK_HOSTS) {
    const req = httpMock.expectOne(r =>
      r.url.includes('/frontend/hosts/') && r.params.get('limit') === '1000'
    );
    expect(req.request.method).toBe('GET');
    req.flush({ items, total: items.length });
  }

  it('should create and load all hosts via loadAllHosts()', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    flushHosts();

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component).toBeTruthy();
    // Both hosts loaded
    expect(component.filteredHosts().length).toBe(2);
    expect(component.filteredHosts()[0].hostname).toBe('linux-server-01');
    expect(component.filteredHosts()[1].hostname).toBe('windows-server-02');
  });

  it('should filter hosts by search term (hostname)', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    flushHosts();
    fixture.detectChanges();

    // Search for 'linux'
    component.searchControl.setValue('linux');
    component.searchTerm.set('linux');

    expect(component.filteredHosts().length).toBe(1);
    expect(component.filteredHosts()[0].hostname).toBe('linux-server-01');

    // Search for IP
    component.searchControl.setValue('10.0.0');
    component.searchTerm.set('10.0.0');
    expect(component.filteredHosts().length).toBe(1);
    expect(component.filteredHosts()[0].hostname).toBe('windows-server-02');

    // Clear search
    component.searchControl.setValue('');
    component.searchTerm.set('');
    expect(component.filteredHosts().length).toBe(2);
  });

  it('should filter hosts by status', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    flushHosts();
    fixture.detectChanges();

    // Only online
    component.filterStatus.set('active');
    expect(component.filteredHosts().length).toBe(1);
    expect(component.filteredHosts()[0].hostname).toBe('linux-server-01');

    // Only offline
    component.filterStatus.set('inactive');
    expect(component.filteredHosts().length).toBe(1);
    expect(component.filteredHosts()[0].hostname).toBe('windows-server-02');

    // All
    component.filterStatus.set('all');
    expect(component.filteredHosts().length).toBe(2);
  });

  it('should filter hosts by OS', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    flushHosts();
    fixture.detectChanges();

    component.filterOS.set('Linux');
    expect(component.filteredHosts().length).toBe(1);
    expect(component.filteredHosts()[0].hwInfo?.system).toBe('Linux');

    component.filterOS.set('Windows');
    expect(component.filteredHosts().length).toBe(1);
    expect(component.filteredHosts()[0].hwInfo?.system).toBe('Windows');

    component.filterOS.set('all');
    expect(component.filteredHosts().length).toBe(2);
  });

  it('should apply multiple filters simultaneously', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    flushHosts();
    fixture.detectChanges();

    // Linux + online = 1 host
    component.filterOS.set('Linux');
    component.filterStatus.set('active');
    expect(component.filteredHosts().length).toBe(1);

    // Linux + offline = 0 hosts
    component.filterStatus.set('inactive');
    expect(component.filteredHosts().length).toBe(0);
  });

  it('should paginate filtered results client-side', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    flushHosts();
    fixture.detectChanges();

    component.limit.set(1);
    component.currentPage.set(1);

    expect(component.totalPages()).toBe(2);
    expect(component.pagedHosts().length).toBe(1);
    expect(component.pagedHosts()[0].hostname).toBe('linux-server-01');

    component.nextPage();
    expect(component.pagedHosts()[0].hostname).toBe('windows-server-02');
  });

  it('should resetFilters to clear all active filters', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    flushHosts();
    fixture.detectChanges();

    component.filterOS.set('Linux');
    component.filterStatus.set('active');
    component.searchTerm.set('linux');
    expect(component.hasActiveFilters()).toBe(true);

    component.resetFilters();
    expect(component.filterOS()).toBe('all');
    expect(component.filterStatus()).toBe('all');
    expect(component.searchTerm()).toBe('');
    expect(component.hasActiveFilters()).toBe(false);
    expect(component.filteredHosts().length).toBe(2);
  });

  it('should build filter options from loaded host data', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    flushHosts();
    fixture.detectChanges();
    await fixture.whenStable();

    const opts = component.filterOptions();
    expect(opts).not.toBeNull();
    expect(opts?.os).toContain('Linux');
    expect(opts?.os).toContain('Windows');
    expect(opts?.gpu).toContain('RTX 4090');
  });

  it('should calculate visiblePages correctly and support page jumping', async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    flushHosts();
    fixture.detectChanges();

    component.limit.set(1);
    expect(component.totalPages()).toBe(2);
    expect(component.visiblePages()).toEqual([1, 2]);

    // Test onPageInput sanitization
    const mockInput = { target: { value: 'abc12' } } as any;
    component.onPageInput(mockInput);
    expect(mockInput.target.value).toBe('12');

    // Test jumpToPage navigation
    const mockJumpInput = { target: { value: '2' } } as any;
    component.jumpToPage(mockJumpInput);
    expect(component.currentPage()).toBe(2);
    expect(mockJumpInput.target.value).toBe('');
  });
});
