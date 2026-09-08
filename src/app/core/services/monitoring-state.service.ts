import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { Camera } from '../domain/entities/camera.models';
import { WebRtcService } from './webrtc.service';
import { WebsocketService } from './websocket.service';
import { WebsocketConnectionService } from './websocket-connection.service';
import { IEventRepository } from '../domain/repositories/event.repository';
import { EventRecord } from '../domain/entities/event.models';

export interface GridSlot {
  id: string;
  camera: Camera | null;
  col: number;
  row: number;
  spanX: number;
  spanY: number;
  isLocked?: boolean;
  isEmpty?: boolean;
}

export interface CanvasStateSnapshot {
  slots: GridSlot[];
  cols: number;
  rows: number;
}

@Injectable({
  providedIn: 'root'
})
export class MonitoringStateService {
  private webRtcService = inject(WebRtcService);
  private websocketService = inject(WebsocketService);
  private wsConnectionService = inject(WebsocketConnectionService);
  private eventRepository = inject(IEventRepository);
  private router = inject(Router);

  // --- Grid & Canvas Signals (Persisten a través de rutas) ---
  readonly rows = signal<number>(1);
  readonly cols = signal<number>(1);
  readonly gridSlots = signal<GridSlot[]>([
    { id: 'slot-1-1', camera: null, col: 1, row: 1, spanX: 1, spanY: 1 }
  ]);

  readonly canvasPanX = signal<number>(0);
  readonly canvasPanY = signal<number>(0);
  readonly canvasZoom = signal<number>(1.0);
  readonly isCanvasPinned = signal<boolean>(false);
  readonly isSyncMode = signal<boolean>(true);
  readonly selectedCanvasSlotIds = signal<Set<string>>(new Set());

  // Historial Undo / Redo
  readonly undoStack = signal<CanvasStateSnapshot[]>([]);
  readonly redoStack = signal<CanvasStateSnapshot[]>([]);

  // --- Estado de la Vista y Picture-in-Picture (PiP) ---
  readonly isMonitoringViewOpen = signal<boolean>(false);
  readonly isPipActive = signal<boolean>(false);
  readonly isPipMinimized = signal<boolean>(false);
  readonly isMonitoringPaused = signal<boolean>(false);
  readonly isPipInactivityPaused = signal<boolean>(false);

  // --- Alertas y Notificaciones de Eventos para Cámaras del Lienzo ---
  readonly isEventPulsing = signal<boolean>(false);
  readonly unseenEventsCount = signal<number>(0);
  private pulseTimeoutId: any = null;

  constructor() {
    // Escuchar eventos en tiempo real recibidos por WebSocket
    this.wsConnectionService.messages$.subscribe(msg => {
      if (msg && msg.action === 'nuevo_evento') {
        const docId = msg.body?.doc_id || msg.doc_id;
        if (!docId) return;

        this.eventRepository.getById(docId).subscribe({
          next: (event) => {
            this.handleIncomingCameraEvent(event);
          },
          error: (err) => {
            console.error('[MonitoringStateService] Error al obtener detalle del evento:', err);
          }
        });
      }
    });
  }

  private handleIncomingCameraEvent(event: EventRecord): void {
    if (!event) return;

    // Verificar si el evento pertenece a alguna cámara presente en la cuadrícula
    const activeSlots = this.gridSlots().filter(s => s.camera !== null);
    if (activeSlots.length === 0) return;

    const matches = activeSlots.some(s => {
      const cam = s.camera!;
      const matchId = !!(cam.id && event.idCamara && cam.id.toLowerCase() === event.idCamara.toLowerCase());
      const matchName = !!(cam.name && event.nombreCamara && cam.name.trim().toLowerCase() === event.nombreCamara.trim().toLowerCase());
      return matchId || matchName;
    });

    if (!matches) {
      // Evento de una cámara no asignada en el lienzo -> ignorar
      return;
    }

    console.log(`[MonitoringStateService] Evento relevante recibido para ${event.nombreCamara}`);

    const nameLower = (event.nombreCamara || '').trim().toLowerCase();
    const idLower = (event.idCamara || '').trim().toLowerCase();

    // Actualizar mapa de últimos eventos y lista para instantáneas
    this.latestEventsMap.update(map => ({
      ...map,
      ...(event.nombreCamara ? { [event.nombreCamara]: event } : {}),
      ...(event.idCamara ? { [event.idCamara]: event } : {}),
      ...(nameLower ? { [nameLower]: event } : {}),
      ...(idLower ? { [idLower]: event } : {})
    }));
    this.eventsList.update(list => [event, ...list]);

    // 1. Activar pulso de 2 latidos en el PiP (ventana o isla flotante)
    this.triggerHeartbeatPulse();

    // 2. Si el usuario NO está en la vista de monitoreo, incrementar contador de notificaciones
    if (!this.isMonitoringViewOpen()) {
      this.unseenEventsCount.update(count => count + 1);
    }
  }

