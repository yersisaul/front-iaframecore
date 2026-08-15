import { Component, Input, Output, EventEmitter, inject, signal, HostListener, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CameraService } from '../../../core/services/camera.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { AnalyticService } from '../../../core/services/analytic.service';
import { HostService } from '../../../core/services/host.service';
import { ListService } from '../../../core/services/list.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { WebsocketService } from '../../../core/services/websocket.service';
import { WebRtcService } from '../../../core/services/webrtc.service';
import { IEventRepository } from '../../../core/domain/repositories/event.repository';

import { Camera } from '../../../core/domain/entities/camera.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { Schedule } from '../../../core/domain/entities/schedule.models';
import { copyToClipboard } from '../../../core/utils/clipboard.util';
import { getCameraEffectiveStatus, getCameraStatusCssClass, getCameraStatusColor } from '../../../core/utils/camera-status.utils';
import { ConfirmDeleteModalComponent } from '../confirm-delete-modal/confirm-delete-modal.component';
import { AnalyticCanvasComponent } from './components/analytic-canvas/analytic-canvas.component';
import { AnalyticParamsFormComponent } from './components/analytic-params-form/analytic-params-form.component';
import { AnalyticActionsBuilderComponent } from './components/analytic-actions-builder/analytic-actions-builder.component';

@Component({
  selector: 'app-camera-detail-drawer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    RouterLink,
    ConfirmDeleteModalComponent,
    AnalyticCanvasComponent,
    AnalyticParamsFormComponent,
    AnalyticActionsBuilderComponent
  ],
  templateUrl: './camera-detail-drawer.component.html',
  styleUrl: './camera-detail-drawer.component.css'
})
export class CameraDetailDrawerComponent implements OnChanges, OnDestroy {
  get resolvedHostFingerprint(): string {
    if (this.camera?.hostFingerprint) return this.camera.hostFingerprint;
    if (this.hostId) return this.hostId;
    const cam = this.camera as any;
    if (cam?.fingerprint_host) return cam.fingerprint_host;
    if (cam?.host_fingerprint) return cam.host_fingerprint;
    if (cam?.fingerprint) return cam.fingerprint;
    if (cam?.host_id) return cam.host_id;
    if (cam?.hostId) return cam.hostId;
    return '';
  }

  ngOnChanges(changes: SimpleChanges): void {
    const showJustOpened = !!(changes['show'] && changes['show'].currentValue && !changes['show'].previousValue);
    const cameraJustChanged = !!(changes['camera'] && (
      !changes['camera'].previousValue ||
      changes['camera'].previousValue.id !== changes['camera'].currentValue?.id
    ));
    const hostJustChanged = !!(changes['hostId'] && changes['hostId'].previousValue !== changes['hostId'].currentValue);

    if (this.show) {
      if (showJustOpened || cameraJustChanged || hostJustChanged) {
        this.lastEventImageUrl.set('');
        this.liveWebRtcFrameUrl.set('');
        this.tryCaptureLiveFrame();
        setTimeout(() => this.tryCaptureLiveFrame(), 150);
        this.fetchLastEventImage();
        const fp = this.resolvedHostFingerprint;
        if (fp) {
          this.fetchHostInfoModels(fp);
        }
        this.scheduleService.getAllSchedules().subscribe();
        this.listService.loadLists().subscribe();
      }
    } else {
      this.cleanupWebRtcForDrawer();
    }
  }

  ngOnDestroy(): void {
    this.cleanupWebRtcForDrawer();
  }

  private cameraService = inject(CameraService);
  private scheduleService = inject(ScheduleService);
  private analyticService = inject(AnalyticService);
  private hostService = inject(HostService);
  private eventRepository = inject(IEventRepository);
  private websocketService = inject(WebsocketService);
  private webRtcService = inject(WebRtcService);
  private listService = inject(ListService);
  public permissionsService = inject(PermissionsService);

  private drawerOffscreenVideo: HTMLVideoElement | null = null;
  private activePeerConnection: RTCPeerConnection | null = null;

  // Control inteligente de sesión WebRTC abierta exclusivamente por este drawer
  readonly openedWebRtcForDrawer = signal<boolean>(false);

  @Input() show: boolean = false;
  @Input() camera: Camera | null = null;
  @Input() hostId: string | null = null;

  @Output() close = new EventEmitter<void>();
  @Output() cameraUpdated = new EventEmitter<Camera>();
  @Output() cameraDeleted = new EventEmitter<Camera>();

  // Signals para analíticas, horarios y captura del último evento o frame WebRTC
  readonly analytics = this.analyticService.analytics;
  readonly schedules = this.scheduleService.schedules;
  readonly lastEventImageUrl = signal<string>('');
  readonly liveWebRtcFrameUrl = signal<string>('');

