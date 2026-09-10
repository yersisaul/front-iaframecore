import { Observable } from 'rxjs';
import { Camera, CameraRegisterRequest, CameraUpdateRequest } from '../entities/camera.models';

export abstract class ICameraRepository {
  abstract getAll(): Observable<Camera[]>;
  abstract getByHost(hostFingerprint: string): Observable<Camera[]>;
  abstract register(camera: CameraRegisterRequest): Observable<Camera>;
  abstract update(cameraId: string, body: CameraUpdateRequest): Observable<any>;
  abstract delete(cameraId: string): Observable<any>;
}
