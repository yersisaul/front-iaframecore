import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Camera, CameraDTO, CameraMapper } from '../../core/domain/entities/camera.models';
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
    return this.http.get<CameraDTO[]>(`${this.apiUrl}/${hostFingerprint}`).pipe(
      map(dtos => (dtos || []).map(CameraMapper.toDomain)),
      catchError(err => {
        console.error('Error in CameraHttpRepository.getByHost:', err);
        return of([]);
      })
    );
  }

  update(cameraId: string, body: { camera_name: string; location: { lat: number; lon: number } }): Observable<any> {
    // PATCH /frontend/cameras/{camera_id}
    return this.http.patch<any>(`${this.apiUrl}/${cameraId}`, body).pipe(
      catchError(err => {
        if (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422) {
          console.warn('[BACKEND-WORKAROUND] Camera update returned status ' + err.status + '. Assuming success. Please fix backend.', err);
          return of(null);
        }
        throw err;
      })
    );
  }

  delete(cameraId: string): Observable<any> {
    // DELETE /frontend/cameras/{camera_id}
    return this.http.delete<any>(`${this.apiUrl}/${cameraId}`).pipe(
      catchError(err => {
        if (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422) {
          console.warn('[BACKEND-WORKAROUND] Camera delete returned status ' + err.status + '. Assuming success. Please fix backend.', err);
          return of(null);
        }
        throw err;
      })
    );
  }
}
