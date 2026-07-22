import { Component, OnInit, OnDestroy, inject, signal, computed, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { HostService } from '../../../core/services/host.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { Schedule, ScheduleMapper } from '../../../core/domain/entities/schedule.models';

import { ICameraRepository } from '../../../core/domain/repositories/camera.repository';
import { IAnalyticRepository } from '../../../core/domain/repositories/analytic.repository';
import { Host } from '../../../core/domain/entities/host.models';
import { Camera } from '../../../core/domain/entities/camera.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { ConfirmDeleteModalComponent } from '../../shared/confirm-delete-modal/confirm-delete-modal.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';

function getDateString(d: Date): string {
  const pad = (num: number) => num.toString().padStart(2, '0');
  // Mostrar en hora LOCAL del usuario (el backend almacena UTC con Z,
  // parseUtcDate lo convierte correctamente, y getFullYear/Month/Date devuelven hora local)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getTimeString(d: Date): string {
  const pad = (num: number) => num.toString().padStart(2, '0');
  // Mostrar en hora LOCAL del usuario
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

@Component({
  selector: 'app-horarios',
  standalone: true,
  imports: [CommonModule, FormsModule, ConfirmDeleteModalComponent, PageHeaderComponent],
  templateUrl: './horarios.html',
  styleUrl: './horarios.css',
})
export class Horarios implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private hostService = inject(HostService);
  private scheduleService = inject(ScheduleService);
  public permissionsService = inject(PermissionsService);
  private sidebarService = inject(SidebarService);
  private cameraRepo = inject(ICameraRepository);
  private analyticRepo = inject(IAnalyticRepository);

  readonly selectedScheduleId = signal<string | null>(null);
  
  readonly scheduleNewIds = this.scheduleService.newRecordIds;
  readonly scheduleUpdatedIds = this.scheduleService.updatedRecordIds;
  readonly scheduleDeletingIds = this.scheduleService.deletingRecordIds;
  readonly scheduleActiveStatusIds = this.scheduleService.activeStatusIds;
  readonly scheduleInactiveStatusIds = this.scheduleService.inactiveStatusIds;

  readonly expandedHosts = signal<boolean>(false);
  readonly expandedCameras = signal<boolean>(false);
  readonly expandedAnalytics = signal<boolean>(false);

  readonly selectedSchedule = computed(() => {
    const id = this.selectedScheduleId();
    if (!id) return null;
    return this.allSchedules().find(s => s.id === id) || null;
  });

  readonly allHostsList = signal<Host[]>([]);
  readonly allCamerasList = signal<Camera[]>([]);
  readonly allAnalyticsList = signal<Analytic[]>([]);

  readonly selectedScheduleAnalytics = computed(() => {
    const sched = this.selectedSchedule();
    if (!sched || !sched.analyticIds) return [];
    return this.allAnalyticsList().filter(a => sched.analyticIds.includes(a.id));
  });

  readonly uniqueSelectedScheduleAnalytics = computed(() => {
    const analytics = this.selectedScheduleAnalytics();
    const seen = new Set<string>();
    const unique: Analytic[] = [];
    analytics.forEach(a => {
      const typeLabel = this.getAnalyticLabel(a.type);
      const classesStr = (a.detectionClasses || []).slice().sort().join(',');
      const key = `${typeLabel}_${classesStr}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(a);
      }
    });
    return unique;
  });

  readonly activeHostFilters = signal<string[]>([]);
  readonly activeCameraFilters = signal<string[]>([]);
  readonly activeAnalyticFilters = signal<string[]>([]);

  readonly filteredScheduleHosts = computed(() => {
    const hosts = this.selectedScheduleHosts();
    const activeCams = this.activeCameraFilters();
    const activeAns = this.activeAnalyticFilters();

    if (activeCams.length > 0) {
      const cameras = this.selectedScheduleCameras().filter(c => activeCams.includes(c.id));
      const fingerprints = cameras.map(c => c.hostFingerprint);
      return hosts.filter(h => fingerprints.includes(h.fingerprint));
    }

    if (activeAns.length > 0) {
      const allAnalytics = this.selectedScheduleAnalytics();
      const uniqueAnalytics = this.uniqueSelectedScheduleAnalytics();
      const activeSigs = uniqueAnalytics
        .filter(ua => activeAns.includes(ua.id))
        .map(ua => `${ua.type}_${(ua.detectionClasses || []).slice().sort().join(',')}`);
      
      const matchingAnalytics = allAnalytics.filter(a => {
        const sig = `${a.type}_${(a.detectionClasses || []).slice().sort().join(',')}`;
        return activeSigs.includes(sig);
      });
      const fingerprints = matchingAnalytics.map(a => a.hostFingerprint);
      return hosts.filter(h => fingerprints.includes(h.fingerprint));
    }

    return hosts;
  });

  readonly filteredScheduleCameras = computed(() => {
    const cameras = this.selectedScheduleCameras();
    const activeHosts = this.activeHostFilters();
    const activeAns = this.activeAnalyticFilters();

    if (activeHosts.length > 0) {
      return cameras.filter(c => activeHosts.includes(c.hostFingerprint));
    }

    if (activeAns.length > 0) {
      const allAnalytics = this.selectedScheduleAnalytics();
      const uniqueAnalytics = this.uniqueSelectedScheduleAnalytics();
      const activeSigs = uniqueAnalytics
        .filter(ua => activeAns.includes(ua.id))
        .map(ua => `${ua.type}_${(ua.detectionClasses || []).slice().sort().join(',')}`);

      const matchingAnalytics = allAnalytics.filter(a => {
        const sig = `${a.type}_${(a.detectionClasses || []).slice().sort().join(',')}`;
        return activeSigs.includes(sig);
      });
      
      const camIds = new Set<string>();
      matchingAnalytics.forEach(a => {
        if (a.targetCameraIds) {
          a.targetCameraIds.forEach(id => camIds.add(id));
        }
      });
      return cameras.filter(c => camIds.has(c.id));
    }

    return cameras;
  });

  readonly filteredScheduleAnalytics = computed(() => {
    const uniqueAnalytics = this.uniqueSelectedScheduleAnalytics();
    const activeHosts = this.activeHostFilters();
    const activeCams = this.activeCameraFilters();

    if (activeHosts.length > 0) {
      return uniqueAnalytics.filter(ua => activeHosts.includes(ua.hostFingerprint));
    }

    if (activeCams.length > 0) {
      const allAnalytics = this.selectedScheduleAnalytics();
      const matchingAnalytics = allAnalytics.filter(a => 
        a.targetCameraIds && a.targetCameraIds.some(id => activeCams.includes(id))
      );
      const matchingSigs = new Set(matchingAnalytics.map(a => 
        `${a.type}_${(a.detectionClasses || []).slice().sort().join(',')}`
      ));
      return uniqueAnalytics.filter(ua => {
        const sig = `${ua.type}_${(ua.detectionClasses || []).slice().sort().join(',')}`;
        return matchingSigs.has(sig);
      });
    }

    return uniqueAnalytics;
  });

  readonly selectedScheduleHosts = computed(() => {
    const analytics = this.selectedScheduleAnalytics();
    if (analytics.length === 0) return [];
    const hostFps = Array.from(new Set(analytics.map(a => a.hostFingerprint)));
    return this.allHostsList().filter(h => hostFps.includes(h.fingerprint));
  });

  readonly selectedScheduleCameras = computed(() => {
    const analytics = this.selectedScheduleAnalytics();
    if (analytics.length === 0) return [];
    const camerasMap = new Map<string, { id: string; name: string; hostFingerprint: string }>();
    analytics.forEach(a => {
      if (a.targetCameraIds && a.targetCameraNames) {
        a.targetCameraIds.forEach((id, idx) => {
          const name = a.targetCameraNames[idx] || id;
          camerasMap.set(id, {
            id,
            name,
            hostFingerprint: a.hostFingerprint
          });
        });
      }
    });
    return Array.from(camerasMap.values());
  });

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;
  readonly allSchedules = this.scheduleService.schedules;
  readonly isLoading = signal(false);

  constructor() {}

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  navigateToHost(fingerprint: string): void {
    this.router.navigate(['/dashboard/nodos', fingerprint, 'camaras']);
  }

  navigateToCamera(hostFingerprint: string, cameraId: string): void {
    this.router.navigate(['/dashboard/nodos', hostFingerprint, 'camaras'], {
      queryParams: { camera: cameraId }
    });
  }

  navigateToAnalytic(hostFingerprint: string, cameraId: string, analyticId: string): void {
    const qParams: any = { analytic: analyticId };
    if (cameraId) {
      qParams['camera'] = cameraId;
    }
    this.router.navigate(['/dashboard/nodos', hostFingerprint, 'camaras'], {
      queryParams: qParams
    });
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    this.activeCalendarField.set(null);
    this.activeTimeField.set(null);
  }

  checkIsCrossMidnight(): boolean {
    const isEditing = !!this.editingScheduleId();
    const tStart = isEditing ? this.editingScheduleTimeStart() : this.newScheduleTimeStart();
    const tEnd = isEditing ? this.editingScheduleTimeEnd() : this.newScheduleTimeEnd();
    if (!tStart || !tEnd) return false;
    const [sh, sm] = tStart.split(':').map(Number);
    const [eh, em] = tEnd.split(':').map(Number);
    return eh * 60 + em <= sh * 60 + sm;
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
      plate_recognition: 'Reconocimiento de Placas',
      people_counting: 'Conteo de Personas',
      intrusion_detection: 'Detección de Intrusión',
      cruce_de_linea: 'Cruce de Línea',
      objeto_en_area: 'Objeto en Área',
      comportamiento_humano: 'Comportamiento Humano'
    };
    return labels[norm] ?? type;
  }





  // Reloj interno para el estado dinámico "Ejecutando"
  readonly currentTime = signal<Date>(new Date());
  private timerId: any;

  // Lógica de eliminación de horario (modal de confirmación)
  readonly showDeleteScheduleModal = signal<boolean>(false);
  readonly scheduleToDelete = signal<Schedule | null>(null);
  readonly isDeletingSchedule = signal<boolean>(false);

  // Modales de Creación y Edición
  readonly showCreateScheduleModal = signal<boolean>(false);
  readonly showEditScheduleModal = signal<boolean>(false);

  readonly showCreateForm = signal(true);
  readonly newScheduleName = signal('');

  readonly newScheduleDateStart = signal('');
  readonly newScheduleTimeStart = signal('');
  readonly newScheduleDateEnd = signal('');
  readonly newScheduleTimeEnd = signal('');
  readonly newScheduleFrequency = signal<'diario' | 'semanal' | 'mensual' | ''>('');

  // Variables de Edición
  readonly editingScheduleId = signal<string | null>(null);
  readonly editingScheduleName = signal('');

  readonly editingScheduleDateStart = signal('');
  readonly editingScheduleTimeStart = signal('');
  readonly editingScheduleDateEnd = signal('');
  readonly editingScheduleTimeEnd = signal('');
  readonly editingScheduleFrequency = signal<'diario' | 'semanal' | 'mensual' | ''>('diario');
  readonly editingScheduleSelectedAnalyticIds = signal<string[]>([]);

  // ── Popover de Calendario y Hora Customizados ──
  readonly activeCalendarField = signal<'newRange' | 'editingRange' | null>(null);
  readonly activeTimeField = signal<'newStart' | 'newEnd' | 'editingStart' | 'editingEnd' | null>(null);
  readonly calendarViewMonth = signal<number>(new Date().getMonth());
  readonly calendarViewYear = signal<number>(new Date().getFullYear());
  readonly isSelectingRange = signal<boolean>(false);
  readonly tempDateStart = signal<string>('');
  readonly tempDateEnd = signal<string>('');
  readonly hoursList = Array.from({ length: 24 }, (_, i) => i);
  readonly minutesList = Array.from({ length: 60 }, (_, i) => i);
  readonly infiniteHours = [...this.hoursList, ...this.hoursList, ...this.hoursList];
  readonly infiniteMinutes = [...this.minutesList, ...this.minutesList, ...this.minutesList];

  readonly calendarGrid = computed(() => {
    const year = this.calendarViewYear();
    const month = this.calendarViewMonth();
    const firstDayIndex = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    const emptyDays = Array.from({ length: firstDayIndex }, (_, i) => i);
    const days = Array.from({ length: totalDays }, (_, i) => i + 1);
    
    return { emptyDays, days };
  });

  // Lista de horarios completa ordenada alfabéticamente
  readonly filteredSchedules = computed(() => {
    return [...this.allSchedules()].sort((a, b) => a.name.localeCompare(b.name));
  });

  // calendarGrid removido por uso de selectores nativos

  readonly newScheduleRemainingRepetitions = computed(() => {
    const dStart = this.newScheduleDateStart();
    const tStart = this.newScheduleTimeStart();
    const dEnd = this.newScheduleDateEnd();
    const tEnd = this.newScheduleTimeEnd();
    const freq = this.newScheduleFrequency();
    if (!dStart || !tStart || !dEnd || !tEnd || !freq) return 0;
    try {
      const start = new Date(`${dStart}T${tStart}:00`);
      const end = new Date(`${dEnd}T${tEnd}:00`);
      return this.getRemainingRepetitions(start, end, freq, this.currentTime());
    } catch {
      return 0;
    }
  });

  readonly editingScheduleRemainingRepetitions = computed(() => {
    const dStart = this.editingScheduleDateStart();
    const tStart = this.editingScheduleTimeStart();
    const dEnd = this.editingScheduleDateEnd();
    const tEnd = this.editingScheduleTimeEnd();
    const freq = this.editingScheduleFrequency();
    if (!dStart || !tStart || !dEnd || !tEnd || !freq) return 0;
    try {
      const start = new Date(`${dStart}T${tStart}:00`);
      const end = new Date(`${dEnd}T${tEnd}:00`);
      return this.getRemainingRepetitions(start, end, freq, this.currentTime());
    } catch {
      return 0;
    }
  });

  ngOnInit(): void {
    this.scheduleService.isViewActive.set(true);
    this.loadAllSchedules();
    this.loadAllAssociationDetails();
 
    // Actualizar reloj cada segundo
    this.timerId = setInterval(() => {
      this.currentTime.set(new Date());
    }, 1000);
  }
 
  ngOnDestroy(): void {
    this.scheduleService.isViewActive.set(false);
    if (this.timerId) {
      clearInterval(this.timerId);
    }
  }

  loadAllSchedules(): void {
    this.isLoading.set(true);
    this.scheduleService.getAllSchedules().pipe(
      catchError(() => of([]))
    ).subscribe(() => {
      this.isLoading.set(false);
      this.loadAllAssociationDetails();
    });
  }

  loadAllAssociationDetails(): void {
    this.hostService.loadAllHosts().subscribe({
      next: (hosts) => {
        this.allHostsList.set(hosts);

        // Cargar todas las cámaras en una sola petición global
        this.cameraRepo.getAll().subscribe({
          next: (cams) => {
            this.allCamerasList.set(cams || []);
          },
          error: (err) => {
            console.error('[HorariosComponent] Error fetching all cameras:', err);
            this.allCamerasList.set([]);
          }
        });

        // Cargar todas las analíticas en una sola petición global
        this.analyticRepo.getAll().subscribe({
          next: (analytics) => {
            this.allAnalyticsList.set(analytics || []);
          },
          error: (err) => {
            console.error('[HorariosComponent] Error fetching all analytics:', err);
            this.allAnalyticsList.set([]);
          }
        });
      }
    });
  }

  isScheduleActive(schedule: Schedule): boolean {
    if (!schedule || schedule.status !== 'activo') {
      return false;
    }
    if (!schedule.analyticIds || schedule.analyticIds.length === 0) {
      return false;
    }
    if (!schedule.start || !schedule.end || isNaN(schedule.start.getTime()) || isNaN(schedule.end.getTime())) {
      return false;
    }
    const now = this.currentTime();
    
    if (schedule.frequency === 'diario') {
      // Comparar ambos en hora LOCAL: la hora actual local vs la hora almacenada en UTC
      // (convertida a local por JS al usar getHours/getMinutes)
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = schedule.start.getHours() * 60 + schedule.start.getMinutes();
      const endMinutes = schedule.end.getHours() * 60 + schedule.end.getMinutes();
      
      if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      } else {
        return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
      }
    }
    
    return now >= schedule.start && now <= schedule.end;
  }

  toggleScheduleStatus(sched: Schedule, event: Event): void {
    event.stopPropagation();
    const nextStatus = sched.status === 'activo' ? 'inactivo' : 'activo';
    this.scheduleService.updateScheduleState(sched.id, nextStatus).subscribe({
      next: () => {
        this.scheduleService.updateScheduleStatusLocal(sched.id, nextStatus);
      },
      error: (err) => {
        console.error('[HorariosComponent] Failed to toggle schedule state:', err);
        alert('Ocurrió un error al cambiar el estado del horario.');
        // Forzar actualización del switch en la UI para revertir la posición visual
        this.scheduleService.schedules.update(all => [...all]);
      }
    });
  }



  // ── Métodos de Calendario Customizado ──────────────────────────────────────

  getMonths(): string[] {
    return [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
  }

  onNewScheduleFrequencyChange(freq: 'diario' | 'semanal' | 'mensual'): void {
    this.newScheduleFrequency.set(freq);
    this.adjustRangeOnFrequencyChange('new', freq);
    if (this.activeCalendarField() === 'newRange') {
      this.adjustTempRangeOnFrequencyChange(freq);
    }
  }

  onEditingScheduleFrequencyChange(freq: 'diario' | 'semanal' | 'mensual'): void {
    this.editingScheduleFrequency.set(freq);
    this.adjustRangeOnFrequencyChange('editing', freq);
    if (this.activeCalendarField() === 'editingRange') {
      this.adjustTempRangeOnFrequencyChange(freq);
    }
  }

  isCalendarSelectionValid(): boolean {
    const startStr = this.tempDateStart();
    const endStr = this.tempDateEnd();
    if (!startStr || !endStr) return false;
    
    const freq = this.editingScheduleId() ? this.editingScheduleFrequency() : this.newScheduleFrequency();
    const dStart = new Date(startStr);
    const dEnd = new Date(endStr);
    
    if (dEnd < dStart) return false;
    
    const diffTime = dEnd.getTime() - dStart.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    const isCrossMidnight = this.checkIsCrossMidnight();
    
    if (freq === 'diario') {
      const expectedDiff = isCrossMidnight ? 2 : 1;
      return diffDays === expectedDiff;
    } else if (freq === 'semanal') {
      const maxDiff = isCrossMidnight ? 8 : 7;
      return diffDays <= maxDiff;
    } else if (freq === 'mensual') {
      const daysInStartMonth = new Date(dStart.getFullYear(), dStart.getMonth() + 1, 0).getDate();
      const maxDiff = isCrossMidnight ? (daysInStartMonth + 1) : daysInStartMonth;
      return diffDays <= maxDiff;
    }
    return true;
  }

  getCalendarValidationWarning(): string {
    const startStr = this.tempDateStart();
    const endStr = this.tempDateEnd();
    if (!startStr || !endStr) return '';
    
    const freq = this.editingScheduleId() ? this.editingScheduleFrequency() : this.newScheduleFrequency();
    const dStart = new Date(startStr);
    const dEnd = new Date(endStr);
    
    if (dEnd < dStart) {
      return 'La fecha de fin no puede ser anterior a la fecha de inicio.';
    }
    
    const diffTime = dEnd.getTime() - dStart.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    const isCrossMidnight = this.checkIsCrossMidnight();
    
    if (freq === 'diario') {
      const expectedDiff = isCrossMidnight ? 2 : 1;
      if (diffDays !== expectedDiff) {
        return isCrossMidnight 
          ? 'El horario nocturno/24h diario requiere abarcar hasta el día siguiente (2 fechas consecutivas).'
          : 'El horario diario estándar requiere la misma fecha de inicio y fin (1 día).';
      }
    } else if (freq === 'semanal') {
      const maxDiff = isCrossMidnight ? 8 : 7;
      if (diffDays > maxDiff) {
        return `Frecuencia semanal permite un rango máximo de ${maxDiff} días (seleccionado: ${diffDays} días).`;
      }
    } else if (freq === 'mensual') {
      const daysInStartMonth = new Date(dStart.getFullYear(), dStart.getMonth() + 1, 0).getDate();
      const maxDiff = isCrossMidnight ? (daysInStartMonth + 1) : daysInStartMonth;
      if (diffDays > maxDiff) {
        return `Frecuencia mensual permite un rango máximo de ${maxDiff} días (seleccionado: ${diffDays} días).`;
      }
    }
    return '';
  }

  isFormValid(): boolean {
    const isEditing = !!this.editingScheduleId();
    const name = isEditing ? this.editingScheduleName() : this.newScheduleName();
    const dStart = isEditing ? this.editingScheduleDateStart() : this.newScheduleDateStart();
    const dEnd = isEditing ? this.editingScheduleDateEnd() : this.newScheduleDateEnd();
    const tStart = isEditing ? this.editingScheduleTimeStart() : this.newScheduleTimeStart();
    const tEnd = isEditing ? this.editingScheduleTimeEnd() : this.newScheduleTimeEnd();
    
    if (!name.trim() || !dStart || !dEnd || !tStart || !tEnd) return false;
    
    const start = new Date(`${dStart}T${tStart}:00`);
    const end = new Date(`${dEnd}T${tEnd}:00`);
    
    if (end < start) return false;
    
    const freq = isEditing ? this.editingScheduleFrequency() : this.newScheduleFrequency();
    const diffTime = new Date(dEnd).getTime() - new Date(dStart).getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    const isCrossMidnight = this.checkIsCrossMidnight();
    
    if (freq === 'diario') {
      const expectedDiff = isCrossMidnight ? 2 : 1;
      return diffDays === expectedDiff;
    } else if (freq === 'semanal') {
      const maxDiff = isCrossMidnight ? 8 : 7;
      return diffDays >= 1 && diffDays <= maxDiff;
    } else if (freq === 'mensual') {
      const startDate = new Date(`${dStart}T00:00:00`);
      const daysInStartMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
      const maxDiff = isCrossMidnight ? (daysInStartMonth + 1) : daysInStartMonth;
      return diffDays >= 1 && diffDays <= maxDiff;
    }
    
    return true;
  }

  // ── Métodos de Calendario y Reloj Popover ──
  
  formatDateLabel(dateStr: string): string {
    if (!dateStr) return '';
    try {
      const d = new Date(`${dateStr}T00:00:00`);
      const days = ['dom.', 'lun.', 'mar.', 'mié.', 'jue.', 'vie.', 'sáb.'];
      const months = ['ene.', 'feb.', 'mar.', 'abr.', 'may.', 'jun.', 'jul.', 'ago.', 'sep.', 'oct.', 'nov.', 'dic.'];
      return `${days[d.getDay()]}, ${d.getDate()} de ${months[d.getMonth()]}`;
    } catch {
      return dateStr;
    }
  }

  isPrevCalendarMonthDisabled(): boolean {
    const now = new Date();
    const currentYear = this.calendarViewYear();
    const currentMonth = this.calendarViewMonth();
    return currentYear < now.getFullYear() || (currentYear === now.getFullYear() && currentMonth <= now.getMonth());
  }

  prevCalendarMonth(event: Event): void {
    event.stopPropagation();
    if (this.isPrevCalendarMonthDisabled()) return;
    if (this.calendarViewMonth() > 0) {
      this.calendarViewMonth.update(m => m - 1);
    } else {
      this.calendarViewMonth.set(11);
      this.calendarViewYear.update(y => y - 1);
    }
  }

  nextCalendarMonth(event: Event): void {
    event.stopPropagation();
    if (this.calendarViewMonth() < 11) {
      this.calendarViewMonth.update(m => m + 1);
    } else {
      this.calendarViewMonth.set(0);
      this.calendarViewYear.update(y => y + 1);
    }
  }

  isCalendarDateSelected(day: number): boolean {
    const field = this.activeCalendarField();
    if (!field) return false;
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const target = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    
    return this.tempDateStart() === target || this.tempDateEnd() === target;
  }

  isCalendarDateInRange(day: number): boolean {
    const field = this.activeCalendarField();
    if (!field) return false;
    
    const startStr = this.tempDateStart();
    const endStr = this.tempDateEnd();
    if (!startStr || !endStr || startStr === endStr) return false;
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const targetStr = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    
    const targetTime = new Date(targetStr).getTime();
    const startTime = new Date(startStr).getTime();
    const endTime = new Date(endStr).getTime();
    
    return targetTime > startTime && targetTime < endTime;
  }

  isCalendarDayDisabled(day: number): boolean {
    const field = this.activeCalendarField();
    if (!field) return true;
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dTarget = new Date(this.calendarViewYear(), this.calendarViewMonth(), day);
    
    // Deshabilitar días anteriores a hoy
    if (dTarget < today) return true;
    
    // Para selección de rango, deshabilitar días anteriores a la fecha de inicio ya seleccionada
    if (this.isSelectingRange()) {
      const parseLocalDate = (dateStr: string) => {
        const parts = dateStr.split('-');
        return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
      };
      const dStart = parseLocalDate(this.tempDateStart());
      if (dTarget < dStart) return true;
      
      const diffTime = dTarget.getTime() - dStart.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
      const freq = this.getActiveCalendarFrequency();
      const isCrossMidnight = this.checkIsCrossMidnight();
      
      const maxWeekly = isCrossMidnight ? 8 : 7;
      if (freq === 'semanal' && diffDays > maxWeekly) return true;
      if (freq === 'mensual') {
        const daysInStartMonth = new Date(dStart.getFullYear(), dStart.getMonth() + 1, 0).getDate();
        const maxMonthly = isCrossMidnight ? (daysInStartMonth + 1) : daysInStartMonth;
        if (diffDays > maxMonthly) return true;
      }
    }
    
    return false;
  }

  getActiveCalendarFrequency(): 'diario' | 'semanal' | 'mensual' {
    const isEditing = !!this.editingScheduleId();
    const freq = isEditing ? this.editingScheduleFrequency() : this.newScheduleFrequency();
    return freq || 'diario';
  }

  selectCalendarDay(day: number): void {
    const field = this.activeCalendarField();
    if (!field) return;
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const dateStr = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    const freq = this.getActiveCalendarFrequency();
    
    if (freq === 'diario') {
      this.tempDateStart.set(dateStr);
      this.tempDateEnd.set(dateStr);
      this.isSelectingRange.set(false);
      this.applyCalendarSelection();
      return;
    }
    
    if (!this.isSelectingRange()) {
      this.tempDateStart.set(dateStr);
      this.tempDateEnd.set(dateStr);
      this.isSelectingRange.set(true);
    } else {
      const startVal = this.tempDateStart();
      if (startVal) {
        const startTime = new Date(startVal).getTime();
        const clickedTime = new Date(dateStr).getTime();
        if (clickedTime < startTime) {
          this.tempDateStart.set(dateStr);
          this.tempDateEnd.set(startVal);
        } else {
          this.tempDateEnd.set(dateStr);
        }
      } else {
        this.tempDateStart.set(dateStr);
        this.tempDateEnd.set(dateStr);
      }
      this.isSelectingRange.set(false);
      this.applyCalendarSelection();
    }
  }

  clearCalendarSelection(): void {
    this.tempDateStart.set('');
    this.tempDateEnd.set('');
    this.isSelectingRange.set(false);
  }

  applyCalendarSelection(): void {
    const field = this.activeCalendarField();
    if (!field) return;
    
    if (field === 'newRange') {
      this.newScheduleDateStart.set(this.tempDateStart());
      this.newScheduleDateEnd.set(this.tempDateEnd());
    } else if (field === 'editingRange') {
      this.editingScheduleDateStart.set(this.tempDateStart());
      this.editingScheduleDateEnd.set(this.tempDateEnd());
    }
    
    this.activeCalendarField.set(null);
  }

  openCalendar(field: 'newRange' | 'editingRange', event: Event): void {
    event.stopPropagation();
    if (this.activeCalendarField() === field) {
      this.activeCalendarField.set(null);
      return;
    }
    const dateStr = field === 'newRange' ? this.newScheduleDateStart() : this.editingScheduleDateStart();
    
    this.tempDateStart.set(field === 'newRange' ? this.newScheduleDateStart() : this.editingScheduleDateStart());
    this.tempDateEnd.set(field === 'newRange' ? this.newScheduleDateEnd() : this.editingScheduleDateEnd());
    this.isSelectingRange.set(false);
    
    if (dateStr) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        if (!isNaN(y)) this.calendarViewYear.set(y);
        if (!isNaN(m) && m >= 0 && m <= 11) this.calendarViewMonth.set(m);
      }
    } else {
      this.calendarViewMonth.set(new Date().getMonth());
      this.calendarViewYear.set(new Date().getFullYear());
    }
    
    this.activeCalendarField.set(field);
    this.activeTimeField.set(null);
  }

  // ── Métodos de Hora Customizados ──

  getTimeParts(timeStr: string): { hour: number; minute: number } {
    if (!timeStr) return { hour: 0, minute: 0 };
    const parts = timeStr.split(':');
    return {
      hour: parseInt(parts[0], 10) || 0,
      minute: parseInt(parts[1], 10) || 0
    };
  }

  isTimeHourSelected(h: number): boolean {
    const field = this.activeTimeField();
    let timeStr = '';
    if (field === 'newStart') timeStr = this.newScheduleTimeStart();
    else if (field === 'newEnd') timeStr = this.newScheduleTimeEnd();
    else if (field === 'editingStart') timeStr = this.editingScheduleTimeStart();
    else if (field === 'editingEnd') timeStr = this.editingScheduleTimeEnd();
    return this.getTimeParts(timeStr).hour === h;
  }

  isTimeMinuteSelected(m: number): boolean {
    const field = this.activeTimeField();
    let timeStr = '';
    if (field === 'newStart') timeStr = this.newScheduleTimeStart();
    else if (field === 'newEnd') timeStr = this.newScheduleTimeEnd();
    else if (field === 'editingStart') timeStr = this.editingScheduleTimeStart();
    else if (field === 'editingEnd') timeStr = this.editingScheduleTimeEnd();
    return this.getTimeParts(timeStr).minute === m;
  }

  selectTimeHour(h: number): void {
    const field = this.activeTimeField();
    let timeStr = '';
    if (field === 'newStart') timeStr = this.newScheduleTimeStart();
    else if (field === 'newEnd') timeStr = this.newScheduleTimeEnd();
    else if (field === 'editingStart') timeStr = this.editingScheduleTimeStart();
    else if (field === 'editingEnd') timeStr = this.editingScheduleTimeEnd();
    
    const parts = this.getTimeParts(timeStr);
    const pad = (num: number) => num.toString().padStart(2, '0');
    const newTimeStr = `${pad(h)}:${pad(parts.minute)}`;
    
    if (field === 'newStart') this.newScheduleTimeStart.set(newTimeStr);
    else if (field === 'newEnd') this.newScheduleTimeEnd.set(newTimeStr);
    else if (field === 'editingStart') this.editingScheduleTimeStart.set(newTimeStr);
    else if (field === 'editingEnd') this.editingScheduleTimeEnd.set(newTimeStr);

    if (field) {
      const type = field.startsWith('new') ? 'new' : 'editing';
      const freq = type === 'new' ? this.newScheduleFrequency() : this.editingScheduleFrequency();
      if (freq) {
        this.adjustRangeOnFrequencyChange(type, freq);
      }
    }
  }

  selectTimeMinute(m: number): void {
    const field = this.activeTimeField();
    let timeStr = '';
    if (field === 'newStart') timeStr = this.newScheduleTimeStart();
    else if (field === 'newEnd') timeStr = this.newScheduleTimeEnd();
    else if (field === 'editingStart') timeStr = this.editingScheduleTimeStart();
    else if (field === 'editingEnd') timeStr = this.editingScheduleTimeEnd();
    
    const parts = this.getTimeParts(timeStr);
    const pad = (num: number) => num.toString().padStart(2, '0');
    const newTimeStr = `${pad(parts.hour)}:${pad(m)}`;
    
    if (field === 'newStart') this.newScheduleTimeStart.set(newTimeStr);
    else if (field === 'newEnd') this.newScheduleTimeEnd.set(newTimeStr);
    else if (field === 'editingStart') this.editingScheduleTimeStart.set(newTimeStr);
    else if (field === 'editingEnd') this.editingScheduleTimeEnd.set(newTimeStr);
    
    this.activeTimeField.set(null); // Cerrar al seleccionar los minutos

    if (field) {
      const type = field.startsWith('new') ? 'new' : 'editing';
      const freq = type === 'new' ? this.newScheduleFrequency() : this.editingScheduleFrequency();
      if (freq) {
        this.adjustRangeOnFrequencyChange(type, freq);
      }
    }
  }

  openTimePicker(field: 'newStart' | 'newEnd' | 'editingStart' | 'editingEnd', event: Event): void {
    event.stopPropagation();
    if (this.activeTimeField() === field) {
      this.activeTimeField.set(null);
    } else {
      this.activeTimeField.set(field);
      this.activeCalendarField.set(null);
      
      // Inicializar si está vacío
      let timeStr = '';
      if (field === 'newStart') timeStr = this.newScheduleTimeStart();
      else if (field === 'newEnd') timeStr = this.newScheduleTimeEnd();
      else if (field === 'editingStart') timeStr = this.editingScheduleTimeStart();
      else if (field === 'editingEnd') timeStr = this.editingScheduleTimeEnd();
      
      if (!timeStr) {
        const defaultTime = '08:00';
        if (field === 'newStart') this.newScheduleTimeStart.set(defaultTime);
        else if (field === 'newEnd') this.newScheduleTimeEnd.set(defaultTime);
        else if (field === 'editingStart') this.editingScheduleTimeStart.set(defaultTime);
        else if (field === 'editingEnd') this.editingScheduleTimeEnd.set(defaultTime);
      }

      // Inicializar scroll infinito en las columnas al centro del conjunto medio
      setTimeout(() => {
        const containers = document.querySelectorAll('.time-column.scroll-container');
        containers.forEach(el => {
          const htmlEl = el as HTMLElement;
          const setHeight = htmlEl.scrollHeight / 3;
          const selected = htmlEl.querySelector('.time-select-option.selected') as HTMLElement;
          
          if (selected) {
            const offsetInSet = selected.offsetTop % setHeight;
            htmlEl.scrollTop = setHeight + offsetInSet - htmlEl.offsetHeight / 2 + selected.offsetHeight / 2;
          } else {
            htmlEl.scrollTop = setHeight;
          }
        });
      }, 0);
    }
  }

  onTimeScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const setHeight = el.scrollHeight / 3;
    if (el.scrollTop < 10) {
      el.scrollTop = setHeight + el.scrollTop;
    } else if (el.scrollTop > setHeight * 2 - 10) {
      el.scrollTop = el.scrollTop - setHeight;
    }
  }

  adjustRangeOnFrequencyChange(type: 'new' | 'editing', freq: 'diario' | 'semanal' | 'mensual'): void {
    const dStart = type === 'new' ? this.newScheduleDateStart() : this.editingScheduleDateStart();
    const dEnd = type === 'new' ? this.newScheduleDateEnd() : this.editingScheduleDateEnd();
    const tStart = type === 'new' ? this.newScheduleTimeStart() : this.editingScheduleTimeStart();
    const tEnd = type === 'new' ? this.newScheduleTimeEnd() : this.editingScheduleTimeEnd();
    
    if (!dStart) return;
    
    const startDate = new Date(`${dStart}T00:00:00`);
    const pad = (num: number) => num.toString().padStart(2, '0');
    const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const isCrossMidnight = this.checkIsCrossMidnight();
    
    if (freq === 'diario') {
      const adjustedEnd = isCrossMidnight ? new Date(startDate.getTime() + 24 * 60 * 60 * 1000) : startDate;
      if (type === 'new') {
        this.newScheduleDateEnd.set(formatDate(adjustedEnd));
      } else {
        this.editingScheduleDateEnd.set(formatDate(adjustedEnd));
      }
    } else if (freq === 'semanal') {
      let shouldAdjust = true;
      if (dEnd) {
        const endDate = new Date(`${dEnd}T00:00:00`);
        const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const maxDiff = isCrossMidnight ? 8 : 7;
        if (diffDays >= 1 && diffDays <= maxDiff) {
          shouldAdjust = false;
        }
      }
      if (shouldAdjust) {
        const daysToAdd = isCrossMidnight ? 7 : 6;
        const adjustedEnd = new Date(startDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        if (type === 'new') {
          this.newScheduleDateEnd.set(formatDate(adjustedEnd));
        } else {
          this.editingScheduleDateEnd.set(formatDate(adjustedEnd));
        }
      }
    } else if (freq === 'mensual') {
      let shouldAdjust = true;
      const daysInStartMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
      if (dEnd) {
        const endDate = new Date(`${dEnd}T00:00:00`);
        const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const maxDiff = isCrossMidnight ? (daysInStartMonth + 1) : daysInStartMonth;
        if (diffDays >= 1 && diffDays <= maxDiff) {
          shouldAdjust = false;
        }
      }
      if (shouldAdjust) {
        const daysToAdd = isCrossMidnight ? daysInStartMonth : (daysInStartMonth - 1);
        const adjustedEnd = new Date(startDate.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
        if (type === 'new') {
          this.newScheduleDateEnd.set(formatDate(adjustedEnd));
        } else {
          this.editingScheduleDateEnd.set(formatDate(adjustedEnd));
        }
      }
    }
  }

  adjustTempRangeOnFrequencyChange(freq: 'diario' | 'semanal' | 'mensual'): void {
    const startStr = this.tempDateStart();
    const endStr = this.tempDateEnd();
    if (!startStr || !endStr) return;
    
    const startDate = new Date(`${startStr}T00:00:00`);
    const pad = (num: number) => num.toString().padStart(2, '0');
    const formatDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const diffDays = Math.round((new Date(`${endStr}T00:00:00`).getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    const isEditing = !!this.editingScheduleId();
    const tStart = isEditing ? this.editingScheduleTimeStart() : this.newScheduleTimeStart();
    const tEnd = isEditing ? this.editingScheduleTimeEnd() : this.newScheduleTimeEnd();
    
    const isCrossMidnight = this.checkIsCrossMidnight();
    
    if (freq === 'diario') {
      const expectedDiff = isCrossMidnight ? 2 : 1;
      if (diffDays !== expectedDiff) {
        const adjustedEnd = isCrossMidnight ? new Date(startDate.getTime() + 24 * 60 * 60 * 1000) : startDate;
        this.tempDateEnd.set(formatDate(adjustedEnd));
        this.isSelectingRange.set(false);
      }
    } else if (freq === 'semanal') {
      const maxDiff = isCrossMidnight ? 8 : 7;
      if (diffDays > maxDiff) {
        const adjustedEnd = new Date(startDate.getTime() + (maxDiff - 1) * 24 * 60 * 60 * 1000);
        this.tempDateEnd.set(formatDate(adjustedEnd));
        this.isSelectingRange.set(false);
      }
    } else if (freq === 'mensual') {
      const daysInStartMonth = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).getDate();
      const maxDiff = isCrossMidnight ? (daysInStartMonth + 1) : daysInStartMonth;
      if (diffDays > maxDiff) {
        const adjustedEnd = new Date(startDate.getTime() + (maxDiff - 1) * 24 * 60 * 60 * 1000);
        this.tempDateEnd.set(formatDate(adjustedEnd));
        this.isSelectingRange.set(false);
      }
    }
  }

  onStartDateChange(type: 'new' | 'editing'): void {
    const freq = type === 'new' ? this.newScheduleFrequency() : this.editingScheduleFrequency();
    if (freq) {
      this.adjustRangeOnFrequencyChange(type, freq);
    }
  }

  // ── Lógica de Formulario CRUD de Horarios ──────────────────────────────────

  openCreateForm(): void {
    this.cancelCreate();
    this.editingScheduleId.set(null);
  }

  cancelCreate(): void {
    this.newScheduleName.set('');
    this.newScheduleDateStart.set('');
    this.newScheduleTimeStart.set('');
    this.newScheduleDateEnd.set('');
    this.newScheduleTimeEnd.set('');
    this.newScheduleFrequency.set('');
  }

  createSchedule(): void {
    if (!this.newScheduleName().trim()) return;

    const payload = {
      nombre: this.newScheduleName(),
      fingerprint_host: '',
      analytics_ids: [], // Se asocian en la vista de Cámaras
      // El backend espera formato DD/MM/YYYY HH:mm en hora local (no ISO UTC)
      timestamp_inicio: this.formatTimestampForBackend(this.newScheduleDateStart(), this.newScheduleTimeStart()),
      timestamp_fin: this.formatTimestampForBackend(this.newScheduleDateEnd(), this.newScheduleTimeEnd()),
      frecuencia: this.newScheduleFrequency(),
      estado: 'activo'
    };

    this.scheduleService.registerSchedule(payload).subscribe({
      next: (responseDto) => {
        if (responseDto && responseDto.schedule_id) {
          const newSchedule = ScheduleMapper.toDomain(responseDto);
          this.scheduleService.addOrUpdateScheduleLocal(newSchedule);
        } else {
          // Fallback a recargar todo si no viene la entidad
          this.scheduleService.getAllSchedules().subscribe();
        }
        this.cancelCreate(); // Limpia los campos
        this.showCreateScheduleModal.set(false);
      },
      error: (err) => {
        console.error('[HorariosComponent] createSchedule failed:', err);
      }
    });
  }

  startEditSchedule(schedule: Schedule): void {
    this.editingScheduleId.set(schedule.id);
    this.editingScheduleName.set(schedule.name);
    // Usar getDateString/getTimeString (ya corregidos a UTC) para pre-cargar el formulario
    this.editingScheduleDateStart.set(getDateString(schedule.start));
    this.editingScheduleTimeStart.set(getTimeString(schedule.start));
    this.editingScheduleDateEnd.set(getDateString(schedule.end));
    this.editingScheduleTimeEnd.set(getTimeString(schedule.end));
    this.editingScheduleFrequency.set(schedule.frequency as any);
    this.editingScheduleSelectedAnalyticIds.set([...schedule.analyticIds]);
  }

  cancelEdit(): void {
    this.editingScheduleId.set(null);
    this.showEditScheduleModal.set(false);
  }

  openCreateScheduleModal(): void {
    this.cancelCreate();
    this.cancelEdit();
    this.showCreateScheduleModal.set(true);
  }

  closeCreateScheduleModal(): void {
    this.showCreateScheduleModal.set(false);
    this.cancelCreate();
  }

  openEditScheduleModal(schedule: Schedule): void {
    this.startEditSchedule(schedule);
    this.showEditScheduleModal.set(true);
  }

  closeEditScheduleModal(): void {
    this.showEditScheduleModal.set(false);
    this.cancelEdit();
  }

  saveScheduleEdit(): void {
    if (!this.editingScheduleId() || !this.editingScheduleName().trim()) return;

    const scheduleId = this.editingScheduleId()!;
    const payload = {
      nombre: this.editingScheduleName(),
      fingerprint_host: '',
      analytics_ids: this.editingScheduleSelectedAnalyticIds().map(id => ({ id_analytic: id })),
      // El backend espera formato DD/MM/YYYY HH:mm en hora local (no ISO UTC)
      timestamp_inicio: this.formatTimestampForBackend(this.editingScheduleDateStart(), this.editingScheduleTimeStart()),
      timestamp_fin: this.formatTimestampForBackend(this.editingScheduleDateEnd(), this.editingScheduleTimeEnd()),
      frecuencia: this.editingScheduleFrequency(),
      estado: 'activo'
    };

    this.scheduleService.updateSchedule(scheduleId, payload).subscribe({
      next: (responseDto) => {
        // Intentar usar el DTO de respuesta, si no, reconstruir localmente y guardar en memoria
        let updatedSchedule: Schedule | null = null;
        if (responseDto && responseDto.schedule_id) {
          updatedSchedule = ScheduleMapper.toDomain(responseDto);
        } else {
          // Reconstrucción local de respaldo
          const oldSchedule = this.scheduleService.schedules().find(s => s.id === scheduleId);
          if (oldSchedule) {
            const parseDateFromInput = (dStr: string, tStr: string): Date => {
              const [year, month, day] = dStr.split('-').map(Number);
              const [hours, minutes] = tStr.split(':').map(Number);
              return new Date(year, month - 1, day, hours, minutes);
            };
            updatedSchedule = {
              ...oldSchedule,
              name: this.editingScheduleName(),
              analyticIds: [...this.editingScheduleSelectedAnalyticIds()],
              start: parseDateFromInput(this.editingScheduleDateStart(), this.editingScheduleTimeStart()),
              end: parseDateFromInput(this.editingScheduleDateEnd(), this.editingScheduleTimeEnd()),
              frequency: this.editingScheduleFrequency()
            };
          }
        }
        if (updatedSchedule) {
          this.scheduleService.addOrUpdateScheduleLocal(updatedSchedule);
        } else {
          this.scheduleService.getAllSchedules().subscribe();
        }
        this.editingScheduleId.set(null);
        this.showEditScheduleModal.set(false);
      },
      error: (err) => {
        console.error('[HorariosComponent] saveScheduleEdit failed:', err);
      }
    });
  }

  openDeleteScheduleModal(schedule: Schedule): void {
    this.scheduleToDelete.set(schedule);
    this.showDeleteScheduleModal.set(true);
  }

  closeDeleteScheduleModal(): void {
    this.scheduleToDelete.set(null);
    this.showDeleteScheduleModal.set(false);
  }

  confirmDeleteSchedule(): void {
    const sched = this.scheduleToDelete();
    if (!sched) return;

    this.isDeletingSchedule.set(true);

    const executeDeletion = () => {
      this.scheduleService.deleteSchedule(sched.id).subscribe({
        next: () => {
          this.scheduleService.deleteScheduleLocal(sched.id);

          if (this.selectedScheduleId() === sched.id) {
            this.selectedScheduleId.set(null);
          }
          this.isDeletingSchedule.set(false);
          this.closeDeleteScheduleModal();
          this.loadAllAssociationDetails();
        },
        error: (err) => {
          console.error('[HorariosComponent] confirmDeleteSchedule failed:', err);
          this.isDeletingSchedule.set(false);
          alert('Error al eliminar el horario. Por favor, intente de nuevo.');
        }
      });
    };

    if (sched.analyticIds && sched.analyticIds.length > 0) {
      const payload = {
        nombre: sched.name,
        fingerprint_host: sched.hostFingerprint || '',
        analytics_ids: [],
        timestamp_inicio: this.formatTimestampForBackend(this.getDateString(sched.start), this.getTimeString(sched.start)),
        timestamp_fin: this.formatTimestampForBackend(this.getDateString(sched.end), this.getTimeString(sched.end)),
        frecuencia: sched.frequency,
        estado: sched.status
      };

      this.scheduleService.updateSchedule(sched.id, payload).pipe(
        catchError((err) => {
          console.warn('[HorariosComponent] Error desvinculando analíticas antes de eliminar:', err);
          return of(null);
        })
      ).subscribe(() => {
        executeDeletion();
      });
    } else {
      executeDeletion();
    }
  }

  getRemainingRepetitions(
    start: Date,
    end: Date,
    frequency: 'diario' | 'semanal' | 'mensual',
    referenceDate: Date = new Date()
  ): number {
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return 0;

    const startHour = start.getHours();
    const startMin = start.getMinutes();
    const endHour = end.getHours();
    const endMin = end.getMinutes();
    const crossesMidnight = (endHour < startHour) || (endHour === startHour && endMin < startMin);

    const getNormalizedDate = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const overallStartDate = getNormalizedDate(start);

    let count = 0;
    let i = 0;
    const maxIterations = frequency === 'diario' ? 366 : frequency === 'semanal' ? 53 : 120;
    while (i < maxIterations) {
      let repDate: Date;
      if (frequency === 'diario') {
        repDate = new Date(overallStartDate.getTime() + i * 24 * 60 * 60 * 1000);
      } else if (frequency === 'semanal') {
        repDate = new Date(overallStartDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      } else {
        repDate = new Date(overallStartDate.getFullYear(), overallStartDate.getMonth() + i, overallStartDate.getDate());
      }

      const repStart = new Date(repDate.getFullYear(), repDate.getMonth(), repDate.getDate(), startHour, startMin, 0, 0);
      if (repStart > end) {
        break;
      }

      let repEnd: Date;
      if (crossesMidnight) {
        repEnd = new Date(repDate.getTime() + 24 * 60 * 60 * 1000);
        repEnd.setHours(endHour, endMin, 0, 0);
      } else {
        repEnd = new Date(repStart.getTime());
        repEnd.setHours(endHour, endMin, 0, 0);
      }

      if (referenceDate <= repEnd) {
        count++;
      }

      i++;
    }

    return count;
  }

  getScheduleRemainingRepetitions(schedule: Schedule): number {
    return this.getRemainingRepetitions(schedule.start, schedule.end, schedule.frequency as any, this.currentTime());
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

  selectScheduleForDetails(sched: Schedule): void {
    this.selectedScheduleId.set(sched.id);
    this.expandedHosts.set(false);
    this.expandedCameras.set(false);
    this.expandedAnalytics.set(false);
    this.activeHostFilters.set([]);
    this.activeCameraFilters.set([]);
    this.activeAnalyticFilters.set([]);
  }

  toggleHostFilter(fingerprint: string): void {
    this.activeCameraFilters.set([]);
    this.activeAnalyticFilters.set([]);
    const current = this.activeHostFilters();
    if (current.includes(fingerprint)) {
      this.activeHostFilters.set(current.filter(f => f !== fingerprint));
    } else {
      this.activeHostFilters.set([...current, fingerprint]);
    }
  }

  toggleCameraFilter(cameraId: string): void {
    this.activeHostFilters.set([]);
    this.activeAnalyticFilters.set([]);
    const current = this.activeCameraFilters();
    if (current.includes(cameraId)) {
      this.activeCameraFilters.set(current.filter(id => id !== cameraId));
    } else {
      this.activeCameraFilters.set([...current, cameraId]);
    }
  }

  toggleAnalyticFilter(analyticId: string): void {
    this.activeHostFilters.set([]);
    this.activeCameraFilters.set([]);
    const current = this.activeAnalyticFilters();
    if (current.includes(analyticId)) {
      this.activeAnalyticFilters.set(current.filter(id => id !== analyticId));
    } else {
      this.activeAnalyticFilters.set([...current, analyticId]);
    }
  }

  isDayOfWeekActive(dayIndex: number, start: Date, end: Date, frequency: string): boolean {
    if (frequency === 'diario') {
      return start.getDay() === dayIndex;
    }
    const s = new Date(start);
    const e = new Date(end);
    let curr = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const limitDate = new Date(e.getFullYear(), e.getMonth(), e.getDate());
    let count = 0;
    while (curr <= limitDate && count < 32) {
      if (curr.getDay() === dayIndex) {
        return true;
      }
      curr.setDate(curr.getDate() + 1);
      count++;
    }
    return false;
  }

  getTimelineBackground(startStr: string, endStr: string): string {
    if (!startStr || !endStr) return 'transparent';
    const [sh, sm] = startStr.split(':').map(Number);
    const [eh, em] = endStr.split(':').map(Number);
    const startPercent = ((sh * 60 + sm) / 1440) * 100;
    const endPercent = ((eh * 60 + em) / 1440) * 100;
    
    const activeColor = 'var(--primary)';
    if (endPercent >= startPercent) {
      return `linear-gradient(90deg, rgba(255,255,255,0.05) ${startPercent}%, ${activeColor} ${startPercent}%, ${activeColor} ${endPercent}%, rgba(255,255,255,0.05) ${endPercent}%)`;
    } else {
      return `linear-gradient(90deg, ${activeColor} ${endPercent}%, rgba(255,255,255,0.05) ${endPercent}%, rgba(255,255,255,0.05) ${startPercent}%, ${activeColor} ${startPercent}%)`;
    }
  }

  getDateString(d: Date): string {
    const pad = (num: number) => num.toString().padStart(2, '0');
    // Mostrar en hora LOCAL del usuario
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  getTimeString(d: Date): string {
    const pad = (num: number) => num.toString().padStart(2, '0');
    // Mostrar en hora LOCAL del usuario
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /**
   * Convierte fecha (YYYY-MM-DD) y hora (HH:mm) al formato DD/MM/YYYY HH:mm
   * que es el formato que espera el backend en sus peticiones.
   */
  private formatTimestampForBackend(dateStr: string, timeStr: string): string {
    if (!dateStr || !timeStr) return '';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year} ${timeStr}`;
  }
}
