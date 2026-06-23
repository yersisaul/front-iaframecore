import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { Camaras } from './camaras';
import { CameraService } from '../../../core/services/camera.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { AnalyticService } from '../../../core/services/analytic.service';
import { Schedule } from '../../../core/domain/entities/schedule.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { Camera } from '../../../core/domain/entities/camera.models';
import { AppEnvironment } from '../../../core/config/app-environment';

import { ICameraRepository } from '../../../core/domain/repositories/camera.repository';
import { CameraHttpRepository } from '../../../data/repositories/camera-http.repository';
import { IScheduleRepository } from '../../../core/domain/repositories/schedule.repository';
import { ScheduleHttpRepository } from '../../../data/repositories/schedule-http.repository';
import { IAnalyticRepository } from '../../../core/domain/repositories/analytic.repository';
import { AnalyticHttpRepository } from '../../../data/repositories/analytic-http.repository';
import { IListRepository } from '../../../core/domain/repositories/list.repository';
import { ListHttpRepository } from '../../../data/repositories/list-http.repository';
import { IStorageRepository } from '../../../core/domain/repositories/storage.repository';
import { StorageHttpRepository } from '../../../data/repositories/storage-http.repository';
import { IHostRepository } from '../../../core/domain/repositories/host.repository';
import { HostHttpRepository } from '../../../data/repositories/host-http.repository';