  private triggerHeartbeatPulse(): void {
    if (this.pulseTimeoutId) {
      clearTimeout(this.pulseTimeoutId);
      this.isEventPulsing.set(false);
    }

    setTimeout(() => {
      this.isEventPulsing.set(true);
      this.pulseTimeoutId = setTimeout(() => {
        this.isEventPulsing.set(false);
        this.pulseTimeoutId = null;
      }, 1600); // 2 ciclos de 0.8s = 1.6s
    }, 10);
  }

  // Dimensiones y posición de la ventana flotante PiP
  readonly pipPosition = signal<{ x: number; y: number } | null>(null);
  readonly pipSize = signal<{ width: number; height: number }>({ width: 460, height: 320 });

  // WebRTC Connections, MediaStreams y Estados
  readonly activeWebRtcConnections = new Map<string, RTCPeerConnection>();
  readonly activeGridCamerasMap = new Map<string, { cameraId: string; hostFingerprint: string }>();
  readonly mediaStreamsMap = new Map<string, MediaStream>();
  readonly webRtcStates = signal<Record<string, 'connecting' | 'connected' | 'failed'>>({});

  // Eventos de cámaras y últimas capturas/snapshots
  readonly latestEventsMap = signal<Record<string, any>>({});
  readonly eventsList = signal<any[]>([]);

  getLatestEventForCamera(cameraName: string, cameraId?: string): any | null {
    if (!cameraName && !cameraId) return null;
    const map = this.latestEventsMap();

    if (cameraId && map[cameraId]) return map[cameraId];
    if (cameraName && map[cameraName]) return map[cameraName];

    const nameLower = (cameraName || '').trim().toLowerCase();
    const idLower = (cameraId || '').trim().toLowerCase();

    if (idLower && map[idLower]) return map[idLower];
    if (nameLower && map[nameLower]) return map[nameLower];

    return null;
  }

  // Computed signals
  readonly occupiedSlots = computed(() => this.gridSlots().filter(s => s.camera !== null));
  readonly hasActiveCameras = computed(() => this.occupiedSlots().length > 0);
  readonly activeCameraCount = computed(() => this.occupiedSlots().length);

  /**
   * Visibilidad del PiP: Activo solo si NO estamos en la vista de monitoreo,
   * el PiP está habilitado y hay al menos una cámara en el lienzo.
   */
  readonly isPipVisible = computed(() => {
    return !this.isMonitoringViewOpen() && this.isPipActive() && this.hasActiveCameras();
  });

  /**
   * Llamado cuando el usuario ingresa a la vista /dashboard/monitoreo
   */
  onEnterMonitoreo(): void {
    console.log('[MonitoringStateService] Ingresando a la vista de Monitoreo');
    this.isMonitoringViewOpen.set(true);
    this.isPipActive.set(false);
    this.isPipMinimized.set(false);
    this.unseenEventsCount.set(0); // El contador desaparece al entrar a Monitoreo

    // Si estaba pausado por el PiP o por inactividad, reanudar automáticamente todo
    if (this.isMonitoringPaused() || this.isPipInactivityPaused()) {
      console.log('[MonitoringStateService] Reanudando transmisiones WebRTC al ingresar a Monitoreo');
      this.resumeAllStreams();
    }
  }

