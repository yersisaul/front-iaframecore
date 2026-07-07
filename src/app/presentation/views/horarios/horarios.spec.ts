import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { Horarios } from './horarios';
import { HostService } from '../../../core/services/host.service';
import { AppEnvironment } from '../../../core/config/app-environment';

import { signal } from '@angular/core';
import { PermissionsService } from '../../../core/services/permissions.service';
import { IHostRepository } from '../../../core/domain/repositories/host.repository';
import { HostHttpRepository } from '../../../data/repositories/host-http.repository';
import { IScheduleRepository } from '../../../core/domain/repositories/schedule.repository';
import { ScheduleHttpRepository } from '../../../data/repositories/schedule-http.repository';

import { ICameraRepository } from '../../../core/domain/repositories/camera.repository';
import { CameraHttpRepository } from '../../../data/repositories/camera-http.repository';
import { IAnalyticRepository } from '../../../core/domain/repositories/analytic.repository';
import { AnalyticHttpRepository } from '../../../data/repositories/analytic-http.repository';

import { of } from 'rxjs';

class MockHostRepository {
  getAll() { return of([]); }
}
class MockCameraRepository {
  getAll() { return of([]); }
  getByHost() { return of([]); }
}
class MockAnalyticRepository {
  getAll() { return of([]); }
  getByHost() { return of([]); }
}

describe('Horarios', () => {
  let component: Horarios;
  let fixture: ComponentFixture<Horarios>;
  let hostService: HostService;
  let httpMock: HttpTestingController;

  const mockPermissionsService = {
    permissionsMatrix: signal({}),
    hasPermission: (module: string, action: string) => true,
    updatePermission: (role: string, module: string, action: string, value: boolean) => {},
    resetPermissions: () => {}
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Horarios],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: IHostRepository, useClass: MockHostRepository },
        { provide: ICameraRepository, useClass: MockCameraRepository },
        { provide: IAnalyticRepository, useClass: MockAnalyticRepository },
        { provide: IScheduleRepository, useClass: ScheduleHttpRepository },
        { provide: PermissionsService, useValue: mockPermissionsService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Horarios);
    component = fixture.componentInstance;
    hostService = TestBed.inject(HostService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create, load all schedules at once, and filter list', async () => {
    fixture.detectChanges();

    // Horarios now calls getAllSchedules() -> single GET /frontend/schedules/
    const reqSched = httpMock.expectOne(`${AppEnvironment.apiUrl}/frontend/schedules/`);
    expect(reqSched.request.method).toBe('GET');
    reqSched.flush([
      {
        schedule_id: 'sched-1',
        nombre: 'Horario de Oficina',
        fingerprint_host: 'HOST-ABC123XYZ',
        analytics_ids: [{ id_analytic: 'analytic-1' }],
        timestamp_inicio: '2026-06-10T08:00:00.000Z',
        timestamp_fin: '2026-06-10T18:00:00.000Z',
        frecuencia: 'diario',
        estado: 'activo'
      }
    ]);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component).toBeTruthy();
    expect(component.allSchedules().length).toBe(1);
    expect(component.allSchedules()[0].name).toBe('Horario de Oficina');

    // Test filtering by host fingerprint (client-side filter)
    expect(component.filteredSchedules().length).toBe(1);
  });
});
