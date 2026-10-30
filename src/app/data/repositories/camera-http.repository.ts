import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError, timeout } from 'rxjs/operators';
import {
  Camera,
  CameraDTO,
  CameraMapper,
  CameraProbeRequest,
  CameraProbeResponse,
  CameraRegisterRequest,
  CameraUpdateRequest,
  PtzPresetsResponse,
  DigitalOutputsResponse
} from '../../core/domain/entities/camera.models';
import { ICameraRepository } from '../../core/domain/repositories/camera.repository';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class CameraHttpRepository implements ICameraRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/frontend/cameras`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<Camera[]> {
    return this.http.get<CameraDTO[]>(`${this.apiUrl}/`).pipe(
      map(dtos => (dtos || []).map(CameraMapper.toDomain)),
      catchError(err => {
        console.error('Error in CameraHttpRepository.getAll:', err);
        return of([]);
      })
    );
  }

  getByHost(hostFingerprint: string): Observable<Camera[]> {
    const encodedHost = encodeURIComponent(hostFingerprint);
    return this.http.get<CameraDTO[]>(`${this.apiUrl}/${encodedHost}`).pipe(
      map(dtos => (dtos || []).map(CameraMapper.toDomain)),
      catchError(err => {
        console.error('Error in CameraHttpRepository.getByHost:', err);
        return of([]);
      })
    );
  }

  getById(cameraId: string): Observable<Camera> {
    const encodedId = encodeURIComponent(cameraId);
    return this.http.get<CameraDTO>(`${this.apiUrl}/${encodedId}/detail`).pipe(
      map(dto => CameraMapper.toDomain(dto))
    );
  }

  register(camera: CameraRegisterRequest): Observable<Camera> {
    const url = this.apiUrl.endsWith('/') ? this.apiUrl : `${this.apiUrl}/`;
    return this.http.post<CameraDTO>(url, camera).pipe(
      map(dto => CameraMapper.toDomain(dto))
    );
  }

  update(cameraId: string, body: CameraUpdateRequest): Observable<Camera> {
    const encodedId = encodeURIComponent(cameraId);
    return this.http.patch<CameraDTO>(`${this.apiUrl}/${encodedId}`, body).pipe(
      map(dto => CameraMapper.toDomain(dto))
    );
  }

  probe<T = any>(req: CameraProbeRequest): Observable<CameraProbeResponse<T>> {
    return this.http.post<CameraProbeResponse<T>>(`${this.apiUrl}/probe`, req).pipe(
      timeout(30000)
    );
  }

  delete(cameraId: string): Observable<void> {
    const encodedId = encodeURIComponent(cameraId);
    return this.http.delete<void>(`${this.apiUrl}/${encodedId}`);
  }

  getPtzPresets(cameraId: string): Observable<PtzPresetsResponse> {
    const encodedId = encodeURIComponent(cameraId);
    return this.http.get<PtzPresetsResponse>(`${this.apiUrl}/${encodedId}/ptz_presets`);
  }

  getDigitalOutputs(cameraId: string): Observable<DigitalOutputsResponse> {
    const encodedId = encodeURIComponent(cameraId);
    return this.http.get<DigitalOutputsResponse>(`${this.apiUrl}/${encodedId}/digital_outputs`);
  }
}
