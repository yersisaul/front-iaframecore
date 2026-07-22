import { Component, Input, Output, EventEmitter, inject, signal, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CameraService } from '../../../core/services/camera.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { AnalyticService } from '../../../core/services/analytic.service';
import { PermissionsService } from '../../../core/services/permissions.service';

import { Camera } from '../../../core/domain/entities/camera.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { Schedule } from '../../../core/domain/entities/schedule.models';
import { copyToClipboard } from '../../../core/utils/clipboard.util';
import { ConfirmDeleteModalComponent } from '../confirm-delete-modal/confirm-delete-modal.component';

@Component({
  selector: 'app-camera-detail-drawer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    ConfirmDeleteModalComponent
  ],
  templateUrl: './camera-detail-drawer.component.html',
  styleUrl: './camera-detail-drawer.component.css'
})
export class CameraDetailDrawerComponent {
  private cameraService = inject(CameraService);
  private scheduleService = inject(ScheduleService);
  private analyticService = inject(AnalyticService);
  public permissionsService = inject(PermissionsService);

  @Input() show: boolean = false;
  @Input() camera: Camera | null = null;
  @Input() hostId: string | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() cameraUpdated = new EventEmitter<Camera>();
  @Output() cameraDeleted = new EventEmitter<Camera>();

  // Signals para analíticas y horarios
  readonly analytics = this.analyticService.analytics;
  readonly schedules = this.scheduleService.schedules;

  // Señales de estado CRUD de analíticas
  readonly analyticNewIds = this.analyticService.newRecordIds;
  readonly analyticUpdatedIds = this.analyticService.updatedRecordIds;
  readonly analyticDeletingIds = this.analyticService.deletingRecordIds;
  readonly analyticActiveStatusIds = this.analyticService.activeStatusIds;
  readonly analyticInactiveStatusIds = this.analyticService.inactiveStatusIds;

  // Estado local del drawer
  readonly isEditingCamera = signal<boolean>(false);
  editCameraName = '';
  editCameraLat = 0;
  editCameraLon = 0;

  readonly expandedAnalyticIds = signal<Set<string>>(new Set());
  readonly activeAddScheduleDropdown = signal<string | null>(null);

  // Feedback de copiado al portapapeles
  readonly copiedRowId = signal<string | null>(null);
  private copiedTimeout: any;

  // Modales de confirmación
  readonly showDeleteModal = signal<boolean>(false);
  readonly cameraToDelete = signal<Camera | null>(null);
  readonly isDeletingCamera = signal<boolean>(false);

  readonly showDeleteAnalyticModal = signal<boolean>(false);
  readonly analyticToDelete = signal<Analytic | null>(null);
  readonly isDeletingAnalytic = signal<boolean>(false);

  // Reloj interno de tiempo
  readonly currentTime = signal<Date>(new Date());

  @HostListener('document:click')
  closeDropdowns(): void {
    this.activeAddScheduleDropdown.set(null);
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    if (this.showDeleteModal()) {
      this.closeDeleteModal();
    } else if (this.showDeleteAnalyticModal()) {
      this.closeDeleteAnalyticModal();
    } else if (this.show) {
      this.closeDrawer();
    }
  }

  closeDrawer(): void {
    this.isEditingCamera.set(false);
    this.close.emit();
  }

  startEditingCamera(cam: Camera): void {
    this.editCameraName = cam.name;
    this.editCameraLat = cam.location?.lat ?? 0;
    this.editCameraLon = cam.location?.lon ?? 0;
    this.isEditingCamera.set(true);
  }

  cancelEditingCamera(): void {
    this.isEditingCamera.set(false);
  }

  get isNameInvalid(): boolean {
    return !this.editCameraName || this.editCameraName.trim() === '';
  }

  get isLatInvalid(): boolean {
    if (this.editCameraLat === null || this.editCameraLat === undefined || isNaN(this.editCameraLat)) {
      return true;
    }
    return this.editCameraLat < -90 || this.editCameraLat > 90;
  }

  get isLonInvalid(): boolean {
    if (this.editCameraLon === null || this.editCameraLon === undefined || isNaN(this.editCameraLon)) {
      return true;
    }
    return this.editCameraLon < -180 || this.editCameraLon > 180;
  }

  get isFormInvalid(): boolean {
    return this.isNameInvalid || this.isLatInvalid || this.isLonInvalid;
  }

  saveCameraInfo(cam: Camera): void {
    if (this.isFormInvalid) {
      alert('Por favor, corrija los errores en el formulario antes de guardar.');
      return;
    }

    const body = {
      camera_name: this.editCameraName.trim(),
      location: {
        lat: Number(this.editCameraLat),
        lon: Number(this.editCameraLon)
      }
    };

    this.cameraService.updateCamera(cam.id, body).subscribe({
      next: () => {
        this.isEditingCamera.set(false);
        this.cameraUpdated.emit(cam);
      },
      error: (err) => {
        if (err?.status >= 400 && err?.status < 500) {
          console.error('Error updating camera:', err);
          alert('Error al guardar la información de la cámara. Por favor, intente de nuevo.');
        } else {
          console.warn('[CameraDetailDrawer] update 5xx swallowed:', err?.status);
          this.isEditingCamera.set(false);
          this.cameraUpdated.emit(cam);
        }
      }
    });
  }

