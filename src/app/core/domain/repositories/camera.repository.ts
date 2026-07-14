import { Observable } from 'rxjs';
import { Camera } from '../entities/camera.models';

export abstract class ICameraRepository {
  abstract getAll(): Observable<Camera[]>;
  abstract getByHost(hostFingerprint: string): Observable<Camera[]>;
  abstract update(cameraId: string, body: { camera_name: string; location: { lat: number; lon: number } }): Observable<any>;
  abstract delete(cameraId: string): Observable<any>;
}