  // Sub-drawer secundario de configuración de analítica
  readonly showAnalyticConfigDrawer = signal<boolean>(false);
  readonly selectedAnalyticForConfig = signal<Analytic | null>(null);
  readonly availableModels = signal<any>(null);
  readonly isLoadingModels = signal<boolean>(false);
  readonly drawnGeometryData = signal<any>(null);
  readonly canvasGeometryType = signal<'polygon' | 'speed_quad' | 'line'>('polygon');
  readonly analyticFormState = signal<any>(null);
  readonly analyticActionsState = signal<any>({});
  readonly selectedScheduleId = signal<string | null>(null);
  readonly isSubmittingAnalytic = signal<boolean>(false);
  readonly validationMessage = signal<string | null>(null);
  readonly validationMessageType = signal<'warning' | 'danger' | 'success'>('warning');
  readonly activeErrorTarget = signal<'classes' | 'canvas' | null>(null);
  private notificationTimeoutId: any = null;

  triggerErrorHighlight(target: 'classes' | 'canvas'): void {
    this.activeErrorTarget.set(target);
    setTimeout(() => {
      if (this.activeErrorTarget() === target) {
        this.activeErrorTarget.set(null);
      }
    }, 2600);
  }

  showNotification(message: string, type: 'warning' | 'danger' | 'success' = 'warning', durationMs: number = 10000): void {
    if (this.notificationTimeoutId) {
      clearTimeout(this.notificationTimeoutId);
      this.notificationTimeoutId = null;
    }

    this.validationMessage.set(message);
    this.validationMessageType.set(type);

    this.notificationTimeoutId = setTimeout(() => {
      this.validationMessage.set(null);
      this.notificationTimeoutId = null;
    }, durationMs);
  }

  clearNotification(): void {
    if (this.notificationTimeoutId) {
      clearTimeout(this.notificationTimeoutId);
      this.notificationTimeoutId = null;
    }
    this.validationMessage.set(null);
  }

  private isGeometryValid(): boolean {
    const geoData = this.drawnGeometryData();
    if (!geoData) return false;

    const type = this.canvasGeometryType();
    if (type === 'line') {
      const lines = geoData.lines || geoData.lineas || [];
      if (!Array.isArray(lines) || lines.length === 0) return false;
      return lines.some((l: any) => {
        const pts = l.extreme_points || l.points || l.line || [];
        return Array.isArray(pts) && pts.length >= 2;
      });
    } else if (type === 'speed_quad') {
      const polygons = geoData.polygons || geoData.poligonos || [];
      const quads = geoData.speed_quads || [];
      const list = (Array.isArray(polygons) && polygons.length > 0) ? polygons : quads;
      if (!Array.isArray(list) || list.length === 0) return false;
      return list.some((p: any) => {
        const pts = p.original_area || p.outer_area || p.points || [];
        return Array.isArray(pts) && pts.length >= 3;
      });
    } else {
      // 'polygon' (Objeto en área, permanencia, aglomeración, etc.)
      const polygons = geoData.polygons || geoData.poligonos || [];
      if (!Array.isArray(polygons) || polygons.length === 0) return false;
      return polygons.some((p: any) => {
        const pts = p.original_area || p.outer_area || p.points || [];
        return Array.isArray(pts) && pts.length >= 3;
      });
    }
  }

  get cameraSnapshotUrl(): string {
    // Orden de prioridad estricto:
    // 1. WEBRTC: Captura en tiempo real del video WebRTC activo
    if (this.liveWebRtcFrameUrl()) {
      return this.liveWebRtcFrameUrl();
    }
    // 2. EVENTO: Foto del último evento registrado si no hay WebRTC activo
    if (this.lastEventImageUrl()) {
      return this.lastEventImageUrl();
    }
    if (!this.camera) return '';
    const cam = this.camera as any;
    // 3. Fallback de propiedades de la cámara
    return cam.lastSnapshotUrl || cam.snapshotUrl || cam.urlImg || cam.snapshot || cam.lastEventImg || '';
  }

  tryCaptureLiveFrame(): boolean {
    if (!this.camera || this.liveWebRtcFrameUrl()) return false;
    const frameDataUrl = this.captureWebRtcFrameForCamera(this.camera);
    if (frameDataUrl && frameDataUrl.length > 5000) {
      this.liveWebRtcFrameUrl.set(frameDataUrl);
      console.log(`[CameraDetailDrawer] ✅ Fotograma WebRTC capturado exitosamente para cámara "${this.camera.name}" (${frameDataUrl.length} bytes). Deteniendo stream WebRTC (webrtc_stop)...`);
      this.cleanupWebRtcForDrawer();
      return true;
    }
    return false;
  }

