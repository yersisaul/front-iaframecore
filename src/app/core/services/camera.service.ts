import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Camera } from '../domain/entities/camera.models';
import { ICameraRepository } from '../domain/repositories/camera.repository';
import { GetCamerasUseCase } from '../domain/use-cases/get-cameras.use-case';

@Injectable({
  providedIn: 'root'
})
export class CameraService {
  readonly cameras = signal<Camera[]>([]);
  readonly isLoading = signal(false);

  constructor(
    private cameraRepository: ICameraRepository,
    private getCamerasUseCase: GetCamerasUseCase
  ) { }

  getCamerasByHost(hostFingerprint: string): Observable<Camera[]> {
    this.isLoading.set(true);
    return this.getCamerasUseCase.execute(hostFingerprint).pipe(
      tap(cameras => {
        this.cameras.set(cameras);
        this.isLoading.set(false);
      })
    );
  }

  updateCamera(cameraId: string, body: { camera_name: string; location: { lat: number; lon: number } }): Observable<any> {
    return this.cameraRepository.update(cameraId, body);
  }

  deleteCamera(cameraId: string): Observable<any> {
    return this.cameraRepository.delete(cameraId);
  }
}