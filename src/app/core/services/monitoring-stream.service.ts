import { Injectable, inject, signal } from '@angular/core';
import { MonitoringStateService, GridSlot } from './monitoring-state.service';
import { WebsocketService } from './websocket.service';
import { Camera } from '../domain/entities/camera.models';

@Injectable({
  providedIn: 'root'
})
export class MonitoringStreamService {
  private monitoringStateService = inject(MonitoringStateService);
  private websocketService = inject(WebsocketService);

  // Estados de feed individual
  readonly activeAiOverlays = signal<Record<string, boolean>>({});
  readonly activeRecStatuses = signal<Record<string, boolean>>({});
  readonly flashEffects = signal<Record<string, boolean>>({});

  /**
   * Refresca el flujo WebRTC de una cámara específica
   */
  refreshCameraStream(slot: GridSlot, event?: MouseEvent): void {
    if (event) event.stopPropagation();
    if (!slot.camera?.id) return;

    const camId = slot.camera.id;
    const hostFp = slot.camera.hostFingerprint || '';

    console.log(`[MonitoringStreamService] Refrescando flujo de cámara "${slot.camera.name}" (ID: ${camId}, Host: ${hostFp}). Emitiendo camera_stream_refresh...`);
    this.websocketService.sendCameraStreamRefresh(camId, hostFp);
  }

  /**
   * Alterna el overlay de IA para una cámara
   */
  toggleAiOverlay(cameraName: string): void {
    const active = !!this.activeAiOverlays()[cameraName];
    this.activeAiOverlays.update(prev => ({ ...prev, [cameraName]: !active }));
  }

  /**
   * Pausa o reanuda el feed individual de una cámara
   */
  toggleFeedPause(cameraName: string): boolean {
    const isPaused = this.isFeedPaused(cameraName);
    this.flashEffects.update(prev => ({ ...prev, [cameraName + '_paused']: !isPaused }));
    return !isPaused;
  }

  /**
   * Comprueba si el feed individual de una cámara está pausado
   */
  isFeedPaused(cameraName: string): boolean {
    return !!this.flashEffects()[cameraName + '_paused'];
  }

  /**
   * Alterna la grabación local simulada de una cámara
   */
  toggleRecording(cameraName: string): boolean {
    const active = !!this.activeRecStatuses()[cameraName];
    this.activeRecStatuses.update(prev => ({ ...prev, [cameraName]: !active }));
    return !active;
  }

