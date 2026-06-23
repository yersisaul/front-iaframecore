import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Camera } from '../entities/camera.models';
import { ICameraRepository } from '../repositories/camera.repository';

@Injectable({
  providedIn: 'root'
})
export class GetCamerasUseCase {
  constructor(private cameraRepository: ICameraRepository) {}

  execute(hostFingerprint: string): Observable<Camera[]> {
    return this.cameraRepository.getByHost(hostFingerprint);
  }
}