describe('Camaras', () => {
  let component: Camaras;
  let fixture: ComponentFixture<Camaras>;
  let cameraService: CameraService;
  let scheduleService: ScheduleService;
  let analyticService: AnalyticService;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Camaras],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ICameraRepository, useClass: CameraHttpRepository },
        { provide: IScheduleRepository, useClass: ScheduleHttpRepository },
        { provide: IAnalyticRepository, useClass: AnalyticHttpRepository },
        { provide: IListRepository, useClass: ListHttpRepository },
        { provide: IStorageRepository, useClass: StorageHttpRepository },
        { provide: IHostRepository, useClass: HostHttpRepository },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: {
                get: (key: string) => key === 'hostId' ? 'HOST-ABC123XYZ' : null
              },
              queryParams: {}
            }
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Camaras);
    component = fixture.componentInstance;
    cameraService = TestBed.inject(CameraService);
    scheduleService = TestBed.inject(ScheduleService);
    analyticService = TestBed.inject(AnalyticService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should create, load cameras, schedules and analytics', async () => {
    fixture.detectChanges();

    // Expect Host request from ngOnInit
    const reqHosts = httpMock.expectOne(`${AppEnvironment.apiUrl}/frontend/hosts/?page=1&limit=1000`);
    expect(reqHosts.request.method).toBe('GET');
    reqHosts.flush({
      items: [
        {
          host_id: 'host-1',
          fingerprint: 'HOST-ABC123XYZ',
          hostname: 'Server 1',
          ip_address: '192.168.1.100',
          version: '1.0.0',
          hw_info: {},
          gpu_info: null,
          license: {
            features: {
              'Aglomeracion': 30,
              'Analisis de trafico': 30
            }
          }
        }
      ],
      total: 1
    });

    // Expect Camera request
    const reqCam = httpMock.expectOne(`${AppEnvironment.apiUrl}/frontend/cameras/HOST-ABC123XYZ`);
    expect(reqCam.request.method).toBe('GET');
    reqCam.flush([
      {
        camera_id: 'cam-1',
        camera_name: 'Main Camera',
        fingerprint_host: 'HOST-ABC123XYZ',
        stream_type: 'rtsp',
        status: 'online',
        decoder: 'opencv',
        location: { lat: 10.0, lon: 20.0 },
        created_at: '2026-06-10T12:00:00Z'
      }
    ]);

    // Expect ALL Schedules request (GET /frontend/schedules/)
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

    // Expect Analytics request
    const reqAnalytics = httpMock.expectOne(`${AppEnvironment.apiUrl}/frontend/analytics/HOST-ABC123XYZ`);
    expect(reqAnalytics.request.method).toBe('GET');
    reqAnalytics.flush([
      {
        analytic_id: 'analytic-1',
        fingerprint_host: 'HOST-ABC123XYZ',
        analytic_type: 'object_detection',
        analytic_status: 'active',
        target_cameras: [{ camera_id: 'cam-1', camera_name: 'Main Camera' }],
        detection_classes: [{ class_index: 0, class_name: 'person' }],
        parameters: {},
        geometric_objects: {},
        acciones: {}
      }
    ]);

    fixture.detectChanges();
    await fixture.whenStable();

    expect(component).toBeTruthy();
    expect(component.cameras().length).toBe(1);
    expect(component.cameras()[0].name).toBe('Main Camera');
    expect(component.schedules().length).toBe(1);
    expect(component.schedules()[0].name).toBe('Horario de Oficina');
    expect(component.analytics().length).toBe(1);
    expect(component.analytics()[0].type).toBe('object_detection');

    // Drawer panel visibility toggles
    expect(component.showAiPanel()).toBe(false);
    expect(component.selectedCamera()).toBeNull();

    const cameraObj = component.cameras()[0];
    component.openAiPanel(cameraObj);
    expect(component.showAiPanel()).toBe(true);
    expect(component.selectedCamera()?.id).toBe('cam-1');

    component.closeAiPanel();
    expect(component.showAiPanel()).toBe(false);
  });

  it('should correctly evaluate if a schedule is active based on time', () => {
    const start = new Date();
    start.setHours(8, 0, 0);

    const end = new Date();
    end.setHours(18, 0, 0);

    const schedule: Schedule = {
      id: 'sched-1',
      name: 'Horario de Oficina',
      hostFingerprint: 'HOST-ABC123XYZ',
      analyticIds: ['analytic-1'],
      start: start,
      end: end,
      frequency: 'diario',
      status: 'activo'
    };

    // 12:00 PM (Should be active)
    const activeTime = new Date();
    activeTime.setHours(12, 0, 0);
    component.currentTime.set(activeTime);
    expect(component.isScheduleActive(schedule)).toBe(true);

    // 07:00 AM (Should be inactive)
    const inactiveTime = new Date();
    inactiveTime.setHours(7, 0, 0);
    component.currentTime.set(inactiveTime);
    expect(component.isScheduleActive(schedule)).toBe(false);

    // If status is 'inactivo', should always be inactive
    schedule.status = 'inactivo';
    component.currentTime.set(activeTime);
    expect(component.isScheduleActive(schedule)).toBe(false);
  });

  it('should return analytics for a specific camera', () => {
    const mockAnalytic: Analytic = {
      id: 'analytic-1',
      hostFingerprint: 'HOST-ABC123XYZ',
      type: 'face_recognition',
      status: 'active',
      targetCameraIds: ['cam-1'],
      targetCameraNames: ['Main Camera'],
      detectionClasses: ['person']
    };

    analyticService.analytics.set([mockAnalytic]);

    const result = component.getAnalyticsForCamera('cam-1');
    expect(result.length).toBe(1);
    expect(result[0].type).toBe('face_recognition');

    const noResult = component.getAnalyticsForCamera('cam-99');
    expect(noResult.length).toBe(0);
  });

  it('should link schedules to analytics', () => {
    const mockAnalytic: Analytic = {
      id: 'analytic-1',
      hostFingerprint: 'HOST-ABC123XYZ',
      type: 'object_detection',
      status: 'active',
      targetCameraIds: ['cam-1'],
      targetCameraNames: ['Main Camera'],
      detectionClasses: []
    };

    const mockSchedule: Schedule = {
      id: 'sched-1',
      name: 'Turno Mañana',
      hostFingerprint: 'HOST-ABC123XYZ',
      analyticIds: ['analytic-1'],
      start: new Date(),
      end: new Date(),
      frequency: 'diario',
      status: 'activo'
    };

    component.hostId.set('HOST-ABC123XYZ');
    analyticService.analytics.set([mockAnalytic]);
    scheduleService.schedules.set([mockSchedule]);

    const schedules = component.getSchedulesForAnalytic('analytic-1');
    expect(schedules.length).toBe(1);
    expect(schedules[0].name).toBe('Turno Mañana');
  });

  it('should calculate client-side pagination correctly', () => {
    const mockCameras = Array.from({ length: 10 }, (_, i) => ({
      id: `cam-${i + 1}`,
      name: `Camera ${i + 1}`,
      hostFingerprint: 'HOST-ABC123XYZ',
      streamType: 'rtsp',
      status: 'online',
      decoder: 'opencv',
      location: { lat: 10, lon: 20 },
      createdAt: new Date()
    }));

    cameraService.cameras.set(mockCameras);
    component.limit.set(3);
    component.currentPage.set(1);

    expect(component.totalPages()).toBe(4);
    expect(component.pages()).toEqual([1, 2, 3, 4]);
    expect(component.pagedCameras().length).toBe(3);
    expect(component.pagedCameras()[0].id).toBe('cam-1');
    expect(component.pagedCameras()[2].id).toBe('cam-3');

    component.nextPage();
    expect(component.currentPage()).toBe(2);
    expect(component.pagedCameras()[0].id).toBe('cam-4');

    component.setPage(4);
    expect(component.currentPage()).toBe(4);
    expect(component.pagedCameras().length).toBe(1);

    component.prevPage();
    expect(component.currentPage()).toBe(3);

    component.onLimitChange({ target: { value: '5' } } as any);
    expect(component.limit()).toBe(5);
    expect(component.currentPage()).toBe(1);
    expect(component.totalPages()).toBe(2);
  });

  it('should correctly normalize and color analytic types, including Spanish variants with accents', () => {
    // Test normalization
    expect(component.normalizeAnalyticType('Detección de Objetos')).toBe('object_detection');
    expect(component.normalizeAnalyticType('deteccion_de_objetos')).toBe('object_detection');
    expect(component.normalizeAnalyticType('Reconocimiento Facial')).toBe('face_recognition');
    expect(component.normalizeAnalyticType('Conteo de Personas')).toBe('people_counting');
    expect(component.normalizeAnalyticType('Detección de Intrusión')).toBe('intrusion_detection');
    expect(component.normalizeAnalyticType('Lectura de Placas')).toBe('plate_recognition');
    expect(component.normalizeAnalyticType('Comportamiento humano')).toBe('comportamiento_humano');
    expect(component.normalizeAnalyticType('Cruce de Linea')).toBe('cruce_de_linea');
    expect(component.normalizeAnalyticType('Objeto en area')).toBe('objeto_en_area');

    // Test colors
    expect(component.getAnalyticColor('Detección de Objetos')).toBe('var(--color-analytic-object-detection)');
    expect(component.getAnalyticColor('Reconocimiento Facial')).toBe('var(--color-analytic-face-recognition)');
    expect(component.getAnalyticColor('Lectura de Placas')).toBe('var(--color-analytic-plate-recognition)');
    expect(component.getAnalyticColor('Conteo de Personas')).toBe('var(--color-analytic-people-counting)');
    expect(component.getAnalyticColor('Detección de Intrusión')).toBe('var(--color-analytic-intrusion-detection)');
    expect(component.getAnalyticColor('Comportamiento humano')).toBe('var(--color-analytic-comportamiento-humano)');
    expect(component.getAnalyticColor('Cruce de Linea')).toBe('var(--color-analytic-cruce-de-linea)');
    expect(component.getAnalyticColor('Objeto en area')).toBe('var(--color-analytic-objeto-en-area)');

    // Fallback color
    expect(component.getAnalyticColor('Unknown analytic')).toBe('var(--color-analytic-unknown)');
  });

  it('should search cameras by name/id using startsWith and filter by advanced filters (status, streamType, decoder, analyticType)', async () => {
    const mockCameras: Camera[] = [
      {
        id: 'cam-001',
        name: 'Front Door Camera',
        hostFingerprint: 'HOST-ABC123XYZ',
        streamType: 'rtsp',
        status: 'online',
        decoder: 'opencv',
        location: { lat: 10, lon: 20 },
        createdAt: new Date()
      },
      {
        id: 'cam-002',
        name: 'Backyard Camera',
        hostFingerprint: 'HOST-ABC123XYZ',
        streamType: 'webrtc',
        status: 'offline',
        decoder: 'gstreamer',
        location: { lat: 11, lon: 21 },
        createdAt: new Date()
      }
    ];

    cameraService.cameras.set(mockCameras);
    component.searchTerm.set('');
    component.searchControl.setValue('');
    component.filterStatus.set('all');
    component.filterStreamType.set('all');
    component.filterDecoder.set('all');
    component.filterAnalyticType.set('all');
    expect(component.filteredCameras().length).toBe(2);

    // 1. Search by name (Front) - startsWith prefix matching
    component.searchControl.setValue('front');
    component.searchTerm.set('front');
    expect(component.filteredCameras().length).toBe(1);
    expect(component.filteredCameras()[0].id).toBe('cam-001');

    // Search by middle name (Door) - startsWith prefix matching should fail to match "Front Door Camera"
    component.searchControl.setValue('door');
    component.searchTerm.set('door');
    expect(component.filteredCameras().length).toBe(0);

    // 2. Search by ID (cam-002) - startsWith prefix matching
    component.searchControl.setValue('cam-002');
    component.searchTerm.set('cam-002');
    expect(component.filteredCameras().length).toBe(1);
    expect(component.filteredCameras()[0].name).toBe('Backyard Camera');

    // Reset search
    component.searchControl.setValue('');
    component.searchTerm.set('');
    expect(component.filteredCameras().length).toBe(2);

    // 3. Advanced Filter: status = 'inactive' (should match offline)
    component.filterStatus.set('inactive');
    expect(component.filteredCameras().length).toBe(1);
    expect(component.filteredCameras()[0].id).toBe('cam-002');
    component.filterStatus.set('all');

    // Advanced Filter: status = 'active' (should match online)
    component.filterStatus.set('active');
    expect(component.filteredCameras().length).toBe(1);
    expect(component.filteredCameras()[0].id).toBe('cam-001');
    component.filterStatus.set('all');

    // 4. Advanced Filter: streamType = 'rtsp'
    component.filterStreamType.set('rtsp');
    expect(component.filteredCameras().length).toBe(1);
    expect(component.filteredCameras()[0].id).toBe('cam-001');
    component.filterStreamType.set('all');

    // 5. Advanced Filter: decoder = 'gstreamer'
    component.filterDecoder.set('gstreamer');
    expect(component.filteredCameras().length).toBe(1);
    expect(component.filteredCameras()[0].id).toBe('cam-002');
    component.filterDecoder.set('all');

    // 6. Advanced Filter: analyticType = 'face_recognition'
    const mockAnalytics: Analytic[] = [
      {
        id: 'analytic-1',
        hostFingerprint: 'HOST-ABC123XYZ',
        type: 'face_recognition',
        status: 'active',
        targetCameraIds: ['cam-001'],
        targetCameraNames: ['Front Door Camera'],
        detectionClasses: []
      },
      {
        id: 'analytic-2',
        hostFingerprint: 'HOST-ABC123XYZ',
        type: 'object_detection',
        status: 'active',
        targetCameraIds: ['cam-002'],
        targetCameraNames: ['Backyard Camera'],
        detectionClasses: []
      }
    ];
    analyticService.analytics.set(mockAnalytics);

    component.filterAnalyticType.set('face_recognition');
    expect(component.filteredCameras().length).toBe(1);
    expect(component.filteredCameras()[0].id).toBe('cam-001');
    component.filterAnalyticType.set('all');
  });

  it('should validate form fields correctly', () => {
    // Valid state
    component.editCameraName = 'Valid Camera';
    component.editCameraLat = 40.7128;
    component.editCameraLon = -74.006;
    expect(component.isNameInvalid).toBe(false);
    expect(component.isLatInvalid).toBe(false);
    expect(component.isLonInvalid).toBe(false);
    expect(component.isFormInvalid).toBe(false);

    // Invalid name
    component.editCameraName = '';
    expect(component.isNameInvalid).toBe(true);
    expect(component.isFormInvalid).toBe(true);
    component.editCameraName = '   ';
    expect(component.isNameInvalid).toBe(true);
    expect(component.isFormInvalid).toBe(true);
    component.editCameraName = 'Valid Camera';

    // Invalid latitude range
    component.editCameraLat = -90.1;
    expect(component.isLatInvalid).toBe(true);
    expect(component.isFormInvalid).toBe(true);
    component.editCameraLat = 90.1;
    expect(component.isLatInvalid).toBe(true);
    expect(component.isFormInvalid).toBe(true);
    component.editCameraLat = 40;
    expect(component.isLatInvalid).toBe(false);

    // Invalid longitude range
    component.editCameraLon = -180.1;
    expect(component.isLonInvalid).toBe(true);
    expect(component.isFormInvalid).toBe(true);
    component.editCameraLon = 180.1;
    expect(component.isLonInvalid).toBe(true);
    expect(component.isFormInvalid).toBe(true);
    component.editCameraLon = -74;
    expect(component.isLonInvalid).toBe(false);
  });

  it('should calculate remaining repetitions correctly', () => {
    const start = new Date('2026-06-22T09:00:00');
    const end = new Date('2026-06-25T18:00:00');
    
    // Test daily frequency starting before start date
    const refBefore = new Date('2026-06-21T12:00:00');
    let reps = component.getRemainingRepetitions(start, end, 'diario', refBefore);
    expect(reps).toBe(4); // June 22, 23, 24, 25

    // Test daily frequency starting during start date (before end time of that day)
    const refDuring = new Date('2026-06-22T14:00:00');
    reps = component.getRemainingRepetitions(start, end, 'diario', refDuring);
    expect(reps).toBe(4); // June 22, 23, 24, 25 (June 22 is counted since it is before June 22 18:00)

    // Test daily frequency starting after that day's schedule has ended
    const refAfterDay = new Date('2026-06-22T19:00:00');
    reps = component.getRemainingRepetitions(start, end, 'diario', refAfterDay);
    expect(reps).toBe(3); // June 23, 24, 25

    // Test weekly frequency
    reps = component.getRemainingRepetitions(start, new Date('2026-07-15T18:00:00'), 'semanal', refBefore);
    expect(reps).toBe(4); // June 22, June 29, July 6, July 13
  });

  it('should validate calendar selection based on frequency rules', () => {
    // 1. Diario: range of exactly 1 day
    component.newScheduleFrequency.set('diario');
    component.activeCalendarField.set('newRange');
    
    component.tempDateStart.set('2026-06-08');
    component.tempDateEnd.set('2026-06-08');
    expect(component.isCalendarSelectionValid()).toBe(true);
    expect(component.getCalendarValidationWarning()).toBe('');

    component.tempDateEnd.set('2026-06-09');
    expect(component.isCalendarSelectionValid()).toBe(false);
    expect(component.getCalendarValidationWarning()).toContain('Frecuencia diaria requiere un rango de exactamente 1 día');

    // 2. Semanal: range up to 7 days
    component.newScheduleFrequency.set('semanal');
    component.tempDateStart.set('2026-06-08'); // Monday
    component.tempDateEnd.set('2026-06-14');   // Sunday (7 days)
    expect(component.isCalendarSelectionValid()).toBe(true);
    expect(component.getCalendarValidationWarning()).toBe('');

    component.tempDateEnd.set('2026-06-15');   // 8 days
    expect(component.isCalendarSelectionValid()).toBe(false);
    expect(component.getCalendarValidationWarning()).toContain('Frecuencia semanal permite un rango máximo de 7 días');

    // 3. Mensual: dynamic range based on end date's month days count
    component.newScheduleFrequency.set('mensual');
    
    // February 2026 has 28 days
    // Jan 31 to Feb 28 = 29 days. 29 > 28 -> Invalid
    component.tempDateStart.set('2026-01-31');
    component.tempDateEnd.set('2026-02-28');
    expect(component.isCalendarSelectionValid()).toBe(false);
    expect(component.getCalendarValidationWarning()).toContain('Frecuencia mensual para el mes de febrero permite un rango máximo de 28 días');

    // Jan 31 to Feb 27 = 28 days. 28 <= 28 -> Valid
    component.tempDateEnd.set('2026-02-27');
    expect(component.isCalendarSelectionValid()).toBe(true);
    expect(component.getCalendarValidationWarning()).toBe('');

    // April 2026 has 30 days
    // Mar 31 to Apr 30 = 31 days. 31 > 30 -> Invalid
    component.tempDateStart.set('2026-03-31');
    component.tempDateEnd.set('2026-04-30');
    expect(component.isCalendarSelectionValid()).toBe(false);
    expect(component.getCalendarValidationWarning()).toContain('Frecuencia mensual para el mes de abril permite un rango máximo de 30 días');

    // Mar 31 to Apr 29 = 30 days. 30 <= 30 -> Valid
    component.tempDateEnd.set('2026-04-29');
    expect(component.isCalendarSelectionValid()).toBe(true);
    expect(component.getCalendarValidationWarning()).toBe('');
  });

  it('should adjust calendar selection dynamically on frequency changes', () => {
    // Start in new schedule form
    component.newScheduleDateStart.set('2026-06-08');
    component.newScheduleDateEnd.set('2026-06-18'); // 11 days (invalid for semanal/diario)
    
    // Change to weekly: should trim to 7 days (June 8 to June 14)
    component.onNewScheduleFrequencyChange('semanal');
    expect(component.newScheduleDateEnd()).toBe('2026-06-14');

    // Change to daily: should trim to 1 day (June 8 to June 8)
    component.onNewScheduleFrequencyChange('diario');
    expect(component.newScheduleDateEnd()).toBe('2026-06-08');

    // Check temp date adjustments when calendar is open
    component.activeCalendarField.set('newRange');
    component.tempDateStart.set('2026-01-31');
    component.tempDateEnd.set('2026-03-10'); // 39 days (too long for monthly)
    
    // Change to monthly: temp date end should clip to January's length (31 days) -> Jan 31 + 30 days = Mar 2
    component.onNewScheduleFrequencyChange('mensual');
    expect(component.tempDateEnd()).toBe('2026-03-02');
  });

  it('should disable previous month navigation and auto-adjust range on opening calendar', () => {
    // 1. Test isPrevCalendarMonthDisabled
    const refDate = new Date('2026-06-22T12:00:00'); // Monday June 22
    component.currentTime.set(refDate);
    
    // Start of week is Monday June 22
    // If calendar view is June 2026, we cannot go back to May 2026
    component.calendarViewYear.set(2026);
    component.calendarViewMonth.set(5); // June
    expect(component.isPrevCalendarMonthDisabled()).toBe(true);
    
    // If calendar view is July 2026, we can go back to June 2026
    component.calendarViewMonth.set(6); // July
    expect(component.isPrevCalendarMonthDisabled()).toBe(false);
    
    // 2. Test auto-adjust range in openCalendar
    component.newScheduleFrequency.set('semanal');
    component.newScheduleDateStart.set('2026-06-08');
    component.newScheduleDateEnd.set('2026-06-25'); // 18 days (invalid for semanal)
    
    const fakeEvent = { stopPropagation: () => {} } as any;
    component.openCalendar('newRange', fakeEvent);
    
    // Should have adjusted tempDateEnd to June 14 (7 days)
    expect(component.tempDateStart()).toBe('2026-06-08');
    expect(component.tempDateEnd()).toBe('2026-06-14');
  });

  it('should have empty newScheduleFrequency by default', () => {
    expect(component.newScheduleFrequency()).toBe('');
  });

  it('should allow active status regardless of schedules and not auto-deactivate when no schedules exist', () => {
    const mockAnalytic: Analytic = {
      id: 'analytic-test',
      hostFingerprint: 'HOST-ABC123XYZ',
      type: 'object_detection',
      status: 'active',
      targetCameraIds: ['cam-abc'],
      targetCameraNames: ['Test Camera'],
      detectionClasses: []
    };

    component.hostId.set('HOST-ABC123XYZ');
    analyticService.analytics.set([mockAnalytic]);
    scheduleService.schedules.set([]);

    const spyUpdateStatus = vi.spyOn(analyticService, 'updateAnalyticStatus').mockReturnValue(of(void 0));
    
    // checkScheduleTransitions should not deactivate
    component['checkScheduleTransitions']();
    expect(spyUpdateStatus).not.toHaveBeenCalled();

    // toggleAnalyticStatus should succeed
    component.toggleAnalyticStatus(mockAnalytic);
    expect(spyUpdateStatus).toHaveBeenCalledWith('analytic-test', 'inactive');
  });

  it('should calculate visiblePages correctly and support page jumping in Camaras', () => {
    component.limit.set(3);
    const mockCameras: Camera[] = Array.from({ length: 12 }, (_, i) => ({
      id: `cam-${i + 1}`,
      name: `Camera ${i + 1}`,
      hostFingerprint: 'HOST-ABC123XYZ',
      ipAddress: '192.168.1.10',
      port: 8080,
      streamType: 'rtsp',
      status: 'online',
      decoder: 'opencv',
      location: { lat: 10, lon: 20 },
      createdAt: new Date()
    }));
    cameraService.cameras.set(mockCameras);
    component.currentPage.set(1);

    expect(component.totalPages()).toBe(4);
    expect(component.visiblePages()).toEqual([1, 2, 3, 4]);

    // Test onPageInput sanitization
    const mockInput = { target: { value: 'abc34' } } as any;
    component.onPageInput(mockInput);
    expect(mockInput.target.value).toBe('34');

    // Test jumpToPage navigation
    const mockJumpInput = { target: { value: '3' } } as any;
    component.jumpToPage(mockJumpInput);
    expect(component.currentPage()).toBe(3);
    expect(mockJumpInput.target.value).toBe('');
  });
});