  /**
   * Captura una instantánea (snapshot) de la cámara en vivo o en playback y dispara la descarga
   */
  takeSnapshot(
    slot: GridSlot,
    options?: {
      isPlayback?: boolean;
      playbackSnapshotUrl?: string;
      latestSnapshotUrl?: string;
      onSuccess?: (msg: string) => void;
    }
  ): void {
    if (!slot || !slot.camera) return;

    const cameraName = slot.camera.name || 'camara';

    // Efecto de destello visual de flash
    this.flashEffects.update(prev => ({ ...prev, [cameraName]: true }));
    setTimeout(() => {
      this.flashEffects.update(prev => ({ ...prev, [cameraName]: false }));
    }, 300);

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestampStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const downloadFileName = `captura_${cameraName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${timestampStr}`;

    // Caso 1: Video WebRTC en tiempo real activo en el lienzo
    const videoEl = document.getElementById(`video-feed-${slot.id}`) as HTMLVideoElement;
    const isVideoActive = videoEl &&
      this.monitoringStateService.webRtcStates()[slot.id] === 'connected' &&
      !options?.isPlayback &&
      videoEl.videoWidth > 0 &&
      videoEl.videoHeight > 0;

    if (isVideoActive) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth;
        canvas.height = videoEl.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          const dataUrl = canvas.toDataURL('image/png');

          const a = document.createElement('a');
          a.href = dataUrl;
          a.download = `${downloadFileName}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          if (options?.onSuccess) {
            options.onSuccess(`📸 Captura de vídeo en tiempo real guardada (${cameraName})`);
          }
          return;
        }
      } catch (err) {
        console.error('[MonitoringStreamService] Error al capturar canvas de vídeo WebRTC:', err);
      }
    }

    // Caso 2: Imagen de Evento / Snapshot Histórico en Playback o fallback
    let imgUrl = options?.playbackSnapshotUrl || options?.latestSnapshotUrl || null;

    if (imgUrl) {
      this.downloadImageFromUrl(imgUrl, `${downloadFileName}.jpg`);
      if (options?.onSuccess) {
        options.onSuccess(`📸 Fotograma de evento descargado (${cameraName})`);
      }
    } else {
      if (options?.onSuccess) {
        options.onSuccess(`📸 Captura de pantalla de ${cameraName} guardada`);
      }
    }
  }

  /**
   * Descarga un archivo de imagen por URL o DataURI
   */
  downloadImageFromUrl(url: string, fileName: string): void {
    if (url.startsWith('data:')) {
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    fetch(url)
      .then(response => response.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      })
      .catch(err => {
        console.error('[MonitoringStreamService] Error al descargar la imagen:', err);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
  }

  /**
   * Inicia el stream WebRTC para un slot específico buscando el video element en el DOM
   */
  async startWebRtcStreamByKey(slot: GridSlot, connKey: string): Promise<void> {
    if (!slot.camera || this.monitoringStateService.isMonitoringPaused()) return;

    // Buscar el elemento de video correspondiente (monitoreo estándar, pip o fullscreen)
    let videoEl = document.getElementById(`video-feed-${slot.id}`) as HTMLVideoElement;
    if (!videoEl) {
      videoEl = document.getElementById(`pip-video-feed-${slot.id}`) as HTMLVideoElement;
    }
    if (!videoEl) {
      videoEl = document.getElementById(`video-feed-fullscreen-${slot.id}`) as HTMLVideoElement;
    }

    if (!videoEl) {
      setTimeout(() => {
        const currentSlots = this.monitoringStateService.gridSlots();
        const exists = currentSlots.some(s => s.id === slot.id && s.camera?.id === slot.camera?.id);
        if (exists && !this.monitoringStateService.activeWebRtcConnections.has(connKey)) {
          this.startWebRtcStreamByKey(slot, connKey);
        }
      }, 60);
      return;
    }

    await this.monitoringStateService.startWebRtcStreamByKey(slot, connKey, videoEl);
  }

  /**
   * Detiene el stream WebRTC por clave de conexión
   */
  stopWebRtcStreamByKey(connKey: string): void {
    this.monitoringStateService.stopWebRtcStreamByKey(connKey);
  }

  /**
   * Sincroniza las conexiones WebRTC activas con los slots del lienzo
   */
  syncWebRtcConnections(
    slots: GridSlot[],
    isDragging: boolean,
    isResizing: boolean
  ): void {
    if (isDragging || isResizing || this.monitoringStateService.isMonitoringPaused()) {
      return;
    }

    const occupiedSlots = slots.filter(s => s.camera !== null);
    const activeKeys = new Set(occupiedSlots.map(s => `${s.id}_${s.camera!.id}`));

    // 1. Detener conexiones de slots que ya no existen o cambiaron de cámara
    for (const connKey of Array.from(this.monitoringStateService.activeWebRtcConnections.keys())) {
      if (!activeKeys.has(connKey)) {
        this.stopWebRtcStreamByKey(connKey);
      }
    }

    // 2. Iniciar conexiones para slots que no tengan conexión activa ni estén en proceso de conexión
    if (occupiedSlots.length > 0) {
      setTimeout(() => {
        if (isDragging || isResizing || this.monitoringStateService.isMonitoringPaused()) {
          return;
        }

        occupiedSlots.forEach(s => {
          const connKey = `${s.id}_${s.camera!.id}`;
          const currentWebRtcState = this.monitoringStateService.webRtcStates()[s.id];
          const hasActiveConn = this.monitoringStateService.activeWebRtcConnections.has(connKey);

          if (!hasActiveConn && currentWebRtcState !== 'connecting') {
            this.startWebRtcStreamByKey(s, connKey);
          }
        });
      }, 150);
    }
  }

  /**
   * Sincroniza eventos WebSocket (webrtc_start y webrtc_stop) con las cámaras de la cuadrícula
   */
  syncWebSocketCameras(slots: GridSlot[]): void {
    const nextGridCamerasMap = new Map<string, { cameraId: string; hostFingerprint: string }>();

    for (const slot of slots) {
      if (slot.camera && slot.camera.id) {
        nextGridCamerasMap.set(slot.camera.id, {
          cameraId: slot.camera.id,
          hostFingerprint: slot.camera.hostFingerprint || ''
        });
      }
    }

    // 1. Detectar cámaras eliminadas
    for (const [camId, info] of this.monitoringStateService.activeGridCamerasMap.entries()) {
      if (!nextGridCamerasMap.has(camId)) {
        console.log(`[MonitoringStreamService WebSocket] Cámara eliminada: ${camId}. Emitiendo webrtc_stop`);
        this.websocketService.sendWebRtcStop(info.cameraId, info.hostFingerprint);
      }
    }

    // 2. Detectar cámaras agregadas
    for (const [camId, info] of nextGridCamerasMap.entries()) {
      if (!this.monitoringStateService.activeGridCamerasMap.has(camId)) {
        console.log(`[MonitoringStreamService WebSocket] Nueva cámara agregada: ${camId}. Emitiendo webrtc_start`);
        this.websocketService.sendWebRtcStart(info.cameraId, info.hostFingerprint);
      }
    }

    // Actualizar mapa activo en el servicio singleton
    this.monitoringStateService.activeGridCamerasMap.clear();
    for (const [k, v] of nextGridCamerasMap.entries()) {
      this.monitoringStateService.activeGridCamerasMap.set(k, v);
    }
  }
}