  /**
   * Llamado cuando el usuario sale de la vista /dashboard/monitoreo a cualquier otra
   */
  onLeaveMonitoreo(): void {
    console.log('[MonitoringStateService] Saliendo de la vista de Monitoreo');
    this.isMonitoringViewOpen.set(false);
    this.unseenEventsCount.set(0); // Comienza a contar desde cero a partir de este momento

    if (this.hasActiveCameras()) {
      // Activar la ventana flotante Picture-in-Picture
      console.log('[MonitoringStateService] Hay cámaras activas en el lienzo. Activando ventana flotante PiP');
      this.isPipActive.set(true);
    } else {
      // Si no hay cámaras, cerrar y limpiar todo
      this.closePip();
    }
  }

  /**
   * Inicia el stream WebRTC para un slot específico y asocia opcionalmente un videoElement
   */
  async startWebRtcStreamByKey(slot: GridSlot, connKey: string, videoEl?: HTMLVideoElement | null): Promise<void> {
    if (!slot.camera) return;

    if (this.activeWebRtcConnections.has(connKey)) {
      // Si ya existe la conexión pero se proporciona un nuevo elemento de video, adjuntar el stream existente solo si no está ya asignado
      if (videoEl && this.mediaStreamsMap.has(slot.id)) {
        const stream = this.mediaStreamsMap.get(slot.id);
        if (stream && videoEl.srcObject !== stream) {
          videoEl.srcObject = stream;
          videoEl.play().catch(err => console.warn('[MonitoringStateService] Autoplay attach warning:', err));
        }
      }
      return;
    }

    try {
      this.webRtcStates.update(prev => ({ ...prev, [slot.id]: 'connecting' }));

      const pc = await this.webRtcService.startStream(
        slot.camera.id,
        videoEl || null,
        (stream) => {
          this.mediaStreamsMap.set(slot.id, stream);
          if (videoEl) {
            videoEl.srcObject = stream;
            videoEl.play().catch(err => console.warn('[MonitoringStateService] Autoplay warning:', err));
          }
        }
      );

      this.activeWebRtcConnections.set(connKey, pc);
      this.webRtcStates.update(prev => ({ ...prev, [slot.id]: 'connected' }));

      // Si el stream ya fue capturado en _remoteStream
      const remoteStream = (pc as any)._remoteStream;
      if (remoteStream) {
        this.mediaStreamsMap.set(slot.id, remoteStream);
      }

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
          this.webRtcStates.update(prev => ({ ...prev, [slot.id]: 'failed' }));
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
          this.webRtcStates.update(prev => ({ ...prev, [slot.id]: 'failed' }));
        }
      };
    } catch (error) {
      console.error(`[MonitoringStateService] Error al iniciar stream WebRTC para cámara ${slot.camera.id}:`, error);
      this.webRtcStates.update(prev => ({ ...prev, [slot.id]: 'failed' }));
    }
  }

  /**
   * Detiene una conexión WebRTC por clave de conexión
   */
  stopWebRtcStreamByKey(connKey: string): void {
    const pc = this.activeWebRtcConnections.get(connKey);
    if (pc) {
      try {
        pc.close();
      } catch (e) {
        console.error(`[MonitoringStateService] Error al cerrar peer connection ${connKey}:`, e);
      }
      this.activeWebRtcConnections.delete(connKey);
    }

    const slotId = connKey.split('_')[0];
    this.mediaStreamsMap.delete(slotId);

    const videoId = `video-feed-${slotId}`;
    const videoEl = document.getElementById(videoId) as HTMLVideoElement;
    if (videoEl) {
      videoEl.srcObject = null;
    }

    this.webRtcStates.update(prev => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });
  }

  /**
   * Adjunta un stream existente al elemento de video indicado
   */
  attachStreamToVideo(slotId: string, videoEl: HTMLVideoElement): void {
    if (!videoEl) return;
    const stream = this.mediaStreamsMap.get(slotId);
    if (stream && videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
      videoEl.play().catch(err => console.warn('[MonitoringStateService] Autoplay play warning:', err));
    }
  }

  /**
   * Pausa todas las transmisiones WebRTC (para ahorro de recursos y ancho de banda)
   * y minimiza la ventana a la Isla Dinámica flotante superior.
   * Conserva intactos los slots, orden, columnas, filas y pan/zoom.
   */
  pauseAllStreams(inactivity: boolean = false): void {
    console.log(`[MonitoringStateService] Pausando todas las transmisiones WebRTC (Inactividad: ${inactivity}) y minimizando PiP`);
    this.isMonitoringPaused.set(true);
    if (inactivity) {
      this.isPipInactivityPaused.set(true);
    }
    this.isPipMinimized.set(true);

    // 1. Emitir webrtc_stop por WebSocket para todas las cámaras del lienzo
    for (const [camId, info] of this.activeGridCamerasMap.entries()) {
      this.websocketService.sendWebRtcStop(info.cameraId, info.hostFingerprint);
    }

    // 2. Cerrar todas las peer connections activas
    for (const connKey of Array.from(this.activeWebRtcConnections.keys())) {
      this.stopWebRtcStreamByKey(connKey);
    }

    this.activeGridCamerasMap.clear();
  }

  /**
   * Reanuda las transmisiones WebRTC para todas las cámaras presentes en la cuadrícula
   * y expande la ventana flotante PiP saliendo de la Isla Dinámica.
   */
  resumeAllStreams(): void {
    console.log('[MonitoringStateService] Reanudando transmisiones WebRTC y expandiendo PiP...');
    this.isMonitoringPaused.set(false);
    this.isPipInactivityPaused.set(false);
    this.isPipMinimized.set(false);

    const currentSlots = this.gridSlots();
    const occupied = currentSlots.filter(s => s.camera !== null);

    // 1. Sincronizar WebSocket webrtc_start
    for (const slot of occupied) {
      if (slot.camera && slot.camera.id) {
        const camId = slot.camera.id;
        const hostFp = slot.camera.hostFingerprint || '';
        this.activeGridCamerasMap.set(camId, { cameraId: camId, hostFingerprint: hostFp });
        this.websocketService.sendWebRtcStart(camId, hostFp);
      }
    }

    // 2. Iniciar streams WebRTC
    occupied.forEach(s => {
      const connKey = `${s.id}_${s.camera!.id}`;
      this.startWebRtcStreamByKey(s, connKey);
    });
  }

  /**
   * Cierra completamente la ventana flotante PiP y la Isla Dinámica, desconecta las transmisiones
   * y restablece la configuración de cámaras y lienzo a su estado inicial.
   */
  closePip(): void {
    console.log('[MonitoringStateService] Cerrando ventana PiP / Isla Dinámica, finalizando streaming y reseteando configuración');
    this.isPipActive.set(false);
    this.isPipMinimized.set(false);
    this.isPipInactivityPaused.set(false);
    this.isMonitoringPaused.set(false);
    this.unseenEventsCount.set(0);

    // 1. Emitir webrtc_stop por WebSocket para todas las cámaras activas
    for (const [camId, info] of this.activeGridCamerasMap.entries()) {
      this.websocketService.sendWebRtcStop(info.cameraId, info.hostFingerprint);
    }
    this.activeGridCamerasMap.clear();

    // 2. Cerrar todas las conexiones activas
    for (const connKey of Array.from(this.activeWebRtcConnections.keys())) {
      this.stopWebRtcStreamByKey(connKey);
    }

    // 3. Restablecer la cuadrícula y lienzo a su estado inicial limpio
    this.gridSlots.set([
      { id: 'slot-1-1', camera: null, col: 1, row: 1, spanX: 1, spanY: 1 }
    ]);
    this.rows.set(1);
    this.cols.set(1);
    this.canvasPanX.set(0);
    this.canvasPanY.set(0);
    this.canvasZoom.set(1.0);
    this.selectedCanvasSlotIds.set(new Set());
    this.undoStack.set([]);
    this.redoStack.set([]);
  }

  /**
   * Navega a la vista completa de Monitoreo
   */
  navigateToMonitoring(): void {
    this.router.navigate(['/dashboard/monitoreo']);
  }
}