  openDeleteModal(cam: Camera): void {
    this.cameraToDelete.set(cam);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.cameraToDelete.set(null);
    this.showDeleteModal.set(false);
  }

  confirmDeleteCamera(): void {
    const cam = this.cameraToDelete();
    if (!cam) return;

    this.isDeletingCamera.set(true);
    this.cameraService.deleteCamera(cam.id).subscribe({
      next: () => {
        this.isDeletingCamera.set(false);
        this.closeDeleteModal();
        this.cameraDeleted.emit(cam);
        this.closeDrawer();
      },
      error: (err) => {
        if (err?.status >= 400 && err?.status < 500) {
          console.error('Error deleting camera:', err);
          this.isDeletingCamera.set(false);
          alert('Error al eliminar la cámara. Por favor, intente de nuevo.');
        } else {
          console.warn('[CameraDetailDrawer] delete 5xx swallowed:', err?.status);
          this.isDeletingCamera.set(false);
          this.closeDeleteModal();
          this.cameraDeleted.emit(cam);
          this.closeDrawer();
        }
      }
    });
  }

  openDeleteAnalyticModal(analytic: Analytic): void {
    this.analyticToDelete.set(analytic);
    this.showDeleteAnalyticModal.set(true);
  }

  closeDeleteAnalyticModal(): void {
    this.analyticToDelete.set(null);
    this.showDeleteAnalyticModal.set(false);
  }

  confirmDeleteAnalytic(): void {
    const analytic = this.analyticToDelete();
    if (!analytic) return;

    this.isDeletingAnalytic.set(true);
    this.analyticService.deleteAnalytic(analytic.id).subscribe({
      next: () => {
        this.isDeletingAnalytic.set(false);
        this.closeDeleteAnalyticModal();
      },
      error: (err) => {
        if (err?.status >= 400 && err?.status < 500) {
          console.error('Error deleting analytic:', err);
          this.isDeletingAnalytic.set(false);
          alert('Error al eliminar la analítica. Por favor, intente de nuevo.');
        } else {
          console.warn('[CameraDetailDrawer] delete analytic 5xx swallowed:', err?.status);
          this.isDeletingAnalytic.set(false);
          this.closeDeleteAnalyticModal();
        }
      }
    });
  }

  isCameraOnline(cam: Camera | null | undefined): boolean {
    if (!cam || !cam.status) return false;
    const st = cam.status.toLowerCase();
    return st === 'online' || st === 'active';
  }

  getAnalyticsForCamera(cameraId: string): Analytic[] {
    return this.analytics().filter(a => (!this.hostId || a.hostFingerprint === this.hostId) && a.targetCameraIds.includes(cameraId));
  }

  normalizeAnalyticType(type: string): string {
    if (!type) return '';
    const clean = type.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const norm = clean.toLowerCase().replace(/[- ]/g, '_').trim();
    
    const variations: Record<string, string> = {
      objectdetection: 'object_detection',
      facerecognition: 'face_recognition',
      platerecognition: 'plate_recognition',
      peoplecounting: 'people_counting',
      intrusiondetection: 'intrusion_detection',
      comportamientohumano: 'comportamiento_humano',
      crucedelinea: 'cruce_de_linea',
      objetoenarea: 'objeto_en_area',
      deteccion_de_objetos: 'object_detection',
      deteccion_objetos: 'object_detection',
      reconocimiento_facial: 'face_recognition',
      lectura_de_placas: 'plate_recognition',
      lectura_placas: 'plate_recognition',
      conteo_de_personas: 'people_counting',
      conteo_personas: 'people_counting',
      deteccion_de_intrusion: 'intrusion_detection',
      deteccion_intrusion: 'intrusion_detection',
      cruce_de_linea: 'cruce_de_linea',
      objeto_en_area: 'objeto_en_area',
      comportamiento_humano: 'comportamiento_humano'
    };
    
    return variations[norm] ?? variations[norm.replace(/_/g, '')] ?? norm;
  }

  getAnalyticLabel(type: string): string {
    const norm = this.normalizeAnalyticType(type);
    const labels: Record<string, string> = {
      object_detection: 'Detección de Objetos',
      face_recognition: 'Reconocimiento Facial',
      plate_recognition: 'Lectura de Placas',
      people_counting: 'Conteo de Personas',
      intrusion_detection: 'Detección de Intrusión',
      comportamiento_humano: 'Comportamiento Humano',
      cruce_de_linea: 'Cruce de Línea',
      objeto_en_area: 'Objeto en Área',
    };
    return labels[norm] ?? type.replace(/_/g, ' ');
  }

