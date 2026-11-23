import { TestBed } from '@angular/core/testing';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { ListHttpRepository } from './list-http.repository';
import { MediaFileService } from '../../core/services/media-file.service';
import { AppEnvironment } from '../../core/config/app-environment';

describe('ListHttpRepository', () => {
  let repository: ListHttpRepository;
  let httpMock: HttpTestingController;
  const registerFaceUrl = `${AppEnvironment.apiUrl}/frontend/list_details/register_face`;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ListHttpRepository,
        { provide: MediaFileService, useValue: { getFileUrl: vi.fn() } }
      ]
    });

    repository = TestBed.inject(ListHttpRepository);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('maps 201 { detail_id, object_name } response contract cleanly', () => {
    const file = new File(['face'], 'ana.jpg', { type: 'image/jpeg' });
    let mapped: any;

    repository.registerListDetail({ list_id: 'list-1', nombre_asociado: 'Ana' }, file).subscribe(res => {
      mapped = res;
    });

    const req = httpMock.expectOne(registerFaceUrl);
    expect(req.request.method).toBe('POST');
    req.flush({ detail_id: 'uuid-1', object_name: 'bucket/face.jpg' }, { status: 201, statusText: 'Created' });

    expect(mapped.detail_id).toBe('uuid-1');
    expect(mapped.list_id).toBe('list-1');
    expect(mapped.nombre_asociado).toBe('Ana');
    expect(mapped.img_minio_object_name).toBe('bucket/face.jpg');
    expect(mapped.metadata?.img_minio_object_name).toBe('bucket/face.jpg');
  });

  it('maps 201 { detail_id, url_img } OpenAPI response contract cleanly', () => {
    const file = new File(['face'], 'luis.jpg', { type: 'image/jpeg' });
    let mapped: any;

    repository.registerListDetail({ list_id: 'list-1', nombre_asociado: 'Luis' }, file).subscribe(res => {
      mapped = res;
    });

    const req = httpMock.expectOne(registerFaceUrl);
    req.flush({ detail_id: 'uuid-2', url_img: 'https://minio/face.jpg' }, { status: 201, statusText: 'Created' });

    expect(mapped.detail_id).toBe('uuid-2');
    expect(mapped.img_minio_object_name).toBe('https://minio/face.jpg');
  });

  it('handles 201 null response body safely without throwing TypeError', () => {
    const file = new File(['face'], 'maria.jpg', { type: 'image/jpeg' });
    let mapped: any;
    let errored = false;

    repository.registerListDetail({ list_id: 'list-1', nombre_asociado: 'Maria' }, file).subscribe({
      next: res => {
        mapped = res;
      },
      error: () => {
        errored = true;
      }
    });

    const req = httpMock.expectOne(registerFaceUrl);
    req.flush(null, { status: 201, statusText: 'Created' });

    expect(errored).toBe(false);
    expect(mapped.detail_id).toBe('');
    expect(mapped.list_id).toBe('list-1');
    expect(mapped.nombre_asociado).toBe('Maria');
  });

  it('propagates HTTP 500 intact instead of returning a fake temp-id', () => {
    const file = new File(['face'], 'carlos.jpg', { type: 'image/jpeg' });
    let capturedError: HttpErrorResponse | undefined;
    let nextCalled = false;

    repository.registerListDetail({ list_id: 'list-1', nombre_asociado: 'Carlos' }, file).subscribe({
      next: () => {
        nextCalled = true;
      },
      error: err => {
        capturedError = err;
      }
    });

    const req = httpMock.expectOne(registerFaceUrl);
    req.flush({ detail: 'Internal error' }, { status: 500, statusText: 'Internal Server Error' });

    expect(nextCalled).toBe(false);
    expect(capturedError?.status).toBe(500);
  });

  it('propagates HTTP 422 validation error intact', () => {
    const file = new File(['face'], 'invalid.jpg', { type: 'image/jpeg' });
    let capturedError: HttpErrorResponse | undefined;

    repository.registerListDetail({ list_id: 'list-1', nombre_asociado: 'Invalid' }, file).subscribe({
      error: err => {
        capturedError = err;
      }
    });

    const req = httpMock.expectOne(registerFaceUrl);
    req.flush({ detail: 'No face detected' }, { status: 422, statusText: 'Unprocessable Entity' });

    expect(capturedError?.status).toBe(422);
    expect(capturedError?.error?.detail).toBe('No face detected');
  });
});