  private captureWebRtcFrameForCamera(cam: Camera): string | null {
    if (!cam) return null;

    // 1. Prioridad absoluta al video offscreen creado exclusivamente para la conexión WebRTC de este drawer
    if (this.drawerOffscreenVideo && this.drawerOffscreenVideo.videoWidth > 0 && this.drawerOffscreenVideo.videoHeight > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = this.drawerOffscreenVideo.videoWidth;
        canvas.height = this.drawerOffscreenVideo.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(this.drawerOffscreenVideo, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
          if (dataUrl && dataUrl.length > 5000) {
            console.log(`[CameraDetailDrawer] Captura en vivo obtenida exitosamente desde drawerOffscreenVideo (${canvas.width}x${canvas.height}).`);
            return dataUrl;
          }
        }
      } catch (err) {
        console.warn('[CameraDetailDrawer] Error capturando de drawerOffscreenVideo:', err);
      }
    }

    // 2. Fallback: Buscar otros elementos de video activos en el DOM
    const camName = (cam.name || '').trim().toLowerCase();
    const camId = (cam.id || '').trim().toLowerCase();
    const videoElements = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];

    for (const video of videoElements) {
      if (video && video !== this.drawerOffscreenVideo && video.videoWidth > 0 && video.videoHeight > 0) {
        const dataCamId = (video.getAttribute('data-camera-id') || '').trim().toLowerCase();
        const dataCamName = (video.getAttribute('data-camera-name') || '').trim().toLowerCase();
        const videoId = (video.id || '').toLowerCase();
        const slotEl = video.closest('.grid-slot-cell, .occupied-slot-content, .grid-slot-card, .vms-slot-card, .camera-card, .main-content-layout, [data-id]');
        const textContent = (slotEl?.textContent || '').toLowerCase();

        const isMatch =
          (dataCamId && (dataCamId === camId || dataCamId.includes(camId))) ||
          (dataCamName && (dataCamName === camName || dataCamName.includes(camName))) ||
          (videoId && (videoId.includes(camId) || videoId.includes(camName))) ||
          (textContent && (textContent.includes(camName) || textContent.includes(camId)));

        if (isMatch) {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
              if (dataUrl && dataUrl.length > 5000) {
                console.log(`[CameraDetailDrawer] Captura obtenida desde elemento de video DOM secundario (${canvas.width}x${canvas.height}).`);
                return dataUrl;
              }
            }
          } catch (err) {
            console.warn('[CameraDetailDrawer] Error capturando canvas WebRTC:', err);
          }
        }
      }
    }
    return null;
  }

  openCreateAnalytic(): void {
    this.liveWebRtcFrameUrl.set('');
    this.lastEventImageUrl.set('');
    this.selectedAnalyticForConfig.set(null);
    this.selectedScheduleId.set(null);
    this.canvasGeometryType.set('polygon'); // Reset a Polígono por defecto para nueva analítica
    this.drawnGeometryData.set(null);
    this.ensureWebRtcConnectionForCamera();
    this.showAnalyticConfigDrawer.set(true);
    this.fetchLastEventImage();
    this.scheduleService.getAllSchedules().subscribe();
    if (this.camera?.hostFingerprint) {
      this.fetchHostInfoModels(this.camera.hostFingerprint);
    }
  }

  private isLiveVideoPresentInDom(camId: string): boolean {
    if (!camId) return false;
    const camIdLower = camId.toLowerCase().trim();
    const videoElements = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    return videoElements.some(video => {
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        const dataCamId = (video.getAttribute('data-camera-id') || '').trim().toLowerCase();
        const videoId = (video.id || '').toLowerCase();
        const slotEl = video.closest('.grid-slot-cell, .occupied-slot-content, .grid-slot-card, .vms-slot-card, .camera-card, [data-id]');
        const textContent = (slotEl?.textContent || '').toLowerCase();
        return (dataCamId && dataCamId.includes(camIdLower)) ||
               (videoId && videoId.includes(camIdLower)) ||
               (textContent && textContent.includes(camIdLower));
      }
      return false;
    });
  }

  private tryCaptureLiveFrameWithRetry(maxRetries: number = 60, delayMs: number = 300): void {
    if (this.liveWebRtcFrameUrl()) return;

    const success = this.tryCaptureLiveFrame();

    if (!success && maxRetries > 0) {
      setTimeout(() => {
        if (!this.liveWebRtcFrameUrl() && (this.showAnalyticConfigDrawer() || this.show)) {
          this.tryCaptureLiveFrameWithRetry(maxRetries - 1, delayMs);
        }
      }, delayMs);
    } else if (!success) {
      console.warn(`[CameraDetailDrawer] Tiempo límite de espera alcanzado para captura WebRTC. Emitiendo webrtc_stop y conservando imagen de respaldo.`);
      this.cleanupWebRtcForDrawer();
    }
  }





  onGeometryChanged(data: any): void {
    this.drawnGeometryData.set(data);
  }

  readonly maxAreas = signal<number>(10);

  onAnalyticFormChanged(data: any): void {
    this.analyticFormState.set(data);
    if (data?.maxAreas) {
      this.maxAreas.set(data.maxAreas);
    }
  }

  onGeometryTypeChanged(type: 'polygon' | 'speed_quad' | 'line'): void {
    this.canvasGeometryType.set(type);
  }

  onActionsChanged(actions: any): void {
    this.analyticActionsState.set(actions);
  }

  toggleScheduleSelection(scheduleId: string): void {
    this.selectedScheduleId.update(current => current === scheduleId ? null : scheduleId);
  }

  clearScheduleSelection(): void {
    this.selectedScheduleId.set(null);
  }

  submitAnalyticForm(): void {
    if (this.isSubmittingAnalytic()) return;
    this.clearNotification();

    const formState = this.analyticFormState();

    // 1. Validar Clases / Objetos a Monitorear (Excluyendo analíticas sin clases como Reconocimiento Facial y Placas LPR)
    const classes = formState?.detection_classes || [];
    const rawType = (formState?.analytic_type || '').toLowerCase();
    const isNoClassesAnalytic = rawType.includes('facial') ||
      rawType.includes('face') ||
      rawType.includes('placa') ||
      rawType.includes('plate') ||
      rawType === 'face_recognition' ||
      rawType === 'license_plate_recognition';

    if (!isNoClassesAnalytic) {
      if (!Array.isArray(classes) || classes.length === 0) {
        this.triggerErrorHighlight('classes');
        this.showNotification('Por favor, selecciona al menos un objeto o clase a monitorear antes de guardar.', 'warning');
        return;
      }

      const isProximity = rawType === 'cercania entre objetos' || rawType === 'object_proximity';
      if (isProximity && classes.length < 2) {
        this.triggerErrorHighlight('classes');
        this.showNotification('Para la analítica "Cercanía entre objetos" debes seleccionar exactamente 2 objetos (1º Núcleo, 2º Órbita) antes de guardar.', 'warning');
        return;
      }
    }

    // 2. Validar Geometría (Línea o Polígono en el Lienzo)
    if (!this.isGeometryValid()) {
      this.triggerErrorHighlight('canvas');
      const geoType = this.canvasGeometryType();
      const label = geoType === 'line' ? 'la línea de cruce' : 'el polígono o zona de análisis';
      this.showNotification(`Por favor, dibuja ${label} en el lienzo antes de guardar.`, 'warning');
      return;
    }

    // 3. Validar Cámara Asignada
    if (!this.camera?.id) {
      this.showNotification('No se ha especificado una cámara válida para asociar la analítica.', 'danger');
      return;
    }

    // 4. Validar Fingerprint de Nodo
    const hostFp = this.resolvedHostFingerprint;
    if (!hostFp) {
      this.showNotification('No se pudo determinar el Fingerprint del Nodo asociado a la cámara.', 'danger');
      return;
    }

    this.isSubmittingAnalytic.set(true);

    const activeSchedId = this.selectedScheduleId();
    let selectedSchedObj: Schedule | undefined = undefined;
    let selectedSchedName = 'Sin horario';

    if (activeSchedId) {
      selectedSchedObj = this.schedules().find(s => s.id === activeSchedId);
      if (selectedSchedObj) {
        selectedSchedName = selectedSchedObj.name;
      }
    }

    const editingAnalytic = this.selectedAnalyticForConfig();

    const rawGeo = this.drawnGeometryData();
    const cleanGeometricObjects = {
      polygons: Array.isArray(rawGeo?.polygons) ? rawGeo.polygons.map((p: any) => {
        const cleaned = { ...p };
        delete cleaned.camera_id;
        return cleaned;
      }) : [],
      lines: Array.isArray(rawGeo?.lines) ? rawGeo.lines.map((l: any) => ({
        ...l,
        camera_id: l.camera_id || this.camera?.id || ''
      })) : []
    };

    const payload: any = {
      camera_id: this.camera?.id || '',
      fingerprint_host: hostFp,
      target_cameras: [{ camera_id: this.camera?.id || '', camera_name: this.camera?.name || '' }],
      analytic_type: formState?.analytic_type || 'Objeto en area',
      analytic_status: editingAnalytic?.status || 'active',
      detection_classes: classes,
      parameters: {
        Modelo: formState?.model || formState?.specific_params?.['Modelo'] || 'dependencias/weights/objetc_detection/yolo26m.pt',
        ...formState?.tracker,
        ...formState?.detection_params,
        ...formState?.specific_params,
        horario: selectedSchedName
      },
      geometric_objects: cleanGeometricObjects,
      acciones: this.analyticActionsState() || {}
    };

    if (editingAnalytic) {
      payload.analytic_id = editingAnalytic.id;
    }

    const modeLabel = editingAnalytic ? 'EDIT ANALYTIC' : 'CREATE ANALYTIC';
    const methodStr = editingAnalytic ? 'PUT' : 'POST';
    const endpointUrl = editingAnalytic 
      ? `/frontend/analytics/${editingAnalytic.id}`
      : `/frontend/analytics/`;

    console.group(`🔍 [DEBUG ${modeLabel}] Enviando petición al Backend (${methodStr} ${endpointUrl})`);
    console.log('📌 Modo de Operación:', modeLabel);
    console.log('📹 Cámara Target:', { id: this.camera?.id, name: this.camera?.name });
    console.log('🔑 Fingerprint Host:', hostFp);
    if (editingAnalytic) {
      console.log('🆔 Analytic ID:', editingAnalytic.id);
    }
    console.log('🏷️ Tipo de Analítica:', payload.analytic_type);
    console.log('🤖 Modelo de IA (Path enviado):', payload.parameters['Modelo']);
    console.log('📋 Clases a Monitorear (Resumen):', classes);
    console.table(payload.detection_classes);
    console.log('⚙️ Parámetros Generales y Específicos:', payload.parameters);
    console.log('📐 Objetos Geométricos (Lienzo):', payload.geometric_objects);
    console.log('⚡ Acciones / Triggers:', payload.acciones);
    console.log('📦 Payload JSON Completo Transmitido:', JSON.stringify(payload, null, 2));
    console.groupEnd();

    const request$ = editingAnalytic
      ? this.analyticService.updateAnalytic(editingAnalytic.id, payload)
      : this.analyticService.registerAnalytic(payload);

    request$.subscribe({
      next: (res) => {
        console.group(`✅ [DEBUG ${modeLabel} SUCCESS] Respuesta del Servidor (Status 20x)`);
        console.log('📥 Respuesta del Backend:', res);
        console.groupEnd();

        this.isSubmittingAnalytic.set(false);
        this.closeAnalyticConfigDrawer();

        const analyticId = editingAnalytic?.id || res?.analytic_id || res?.id || res?.data?.analytic_id;
        if (analyticId) {
          if (selectedSchedObj) {
            this.toggleScheduleAssociation(selectedSchedObj, analyticId, true);
          } else {
            const currentScheds = this.getSchedulesForAnalytic(analyticId);
            for (const oldSched of currentScheds) {
              this.toggleScheduleAssociation(oldSched, analyticId, false);
            }
          }
        }

        if (hostFp) {
          this.analyticService.getAnalyticsByHost(hostFp, true).subscribe();
        }
      },
      error: (err) => {
        console.group(`❌ [DEBUG ${modeLabel} ERROR] Fallo al enviar petición de analítica`);
        console.error('Status Code:', err.status, err.statusText);
        console.error('Cuerpo del Error Backend:', err.error);
        console.error('Detalles del Error:', err);
        console.groupEnd();

        this.isSubmittingAnalytic.set(false);

        // EXTRAER MENSAJE DE ERROR DEL BACKEND Y MANTENER EL PANEL ABIERTO
        let backendMsg = 'Error al guardar la analítica en el servidor.';
        if (err.error) {
          if (typeof err.error === 'string') {
            backendMsg = err.error;
          } else if (err.error.detail) {
            backendMsg = typeof err.error.detail === 'string' ? err.error.detail : JSON.stringify(err.error.detail);
          } else if (err.error.message) {
            backendMsg = err.error.message;
          }
        } else if (err.message) {
          backendMsg = err.message;
        }

        this.showNotification(`Error del Servidor: ${backendMsg}`, 'danger');
      }
    });
  }

  fetchLastEventImage(): void {
    if (!this.camera?.name) return;
    this.eventRepository.search({
      search: '',
      camaras: [this.camera.name],
      analiticas: [],
      objetos: [],
      timestampDesde: null,
      timestampHasta: null
    }, 1, 5).subscribe({
      next: (res) => {
        if (res.records && res.records.length > 0) {
          const withImg = res.records.find(r => !!r.urlImg);
          if (withImg && withImg.urlImg) {
            this.lastEventImageUrl.set(withImg.urlImg);
          }
        }
      },
      error: (err) => {
        console.warn('[CameraDetailDrawer] No se pudo consultar la captura del último evento:', err);
      }
    });
  }

  /**
   * Asegura la disponibilidad de la conexión WebRTC para la cámara seleccionada.
   * Si la cámara ya se encuentra en transmisión activa (ej. desde el Panel de Monitoreo en Tiempo Real),
   * reutiliza el stream sin emitir webrtc_start ni realizar negociación SDP adicional.
   * Si NO está activa, emite webrtc_start vía WebSocket Y ADEMÁS conecta con WebRtcService (POST /frontend/webrtc/${cameraId})
   * para obtener la señal de video que permita capturar el fotograma.
   */
  ensureWebRtcConnectionForCamera(): void {
    if (!this.camera?.id) return;
    const camId = this.camera.id;
    const hostFp = this.resolvedHostFingerprint;

    const isAlreadyActive = this.websocketService.isWebRtcActive(camId) || this.isLiveVideoPresentInDom(camId);

    if (!isAlreadyActive) {
      console.log(`[CameraDetailDrawer] Cámara "${camId}" sin WebRTC activo. Emitiendo webrtc_start e iniciando conexión SDP con endpoint WebRTC...`);
      this.openedWebRtcForDrawer.set(true);
      this.websocketService.sendWebRtcStart(camId, hostFp);

      // Crear elemento de video posicionado sutilmente con resolución real de decodificación (320x240)
      if (!this.drawerOffscreenVideo) {
        this.drawerOffscreenVideo = document.createElement('video');
        this.drawerOffscreenVideo.autoplay = true;
        this.drawerOffscreenVideo.muted = true;
        this.drawerOffscreenVideo.playsInline = true;
        this.drawerOffscreenVideo.style.position = 'fixed';
        this.drawerOffscreenVideo.style.top = '0px';
        this.drawerOffscreenVideo.style.left = '0px';
        this.drawerOffscreenVideo.style.width = '320px';
        this.drawerOffscreenVideo.style.height = '240px';
        this.drawerOffscreenVideo.style.opacity = '0.001';
        this.drawerOffscreenVideo.style.pointerEvents = 'none';
        this.drawerOffscreenVideo.style.zIndex = '-99999';
        this.drawerOffscreenVideo.setAttribute('data-camera-id', camId);
        document.body.appendChild(this.drawerOffscreenVideo);
      } else {
        this.drawerOffscreenVideo.setAttribute('data-camera-id', camId);
      }

      const onFrameReady = () => {
        if (this.drawerOffscreenVideo && this.drawerOffscreenVideo.videoWidth > 0) {
          this.tryCaptureLiveFrame();
        }
      };

      this.drawerOffscreenVideo.onloadedmetadata = onFrameReady;
      this.drawerOffscreenVideo.oncanplay = onFrameReady;
      this.drawerOffscreenVideo.onplaying = onFrameReady;
      this.drawerOffscreenVideo.ontimeupdate = onFrameReady;

      this.webRtcService.startStream(camId, this.drawerOffscreenVideo).then(pc => {
        this.activePeerConnection = pc;
        if (this.drawerOffscreenVideo) {
          this.drawerOffscreenVideo.play().catch(e => console.warn('[CameraDetailDrawer] Offscreen video play warning:', e));
        }
      }).catch(err => {
        console.warn('[CameraDetailDrawer] Error al conectar con endpoint WebRTC:', err);
      });

    } else {
      console.log(`[CameraDetailDrawer] Cámara "${camId}" YA tiene transmisión WebRTC activa en la aplicación. Reutilizando stream de video del DOM.`);
      this.openedWebRtcForDrawer.set(false);
    }

    this.tryCaptureLiveFrameWithRetry(60, 300);
  }

  /**
   * Libera la conexión WebRTC y cierra la RTCPeerConnection ÚNICAMENTE si fue abierta de forma exclusiva por este drawer.
   * Si la cámara está activa en el Panel de Monitoreo en Tiempo Real, preserva la transmisión ininterrumpida.
   */
  cleanupWebRtcForDrawer(): void {
    if (this.activePeerConnection) {
      try {
        this.activePeerConnection.close();
      } catch (e) {}
      this.activePeerConnection = null;
    }

    if (this.drawerOffscreenVideo) {
      try {
        this.drawerOffscreenVideo.onloadedmetadata = null;
        this.drawerOffscreenVideo.oncanplay = null;
        this.drawerOffscreenVideo.onplaying = null;
        this.drawerOffscreenVideo.ontimeupdate = null;
        this.drawerOffscreenVideo.srcObject = null;
        if (this.drawerOffscreenVideo.parentNode) {
          this.drawerOffscreenVideo.parentNode.removeChild(this.drawerOffscreenVideo);
        }
      } catch (e) {}
      this.drawerOffscreenVideo = null;
    }

    if (this.openedWebRtcForDrawer() && this.camera?.id) {
      const camId = this.camera.id;
      const hostFp = this.resolvedHostFingerprint;
      console.log(`[CameraDetailDrawer] Cerrando transmisión WebRTC abierta por este drawer para cámara "${camId}". Emitiendo webrtc_stop...`);
      this.websocketService.sendWebRtcStop(camId, hostFp);
      this.openedWebRtcForDrawer.set(false);
    } else if (this.camera?.id && this.websocketService.isWebRtcActive(this.camera.id)) {
      console.log(`[CameraDetailDrawer] Transmisión WebRTC conservada para la cámara (permanece activa en el Panel de Monitoreo en Tiempo Real).`);
    } else {
      console.log(`[CameraDetailDrawer] Transmisión WebRTC ya finalizada previamente.`);
    }
  }



  openEditAnalytic(analytic: Analytic): void {
    this.liveWebRtcFrameUrl.set('');
    this.lastEventImageUrl.set('');
    this.selectedAnalyticForConfig.set(analytic);

    // Pre-seleccionar horario asociado localmente o coincidente por parámetro de analítica
    const matchedLocal = this.findScheduleForAnalytic(analytic, this.schedules());
    if (matchedLocal) {
      this.selectedScheduleId.set(matchedLocal.id);
    } else {
      this.selectedScheduleId.set(null);
    }

    this.scheduleService.getAllSchedules().subscribe({
      next: (schedules) => {
        const matched = this.findScheduleForAnalytic(analytic, schedules);
        if (matched) {
          this.selectedScheduleId.set(matched.id);
        }
      }
    });

    let geoType: 'polygon' | 'speed_quad' | 'line' = 'polygon';
    const cleanType = (analytic.type || '').toLowerCase();
    if (cleanType.includes('medicion') || cleanType.includes('velocidad') || cleanType === 'speed_measurement') {
      geoType = 'speed_quad';
    } else if (cleanType.includes('cruce') || cleanType.includes('linea') || cleanType.includes('aforo') || cleanType.includes('trafico') || analytic.type === 'line_crossing' || analytic.type === 'capacity_control' || analytic.type === 'traffic_analysis') {
      geoType = 'line';
    }
    this.canvasGeometryType.set(geoType);

    if (analytic.geometricObjects) {
      this.drawnGeometryData.set(analytic.geometricObjects);
    }

    this.ensureWebRtcConnectionForCamera();
    this.showAnalyticConfigDrawer.set(true);
    this.fetchLastEventImage();
    if (this.camera?.hostFingerprint) {
      this.fetchHostInfoModels(this.camera.hostFingerprint);
    }
  }

  fetchHostInfoModels(fingerprint: string): void {
    if (!fingerprint) return;
    if (!this.availableModels()) {
      this.isLoadingModels.set(true);
    }
    this.hostService.getHostInfoModels(fingerprint).subscribe({
      next: (models) => {
        this.availableModels.set(models);
        this.isLoadingModels.set(false);
      },
      error: () => {
        this.availableModels.set(null);
        this.isLoadingModels.set(false);
      }
    });
  }

  closeAnalyticConfigDrawer(): void {
    this.cleanupWebRtcForDrawer();
    this.showAnalyticConfigDrawer.set(false);
    this.selectedAnalyticForConfig.set(null);
  }

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
    } else if (this.showAnalyticConfigDrawer()) {
      this.closeAnalyticConfigDrawer();
    } else if (this.show) {
      this.closeDrawer();
    }
  }

  private backdropMouseDownTarget: EventTarget | null = null;

  onBackdropMouseDown(event: MouseEvent): void {
    if (event.button === 0) {
      this.backdropMouseDownTarget = event.target;
    }
  }

  onBackdropMouseUp(event: MouseEvent): void {
    if (
      event.button === 0 &&
      this.backdropMouseDownTarget === event.currentTarget &&
      event.target === event.currentTarget
    ) {
      this.onBackdropClick();
    }
    this.backdropMouseDownTarget = null;
  }

  onBackdropClick(): void {
    if (this.showAnalyticConfigDrawer()) {
      // Si el desplegable izquierdo de analíticas está abierto, al hacer clic afuera SOLO se cierra el desplegable izquierdo
      this.closeAnalyticConfigDrawer();
    } else {
      // Si solo está abierto el drawer de detalle de cámara, se cierra el drawer de cámara
      this.closeDrawer();
    }
  }

  closeDrawer(): void {
    this.isEditingCamera.set(false);
    this.closeAnalyticConfigDrawer();
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
    const status = getCameraEffectiveStatus(cam, this.hostService.allHosts());
    return status === 'Online';
  }

  getCameraStatusClass(cam: Camera | null | undefined): string {
    const status = getCameraEffectiveStatus(cam, this.hostService.allHosts());
    return getCameraStatusCssClass(status);
  }

  getCameraStatusLabel(cam: Camera | null | undefined): string {
    return getCameraEffectiveStatus(cam, this.hostService.allHosts());
  }

  getCameraStatusColorStyle(cam: Camera | null | undefined): string {
    const status = getCameraEffectiveStatus(cam, this.hostService.allHosts());
    return getCameraStatusColor(status);
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

  getAnalyticSubtitle(analytic: Analytic): string | null {
    if (!analytic) return null;

    const rawType = (analytic.type || '').toLowerCase();
    const isNoClassesAnalytic = rawType.includes('facial') ||
      rawType.includes('face') ||
      rawType.includes('placa') ||
      rawType.includes('plate') ||
      rawType === 'face_recognition' ||
      rawType === 'license_plate_recognition';

    if (isNoClassesAnalytic) {
      const params = analytic.parameters || {};
      const listId = params['list_id'] || params['listId'] || params['id_lista'] || params['lista_id'];

      if (listId) {
        const allLists = this.listService.lists();
        const foundList = allLists.find(l => String(l.list_id) === String(listId));
        if (foundList && foundList.name) {
          return foundList.name;
        }
      }

      const directName = params['list_name'] || params['listName'] || params['nombre_lista'];
      if (directName && String(directName).trim()) {
        return String(directName).trim();
      }

      return null;
    } else {
      if (analytic.detectionClasses && analytic.detectionClasses.length > 0) {
        const classesSlice = analytic.detectionClasses.slice(0, 3).join(', ');
        const suffix = analytic.detectionClasses.length > 3 ? '...' : '';
        return `${classesSlice}${suffix}`;
      }
      return null;
    }
  }

  private findScheduleForAnalytic(analytic: Analytic | null, schedulesList: Schedule[]): Schedule | undefined {
    if (!analytic || !schedulesList || schedulesList.length === 0) return undefined;

    // 1. Buscar primero por ID de analítica en las asociaciones de horarios locales
    const assocByAnalyticId = schedulesList.find(s => s.analyticIds && s.analyticIds.includes(analytic.id));
    if (assocByAnalyticId) return assocByAnalyticId;

    // 2. Buscar por el valor guardado en los parámetros de la analítica ('horario', 'Horario', 'schedule', etc.)
    const params = analytic.parameters || {};
    const schedNameOrId = params['horario'] || params['Horario'] || params['schedule'] || params['horario_nombre'] || params['schedule_name'] || params['schedule_id'];

    if (schedNameOrId && String(schedNameOrId).trim() !== '' && String(schedNameOrId).toLowerCase() !== 'sin horario') {
      const targetStr = String(schedNameOrId).trim().toLowerCase();
      const matchedByNameOrId = schedulesList.find(s =>
        s.id.toLowerCase() === targetStr ||
        s.name.toLowerCase().trim() === targetStr
      );
      if (matchedByNameOrId) return matchedByNameOrId;
    }

    return undefined;
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
    if (associate) {
      // Garantizar estrictamente 1 horario por analítica: limpiar de cualquier otro horario anterior
      const currentSchedules = this.getSchedulesForAnalytic(analyticId);
      for (const oldSched of currentSchedules) {
        if (oldSched.id !== schedule.id) {
          const cleanedIds = oldSched.analyticIds.filter(id => id !== analyticId);
          this.scheduleService.addOrUpdateScheduleLocal({
            ...oldSched,
            analyticIds: cleanedIds
          });
        }
      }
    }

    const currentAnalyticIds = schedule.analyticIds;
    let newAnalyticIds: string[];
    if (associate) {
      newAnalyticIds = currentAnalyticIds.includes(analyticId) ? currentAnalyticIds : [...currentAnalyticIds, analyticId];
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

  getCleanModelName(path: string): string {
    if (!path) return '';
    return String(path).split(/[/\\]/).pop() || String(path);
  }

  getAnalyticModelPath(analytic: Analytic): string | null {
    if (!analytic?.parameters) return null;
    return analytic.parameters['model'] || analytic.parameters['Modelo'] || null;
  }

  getAnalyticGeometriesSummary(analytic: Analytic): string | null {
    if (!analytic?.geometricObjects) return null;
    const polys = analytic.geometricObjects['polygons']?.length || 0;
    const lines = analytic.geometricObjects['lines']?.length || 0;
    if (polys === 0 && lines === 0) return null;
    return `${polys} polígonos • ${lines} líneas`;
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
