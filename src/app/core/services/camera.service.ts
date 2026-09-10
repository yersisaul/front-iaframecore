import { Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Camera, CameraRegisterRequest, CameraUpdateRequest } from '../domain/entities/camera.models';
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
  readonly activeStatusIds = signal<Set<string>>(new Set());
  readonly inactiveStatusIds = signal<Set<string>>(new Set());

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

  markAsStatusActive(id: string): void {
    this.activeStatusIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.activeStatusIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1200);
  }

  markAsStatusInactive(id: string): void {
    this.inactiveStatusIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.inactiveStatusIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1200);
  }

  constructor(
    private cameraRepository: ICameraRepository,
    private getCamerasUseCase: GetCamerasUseCase
  ) { }

  getCamerasByHost(hostFingerprint: string, animateNew = false): Observable<Camera[]> {
    this.isLoading.set(true);
    const isHostMode = this.activeHostFingerprint() === hostFingerprint;
    const oldIds = new Set(this.cameras().map(c => c.id));
    return this.getCamerasUseCase.execute(hostFingerprint).pipe(
      tap(cameras => {
        if (isHostMode) {
          this.cameras.set(cameras);
        } else if (this.activeHostFingerprint() === null) {
          // Modo global: reemplazamos únicamente las cámaras de este host manteniendo las de otros nodos
          this.cameras.update(current => {
            const others = current.filter(c => c.hostFingerprint !== hostFingerprint);
            return [...others, ...cameras];
          });
        } else {
          this.activeHostFingerprint.set(hostFingerprint);
          this.cameras.set(cameras);
        }
        this.isLoading.set(false);
        if (animateNew) {
          cameras.forEach(c => {
            if (!oldIds.has(c.id)) {
              this.markAsNew(c.id);
            }
          });
        }
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

  registerCamera(request: CameraRegisterRequest): Observable<Camera> {
    return this.cameraRepository.register(request).pipe(
      tap(newCamera => {
        if (this.activeHostFingerprint() === null || this.activeHostFingerprint() === newCamera.hostFingerprint) {
          this.cameras.update(list => [newCamera, ...list]);
          this.markAsNew(newCamera.id);
        }
      })
    );
  }

  updateCamera(cameraId: string, body: CameraUpdateRequest): Observable<any> {
    return this.cameraRepository.update(cameraId, body).pipe(
      tap(() => {
        this.cameras.update(list => list.map(c => {
          if (c.id === cameraId) {
            return {
              ...c,
              name: body.camera_name !== undefined ? body.camera_name : c.name,
              hostFingerprint: body.fingerprint_host !== undefined ? body.fingerprint_host : c.hostFingerprint,
              streamType: (body.stream_type as string) !== undefined ? (body.stream_type as string) : c.streamType,
              decoder: (body.decoder as string) !== undefined ? ((body.decoder as string) || '') : c.decoder,
              location: body.location !== undefined && body.location !== null ? body.location : c.location,
              streamUrl: body.stream_url !== undefined ? (body.stream_url || undefined) : c.streamUrl,
              rtspUrl: body.stream_url !== undefined ? (body.stream_url || undefined) : c.rtspUrl,
              nxId: body.nx_id !== undefined ? (body.nx_id || undefined) : c.nxId,
              forcedResolution: body.forced_resolution !== undefined ? (body.forced_resolution || undefined) : c.forcedResolution,
              forcedFps: body.forced_fps !== undefined ? (body.forced_fps ?? undefined) : c.forcedFps,
              compatibilityMode: body.compatibility_mode !== undefined ? body.compatibility_mode : c.compatibilityMode,
              ipAddress: body.ip_address !== undefined ? (body.ip_address || undefined) : c.ipAddress,
              user: body.user !== undefined ? (body.user || undefined) : c.user,
              password: body.password !== undefined ? (body.password || undefined) : c.password,
              httpPort: body.http_port !== undefined ? (body.http_port ?? undefined) : c.httpPort,
              selectedStream: body.selected_stream !== undefined ? (body.selected_stream ?? undefined) : c.selectedStream
            };
          }
          return c;
        }));
        this.markAsUpdated(cameraId);
      })
    );
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

  migrateHostLocal(oldFingerprint: string, newFingerprint: string): void {
    if (this.activeHostFingerprint() === oldFingerprint) {
      this.activeHostFingerprint.set(newFingerprint);
    }
    this.cameras.update(list =>
      list.map(c => c.hostFingerprint === oldFingerprint ? { ...c, hostFingerprint: newFingerprint } : c)
    );
  }
}