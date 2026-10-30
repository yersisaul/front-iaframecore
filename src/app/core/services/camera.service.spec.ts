import { TestBed } from '@angular/core/testing';
import { CameraService } from './camera.service';
import { ICameraRepository } from '../domain/repositories/camera.repository';
import { GetCamerasUseCase } from '../domain/use-cases/get-cameras.use-case';
import { of } from 'rxjs';
import { Camera, CameraProbeRequest, CameraRegisterRequest, CameraUpdateRequest } from '../domain/entities/camera.models';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('CameraService', () => {
  let service: CameraService;
  let mockRepo: any;
  let mockUseCase: any;

  const dummyCam1: Camera = {
    id: 'cam-01',
    name: 'Cámara 1',
    hostFingerprint: 'HOST-01',
    streamType: 'rtsp',
    status: 'online',
    decoder: 'opencv',
    location: { lat: 10, lon: 20 },
    createdAt: new Date(),
    nxId: 'NX-01'
  };

  const dummyCam2: Camera = {
    id: 'cam-02',
    name: 'Cámara 2',
    hostFingerprint: 'HOST-02',
    streamType: 'Onvif',
    status: 'online',
    decoder: 'opencv',
    location: { lat: 10, lon: 20 },
    createdAt: new Date(),
    streams: ['Profile_1']
  };

  beforeEach(() => {
    mockRepo = {
      getAll: vi.fn().mockReturnValue(of([dummyCam1, dummyCam2])),
      getByHost: vi.fn().mockReturnValue(of([dummyCam1])),
      getById: vi.fn().mockReturnValue(of(dummyCam1)),
      register: vi.fn().mockReturnValue(of(dummyCam1)),
      update: vi.fn().mockReturnValue(of(dummyCam1)),
      probe: vi.fn().mockReturnValue(of({ data: { valido: true } })),
      delete: vi.fn().mockReturnValue(of(void 0))
    };

    mockUseCase = {
      execute: vi.fn().mockReturnValue(of([dummyCam1]))
    };

    TestBed.configureTestingModule({
      providers: [
        CameraService,
        { provide: ICameraRepository, useValue: mockRepo },
        { provide: GetCamerasUseCase, useValue: mockUseCase }
      ]
    });

    service = TestBed.inject(CameraService);
  });

  it('should update camera in place with upsertCameraLocal when it already exists', () => {
    service.cameras.set([dummyCam1]);

    const updatedCam1: Camera = {
      ...dummyCam1,
      name: 'Cámara 1 Modificada',
      nxId: 'NX-NEW-ID'
    };

    service.upsertCameraLocal(updatedCam1);

    expect(service.cameras().length).toBe(1);
    expect(service.cameras()[0].name).toBe('Cámara 1 Modificada');
    expect(service.cameras()[0].nxId).toBe('NX-NEW-ID');
  });

  it('should insert new camera with upsertCameraLocal when it matches active host or in global mode', () => {
    service.cameras.set([dummyCam1]);
    (service as any).activeHostFingerprint.set(null); // modo global

    service.upsertCameraLocal(dummyCam2);

    expect(service.cameras().length).toBe(2);
    expect(service.cameras()[0].id).toBe('cam-02');
  });

  it('should getCameraById and update local reactive state', () => {
    service.cameras.set([]);

    service.getCameraById('cam-01').subscribe(cam => {
      expect(cam.id).toBe('cam-01');
      expect(mockRepo.getById).toHaveBeenCalledWith('cam-01');
      expect(service.cameras().length).toBe(1);
    });
  });

  it('should updateCamera using backend response and update local reactive state', () => {
    service.cameras.set([dummyCam1]);
    const returnedFromBackend: Camera = {
      ...dummyCam1,
      name: 'Nuevo Nombre Backend'
    };
    mockRepo.update.mockReturnValue(of(returnedFromBackend));

    const body: CameraUpdateRequest = { camera_name: 'Nuevo Nombre Backend' };
    service.updateCamera('cam-01', body).subscribe(res => {
      expect(res.name).toBe('Nuevo Nombre Backend');
      expect(service.cameras()[0].name).toBe('Nuevo Nombre Backend');
    });
  });

  it('should probeCamera by delegating directly to repository', () => {
    const probeReq: CameraProbeRequest = {
      fingerprint_host: 'HOST-01',
      probe_type: 'validate_stream',
      params: { url: 'rtsp://test' }
    };

    service.probeCamera(probeReq).subscribe(res => {
      expect(res.data.valido).toBe(true);
      expect(mockRepo.probe).toHaveBeenCalledWith(probeReq);
    });
  });
});
