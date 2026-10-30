import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { CameraHttpRepository } from './camera-http.repository';
import { AppEnvironment } from '../../core/config/app-environment';
import {
  CameraDTO,
  CameraFrontendCreateRequest,
  CameraFrontendUpdateRequest,
  CameraProbeRequest
} from '../../core/domain/entities/camera.models';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('CameraHttpRepository', () => {
  let repository: CameraHttpRepository;
  let httpMock: HttpTestingController;
  const baseUrl = `${AppEnvironment.apiUrl}/frontend/cameras`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [CameraHttpRepository]
    });
    repository = TestBed.inject(CameraHttpRepository);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should call GET /frontend/cameras/{id}/detail in getById', () => {
    const dummyDto: CameraDTO = {
      camera_id: 'cam-101',
      camera_name: 'Cámara Acceso',
      fingerprint_host: 'HOST-001',
      stream_type: 'Onvif',
      status: 'online',
      decoder: 'opencv',
      location: { lat: '40.7128', lon: '-74.0060' },
      nx_id: 'NX-999',
      streams: ['Profile_1', 'Profile_2'],
      selected_stream: 0,
      selected_profile_token: 'Profile_1',
      ptz_mode: 'auto'
    };

    repository.getById('cam-101').subscribe(camera => {
      expect(camera.id).toBe('cam-101');
      expect(camera.name).toBe('Cámara Acceso');
      expect(camera.streams).toEqual(['Profile_1', 'Profile_2']);
      expect(camera.selectedProfileToken).toBe('Profile_1');
      expect(camera.nxId).toBe('NX-999');
    });

    const req = httpMock.expectOne(`${baseUrl}/cam-101/detail`);
    expect(req.request.method).toBe('GET');
    req.flush(dummyDto);
  });

  it('should call POST /frontend/cameras/probe in probe()', () => {
    const probeReq: CameraProbeRequest = {
      fingerprint_host: 'HOST-001',
      probe_type: 'onvif_profiles',
      params: { ip: '192.168.1.50', port: 80, user: 'admin', password: '123' }
    };

    const mockResponse = {
      request_id: 'req-01',
      fingerprint_host: 'HOST-001',
      probe_type: 'onvif_profiles' as const,
      data: {
        fabricante: 'Hikvision',
        tokens: ['Profile_1', 'Profile_2'],
        perfiles: [{ codec: 'H264', fps: 30, legible: true, resolucion: '1920x1080' }]
      }
    };

    repository.probe(probeReq).subscribe(res => {
      expect(res.probe_type).toBe('onvif_profiles');
      expect(res.data.tokens).toEqual(['Profile_1', 'Profile_2']);
    });

    const req = httpMock.expectOne(`${baseUrl}/probe`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(probeReq);
    req.flush(mockResponse);
  });

  it('should call POST /frontend/cameras/ in register() and return mapped Camera', () => {
    const createReq: CameraFrontendCreateRequest = {
      camera_name: 'Cámara Estacionamiento',
      fingerprint_host: 'HOST-001',
      stream_type: 'rtsp',
      stream_url: 'rtsp://192.168.1.50:554/live',
      nx_id: 'nx-optional-guid',
      location: { lat: '-12.0', lon: '-77.0' }
    };

    const dummyDto: CameraDTO = {
      camera_id: 'cam-202',
      camera_name: 'Cámara Estacionamiento',
      fingerprint_host: 'HOST-001',
      stream_type: 'rtsp',
      status: 'online',
      decoder: 'opencv',
      location: { lat: '-12.0', lon: '-77.0' },
      nx_id: 'nx-optional-guid'
    };

    repository.register(createReq).subscribe(camera => {
      expect(camera.id).toBe('cam-202');
      expect(camera.name).toBe('Cámara Estacionamiento');
      expect(camera.nxId).toBe('nx-optional-guid');
    });

    const req = httpMock.expectOne(`${baseUrl}/`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual(createReq);
    req.flush(dummyDto);
  });

  it('should call PATCH /frontend/cameras/{id} in update() with differential fields and return mapped Camera', () => {
    const updateReq: CameraFrontendUpdateRequest = {
      camera_name: 'Nuevo Nombre',
      nx_id: 'nx-updated-id'
    };

    const dummyDto: CameraDTO = {
      camera_id: 'cam-202',
      camera_name: 'Nuevo Nombre',
      fingerprint_host: 'HOST-001',
      stream_type: 'rtsp',
      status: 'online',
      decoder: 'opencv',
      location: { lat: '-12.0', lon: '-77.0' },
      nx_id: 'nx-updated-id'
    };

    repository.update('cam-202', updateReq).subscribe(camera => {
      expect(camera.id).toBe('cam-202');
      expect(camera.name).toBe('Nuevo Nombre');
      expect(camera.nxId).toBe('nx-updated-id');
    });

    const req = httpMock.expectOne(`${baseUrl}/cam-202`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual(updateReq);
    req.flush(dummyDto);
  });

  it('should propagate errors on update without swallowing 5xx', () => {
    let errorReceived: any = null;

    repository.update('cam-err', { camera_name: 'Fail' }).subscribe({
      next: () => {},
      error: err => {
        errorReceived = err;
      }
    });

    const req = httpMock.expectOne(`${baseUrl}/cam-err`);
    req.flush({ detail: 'Internal Server Error' }, { status: 500, statusText: 'Server Error' });

    expect(errorReceived).not.toBeNull();
    expect(errorReceived.status).toBe(500);
  });
});