  getAnalyticColor(type: string): string {
    const norm = this.normalizeAnalyticType(type);
    const colors: Record<string, string> = {
      object_detection: 'var(--color-analytic-object-detection)',
      face_recognition: 'var(--color-analytic-face-recognition)',
      plate_recognition: 'var(--color-analytic-plate-recognition)',
      people_counting: 'var(--color-analytic-people-counting)',
      intrusion_detection: 'var(--color-analytic-intrusion-detection)',
      comportamiento_humano: 'var(--color-analytic-comportamiento-humano)',
      cruce_de_linea: 'var(--color-analytic-cruce-de-linea)',
      objeto_en_area: 'var(--color-analytic-objeto-en-area)',
    };
    return colors[norm] ?? 'var(--color-analytic-unknown)';
  }

  toggleAnalyticStatus(analytic: Analytic): void {
    const newStatus = analytic.status === 'active' ? 'inactive' : 'active';
    this.analyticService.updateAnalyticStatus(analytic.id, newStatus).subscribe({
      next: () => {
        this.analyticService.analytics.update(all =>
          all.map(a => a.id === analytic.id ? { ...a, status: newStatus } : a)
        );
      },
      error: (err) => {
        console.error('Error toggling analytic status:', err);
        alert('Error al cambiar el estado de la analítica en caliente. Por favor, intente de nuevo.');
        this.analyticService.analytics.update(all => [...all]);
      }
    });
  }

  getSchedulesForAnalytic(analyticId: string): Schedule[] {
    return this.schedules().filter(s => s.analyticIds.includes(analyticId));
  }

  getUnassociatedSchedules(analyticId: string): Schedule[] {
    return this.schedules().filter(s => !s.analyticIds.includes(analyticId) && s.status === 'activo');
  }

  toggleAnalyticDetails(analyticId: string): void {
    this.expandedAnalyticIds.update(set => {
      const newSet = new Set(set);
      if (newSet.has(analyticId)) {
        newSet.delete(analyticId);
      } else {
        newSet.add(analyticId);
      }
      return newSet;
    });
  }

  isAnalyticDetailsExpanded(analyticId: string): boolean {
    return this.expandedAnalyticIds().has(analyticId);
  }

  toggleScheduleAssociation(schedule: Schedule, analyticId: string, associate: boolean): void {
    const currentAnalyticIds = schedule.analyticIds;
    let newAnalyticIds: string[];
    if (associate) {
      newAnalyticIds = [...currentAnalyticIds, analyticId];
    } else {
      newAnalyticIds = currentAnalyticIds.filter(id => id !== analyticId);
    }

    const formatPayloadDate = (d: Date): string => {
      const pad = (num: number) => num.toString().padStart(2, '0');
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    };

    const payload = {
      nombre: schedule.name,
      fingerprint_host: schedule.hostFingerprint || '',
      analytics_ids: newAnalyticIds.map(id => ({ id_analytic: id })),
      timestamp_inicio: formatPayloadDate(schedule.start),
      timestamp_fin: formatPayloadDate(schedule.end),
      frecuencia: schedule.frequency,
      estado: schedule.status
    };

    this.scheduleService.updateSchedule(schedule.id, payload).subscribe({
      next: () => {
        const updatedSchedule: Schedule = {
          ...schedule,
          analyticIds: newAnalyticIds
        };
        this.scheduleService.addOrUpdateScheduleLocal(updatedSchedule);
      },
      error: (err) => {
        console.error('[CameraDetailDrawerComponent] toggleScheduleAssociation failed:', err);
      }
    });
  }

  toggleAddScheduleDropdown(analyticId: string, event: Event): void {
    event.stopPropagation();
    this.activeAddScheduleDropdown.update(cur => cur === analyticId ? null : analyticId);
  }

  getScheduleDateLabelCompact(sched: Schedule): string {
    const pad = (num: number) => num.toString().padStart(2, '0');
    const yStart = sched.start.getFullYear().toString().slice(-2);
    const yEnd = sched.end.getFullYear().toString().slice(-2);
    
    const dStart = `${pad(sched.start.getDate())}/${pad(sched.start.getMonth() + 1)}/${yStart}`;
    const dEnd = `${pad(sched.end.getDate())}/${pad(sched.end.getMonth() + 1)}/${yEnd}`;
    
    return dStart === dEnd ? dStart : `${dStart} al ${dEnd}`;
  }

  getScheduleTimeLabelCompact(sched: Schedule): string {
    const pad = (num: number) => num.toString().padStart(2, '0');
    const tStart = `${pad(sched.start.getHours())}:${pad(sched.start.getMinutes())}`;
    const tEnd = `${pad(sched.end.getHours())}:${pad(sched.end.getMinutes())}`;
    return `${tStart} a ${tEnd}`;
  }

  copyRowContent(value: string, uniqueKey: string): void {
    if (!value) return;
    copyToClipboard(value).then(() => {
      this.copiedRowId.set(uniqueKey);
      if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
      this.copiedTimeout = setTimeout(() => {
        this.copiedRowId.set(null);
      }, 2000);
    }).catch(err => {
      console.error('Error al copiar al portapapeles', err);
    });
  }
}
