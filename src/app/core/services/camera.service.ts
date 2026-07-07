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
  readonly activeHostFingerprint = signal<string | null>(null);
  readonly isViewActive = signal<boolean>(false);
  
  readonly newRecordIds = signal<Set<string>>(new Set());
  readonly updatedRecordIds = signal<Set<string>>(new Set());
  readonly deletingRecordIds = signal<Set<string>>(new Set());

  markAsNew(id: string): void {
    this.newRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  markAsUpdated(id: string): void {
    this.updatedRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.updatedRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  markAsDeleting(id: string): void {
    this.deletingRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.deletingRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  constructor(
    private cameraRepository: ICameraRepository,
    private getCamerasUseCase: GetCamerasUseCase
  ) { }

  getCamerasByHost(hostFingerprint: string): Observable<Camera[]> {
    this.isLoading.set(true);
    this.activeHostFingerprint.set(hostFingerprint);
    return this.getCamerasUseCase.execute(hostFingerprint).pipe(
      tap(cameras => {
        this.cameras.set(cameras);
        this.isLoading.set(false);
      })
    );
  }

  getAllCameras(): Observable<Camera[]> {
    this.isLoading.set(true);
    this.activeHostFingerprint.set(null);
    return this.cameraRepository.getAll().pipe(
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

  updateCameraStatusLocal(cameraId: string, status: string): void {
    this.cameras.update(list => list.map(c => c.id === cameraId ? { ...c, status } : c));
  }

  deleteCameraLocal(cameraId: string): void {
    this.cameras.update(list => list.filter(c => c.id !== cameraId));
  }
}