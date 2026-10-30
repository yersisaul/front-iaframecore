import { Observable } from 'rxjs';
import {
  Camera,
  CameraProbeRequest,
  CameraProbeResponse,
  CameraRegisterRequest,
  CameraUpdateRequest,
  PtzPresetsResponse,
  DigitalOutputsResponse
} from '../entities/camera.models';

export abstract class ICameraRepository {
  abstract getAll(): Observable<Camera[]>;
  abstract getByHost(hostFingerprint: string): Observable<Camera[]>;
  abstract getById(cameraId: string): Observable<Camera>;
  abstract register(camera: CameraRegisterRequest): Observable<Camera>;
  abstract update(cameraId: string, body: CameraUpdateRequest): Observable<Camera>;
  abstract probe<T = any>(req: CameraProbeRequest): Observable<CameraProbeResponse<T>>;
  abstract delete(cameraId: string): Observable<void>;
  abstract getPtzPresets(cameraId: string): Observable<PtzPresetsResponse>;
  abstract getDigitalOutputs(cameraId: string): Observable<DigitalOutputsResponse>;
}
