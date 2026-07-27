import { Component, OnInit, OnDestroy, AfterViewInit, inject, signal, computed, effect, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { CameraService } from '../../../core/services/camera.service';
import { HostService } from '../../../core/services/host.service';
import { AnalyticService } from '../../../core/services/analytic.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { WebsocketConnectionService } from '../../../core/services/websocket-connection.service';
import { IEventRepository } from '../../../core/domain/repositories/event.repository';
import { WebRtcService } from '../../../core/services/webrtc.service';

import { Camera } from '../../../core/domain/entities/camera.models';
import { Host } from '../../../core/domain/entities/host.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { EventRecord } from '../../../core/domain/entities/event.models';
import { parseUtcDate } from '../../../core/utils/date-utils';
import { copyToClipboard } from '../../../core/utils/clipboard.util';
import { getCameraEffectiveStatus, getCameraStatusCssClass } from '../../../core/utils/camera-status.utils';
import { EventDetailModalComponent } from '../../shared/event-detail-modal/event-detail-modal.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { SearchInputComponent } from '../../shared/search-input/search-input.component';
import { CameraDetailDrawerComponent } from '../../shared/camera-detail-drawer/camera-detail-drawer.component';

export interface GridSlot {
  id: string;
  camera: Camera | null;
  col: number;
  row: number;
  spanX: number;
  spanY: number;
  isLocked?: boolean;
}

export interface CanvasStateSnapshot {
  slots: GridSlot[];
  cols: number;
  rows: number;
}



@Component({
  selector: 'app-monitoreo',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, EventDetailModalComponent, PageHeaderComponent, SearchInputComponent, CameraDetailDrawerComponent],
  templateUrl: './monitoreo.html',
  styleUrl: './monitoreo.css'
})
export class Monitoreo implements OnInit, OnDestroy, AfterViewInit {
  private cameraService = inject(CameraService);
  private hostService = inject(HostService);
  private analyticService = inject(AnalyticService);
  private sidebarService = inject(SidebarService);
  private wsConnectionService = inject(WebsocketConnectionService);
  private eventRepository = inject(IEventRepository);
  public permissionsService = inject(PermissionsService);
  private webRtcService = inject(WebRtcService);
  private cdr = inject(ChangeDetectorRef);

  // Camera Detail Drawer State (Shared Component)
  readonly showCameraConfigDrawer = signal<boolean>(false);
  readonly selectedConfigCamera = signal<Camera | null>(null);

  openCameraConfig(camera: Camera, event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.selectedConfigCamera.set(camera);
    this.showCameraConfigDrawer.set(true);
  }

  // WebRTC Live Video Connections & States
  private activeWebRtcConnections = new Map<string, RTCPeerConnection>();
  readonly webRtcStates = signal<Record<string, 'connecting' | 'connected' | 'failed'>>({});

  // Layout Grid States (Coordinate slots) - Empieza en 1x1 reactivo
  readonly rows = signal<number>(1);
  readonly cols = signal<number>(1);

  readonly gridSlots = signal<GridSlot[]>([
    { id: 'slot-1-1', camera: null, col: 1, row: 1, spanX: 1, spanY: 1 }
  ]);

  readonly targetAddCol = signal<number | null>(null);
  readonly targetAddRow = signal<number | null>(null);

  // Custom Drag & Resize Signals
  readonly draggingSlotId = signal<string | null>(null);
  readonly resizingSlotId = signal<string | null>(null);
  readonly swapPulseSlotId = signal<string | null>(null);
  readonly activeHoveredExpander = signal<'column' | 'row' | null>(null);

  // Canvas Mode, Panning and Zooming Signals for Grid > 4x4
  readonly canvasPanX = signal<number>(0);
  readonly canvasPanY = signal<number>(0);
  readonly canvasZoom = signal<number>(1.0);
  readonly showMinimap = signal<boolean>(true);
  readonly isCanvasPinned = signal<boolean>(false);
  readonly isCanvasActive = signal<boolean>(true);
  readonly isCanvasMode = computed(() => this.gridSlots().some(s => s.camera !== null));
  readonly isRightPanelCollapsed = signal<boolean>(false);
  private canvasActivityTimer: any = null;

  // Box Selection (Recuadro de Selección por Clic + Arrastre) Signals & Sync State
  readonly isSyncMode = signal<boolean>(true);
  readonly isBoxSelecting = signal<boolean>(false);
  readonly selectionBox = signal<{ x: number; y: number; width: number; height: number } | null>(null);
  readonly selectedCanvasSlotIds = signal<Set<string>>(new Set());

  // Camera Fullscreen Overlay Signal & Origin Animation
  readonly fullscreenSlot = signal<GridSlot | null>(null);
  readonly fullscreenTransformOrigin = signal<string>('center center');

  openFullscreen(slot: GridSlot, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();

      const target = (event.currentTarget || event.target) as HTMLElement;
      const cardEl = target ? target.closest('.grid-slot-cell') as HTMLElement : null;
      if (cardEl) {
        const rect = cardEl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        this.fullscreenTransformOrigin.set(`${centerX}px ${centerY}px`);
      } else {
        this.fullscreenTransformOrigin.set('center center');
      }
    } else {
      this.fullscreenTransformOrigin.set('center center');
    }

    if (!slot.camera) return;

    this.fullscreenSlot.set(slot);
    this.showToast(`📺 Pantalla completa: ${slot.camera.name}`, 'primary');

    // Sincronizar la transmisión de vídeo WebRTC al elemento de vídeo en pantalla completa
    setTimeout(() => {
      const mainVideo = document.getElementById(`video-feed-${slot.id}`) as HTMLVideoElement;
      const fsVideo = document.getElementById(`video-feed-fullscreen-${slot.id}`) as HTMLVideoElement;
      if (mainVideo && fsVideo && mainVideo.srcObject) {
        fsVideo.srcObject = mainVideo.srcObject;
      }
    }, 50);
  }

  closeFullscreen(): void {
    if (this.fullscreenSlot()) {
      this.fullscreenSlot.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    if (this.fullscreenSlot()) {
      this.closeFullscreen();
    }
  }

  toggleSyncMode(): void {
    this.isSyncMode.update(s => !s);
    // No se limpia la selección al cambiar de modo: persiste en ambos
    if (this.playbackMode() === 'playback' && !this.isSyncMode()) {
      // Solo revertir a LIVE si pasamos a SYNC sin selección activa para playback individual
    }
    if (this.isSyncMode()) {
      this.showToast('🔒 Modo SYNC activado: Selección activa filtra el panel e info, lienzo sincronizado', 'primary');
    } else {
      this.showToast('🔓 Modo ASYNC activado: Selección e interacción independiente de cámaras', 'warning');
    }
  }

  readonly selectedCameraNames = computed(() => {
    const selectedSlotIds = this.selectedCanvasSlotIds();
    if (selectedSlotIds.size === 0) return new Set<string>();

    const slots = this.gridSlots().filter(s => selectedSlotIds.has(s.id) && s.camera !== null);
    return new Set(slots.map(s => s.camera!.name));
  });

  // Canvas History Stack Signals (Undo/Redo)
  readonly undoStack = signal<CanvasStateSnapshot[]>([]);
  readonly redoStack = signal<CanvasStateSnapshot[]>([]);
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);
  readonly isGridFullyOccupied = computed(() => {
    const totalArea = this.cols() * this.rows();
    const occupiedArea = this.gridSlots()
      .filter(s => s.camera !== null)
      .reduce((sum, s) => sum + s.spanX * s.spanY, 0);
    return occupiedArea >= totalArea;
  });

  // Multi-select camera signal inside the modal
  readonly selectedCameraIds = signal<Set<string>>(new Set());

  // Modal Search & Filter States
  readonly modalSearchQuery = signal<string>('');
  readonly modalStatusFilter = signal<'all' | 'online' | 'offline'>('all');

  // Player & Timeline States
  readonly playbackMode = signal<'live' | 'playback'>('live');
  readonly paused = signal<boolean>(false);
  readonly playbackSpeed = signal<number>(1);
  readonly zoomRangeSeconds = signal<number>(86400); // 24 horas por defecto
  readonly currentTimePointer = signal<Date>(new Date());
  readonly playbackWindowEnd = signal<Date | null>(null);

  readonly hoursSegmentStr = signal<string>('00');
  readonly minutesSegmentStr = signal<string>('00');
  readonly secondsSegmentStr = signal<string>('00');
  private isEditingTimeSegments = false;

  readonly dateDayStr = signal<string>('01');
  readonly dateMonthStr = signal<string>('01');
  readonly dateYearStr = signal<string>('2026');
  private isEditingDateSegments = false;

  // Collections
  readonly allCameras = signal<Camera[]>([]);
  readonly allHosts = signal<Host[]>([]);
  readonly eventsList = signal<EventRecord[]>([]);
  readonly bufferedEvents = signal<EventRecord[]>([]);
  readonly latestEventsMap = signal<Record<string, EventRecord>>({});
  readonly isLoadingEvents = signal<boolean>(false);

  // Individual feed configurations
  readonly activeAiOverlays = signal<Record<string, boolean>>({});
  readonly activeRecStatuses = signal<Record<string, boolean>>({});
  readonly flashEffects = signal<Record<string, boolean>>({});



  // Highlight effect
  readonly highlightedCellCameraName = signal<string | null>(null);

  // Logs Feed Control
  readonly isLogsFeedPaused = signal<boolean>(false);

  // UI Tabs & Toggles
  readonly activeRightTab = signal<'registro' | 'analiticas'>('registro');
  readonly activeModalTab = signal<'nodos' | 'todas'>('nodos');
  readonly expandedNodes = signal<Set<string>>(new Set());
  readonly showModal = signal<boolean>(false);
  readonly selectedEvent = signal<EventRecord | null>(null);
  readonly selectedModalEvent = signal<EventRecord | null>(null);
  readonly isZoomed = signal<boolean>(false);

  // Right log filters
  readonly eventSearchControl = new FormControl('');
  readonly eventSearchQuery = signal<string>('');
  readonly eventAnalyticFilter = signal<string>('all');
  readonly eventDesdeFilter = signal<Date | null>(null);
  readonly eventHastaFilter = signal<Date | null>(null);

  // Sidebar infinite scroll 3-page sliding window (75 items max in DOM: 25 items x 3 pages)
  readonly currentSidebarPage = signal<number>(1);
  readonly sidebarPageSize = 25;

  // Sidebar filter panel visibility
  readonly showSidebarFilters = signal<boolean>(false);
  readonly hasActiveSidebarFilters = computed(() =>
    this.eventAnalyticFilter() !== 'all' ||
    !!this.filterDateDesdeStr() ||
    !!this.filterDateHastaStr()
  );

  // Date and Time inputs inside filters
  readonly filterDateDesdeStr = signal<string>('');
  readonly filterTimeDesdeStr = signal<string>('00:00');
  readonly filterDateHastaStr = signal<string>('');
  readonly filterTimeHastaStr = signal<string>('23:59');

  readonly tempDateStart = signal<string>('');
  readonly tempDateEnd = signal<string>('');
  readonly isSelectingRange = signal<boolean>(false);
  readonly showTimeRangeDropdown = signal<boolean>(false);

  readonly activeCalendarField = signal<'custom-layout' | 'registro-fechas' | 'fechas' | null>(null);
  readonly activeNestedCalendar = signal<'desde' | 'hasta' | null>(null);
  readonly activeTimeField = signal<'desde' | 'hasta' | null>(null);
  readonly calendarViewMonth = signal<number>(new Date().getMonth());
  readonly calendarViewYear = signal<number>(new Date().getFullYear());
  readonly hoursList = Array.from({ length: 24 }, (_, i) => i);
  readonly minutesList = Array.from({ length: 60 }, (_, i) => i);

  // Magnifier lens state
  readonly zoomX = signal<number>(0);
  readonly zoomY = signal<number>(0);
  readonly zoomBgX = signal<number>(0);
  readonly zoomBgY = signal<number>(0);
  readonly zoomBgWidth = signal<number>(0);
  readonly zoomBgHeight = signal<number>(0);
  readonly copiedField = signal<string | null>(null);

  onImageError(event: Event): void {
    const target = event.target as HTMLElement;
    if (target) {
      target.style.display = 'none';
    }
  }

  // Sidebar state
  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  private wsSubscription?: Subscription;
  private timelineTimer: any;

  constructor() {
    effect(() => {
      const d = this.currentTimePointer();
      const pad = (n: number) => n.toString().padStart(2, '0');
      if (!this.isEditingTimeSegments) {
        this.hoursSegmentStr.set(pad(d.getHours()));
        this.minutesSegmentStr.set(pad(d.getMinutes()));
        this.secondsSegmentStr.set(pad(d.getSeconds()));
      }
      if (!this.isEditingDateSegments) {
        this.dateDayStr.set(pad(d.getDate()));
        this.dateMonthStr.set(pad(d.getMonth() + 1));
        this.dateYearStr.set(d.getFullYear().toString());
      }
    }, { allowSignalWrites: true });

    // Restablecer automáticamente el reproductor a EN VIVO si no quedan cámaras seleccionadas en modo ASYNC
    effect(() => {
      const sync = this.isSyncMode();
      const selectedCount = this.selectedCanvasSlotIds().size;
      const mode = this.playbackMode();

      // Solo en ASYNC: si se deseleccionan todas las cámaras y estaba en playback, volver a LIVE
      if (!sync && selectedCount === 0 && mode === 'playback') {
        this.setLiveMode();
      }
    }, { allowSignalWrites: true });

    this.eventSearchControl.valueChanges.pipe(
      debounceTime(200),
      distinctUntilChanged()
    ).subscribe(val => {
      this.eventSearchQuery.set(val || '');
    });



    // Clave computada única de IDs de cámaras presentes en el grid (evita re-ejecución al mover celdas)
    const activeCameraIdsKey = computed(() => {
      const ids = this.gridSlots()
        .map(s => s.camera?.id)
        .filter((id): id is string => !!id)
        .sort();
      return Array.from(new Set(ids)).join(',');
    });

    // Rango de búsqueda para la consulta HTTP a OpenSearch (NO depende del reloj ticker de 1s)
    const activeSearchRange = computed(() => {
      const key = activeCameraIdsKey();
      const manualDate = this.selectedManualDate();
      if (!key) return null;

      if (!manualDate) {
        // Modo por defecto / En Vivo (Últimas 24 horas a partir del momento de la consulta)
        const end = new Date();
        const start = new Date(end.getTime() - 24 * 3600 * 1000);
        return { start, end, key };
      } else {
        // Fecha pasada seleccionada manualmente
        const start = new Date(manualDate.getFullYear(), manualDate.getMonth(), manualDate.getDate(), 0, 0, 0, 0);
        const end = new Date(manualDate.getFullYear(), manualDate.getMonth(), manualDate.getDate(), 23, 59, 59, 999);
        return { start, end, key };
      }
    });

    // Cargar eventos históricos SOLO cuando cambian las cámaras del lienzo o se selecciona una fecha manual
    effect(() => {
      const range = activeSearchRange();
      if (!range) {
        this.eventsList.set([]);
        this.latestEventsMap.set({});
        return;
      }

      const activeCams = this.gridSlots()
        .map(s => s.camera)
        .filter((c): c is Camera => c !== null);

      const cameraNames = Array.from(new Set(activeCams.map(c => c.name)));
      this.isLoadingEvents.set(true);

      this.eventRepository.search({
        search: '',
        camaras: cameraNames,
        analiticas: [],
        objetos: [],
        timestampDesde: range.start,
        timestampHasta: range.end
      }, 1, 10000).subscribe({
        next: (res) => {
          const recordsWithMs = res.records.map(r => {
            r.timestampMs = r.timestampMs || new Date(r.timestamp).getTime();
            return r;
          });
          this.eventsList.set(recordsWithMs);
          this.pruneEventsOlderThan24h();
          this.isLoadingEvents.set(false);

          // Rellenar mapa de últimos eventos
          const latestMap: Record<string, EventRecord> = {};
          res.records.forEach(r => {
            if (!latestMap[r.nombreCamara]) {
              latestMap[r.nombreCamara] = r;
            }
          });
          this.latestEventsMap.set(latestMap);
        },
        error: (err) => {
          console.error('[Monitoreo] Error al cargar histórico de eventos:', err);
          this.eventsList.set([]);
          this.isLoadingEvents.set(false);
        }
      });
    }, { allowSignalWrites: true });

    // Sincronizar conexiones de WebRTC activas basadas en las celdas ocupadas
    effect(() => {
      // Congelar la sincronización si el usuario está arrastrando o redimensionando activamente
      if (this.draggingSlotId() !== null || this.resizingSlotId() !== null) {
        return;
      }

      const currentSlots = this.gridSlots();
      const occupiedSlots = currentSlots.filter(s => s.camera !== null);
      const activeKeys = new Set(occupiedSlots.map(s => `${s.id}_${s.camera!.id}`));

      // 1. Detener conexiones de slots que ya no existen o cambiaron de cámara
      for (const connKey of Array.from(this.activeWebRtcConnections.keys())) {
        if (!activeKeys.has(connKey)) {
          this.stopWebRtcStreamByKey(connKey);
        }
      }

      // 2. Iniciar conexiones para nuevos slots o con cámaras cambiadas
      if (occupiedSlots.length > 0) {
        setTimeout(() => {
          // Re-confirmar que no se haya iniciado un arrastre o redimensionamiento en el intervalo
          if (this.draggingSlotId() !== null || this.resizingSlotId() !== null) {
            return;
          }

          occupiedSlots.forEach(s => {
            const connKey = `${s.id}_${s.camera!.id}`;
            this.startWebRtcStreamByKey(s, connKey);
          });
        }, 150);
      }
    });
  }

  readonly liveTickerClock = signal<Date>(new Date());

  ngOnInit(): void {
    this.cameraService.getAllCameras().subscribe({
      next: (cams) => this.allCameras.set(cams)
    });
    this.hostService.loadAllHosts().subscribe({
      next: (hosts) => this.allHosts.set(hosts)
    });
    this.analyticService.getAllAnalytics().subscribe();

    this.setupWebSocketSubscription();
    this.resetCanvasActivityTimer();
  }

  // WebSocket en tiempo real
  private setupWebSocketSubscription(): void {
    this.wsSubscription = this.wsConnectionService.messages$.subscribe(msg => {
      if (msg && msg.action === 'nuevo_evento') {
        const docId = msg.body?.doc_id || msg.doc_id;
        if (!docId) return;

        this.eventRepository.getById(docId).subscribe({
          next: (event) => {
            const activeCams = this.gridSlots()
              .map(s => s.camera)
              .filter((c): c is Camera => c !== null);
            const activeNames = activeCams.map(c => c.name);

            if (activeNames.includes(event.nombreCamara)) {
              if (this.isLogsFeedPaused()) {
                this.bufferedEvents.update(prev => [event, ...prev]);
              } else {
                this.eventsList.update(list => [event, ...list]);
                this.latestEventsMap.update(map => ({
                  ...map,
                  [event.nombreCamara]: event
                }));
                if (this.playbackMode() === 'live') {
                  this.currentTimePointer.set(new Date());
                }
              }
              this.pruneEventsOlderThan24h();
            }
          }
        });
      }
    });

    // Reloj digital y pulso reactivo en tiempo real
    this.timelineTimer = setInterval(() => {
      const now = new Date();
      this.liveTickerClock.set(now);
      if (this.playbackMode() === 'live') {
        this.currentTimePointer.set(now);
      }
      this.pruneEventsOlderThan24h();
      this.cdr.markForCheck();
    }, 1000);

    // Inicializar temporizador de inactividad
    this.resetCanvasActivityTimer();
  }

  pruneEventsOlderThan24h(): void {
    const bounds = this.activeDayBounds();
    const startMs = bounds.start.getTime();
    const endMs = bounds.end.getTime();

    this.eventsList.update(list => list.filter(e => {
      const t = new Date(e.timestamp).getTime();
      return t >= startMs && t <= endMs;
    }));

    this.bufferedEvents.update(buf => buf.filter(e => {
      const t = new Date(e.timestamp).getTime();
      return t >= startMs && t <= endMs;
    }));

    this.latestEventsMap.update(map => {
      const nextMap: Record<string, EventRecord> = {};
      Object.entries(map).forEach(([camName, evt]) => {
        const t = new Date(evt.timestamp).getTime();
        if (t >= startMs && t <= endMs) {
          nextMap[camName] = evt;
        }
      });
      return nextMap;
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.resetCanvas(), 150);
  }

  ngOnDestroy(): void {
    if (this.wsSubscription) {
      this.wsSubscription.unsubscribe();
    }
    if (this.timelineTimer) {
      clearInterval(this.timelineTimer);
    }
    if (this.canvasActivityTimer) {
      clearTimeout(this.canvasActivityTimer);
    }
    // Cerrar todas las conexiones activas de WebRTC al destruir la vista
    for (const connKey of Array.from(this.activeWebRtcConnections.keys())) {
      this.stopWebRtcStreamByKey(connKey);
    }
  }

  async startWebRtcStreamByKey(slot: GridSlot, connKey: string): Promise<void> {
    if (!slot.camera) return;

    // Si ya existe una conexión para esta clave, no duplicarla
    if (this.activeWebRtcConnections.has(connKey)) {
      return;
    }

    const videoId = `video-feed-${slot.id}`;
    const videoEl = document.getElementById(videoId) as HTMLVideoElement;
    if (!videoEl) {
      // Reintentar en un ciclo corto si el elemento aún no se ha dibujado en el DOM
      setTimeout(() => {
        const currentSlots = this.gridSlots();
        const exists = currentSlots.some(s => s.id === slot.id && s.camera?.id === slot.camera?.id);
        if (exists && !this.activeWebRtcConnections.has(connKey)) {
          this.startWebRtcStreamByKey(slot, connKey);
        }
      }, 50);
      return;
    }

    try {
      this.webRtcStates.update(prev => ({ ...prev, [slot.id]: 'connecting' }));
      const pc = await this.webRtcService.startStream(slot.camera.id, videoEl);

      this.activeWebRtcConnections.set(connKey, pc);
      this.webRtcStates.update(prev => ({ ...prev, [slot.id]: 'connected' }));

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
      console.error(`Error al iniciar stream WebRTC para la cámara ${slot.camera.id} (slot ${slot.id}):`, error);
      this.webRtcStates.update(prev => ({ ...prev, [slot.id]: 'failed' }));
    }
  }

  stopWebRtcStreamByKey(connKey: string): void {
    const pc = this.activeWebRtcConnections.get(connKey);
    if (pc) {
      try {
        pc.close();
      } catch (e) {
        console.error(`Error al cerrar peer connection para llave ${connKey}:`, e);
      }
      this.activeWebRtcConnections.delete(connKey);
    }

    const slotId = connKey.split('_')[0];
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

  // Notificaciones Toast Deshabilitadas
  showToast(msg?: string, type?: 'success' | 'warning' | 'danger' | 'primary'): void {
    // Deshabilitado por completo
  }

  // --- Limpiar y pausar feed de logs ---
  clearLogs(): void {
    this.eventsList.set([]);
    this.latestEventsMap.set({});
    this.showToast('Historial de alertas limpio', 'warning');
  }

  toggleLogsFeed(): void {
    this.isLogsFeedPaused.update(p => !p);
    if (!this.isLogsFeedPaused() && this.bufferedEvents().length > 0) {
      const buffer = this.bufferedEvents();
      this.eventsList.update(list => [...buffer, ...list]);

      const newLatestMap = { ...this.latestEventsMap() };
      buffer.forEach(e => {
        if (!newLatestMap[e.nombreCamara]) {
          newLatestMap[e.nombreCamara] = e;
        }
      });
      this.latestEventsMap.set(newLatestMap);
      this.bufferedEvents.set([]);
      this.pruneEventsOlderThan24h();
    }
    this.showToast(this.isLogsFeedPaused() ? 'Feed de alertas pausado' : 'Feed de alertas reanudado', 'primary');
  }

  // --- Métodos de Lienzo (Canvas Mode) y Minimapa interactivo ---
  getMinZoom(): number {
    const gridContainer = document.querySelector('.monitoring-grid-container');
    if (!gridContainer) return 0.15;

    const { width: totalW, height: totalH } = this.getCanvasDimensions();
    const viewportW = gridContainer.clientWidth;
    const viewportH = gridContainer.clientHeight;

    if (totalW === 0 || totalH === 0) return 0.15;

    const zoomToFitX = viewportW / totalW;
    const zoomToFitY = viewportH / totalH;
    const zoomToFit = Math.min(zoomToFitX, zoomToFitY);

    // Permitir zoom out hasta un 20% más alejado del ajuste perfecto (zoomToFit * 0.8),
    // pero con un tope mínimo estándar de 0.5 si el canvas cabe completo,
    // y un piso absoluto de seguridad de 0.02 (2%).
    return Math.max(0.02, Math.min(0.5, zoomToFit * 0.8));
  }

  getCellDimensions(): { cellW: number; cellH: number } {
    const gridContainer = document.querySelector('.monitoring-grid-container');
    if (!gridContainer) return { cellW: 240, cellH: 135 };

    const isCanvas = this.isCanvasMode();
    const colsVal = this.cols();
    const rowsVal = this.rows();
    const refCols = isCanvas ? 4 : colsVal;
    const refRows = isCanvas ? 4 : rowsVal;

    const totalWidth = gridContainer.clientWidth - 20;
    const availableWidth = totalWidth - (refCols - 1) * 12;
    const cellW = isCanvas ? Math.max(180, availableWidth / refCols) : (availableWidth / refCols);

    let cellH: number;
    if (isCanvas) {
      cellH = Math.round(cellW * (9 / 16));
    } else {
      const totalHeight = gridContainer.clientHeight - 20;
      const availableHeight = totalHeight - (refRows - 1) * 12;
      cellH = availableHeight / refRows;
    }

    return { cellW, cellH };
  }

  getExtenderDimensions(): { width: number; height: number; fontSize: number; iconSize: number } {
    const zoom = Math.max(0.05, this.canvasZoom());
    // Escala inversamente al Zoom para mantener dimensiones legibles en pantalla al alejarse
    const width = Math.round(48 / zoom);
    const height = Math.round(48 / zoom);
    const fontSize = Math.max(10, Math.round(11 / zoom));
    const iconSize = Math.max(13, Math.round(14 / zoom));
    return { width, height, fontSize, iconSize };
  }

  getCanvasDimensions(): { width: number; height: number } {
    const { cellW, cellH } = this.getCellDimensions();
    const colsVal = this.cols();
    const rowsVal = this.rows();

    const showExpanders = (this.draggingSlotId() !== null || this.isGridFullyOccupied()) && !this.isCanvasPinned();
    const extDim = this.getExtenderDimensions();
    const draggingOffsetW = showExpanders ? extDim.width : 0;
    const draggingOffsetH = showExpanders ? extDim.height : 0;

    const width = colsVal * cellW + (colsVal - 1) * 12 + 20 + draggingOffsetW;
    const height = rowsVal * cellH + (rowsVal - 1) * 12 + 20 + draggingOffsetH;

    return { width, height };
  }

  constrainPan(panX: number, panY: number, zoom: number): { x: number; y: number } {
    const gridContainer = document.querySelector('.monitoring-grid-container');
    if (!gridContainer) return { x: panX, y: panY };

    const { width: totalW, height: totalH } = this.getCanvasDimensions();
    const viewportW = gridContainer.clientWidth;
    const viewportH = gridContainer.clientHeight;

    // Límites de desplazamiento compactos y acotados (margen buffer del 12% del viewport)
    const marginX = Math.max(40, viewportW * 0.12);
    const marginY = Math.max(30, viewportH * 0.12);

    const minX = viewportW - (totalW * zoom) - marginX;
    const maxX = marginX;

    const minY = viewportH - (totalH * zoom) - marginY;
    const maxY = marginY;

    const clampRange = (val: number, bound1: number, bound2: number): number => {
      const min = Math.min(bound1, bound2);
      const max = Math.max(bound1, bound2);
      return Math.max(min, Math.min(max, val));
    };

    const x = clampRange(panX, minX, maxX);
    const y = clampRange(panY, minY, maxY);

    return { x, y };
  }

  getMinimapWorldBounds(): { minX: number; maxX: number; minY: number; maxY: number; width: number; height: number } {
    const gridContainer = document.querySelector('.monitoring-grid-container');
    const viewportW = gridContainer ? gridContainer.clientWidth : 1200;
    const viewportH = gridContainer ? gridContainer.clientHeight : 700;

    const { width: layoutW, height: layoutH } = this.getCanvasDimensions();
    const zoom = this.canvasZoom();
    const panX = this.canvasPanX();
    const panY = this.canvasPanY();

    // Coordenadas del Viewport visible en el espacio del Lienzo (Canvas)
    const vpMinX = -panX / zoom;
    const vpMaxX = (viewportW - panX) / zoom;
    const vpMinY = -panY / zoom;
    const vpMaxY = (viewportH - panY) / zoom;

    // Unión de los límites del Layout completo y el Viewport visible
    const minXUnpadded = Math.min(0, vpMinX);
    const maxXUnpadded = Math.max(layoutW, vpMaxX);
    const minYUnpadded = Math.min(0, vpMinY);
    const maxYUnpadded = Math.max(layoutH, vpMaxY);

    // Margen buffer del 6% alrededor del canvas
    const padX = Math.max(40, (maxXUnpadded - minXUnpadded) * 0.06);
    const padY = Math.max(40, (maxYUnpadded - minYUnpadded) * 0.06);

    const minX = minXUnpadded - padX;
    const maxX = maxXUnpadded + padX;
    const minY = minYUnpadded - padY;
    const maxY = maxYUnpadded + padY;

    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);

    return { minX, maxX, minY, maxY, width, height };
  }

  getMinimapLayoutRect(): { left: number; top: number; width: number; height: number } {
    const world = this.getMinimapWorldBounds();
    const { width: layoutW, height: layoutH } = this.getCanvasDimensions();

    return {
      left: ((0 - world.minX) / world.width) * 100,
      top: ((0 - world.minY) / world.height) * 100,
      width: (layoutW / world.width) * 100,
      height: (layoutH / world.height) * 100
    };
  }

  getMinimapSlotRect(slot: GridSlot): { left: number; top: number; width: number; height: number } {
    const world = this.getMinimapWorldBounds();
    const { cellW, cellH } = this.getCellDimensions();

    const slotX = 10 + (slot.col - 1) * (cellW + 12);
    const slotY = 10 + (slot.row - 1) * (cellH + 12);
    const slotW = slot.spanX * cellW + (slot.spanX - 1) * 12;
    const slotH = slot.spanY * cellH + (slot.spanY - 1) * 12;

    return {
      left: ((slotX - world.minX) / world.width) * 100,
      top: ((slotY - world.minY) / world.height) * 100,
      width: (slotW / world.width) * 100,
      height: (slotH / world.height) * 100
    };
  }

  getMinimapViewportRect(): { left: number; top: number; width: number; height: number } {
    const gridContainer = document.querySelector('.monitoring-grid-container');
    if (!gridContainer) return { left: 0, top: 0, width: 100, height: 100 };

    const world = this.getMinimapWorldBounds();
    const zoom = this.canvasZoom();
    const panX = this.canvasPanX();
    const panY = this.canvasPanY();

    const viewportW = gridContainer.clientWidth;
    const viewportH = gridContainer.clientHeight;

    const vpMinX = -panX / zoom;
    const vpMaxX = (viewportW - panX) / zoom;
    const vpMinY = -panY / zoom;
    const vpMaxY = (viewportH - panY) / zoom;

    const vpW = vpMaxX - vpMinX;
    const vpH = vpMaxY - vpMinY;

    return {
      left: Math.max(0, Math.min(100, ((vpMinX - world.minX) / world.width) * 100)),
      top: Math.max(0, Math.min(100, ((vpMinY - world.minY) / world.height) * 100)),
      width: Math.max(2, Math.min(100, (vpW / world.width) * 100)),
      height: Math.max(2, Math.min(100, (vpH / world.height) * 100))
    };
  }

  adjustZoom(amount: number): void {
    const gridContainer = document.querySelector('.monitoring-grid-container');
    if (!gridContainer) return;

    const currentZoom = this.canvasZoom();
    const minZoom = this.getMinZoom();
    const nextZoom = Math.max(minZoom, Math.min(5.0, currentZoom + amount));

    const rect = gridContainer.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const canvasX = (centerX - this.canvasPanX()) / currentZoom;
    const canvasY = (centerY - this.canvasPanY()) / currentZoom;

    const newPanX = centerX - canvasX * nextZoom;
    const newPanY = centerY - canvasY * nextZoom;

    const constrained = this.constrainPan(newPanX, newPanY, nextZoom);

    this.canvasZoom.set(nextZoom);
    this.canvasPanX.set(constrained.x);
    this.canvasPanY.set(constrained.y);
  }

  resetCanvasActivityTimer(delayMs: number = 5000): void {
    this.isCanvasActive.set(true);
    if (this.canvasActivityTimer) {
      clearTimeout(this.canvasActivityTimer);
    }
    this.canvasActivityTimer = setTimeout(() => {
      this.isCanvasActive.set(false);
    }, delayMs);
  }

  resetCanvas(): void {
    const gridContainer = document.querySelector('.monitoring-grid-container');
    if (!gridContainer) return;

    const { width: totalW, height: totalH } = this.getCanvasDimensions();
    const viewportW = gridContainer.clientWidth;
    const viewportH = gridContainer.clientHeight;

    if (totalW === 0 || totalH === 0) return;

    const padding = 0.95; // 5% de margen
    const zoomToFitX = (viewportW * padding) / totalW;
    const zoomToFitY = (viewportH * padding) / totalH;
    const fitZoom = Math.max(0.02, Math.min(3.0, zoomToFitX, zoomToFitY));

    const panX = (viewportW - totalW * fitZoom) / 2;
    const panY = (viewportH - totalH * fitZoom) / 2;

    this.canvasZoom.set(fitZoom);
    this.canvasPanX.set(panX);
    this.canvasPanY.set(panY);
  }

  centerOnSlot(slot: GridSlot): void {
    const gridContainer = document.querySelector('.monitoring-grid-container');
    if (!gridContainer) return;

    const { cellW, cellH } = this.getCellDimensions();
    const slotLeft = (slot.col - 1) * (cellW + 12) + 10;
    const slotTop = (slot.row - 1) * (cellH + 12) + 10;
    const slotW = slot.spanX * cellW + (slot.spanX - 1) * 12;
    const slotH = slot.spanY * cellH + (slot.spanY - 1) * 12;

    const slotCenterX = slotLeft + slotW / 2;
    const slotCenterY = slotTop + slotH / 2;

    const viewportW = gridContainer.clientWidth;
    const viewportH = gridContainer.clientHeight;

    const targetZoom = Math.max(0.6, Math.min(1.5, Math.min((viewportW * 0.75) / slotW, (viewportH * 0.75) / slotH)));

    const targetPanX = (viewportW / 2) - (slotCenterX * targetZoom);
    const targetPanY = (viewportH / 2) - (slotCenterY * targetZoom);

    const constrained = this.constrainPan(targetPanX, targetPanY, targetZoom);

    this.canvasZoom.set(targetZoom);
    this.canvasPanX.set(constrained.x);
    this.canvasPanY.set(constrained.y);
  }

  toggleRightPanel(): void {
    this.isRightPanelCollapsed.set(!this.isRightPanelCollapsed());
    // Esperar a que la transición del panel derecho (400ms) termine y recentrar
    setTimeout(() => {
      this.resetCanvas();
    }, 400);
  }

  // --- Sistema de Historial Undo/Redo para distribución, formato y eliminación de cámaras ---
  saveStateToHistory(): void {
    const slots = this.gridSlots().map(s => ({
      ...s,
      camera: s.camera ? { ...s.camera } : null
    }));
    const cols = this.cols();
    const rows = this.rows();
    this.pushToUndoStack({ slots, cols, rows });
  }

  pushToUndoStack(snapshot: CanvasStateSnapshot): void {
    this.undoStack.update(prev => [...prev, snapshot]);
    this.redoStack.set([]); // Limpiar la pila de Rehacer al realizar una nueva acción
  }

  undo(): void {
    const undo = this.undoStack();
    if (undo.length === 0) return;

    const prevSnapshot = undo[undo.length - 1];
    this.undoStack.update(prev => prev.slice(0, -1));

    // Guardar el estado actual en la pila de Rehacer antes de revertir
    const currentSnapshot: CanvasStateSnapshot = {
      slots: this.gridSlots().map(s => ({
        ...s,
        camera: s.camera ? { ...s.camera } : null
      })),
      cols: this.cols(),
      rows: this.rows()
    };
    this.redoStack.update(prev => [...prev, currentSnapshot]);

    // Restaurar estado anterior
    const restoredSlots = prevSnapshot.slots.map(s => ({
      ...s,
      camera: s.camera ? { ...s.camera } : null
    }));
    this.gridSlots.set(restoredSlots);
    this.cols.set(prevSnapshot.cols);
    this.rows.set(prevSnapshot.rows);

    this.recalculateGridDimensions();
    this.showToast('Cambio deshecho', 'warning');
  }

  redo(): void {
    const redo = this.redoStack();
    if (redo.length === 0) return;

    const nextSnapshot = redo[redo.length - 1];
    this.redoStack.update(prev => prev.slice(0, -1));

    // Guardar el estado actual en la pila de Deshacer antes de avanzar
    const currentSnapshot: CanvasStateSnapshot = {
      slots: this.gridSlots().map(s => ({
        ...s,
        camera: s.camera ? { ...s.camera } : null
      })),
      cols: this.cols(),
      rows: this.rows()
    };
    this.undoStack.update(prev => [...prev, currentSnapshot]);

    // Restaurar estado siguiente
    const restoredSlots = nextSnapshot.slots.map(s => ({
      ...s,
      camera: s.camera ? { ...s.camera } : null
    }));
    this.gridSlots.set(restoredSlots);
    this.cols.set(nextSnapshot.cols);
    this.rows.set(nextSnapshot.rows);

    this.recalculateGridDimensions();
    this.showToast('Cambio rehecho', 'primary');
  }

  // --- Manejo Global de Teclado (Delete / Suprimir para eliminación masiva, Ctrl+Z / Ctrl+Y para Undo/Redo) ---
  @HostListener('window:keydown', ['$event'])
  onGlobalKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable || target.closest('input, textarea, select, .modal'))) {
      return;
    }

    // Tecla Delete / Suprimir -> Eliminar cámara(s) seleccionada(s)
    if (event.key === 'Delete' || event.key === 'Del') {
      if (this.selectedCanvasSlotIds().size > 0) {
        event.preventDefault();
        this.deleteSelectedCameras();
      }
    }

    // Ctrl + Z -> Deshacer (Undo)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      if (this.canUndo()) {
        this.undo();
      }
    }

    // Ctrl + Y o Ctrl + Shift + Z -> Rehacer (Redo)
    if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === 'y' || (event.shiftKey && event.key.toLowerCase() === 'z'))) {
      event.preventDefault();
      if (this.canRedo()) {
        this.redo();
      }
    }
  }

  toggleLockSlot(slot: GridSlot): void {
    const backupSlots = this.gridSlots().map(s => ({ ...s }));
    const originalCols = this.cols();
    const originalRows = this.rows();

    this.pushToUndoStack({ slots: backupSlots, cols: originalCols, rows: originalRows });

    const targetSlot = this.gridSlots().find(s => s.id === slot.id);
    if (targetSlot) {
      targetSlot.isLocked = !targetSlot.isLocked;
      this.gridSlots.set([...this.gridSlots()]);
      this.showToast(
        targetSlot.isLocked
          ? `Posición de ${slot.camera?.name || 'canal'} bloqueada`
          : `Posición de ${slot.camera?.name || 'canal'} desbloqueada`,
        targetSlot.isLocked ? 'primary' : 'warning'
      );
    }
  }

  onCanvasMouseDown(event: MouseEvent): void {
    if (!this.isCanvasMode()) return;

    // ── Clic Derecho (button === 2) o Clic Central de Scroll (button === 1): Paneo del Lienzo con Agarre (Bloqueado si está FIJADO) ───
    if (event.button === 2 || event.button === 1) {
      if (this.isCanvasPinned()) return;
      event.preventDefault();

      const startX = event.clientX;
      const startY = event.clientY;
      const startPanX = this.canvasPanX();
      const startPanY = this.canvasPanY();
      const zoom = this.canvasZoom();

      document.body.classList.add('is-panning-canvas');

      const suppressContextMenu = (e: Event) => { e.preventDefault(); };
      document.addEventListener('contextmenu', suppressContextMenu, { capture: true, once: true });

      const onMouseMove = (moveEvent: MouseEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        const targetPanX = startPanX + dx;
        const targetPanY = startPanY + dy;

        const constrained = this.constrainPan(targetPanX, targetPanY, zoom);
        this.canvasPanX.set(constrained.x);
        this.canvasPanY.set(constrained.y);
      };

      const onMouseUp = () => {
        document.body.classList.remove('is-panning-canvas');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      return;
    }

    // ── Clic Izquierdo (button === 0): Recuadro de Selección por Arrastre ───
    if (event.button === 0) {
      // Limpiar filtro por texto del buscador superior al hacer clic en el lienzo
      if (this.eventSearchControl.value) {
        this.eventSearchControl.setValue('');
      }

      const target = event.target as HTMLElement;

      // No iniciar recuadro si se hace clic en un elemento interactivo o sobre una celda del grid
      if (target.closest('button, input, select, .feed-actions-vertical-dock, .feed-resize-handle, .canvas-control-dock, .canvas-minimap-container, .grid-cell-placeholder-vertical, .grid-cell-placeholder-wide, .grid-slot-cell')) {
        return;
      }

      const gridContainer = document.querySelector('.monitoring-grid-container') as HTMLElement;
      if (!gridContainer) return;

      const containerRect = gridContainer.getBoundingClientRect();
      const startX = event.clientX - containerRect.left + gridContainer.scrollLeft;
      const startY = event.clientY - containerRect.top + gridContainer.scrollTop;
      const clientStartX = event.clientX;
      const clientStartY = event.clientY;

      let hasMoved = false;

      const onMouseMove = (moveEvent: MouseEvent) => {
        const currentX = moveEvent.clientX - containerRect.left + gridContainer.scrollLeft;
        const currentY = moveEvent.clientY - containerRect.top + gridContainer.scrollTop;

        const dist = Math.hypot(moveEvent.clientX - clientStartX, moveEvent.clientY - clientStartY);
        if (dist > 4) {
          hasMoved = true;
          this.isBoxSelecting.set(true);
          document.body.classList.add('is-box-selecting');
        }

        if (!hasMoved) return;

        const x = Math.min(startX, currentX);
        const y = Math.min(startY, currentY);
        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);

        this.selectionBox.set({ x, y, width, height });

        // Intersección directa en coordenadas de pantalla mediante getBoundingClientRect
        const boxLeft = Math.min(clientStartX, moveEvent.clientX);
        const boxTop = Math.min(clientStartY, moveEvent.clientY);
        const boxRight = Math.max(clientStartX, moveEvent.clientX);
        const boxBottom = Math.max(clientStartY, moveEvent.clientY);

        const slotEls = gridContainer.querySelectorAll('.grid-slot-cell');
        const selectedIds = new Set<string>();

        slotEls.forEach(el => {
          const slotId = el.getAttribute('data-id');
          if (!slotId) return;

          const rect = el.getBoundingClientRect();
          const intersects = !(rect.right < boxLeft || rect.left > boxRight || rect.bottom < boxTop || rect.top > boxBottom);
          if (intersects) {
            selectedIds.add(slotId);
          }
        });

        this.selectedCanvasSlotIds.set(selectedIds);
      };

      const onMouseUp = () => {
        document.body.classList.remove('is-box-selecting');
        this.isBoxSelecting.set(false);
        this.selectionBox.set(null);

        // Si fue un clic simple sin arrastrar sobre el fondo neutro, limpiar la selección previa
        if (!hasMoved && !target.closest('.grid-slot-cell')) {
          this.selectedCanvasSlotIds.set(new Set());
        }

        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }
  }

  onCanvasWheel(event: WheelEvent): void {
    if (!this.isCanvasMode() || this.isCanvasPinned()) return;
    event.preventDefault();

    // Desplazamiento del lienzo cuando hay movimiento horizontal (deltaX)
    if (Math.abs(event.deltaX) > 0) {
      const currentPanX = this.canvasPanX();
      const currentPanY = this.canvasPanY();
      const currentZoom = this.canvasZoom();

      const newPanX = currentPanX - event.deltaX;
      const newPanY = currentPanY - event.deltaY;

      const constrained = this.constrainPan(newPanX, newPanY, currentZoom);
      this.canvasPanX.set(constrained.x);
      this.canvasPanY.set(constrained.y);
      return;
    }

    // Zoom del lienzo
    const zoomDelta = event.deltaY < 0 ? 0.08 : -0.08;
    const currentZoom = this.canvasZoom();
    const minZoom = this.getMinZoom();
    const nextZoom = Math.max(minZoom, Math.min(5.0, currentZoom + zoomDelta));

    const gridContainer = event.currentTarget as HTMLElement;
    const rect = gridContainer.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const canvasX = (mouseX - this.canvasPanX()) / currentZoom;
    const canvasY = (mouseY - this.canvasPanY()) / currentZoom;

    const newPanX = mouseX - canvasX * nextZoom;
    const newPanY = mouseY - canvasY * nextZoom;

    const constrained = this.constrainPan(newPanX, newPanY, nextZoom);

    this.canvasZoom.set(nextZoom);
    this.canvasPanX.set(constrained.x);
    this.canvasPanY.set(constrained.y);
  }

  onCanvasContextMenu(event: MouseEvent): void {
    if (this.isCanvasMode()) {
      event.preventDefault();
    }
  }

  onMinimapMouseDown(event: MouseEvent): void {
    if (!this.isCanvasMode() || this.isCanvasPinned()) return;
    event.preventDefault();
    event.stopPropagation();

    const minimapArea = event.currentTarget as HTMLElement;
    const updatePan = (clientX: number, clientY: number) => {
      const rect = minimapArea.getBoundingClientRect();
      const relX = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const relY = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));

      const world = this.getMinimapWorldBounds();
      const canvasTargetX = world.minX + relX * world.width;
      const canvasTargetY = world.minY + relY * world.height;

      const gridContainer = document.querySelector('.monitoring-grid-container');
      if (!gridContainer) return;

      const zoom = this.canvasZoom();
      const viewportW = gridContainer.clientWidth;
      const viewportH = gridContainer.clientHeight;

      const targetPanX = -(canvasTargetX - (viewportW / zoom) / 2) * zoom;
      const targetPanY = -(canvasTargetY - (viewportH / zoom) / 2) * zoom;

      const constrained = this.constrainPan(targetPanX, targetPanY, zoom);
      this.canvasPanX.set(constrained.x);
      this.canvasPanY.set(constrained.y);
    };

    updatePan(event.clientX, event.clientY);

    const onMouseMove = (moveEvent: MouseEvent) => {
      updatePan(moveEvent.clientX, moveEvent.clientY);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  recalculateGridDimensions(): void {
    this.compressGrid();

    const slots = this.gridSlots();
    if (slots.length === 0) {
      this.cols.set(1);
      this.rows.set(1);
      return;
    }

    const dims = this.getDimensionsForArray(slots);
    this.cols.set(dims.cols);
    this.rows.set(dims.rows);

    // Ajustar zoom actual si el lienzo se encoge y excede el zoom mínimo dinámico
    const minZoom = this.getMinZoom();
    if (this.canvasZoom() < minZoom) {
      this.canvasZoom.set(minZoom);
      const constrained = this.constrainPan(this.canvasPanX(), this.canvasPanY(), minZoom);
      this.canvasPanX.set(constrained.x);
      this.canvasPanY.set(constrained.y);
    }
  }

  compressGrid(): void {
    const slots = this.gridSlots();
    const occupiedSlots = slots.filter(s => s.camera !== null);

    if (occupiedSlots.length === 0) {
      this.gridSlots.set([
        { id: 'slot-1-1', camera: null, col: 1, row: 1, spanX: 1, spanY: 1 }
      ]);
      return;
    }

    const maxCol = Math.max(...occupiedSlots.map(s => s.col + s.spanX - 1));
    const maxRow = Math.max(...occupiedSlots.map(s => s.row + s.spanY - 1));

    for (let c = 1; c <= maxCol; c++) {
      const colHasCamera = occupiedSlots.some(s => s.col <= c && (s.col + s.spanX - 1) >= c);
      if (!colHasCamera) {
        occupiedSlots.forEach(s => {
          if (s.col > c) s.col -= 1;
        });
        this.gridSlots.set(occupiedSlots);
        this.compressGrid();
        return;
      }
    }

    for (let r = 1; r <= maxRow; r++) {
      const rowHasCamera = occupiedSlots.some(s => s.row <= r && (s.row + s.spanY - 1) >= r);
      if (!rowHasCamera) {
        occupiedSlots.forEach(s => {
          if (s.row > r) s.row -= 1;
        });
        this.gridSlots.set(occupiedSlots);
        this.compressGrid();
        return;
      }
    }

    this.gridSlots.set(occupiedSlots);
  }

  // Resuelve solapamientos desplazando celdas en orden de lectura concéntrico para mantener cuadrículas proporcionadas
  resolveOverlapConflicts(activeCam: GridSlot): void {
    const slots = this.gridSlots();
    this.resolveOverlapConflictsForArray(activeCam, slots);
    this.gridSlots.set([...slots]);
  }

  private resolveOverlapConflictsForArray(activeCam: GridSlot, slots: GridSlot[]): void {
    const occupied = new Set<string>();
    const colsLimit = Math.max(1, this.cols());

    // Marcar espacio de la cámara activa
    const startC = activeCam.col;
    const startR = activeCam.row;
    const spanX = activeCam.spanX;
    const spanY = activeCam.spanY;
    for (let r = startR; r < startR + spanY; r++) {
      for (let c = startC; c < startC + spanX; c++) {
        occupied.add(`${r},${c}`);
      }
    }

    // Filtrar y ordenar el resto de cámaras activas
    const otherCams = slots.filter(s => s.id !== activeCam.id && s.camera !== null);
    otherCams.sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    otherCams.forEach(cam => {
      let col = cam.col;
      let row = cam.row;
      const cSpanX = cam.spanX;
      const cSpanY = cam.spanY;

      // Comprobar si cabe en su posición actual sin colisionar con lo ya reservado y respetando el límite
      let fitsCurrent = true;
      const maxAllowedCol = Math.max(colsLimit, cSpanX);
      for (let r = row; r < row + cSpanY; r++) {
        for (let c = col; c < col + cSpanX; c++) {
          if (c > maxAllowedCol || occupied.has(`${r},${c}`)) {
            fitsCurrent = false;
            break;
          }
        }
        if (!fitsCurrent) break;
      }

      if (!fitsCurrent) {
        let found = false;
        let checkRow = 1;
        let checkCol = 1;

        while (!found && checkRow < 1000) {
          if (this.doesSlotFit(checkCol, checkRow, cSpanX, cSpanY, occupied, colsLimit)) {
            col = checkCol;
            row = checkRow;
            found = true;
          } else {
            checkCol++;
            if (checkCol > colsLimit) {
              checkCol = 1;
              checkRow++;
            }
          }
        }
      }

      // Asignar nuevas coordenadas y marcar como ocupado
      cam.col = col;
      cam.row = row;
      for (let r = row; r < row + cSpanY; r++) {
        for (let c = col; c < col + cSpanX; c++) {
          occupied.add(`${r},${c}`);
        }
      }
    });
  }

  private getDimensionsForArray(slots: GridSlot[]): { cols: number; rows: number } {
    let maxCol = 1;
    let maxRow = 1;
    slots.forEach(s => {
      const endCol = s.col + s.spanX - 1;
      const endRow = s.row + s.spanY - 1;
      if (endCol > maxCol) maxCol = endCol;
      if (endRow > maxRow) maxRow = endRow;
    });
    return { cols: maxCol, rows: maxRow };
  }

  private doesSlotFit(col: number, row: number, spanX: number, spanY: number, occupied: Set<string>, colsLimit: number): boolean {
    const maxCol = Math.max(colsLimit, spanX);
    for (let r = row; r < row + spanY; r++) {
      for (let c = col; c < col + spanX; c++) {
        if (c > maxCol || occupied.has(`${r},${c}`)) {
          return false;
        }
      }
    }
    return true;
  }

  readonly visibleGridSlots = computed(() => {
    const slots = this.gridSlots();
    const totalCols = this.cols();
    const totalRows = this.rows();

    const cells: (GridSlot & { isEmpty: boolean })[] = [];
    const occupiedSet = new Set<string>();

    slots.forEach(s => {
      for (let r = s.row; r < s.row + s.spanY; r++) {
        for (let c = s.col; c < s.col + s.spanX; c++) {
          occupiedSet.add(`${r},${c}`);
        }
      }
      cells.push({ ...s, isEmpty: s.camera === null });
    });

    for (let r = 1; r <= totalRows; r++) {
      for (let c = 1; c <= totalCols; c++) {
        const key = `${r},${c}`;
        if (!occupiedSet.has(key)) {
          cells.push({
            id: `empty-${c}-${r}`,
            camera: null,
            col: c,
            row: r,
            spanX: 1,
            spanY: 1,
            isEmpty: true
          });
          occupiedSet.add(key);
        }
      }
    }

    return cells.sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });
  });

  // --- Manejador Inteligente: Clic de Selección vs Arrastre de Reordenamiento ---
  onSlotMouseDown(slot: GridSlot, event: MouseEvent, index: number): void {
    if (!slot.camera) return;
    if (event.button !== 0) return; // Solo clic izquierdo

    // Detener propagación para evitar que el mousedown del slot active el recuadro de selección del lienzo
    event.stopPropagation();

    const targetEl = event.target as HTMLElement;
    if (targetEl.closest('.feed-actions-vertical-dock') || targetEl.closest('.feed-resize-handle') || targetEl.closest('button') || targetEl.closest('input')) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    let isDragActivated = false;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (dist >= 5 && !isDragActivated) {
        isDragActivated = true;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        if (!slot.isLocked) {
          this.initDrag(slot, event, index);
        }
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      // Si no hubo movimiento (clic simple): Seleccionar / alternar selección de esta cámara
      if (!isDragActivated) {
        // Limpiar el buscador de texto superior al hacer clic sobre cualquier cámara
        if (this.eventSearchControl.value) {
          this.eventSearchControl.setValue('');
        }

        const currentSelected = new Set(this.selectedCanvasSlotIds());
        if (event.ctrlKey || event.shiftKey) {
          if (currentSelected.has(slot.id)) {
            currentSelected.delete(slot.id);
          } else {
            currentSelected.add(slot.id);
          }
        } else {
          if (currentSelected.has(slot.id) && currentSelected.size === 1) {
            currentSelected.clear();
          } else {
            currentSelected.clear();
            currentSelected.add(slot.id);
          }
        }
        this.selectedCanvasSlotIds.set(currentSelected);
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // --- Arrastre por Mousedown con Clonación Ghost y Detección de Destino ---
  initDrag(slot: GridSlot, event: MouseEvent, index: number): void {
    if (this.isCanvasPinned()) {
      return;
    }
    if (slot.isLocked) {
      return;
    }
    const targetEl = event.target as HTMLElement;
    if (targetEl.closest('.feed-actions-vertical-dock') || targetEl.closest('.feed-resize-handle') || targetEl.closest('button') || targetEl.closest('input')) {
      return;
    }

    // Arrastrar únicamente con clic izquierdo
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();

    const startX = event.clientX;
    const startY = event.clientY;

    const cellEl = targetEl.closest('.grid-slot-cell') as HTMLElement;
    if (!cellEl) return;

    const rect = cellEl.getBoundingClientRect();
    const offsetX = startX - rect.left;
    const offsetY = startY - rect.top;

    // Clon ghost
    const ghost = cellEl.cloneNode(true) as HTMLElement;
    ghost.classList.add('ghost-drag-card');
    ghost.style.position = 'fixed';
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '9999';
    ghost.style.opacity = '0.9';
    ghost.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.6)';
    ghost.style.border = '2px solid var(--primary)';

    document.body.appendChild(ghost);

    this.draggingSlotId.set(slot.id);
    document.body.classList.add('grabbing-active');

    // GUARDAR ESTADO ORIGINAL PARA PREVIEWS TEMPORALES
    const backupSlots = this.gridSlots().map(s => ({ ...s }));
    const originalCols = this.cols();
    const originalRows = this.rows();

    let lastTargetKey = '';
    let finalSlots = [...backupSlots];
    let hoverSuccess = false;
    let pendingExpanderDrop: 'column' | 'row' | null = null;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const ghostX = moveEvent.clientX - offsetX;
      const ghostY = moveEvent.clientY - offsetY;
      ghost.style.left = `${ghostX}px`;
      ghost.style.top = `${ghostY}px`;

      const wrapperEl = document.querySelector('.monitoring-grid-canvas-wrapper') as HTMLElement;
      if (!wrapperEl) return;
      const wrapperRect = wrapperEl.getBoundingClientRect();

      const isOutside = (
        moveEvent.clientX < wrapperRect.left ||
        moveEvent.clientX > wrapperRect.right ||
        moveEvent.clientY < wrapperRect.top ||
        moveEvent.clientY > wrapperRect.bottom
      );

      if (!isOutside) {
        let targetCol = 1;
        let targetRow = 1;
        let type = 'cell';

        const hoveredEl = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement;
        const expander = hoveredEl?.closest('[data-type="vertical-expander"], [data-type="horizontal-expander"]') as HTMLElement;
        const cell = hoveredEl?.closest('.grid-slot-cell') as HTMLElement;

        if (expander) {
          const typeAttr = expander.getAttribute('data-type');
          if (typeAttr === 'vertical-expander') {
            type = 'vertical-expander';
            targetCol = originalCols + 1;
            targetRow = 1;
          } else if (typeAttr === 'horizontal-expander') {
            type = 'horizontal-expander';
            targetCol = 1;
            targetRow = originalRows + 1;
          }
        } else if (cell) {
          const colAttr = cell.getAttribute('data-col');
          const rowAttr = cell.getAttribute('data-row');
          if (colAttr && rowAttr) {
            targetCol = parseInt(colAttr, 10);
            targetRow = parseInt(rowAttr, 10);
            type = 'cell';
          }
        } else {
          const { cellW, cellH } = this.getCellDimensions();
          const gap = 12;
          const zoom = this.isCanvasMode() ? this.canvasZoom() : 1.0;

          const localX = (moveEvent.clientX - wrapperRect.left) / zoom;
          const localY = (moveEvent.clientY - wrapperRect.top) / zoom;

          targetCol = Math.floor(localX / (cellW + gap)) + 1;
          targetRow = Math.floor(localY / (cellH + gap)) + 1;

          const maxC = originalCols + 1;
          const maxR = originalRows + 1;
          targetCol = Math.max(1, Math.min(targetCol, maxC));
          targetRow = Math.max(1, Math.min(targetRow, maxR));

          if (targetCol === originalCols + 1) {
            type = 'vertical-expander';
          } else if (targetRow === originalRows + 1) {
            type = 'horizontal-expander';
          }
        }

        const targetKey = `${type}-${targetCol}-${targetRow}`;

        if (targetKey !== lastTargetKey) {
          lastTargetKey = targetKey;

          if (type === 'vertical-expander') {
            this.cols.set(originalCols);
            this.rows.set(originalRows);
            this.gridSlots.set(backupSlots.map(s => ({ ...s })));
            finalSlots = [...backupSlots];
            hoverSuccess = true;
            pendingExpanderDrop = 'column';
            this.activeHoveredExpander.set('column');
            return;
          }

          if (type === 'horizontal-expander') {
            this.cols.set(originalCols);
            this.rows.set(originalRows);
            this.gridSlots.set(backupSlots.map(s => ({ ...s })));
            finalSlots = [...backupSlots];
            hoverSuccess = true;
            pendingExpanderDrop = 'row';
            this.activeHoveredExpander.set('row');
            return;
          }

          if (targetCol === slot.col && targetRow === slot.row) {
            this.cols.set(originalCols);
            this.rows.set(originalRows);
            this.gridSlots.set(backupSlots.map(s => ({ ...s })));
            finalSlots = [...backupSlots];
            hoverSuccess = false;
            pendingExpanderDrop = null;
            this.activeHoveredExpander.set(null);
            return;
          }

          const tempSlots = backupSlots.map(s => ({ ...s }));
          const dragSlot = tempSlots.find(s => s.id === slot.id);
          if (!dragSlot) return;

          let validHover = false;
          pendingExpanderDrop = null;
          this.activeHoveredExpander.set(null);

          const overlapsLocked = backupSlots.some(s =>
            s.isLocked && s.id !== slot.id &&
            targetCol < s.col + s.spanX && targetCol + slot.spanX > s.col &&
            targetRow < s.row + s.spanY && targetRow + slot.spanY > s.row
          );

          if (overlapsLocked) {
            validHover = false;
          } else {
            const targetSlotInBackup = backupSlots.find(s =>
              s.camera !== null &&
              targetCol >= s.col && targetCol < s.col + s.spanX &&
              targetRow >= s.row && targetRow < s.row + s.spanY
            );

            if (targetSlotInBackup && targetSlotInBackup.id !== slot.id) {
              const hoverSlot = tempSlots.find(s => s.id === targetSlotInBackup.id);
              if (hoverSlot) {
                const tempCol = dragSlot.col;
                const tempRow = dragSlot.row;
                dragSlot.col = hoverSlot.col;
                dragSlot.row = hoverSlot.row;
                hoverSlot.col = tempCol;
                hoverSlot.row = tempRow;

                this.resolveOverlapConflictsForArray(dragSlot, tempSlots);
                validHover = true;
              }
            } else {
              dragSlot.col = targetCol;
              dragSlot.row = targetRow;
              this.resolveOverlapConflictsForArray(dragSlot, tempSlots);
              validHover = true;
            }
          }

          if (validHover) {
            this.cols.set(originalCols);
            this.rows.set(originalRows);
            this.gridSlots.set(tempSlots);
            finalSlots = tempSlots;
            hoverSuccess = true;
          } else {
            this.cols.set(originalCols);
            this.rows.set(originalRows);
            this.gridSlots.set(backupSlots.map(s => ({ ...s })));
            finalSlots = [...backupSlots];
            hoverSuccess = false;
          }
        }
      } else {
        if (lastTargetKey !== '') {
          lastTargetKey = '';
          this.cols.set(originalCols);
          this.rows.set(originalRows);
          this.gridSlots.set(backupSlots.map(s => ({ ...s })));
          finalSlots = [...backupSlots];
          hoverSuccess = false;
          pendingExpanderDrop = null;
          this.activeHoveredExpander.set(null);
        }
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (ghost && ghost.parentNode) {
        ghost.parentNode.removeChild(ghost);
      }

      document.body.classList.remove('grabbing-active');
      this.draggingSlotId.set(null);
      this.activeHoveredExpander.set(null);

      if (hoverSuccess) {
        if (pendingExpanderDrop === 'column') {
          // Confirmar adición de columna
          this.pushToUndoStack({ slots: backupSlots, cols: originalCols, rows: originalRows });
          const nextSlots = backupSlots.map(s => ({ ...s }));
          const dragSlot = nextSlots.find(s => s.id === slot.id);
          if (dragSlot) {
            dragSlot.col = originalCols + 1;
            dragSlot.row = 1;
            dragSlot.spanX = 1;
            dragSlot.spanY = 1;
          }
          this.gridSlots.set(nextSlots);
          this.recalculateGridDimensions();
          this.swapPulseSlotId.set(slot.id);
          setTimeout(() => this.swapPulseSlotId.set(null), 1000);
          this.showToast('Columna añadida con canal reubicado', 'primary');
        } else if (pendingExpanderDrop === 'row') {
          // Confirmar adición de fila
          this.pushToUndoStack({ slots: backupSlots, cols: originalCols, rows: originalRows });
          const nextSlots = backupSlots.map(s => ({ ...s }));
          const dragSlot = nextSlots.find(s => s.id === slot.id);
          if (dragSlot) {
            dragSlot.col = 1;
            dragSlot.row = originalRows + 1;
            dragSlot.spanX = 1;
            dragSlot.spanY = 1;
          }
          this.gridSlots.set(nextSlots);
          this.recalculateGridDimensions();
          this.swapPulseSlotId.set(slot.id);
          setTimeout(() => this.swapPulseSlotId.set(null), 1000);
          this.showToast('Fila añadida con canal reubicado', 'primary');
        } else {
          // Confirmar cambio normal
          this.pushToUndoStack({ slots: backupSlots, cols: originalCols, rows: originalRows });
          this.gridSlots.set(finalSlots);
          this.recalculateGridDimensions();
          this.swapPulseSlotId.set(slot.id);
          setTimeout(() => this.swapPulseSlotId.set(null), 1000);
          this.showToast('Distribución de canales reordenada', 'primary');
        }
      } else {
        // Cancelar y restaurar el estado original intacto
        this.cols.set(originalCols);
        this.rows.set(originalRows);
        this.gridSlots.set(backupSlots);
        this.recalculateGridDimensions();
        this.showToast('Reordenamiento cancelado', 'warning');
      }
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // --- Redimensionamiento suave por spans con previsualización temporal en tiempo real ---
  initResize(slot: GridSlot, event: MouseEvent, cardEl: HTMLElement): void {
    if (this.isCanvasPinned()) {
      return;
    }
    // Redimensionar únicamente con clic izquierdo
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    this.resizingSlotId.set(slot.id);

    const startX = event.clientX;
    const startWidth = cardEl.offsetWidth;

    const gridContainer = cardEl.closest('.monitoring-grid-container') as HTMLElement;
    const gridContainerRect = gridContainer.getBoundingClientRect();

    // GUARDAR ESTADO ORIGINAL PARA PREVIEWS TEMPORALES
    const backupSlots = this.gridSlots().map(s => ({ ...s }));
    const originalCols = this.cols();
    const originalRows = this.rows();

    const { cellW: initialCellW } = this.getCellDimensions();

    const panXVal = this.isCanvasMode() ? this.canvasPanX() : 0;
    const zoomVal = this.isCanvasMode() ? this.canvasZoom() : 1.0;

    // Calcular la posición inicial izquierda del card en pantalla (incluyendo pan y zoom)
    const initialCardLeft = gridContainerRect.left + panXVal + (10 + (slot.col - 1) * (initialCellW + 12)) * zoomVal;
    const handleOffset = startX - (initialCardLeft + startWidth * zoomVal);

    let lastSpanX = slot.spanX;
    let finalSlots = [...backupSlots];

    // Elevar temporalmente la capa de pintura (z-index) para que se dibuje por encima del resto
    cardEl.style.zIndex = '100';

    const onMouseMove = (moveEvent: MouseEvent) => {
      const colsVal = this.cols();
      const rowsVal = this.rows();

      const { cellW, cellH } = this.getCellDimensions();

      const currentGridRect = gridContainer.getBoundingClientRect();
      const currentPanX = this.isCanvasMode() ? this.canvasPanX() : 0;
      const currentZoom = this.isCanvasMode() ? this.canvasZoom() : 1.0;
      const currentCardLeft = currentGridRect.left + currentPanX + (10 + (slot.col - 1) * (cellW + 12)) * currentZoom;

      // Medir la distancia horizontal del cursor en espacio de lienzo (canvas space)
      const newWidth = Math.max(cellW, (moveEvent.clientX - handleOffset - currentCardLeft) / currentZoom);
      const newHeight = newWidth * (cellH / cellW);

      // Sensibilidad de redimensionamiento: Se activa al cruzar el 20% de la celda adyacente (en vez del 50%)
      const triggerThreshold = 0.2;
      const spanX = Math.max(1, Math.floor((newWidth + 12 - triggerThreshold * cellW) / (cellW + 12)) + 1);
      const spanY = spanX; // Enforzar escalamiento simétrico (1x1, 2x2, 3x3)

      const overlapsLocked = backupSlots.some(s =>
        s.isLocked && s.id !== slot.id &&
        slot.col < s.col + s.spanX && slot.col + spanX > s.col &&
        slot.row < s.row + s.spanY && slot.row + spanY > s.row
      );

      if (spanX !== lastSpanX && !overlapsLocked) {
        lastSpanX = spanX;

        const tempSlots = backupSlots.map(s => ({ ...s }));
        const dragSlot = tempSlots.find(s => s.id === slot.id);

        if (dragSlot) {
          dragSlot.spanX = spanX;
          dragSlot.spanY = spanY;
          this.resolveOverlapConflictsForArray(dragSlot, tempSlots);

          const dims = this.getDimensionsForArray(tempSlots);
          this.cols.set(dims.cols);
          this.rows.set(dims.rows);
          this.gridSlots.set(tempSlots);
          finalSlots = tempSlots;
        }
      }

      let finalWidth = newWidth;
      let finalHeight = newHeight;
      if (overlapsLocked) {
        finalWidth = lastSpanX * cellW + (lastSpanX - 1) * 12;
        finalHeight = finalWidth * (cellH / cellW);
      }

      cardEl.style.width = `${finalWidth}px`;
      cardEl.style.height = `${finalHeight}px`;
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      this.resizingSlotId.set(null);

      // Restablecer el z-index y los estilos inline para delegar el posicionamiento final a Angular
      cardEl.style.zIndex = '';
      cardEl.style.width = '';
      cardEl.style.height = '';

      const hasChanged = lastSpanX !== slot.spanX || finalSlots.some((s, idx) => s.col !== backupSlots[idx].col || s.row !== backupSlots[idx].row);
      if (hasChanged) {
        this.pushToUndoStack({ slots: backupSlots, cols: originalCols, rows: originalRows });
      }

      // Confirmar el cambio de redimensionamiento final forzando un clon del array final para reactividad
      this.gridSlots.set([...finalSlots]);
      this.recalculateGridDimensions();
      this.showToast(`Grid ajustado: Cámara redimensionada a ${lastSpanX}x${lastSpanX}`, 'primary');
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // --- Acciones de Feed Individual (Premium floating overlay) ---
  toggleAiOverlay(cameraName: string): void {
    const active = !!this.activeAiOverlays()[cameraName];
    this.activeAiOverlays.update(prev => ({ ...prev, [cameraName]: !active }));
  }

  // --- Pausar feed individual de la cámara ---
  toggleFeedPause(cameraName: string): void {
    const isPaused = !!this.flashEffects()[cameraName + '_paused']; // Reutilizando un mapa interno para pausar
    this.flashEffects.update(prev => ({ ...prev, [cameraName + '_paused']: !isPaused }));
    this.showToast(isPaused ? `Feed de ${cameraName} reanudado` : `Feed de ${cameraName} pausado`, 'warning');
  }

  isFeedPaused(cameraName: string): boolean {
    return !!this.flashEffects()[cameraName + '_paused'];
  }

  toggleRecording(cameraName: string): void {
    const active = !!this.activeRecStatuses()[cameraName];
    this.activeRecStatuses.update(prev => ({ ...prev, [cameraName]: !active }));
    if (!active) {
      this.showToast(`🔴 Grabando feed histórico de ${cameraName}`, 'danger');
    } else {
      this.showToast(`💾 Grabación de ${cameraName} guardada exitosamente`, 'success');
    }
  }

  takeSnapshot(slotOrName: GridSlot | string): void {
    let slot: GridSlot | undefined;
    let cameraName = '';

    if (typeof slotOrName === 'string') {
      cameraName = slotOrName;
      slot = this.gridSlots().find(s => s.camera?.name === cameraName);
    } else {
      slot = slotOrName;
      cameraName = slot.camera?.name || 'camara';
    }

    if (!slot || !slot.camera) {
      return;
    }

    // Efecto de destello visual de flash
    this.flashEffects.update(prev => ({ ...prev, [cameraName]: true }));
    setTimeout(() => {
      this.flashEffects.update(prev => ({ ...prev, [cameraName]: false }));
    }, 300);

    const formatTimestamp = () => {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    };

    const downloadFileName = `captura_${cameraName.replace(/[^a-zA-Z0-9_-]/g, '_')}_${formatTimestamp()}`;

    // Caso 1: Video WebRTC en tiempo real activo en el lienzo
    const videoEl = document.getElementById(`video-feed-${slot.id}`) as HTMLVideoElement;
    const isVideoActive = videoEl &&
                          this.webRtcStates()[slot.id] === 'connected' &&
                          !this.isSlotInPlaybackMode(slot) &&
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

          this.showToast(`📸 Captura de vídeo en tiempo real guardada (${cameraName})`, 'success');
          return;
        }
      } catch (err) {
        console.error('Error al capturar canvas de vídeo WebRTC:', err);
      }
    }

    // Caso 2: Imagen de Evento / Snapshot Histórico en Playback o fallback
    let imgUrl: string | null = null;

    if (this.isSlotInPlaybackMode(slot)) {
      const snapshot = this.getSnapshotForCameraAt(slot.camera.name);
      if (snapshot && snapshot.urlImg) {
        imgUrl = snapshot.urlImg;
      }
    }

    if (!imgUrl) {
      const lastEvent = this.latestEventsMap()[slot.camera.name];
      if (lastEvent && lastEvent.urlImg) {
        imgUrl = lastEvent.urlImg;
      }
    }

    if (imgUrl) {
      this.downloadImageFromUrl(imgUrl, `${downloadFileName}.jpg`);
      this.showToast(`📸 Fotograma de evento descargado (${cameraName})`, 'success');
    } else {
      this.showToast(`📸 Captura de pantalla de ${cameraName} guardada`, 'success');
    }
  }

  private downloadImageFromUrl(url: string, fileName: string): void {
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
        console.error('Error al descargar la imagen:', err);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.target = '_blank';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      });
  }

  isSlotInPlaybackMode(slot: GridSlot): boolean {
    if (this.playbackMode() !== 'playback') return false;

    // En modo ASYNC con cámaras seleccionadas, solo los slots de cámaras seleccionadas entran en modo playback
    if (!this.isSyncMode() && this.selectedCameraNames().size > 0) {
      if (!slot.camera || !this.selectedCameraNames().has(slot.camera.name)) {
        return false;
      }
    }
    return true;
  }

  // --- Bounding Boxes IA Simuladas reactivas ---
  readonly aiBoundingBoxes = computed(() => {
    this.currentTimePointer();
    const slots = this.gridSlots();
    const timeMs = new Date().getTime();
    const step = Math.floor(timeMs / 3000);

    const boxes: Record<string, { top: number; left: number; width: number; height: number; label: string; color: string }> = {};

    slots.forEach((s, idx) => {
      if (s.camera) {
        const name = s.camera.name;

        // No mostrar bounding boxes si el feed está pausado
        if (this.isFeedPaused(name)) return;

        const isVeh = name.toLowerCase().includes('vehiculo') || name.toLowerCase().includes('porton') || idx % 2 === 0;
        const offset = (step + idx) % 3;

        let top = 25;
        let left = 20;
        let width = 30;
        let height = 45;
        let label = 'Persona 92%';
        let color = 'var(--color-personas)';

        if (isVeh) {
          label = 'Vehículo 96%';
          color = 'var(--color-vehiculos)';
          if (offset === 0) { left = 15; top = 40; width = 45; height = 35; }
          else if (offset === 1) { left = 40; top = 30; width = 40; height = 38; }
          else { left = 30; top = 45; width = 42; height = 32; }
        } else {
          label = 'Rostro 91%';
          color = 'var(--color-rostros)';
          if (offset === 0) { left = 35; top = 20; width = 20; height = 25; }
          else if (offset === 1) { left = 55; top = 25; width = 22; height = 26; }
          else { left = 45; top = 15; width = 18; height = 24; }
        }

        boxes[name] = { top, left, width, height, label, color };
      }
    });

    return boxes;
  });

  readonly selectedManualDate = signal<Date | null>(null);

  readonly activeDayBounds = computed(() => {
    const manualDate = this.selectedManualDate();
    const now = this.liveTickerClock();

    if (!manualDate) {
      // Modo por defecto / Navegación libre / En Vivo: ÚLTIMAS 24 HORAS desde "ahora" (now - 24h a ahora)
      const end = now;
      const start = new Date(end.getTime() - 24 * 3600 * 1000);
      return { start, end, isManual: false };
    } else {
      // Fecha pasada ingresada manualmente en el apartado inferior: De 00:00:00 a 23:59:59 de esa fecha
      const start = new Date(manualDate.getFullYear(), manualDate.getMonth(), manualDate.getDate(), 0, 0, 0, 0);
      const end = new Date(manualDate.getFullYear(), manualDate.getMonth(), manualDate.getDate(), 23, 59, 59, 999);
      return { start, end, isManual: true };
    }
  });

  readonly maxTimelineEnd = computed(() => {
    return this.activeDayBounds().end;
  });

  // --- Línea de Tiempo y ventana estática en Playback ---
  readonly timelineRange = computed(() => {
    const bounds = this.activeDayBounds();
    const zoom = Math.min(86400 * 1000, this.zoomRangeSeconds() * 1000);

    const rawEndMs = this.playbackWindowEnd() !== null
      ? this.playbackWindowEnd()!.getTime()
      : bounds.end.getTime();

    const minEndMs = bounds.start.getTime() + zoom;
    const maxEndMs = bounds.end.getTime();
    const endMs = Math.max(minEndMs, Math.min(maxEndMs, rawEndMs));
    const start = new Date(endMs - zoom);

    return { start, end: new Date(endMs) };
  });

  readonly playheadLeftPct = computed(() => {
    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    const pointerMs = this.currentTimePointer().getTime();

    if (pointerMs <= startMs) return 0;
    if (pointerMs >= endMs) return 100;

    return ((pointerMs - startMs) / (endMs - startMs)) * 100;
  });

  readonly timeOffsetLabel = computed(() => {
    if (this.playbackMode() === 'live') {
      return 'EN VIVO';
    }
    const nowMs = this.liveTickerClock().getTime();
    const pointerMs = this.currentTimePointer().getTime();
    const diffSec = Math.max(0, Math.round((nowMs - pointerMs) / 1000));

    if (diffSec < 60) {
      return `-${diffSec}s del En Vivo`;
    }

    if (diffSec < 3600) {
      const m = Math.floor(diffSec / 60);
      const s = diffSec % 60;
      return s > 0 ? `-${m}m ${s}s del En Vivo` : `-${m}m del En Vivo`;
    }

    if (diffSec < 86400) {
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      return m > 0 ? `-${h}h ${m}m del En Vivo` : `-${h}h del En Vivo`;
    }

    const d = Math.floor(diffSec / 86400);
    return `-${d}d del En Vivo`;
  });

  getSnapshotForCameraAt(cameraName: string): EventRecord | null {
    if (this.playbackMode() === 'live') {
      return null;
    }

    // En modo ASYNC con cámaras seleccionadas, solo la(s) cámara(s) seleccionada(s) responden al playback
    if (!this.isSyncMode() && this.selectedCameraNames().size > 0) {
      if (!this.selectedCameraNames().has(cameraName)) {
        return null;
      }
    }

    const pointerMs = this.currentTimePointer().getTime();
    const events = this.eventsList();
    let bestMatch: EventRecord | null = null;
    let maxMs = -1;

    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const matchesName = e.nombreCamara && e.nombreCamara.toLowerCase() === cameraName.toLowerCase();
      const matchesId = e.idCamara && e.idCamara === cameraName;
      if (matchesName || matchesId) {
        const t = e.timestampMs || (e.timestampMs = new Date(e.timestamp).getTime());
        if (t <= pointerMs + 1000 && t > maxMs) {
          maxMs = t;
          bestMatch = e;
        }
      }
    }

    if (!bestMatch) {
      bestMatch = this.latestEventsMap()[cameraName] || null;
    }

    return bestMatch;
  }

  getDisplayedEventForSlot(slot: GridSlot): EventRecord | null {
    if (!slot || !slot.camera) return null;
    const camera = slot.camera;
    const cameraName = camera.name;
    const cameraId = camera.id;

    // 1. Si esta cámara coincide con el evento seleccionado explícitamente (sidebar, flag o Backward/Forward)
    const sel = this.selectedEvent();
    if (sel) {
      const matchesName = sel.nombreCamara && sel.nombreCamara.toLowerCase() === cameraName.toLowerCase();
      const matchesId = sel.idCamara && sel.idCamara === cameraId;
      if (matchesName || matchesId) {
        return sel;
      }
    }

    // 2. Si la celda está en modo playback / línea de tiempo, obtener la instantánea en o antes del scrubber
    if (this.isSlotInPlaybackMode(slot)) {
      const snap = this.getSnapshotForCameraAt(cameraName);
      if (snap) return snap;

      const lastMap = this.latestEventsMap();
      if (lastMap[cameraName]) return lastMap[cameraName];
      if (lastMap[cameraId]) return lastMap[cameraId];

      for (const key of Object.keys(lastMap)) {
        if (key.toLowerCase() === cameraName.toLowerCase()) {
          return lastMap[key];
        }
      }

      const allEvents = this.eventsList();
      for (let i = 0; i < allEvents.length; i++) {
        const e = allEvents[i];
        const matchesName = e.nombreCamara && e.nombreCamara.toLowerCase() === cameraName.toLowerCase();
        const matchesId = e.idCamara && e.idCamara === cameraId;
        if (matchesName || matchesId) {
          return e;
        }
      }

      const defaultAnalytic = this.getCameraAnalytics(camera)[0] || 'Detección';
      const lastMapTyped = lastMap as Record<string, EventRecord>;
      const fallbackImg = lastMapTyped[cameraName]?.urlImg || lastMapTyped[cameraId]?.urlImg || '';
      return {
        id: `synthetic-${cameraId}`,
        idCamara: cameraId,
        nombreCamara: cameraName,
        timestamp: this.currentTimePointer() || new Date(),
        analitica: defaultAnalytic,
        detalleEvento: `Detección ${defaultAnalytic}`,
        urlImg: fallbackImg
      } as EventRecord;
    }

    // 3. Fallback en la lista/mapa de eventos para cámaras estáticas no conectadas a WebRTC
    if (this.webRtcStates()[slot.id] !== 'connected') {
      const lastMap = this.latestEventsMap();
      if (lastMap[cameraName]) return lastMap[cameraName];
      if (lastMap[cameraId]) return lastMap[cameraId];

      for (const key of Object.keys(lastMap)) {
        if (key.toLowerCase() === cameraName.toLowerCase()) {
          return lastMap[key];
        }
      }

      const allEvents = this.eventsList();
      for (let i = 0; i < allEvents.length; i++) {
        const e = allEvents[i];
        const matchesName = e.nombreCamara && e.nombreCamara.toLowerCase() === cameraName.toLowerCase();
        const matchesId = e.idCamara && e.idCamara === cameraId;
        if (matchesName || matchesId) {
          return e;
        }
      }

      const defaultAnalytic = this.getCameraAnalytics(camera)[0] || 'Detección';
      const lastMapTyped = lastMap as Record<string, EventRecord>;
      const fallbackImg = lastMapTyped[cameraName]?.urlImg || lastMapTyped[cameraId]?.urlImg || '';
      return {
        id: `synthetic-${cameraId}`,
        idCamara: cameraId,
        nombreCamara: cameraName,
        timestamp: this.currentTimePointer() || new Date(),
        analitica: defaultAnalytic,
        detalleEvento: `Detección ${defaultAnalytic}`,
        urlImg: fallbackImg
      } as EventRecord;
    }

    return null;
  }

  isSlotShowingEventPhoto(slot: GridSlot): boolean {
    if (!slot || !slot.camera) return false;
    // 1. Si la celda individual está en modo reproducción/playback (en SYNC: todas las celdas; en ASYNC: solo las celdas en playback)
    if (this.isSlotInPlaybackMode(slot)) {
      return true;
    }
    // 2. Si la cámara NO está transmitiendo video en vivo WebRTC (mostrando foto estática de fallback por desconexión)
    if (this.webRtcStates()[slot.id] !== 'connected') {
      return true;
    }
    return false;
  }

  readonly formattedZoomSpanLabel = computed(() => {
    const sec = this.zoomRangeSeconds();
    if (sec < 300) return '5 min';
    if (sec < 1800) return '10 min';
    if (sec < 3600) return '30 min';
    if (sec < 10800) return '1 hora';
    if (sec < 21600) return '3 horas';
    if (sec < 43200) return '6 horas';
    if (sec < 86400) return '12 horas';
    return '24 horas';
  });

  togglePlayPause(): void {
    if (this.playbackMode() === 'live') {
      const now = new Date();
      this.liveTickerClock.set(now);
      this.playbackWindowEnd.set(now);
      this.currentTimePointer.set(now);
      this.playbackMode.set('playback');
      this.paused.set(true);
      this.showToast('⏸️ Modo Pausa activado', 'primary');
    } else {
      this.setLiveMode();
    }
  }

  setLiveMode(): void {
    const now = new Date();
    this.selectedManualDate.set(null);
    this.selectedFlagId.set(null);
    this.selectedCanvasSlotIds.set(new Set());
    this.highlightedCellCameraName.set(null);
    this.playbackMode.set('live');
    this.paused.set(false);
    this.playbackWindowEnd.set(null);
    this.currentTimePointer.set(now);

    this.isEditingTimeSegments = false;
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.hoursSegmentStr.set(pad(now.getHours()));
    this.minutesSegmentStr.set(pad(now.getMinutes()));
    this.secondsSegmentStr.set(pad(now.getSeconds()));

    // Vaciar eventos acumulados en el búfer ordenadamente a la lista principal
    if (this.bufferedEvents().length > 0) {
      const buffer = this.bufferedEvents();
      this.eventsList.update(list => {
        const combined = [...buffer, ...list];
        return combined.sort((a, b) => {
          const tA = a.timestampMs || new Date(a.timestamp).getTime();
          const tB = b.timestampMs || new Date(b.timestamp).getTime();
          return tB - tA;
        });
      });
      this.bufferedEvents.set([]);
      this.pruneEventsOlderThan24h();
    }
    this.showToast('⚡ Visualización En Vivo restablecida', 'success');
  }

  onScrubberChange(value: number): void {
    const targetMs = value;
    const targetDate = new Date(targetMs);

    this.isEditingTimeSegments = false;
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.hoursSegmentStr.set(pad(targetDate.getHours()));
    this.minutesSegmentStr.set(pad(targetDate.getMinutes()));
    this.secondsSegmentStr.set(pad(targetDate.getSeconds()));

    this.currentTimePointer.set(targetDate);
  }

  private ensureEventUnclustered(targetEvent: EventRecord): void {
    const events = this.eventsList();
    if (events.length <= 1) return;

    const targetMs = new Date(targetEvent.timestamp).getTime();

    // Encontrar la menor distancia de tiempo (ms) hacia cualquier otro evento vecino
    let minDeltaMs = Infinity;
    for (const e of events) {
      if (e.id === targetEvent.id) continue;
      const diff = Math.abs(new Date(e.timestamp).getTime() - targetMs);
      if (diff > 0 && diff < minDeltaMs) {
        minDeltaMs = diff;
      }
    }

    if (minDeltaMs === Infinity) return;

    const minDeltaSec = minDeltaMs / 1000;

    // Calcular el rango de zoom óptimo para des-agrupar completamente el evento seleccionado
    const targetZoomSeconds = Math.max(60, Math.min(300, Math.ceil(minDeltaSec * 10)));

    this.zoomRangeSeconds.set(targetZoomSeconds);

    // Centrar la ventana de tiempo en el evento seleccionado
    const halfZoomMs = (targetZoomSeconds * 1000) / 2;
    const nowMs = new Date().getTime();
    const desiredEndMs = Math.min(nowMs, targetMs + halfZoomMs);
    this.playbackWindowEnd.set(new Date(desiredEndMs));
  }

  readonly selectedFlagId = signal<string | null>(null);

  toggleTimelineFlag(eventRecord: EventRecord, clusterCount: number = 1, mouseEvent?: MouseEvent): void {
    if (mouseEvent) {
      mouseEvent.stopPropagation();
      mouseEvent.preventDefault();
    }
    if (!eventRecord || !eventRecord.timestamp) return;

    // Si la bandera individual ya está seleccionada -> Des-seleccionar y volver a EN VIVO
    if (clusterCount <= 1 && this.selectedFlagId() === eventRecord.id) {
      this.selectedFlagId.set(null);
      this.setLiveModeKeepWindow();
      return;
    }

    // Destacar la cámara correspondiente a este evento con borde azul (sin mover la vista ni alterar la selección previa del usuario)
    if (eventRecord.nombreCamara || eventRecord.idCamara) {
      const slotMatch = this.gridSlots().find(s => s.camera && (s.camera.name === eventRecord.nombreCamara || s.camera.id === eventRecord.idCamara));
      if (slotMatch) {
        // PRESERVAR SELECCIÓN DE CÁMARAS: Solo auto-seleccionar si el usuario no tiene ninguna cámara seleccionada previamente
        if (this.selectedCanvasSlotIds().size === 0) {
          this.selectedCanvasSlotIds.set(new Set([slotMatch.id]));
        }
        this.highlightedCellCameraName.set(slotMatch.camera!.name);
      } else if (eventRecord.nombreCamara) {
        this.highlightedCellCameraName.set(eventRecord.nombreCamara);
      }
    }

    // Seleccionar evento y guardar referencia
    this.selectedEvent.set(eventRecord);
    this.selectedFlagId.set(eventRecord.id);

    const eventDate = new Date(eventRecord.timestamp);
    const nowMs = new Date().getTime();
    const targetMs = Math.min(nowMs, eventDate.getTime());
    const targetDate = new Date(targetMs);

    if (this.playbackMode() === 'live') {
      if (this.playbackWindowEnd() === null) {
        this.playbackWindowEnd.set(new Date());
      }
      this.playbackMode.set('playback');
      this.paused.set(true);
    }

    this.isEditingTimeSegments = false;
    this.isEditingDateSegments = false;

    const pad = (n: number) => n.toString().padStart(2, '0');
    this.hoursSegmentStr.set(pad(targetDate.getHours()));
    this.minutesSegmentStr.set(pad(targetDate.getMinutes()));
    this.secondsSegmentStr.set(pad(targetDate.getSeconds()));
    this.dateDayStr.set(pad(targetDate.getDate()));
    this.dateMonthStr.set(pad(targetDate.getMonth() + 1));
    this.dateYearStr.set(targetDate.getFullYear().toString());

    this.currentTimePointer.set(targetDate);
    this.showToast(`📍 Evento activo: ${eventRecord.analitica || 'Alerta'} (${eventRecord.nombreCamara})`, 'primary');
  }

  backwardEvent(): void {
    let events = this.eventsList();
    if (events.length === 0) return;

    // Si hay cámaras seleccionadas en el lienzo (en modo SYNC o ASYNC), filtrar eventos para navegar ÚNICAMENTE entre los de las cámaras seleccionadas
    if (this.selectedCameraNames().size > 0) {
      const selectedNames = this.selectedCameraNames();
      events = events.filter(e => selectedNames.has(e.nombreCamara));
      if (events.length === 0) return;
    }

    const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const currentFlagId = this.selectedFlagId();

    let targetIdx = -1;
    if (currentFlagId !== null) {
      const currentIdx = sorted.findIndex(e => e.id === currentFlagId);
      if (currentIdx > 0) {
        targetIdx = currentIdx - 1;
      } else if (currentIdx === 0) {
        targetIdx = 0;
      }
    } else {
      const pointerMs = this.currentTimePointer().getTime();
      const prevEvents = sorted.filter(e => new Date(e.timestamp).getTime() <= pointerMs);
      if (prevEvents.length > 0) {
        targetIdx = sorted.findIndex(e => e.id === prevEvents[prevEvents.length - 1].id);
      } else {
        targetIdx = 0;
      }
    }

    if (targetIdx >= 0 && targetIdx < sorted.length) {
      const targetEvent = sorted[targetIdx];
      this.toggleTimelineFlag(targetEvent, 1);
    }
  }

  forwardEvent(): void {
    if (this.playbackMode() === 'live') return;

    let events = this.eventsList();
    if (events.length === 0) {
      this.setLiveMode();
      return;
    }

    // Si hay cámaras seleccionadas en el lienzo (en modo SYNC o ASYNC), filtrar eventos para navegar ÚNICAMENTE entre los de las cámaras seleccionadas
    if (this.selectedCameraNames().size > 0) {
      const selectedNames = this.selectedCameraNames();
      events = events.filter(e => selectedNames.has(e.nombreCamara));
      if (events.length === 0) {
        this.setLiveMode();
        return;
      }
    }

    const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const currentFlagId = this.selectedFlagId();

    let targetIdx = -1;
    if (currentFlagId !== null) {
      const currentIdx = sorted.findIndex(e => e.id === currentFlagId);
      if (currentIdx >= 0) {
        targetIdx = currentIdx + 1;
      }
    } else {
      const pointerMs = this.currentTimePointer().getTime();
      const nextEvents = sorted.filter(e => new Date(e.timestamp).getTime() > pointerMs);
      if (nextEvents.length > 0) {
        targetIdx = sorted.findIndex(e => e.id === nextEvents[0].id);
      }
    }

    // Si se presiona en el último evento o sobrepasa -> Volver a EN VIVO
    if (targetIdx < 0 || targetIdx >= sorted.length) {
      this.selectedFlagId.set(null);
      this.setLiveMode();
      return;
    }

    const targetEvent = sorted[targetIdx];
    this.toggleTimelineFlag(targetEvent, 1);
  }

  setLiveModeKeepWindow(): void {
    const now = new Date();
    this.playbackMode.set('live');
    this.paused.set(false);
    this.selectedFlagId.set(null);
    this.selectedCanvasSlotIds.set(new Set());
    this.highlightedCellCameraName.set(null);
    this.currentTimePointer.set(now);

    const pad = (n: number) => n.toString().padStart(2, '0');
    this.hoursSegmentStr.set(pad(now.getHours()));
    this.minutesSegmentStr.set(pad(now.getMinutes()));
    this.secondsSegmentStr.set(pad(now.getSeconds()));
    this.dateDayStr.set(pad(now.getDate()));
    this.dateMonthStr.set(pad(now.getMonth() + 1));
    this.dateYearStr.set(now.getFullYear().toString());

    this.showToast('⚡ Transmisión En Vivo reanudada', 'success');
  }

  readonly timelineRuleMarks = computed(() => {
    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    const durationMs = endMs - startMs;
    const zoomSec = this.zoomRangeSeconds();

    const marks: { id: string; timeLabel: string; leftPct: number }[] = [];
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const oneDayMs = 86400 * 1000;

    if (zoomSec >= 86400 * 2) {
      // Escala multidía: definir paso de días según escala de zoom fija (exclusivamente del zoom)
      let stepDays = 1;
      if (zoomSec >= 86400 * 20) stepDays = 5;
      else if (zoomSec >= 86400 * 10) stepDays = 3;
      else if (zoomSec >= 86400 * 4) stepDays = 2;

      // Buffer amplio para entrada y salida suave de los bordes
      const bufferStartMs = startMs - oneDayMs * stepDays * 2;
      const bufferEndMs = endMs + oneDayMs * stepDays * 2;

      const startDate = new Date(bufferStartMs);
      const firstDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      let curr = firstDay.getTime();

      while (curr <= bufferEndMs) {
        const dayEpoch = Math.floor(curr / oneDayMs);
        if (dayEpoch % stepDays === 0) {
          const pct = ((curr - startMs) / durationMs) * 100;
          if (pct >= 0 && pct <= 100) {
            const d = new Date(curr);
            marks.push({
              id: `day-${dayEpoch}`,
              timeLabel: `${d.getDate()} ${monthNames[d.getMonth()]}`,
              leftPct: pct
            });
          }
        }
        curr += oneDayMs;
      }
    } else if (zoomSec >= 14400) {
      // Escala de horas (4h a 48h): horas exactas fijas (ej. cada 2h, 3h o 6h)
      const stepHours = zoomSec >= 86400 ? 6 : (zoomSec >= 43200 ? 3 : 2);
      const stepMs = stepHours * 3600 * 1000;

      const bufferStartMs = startMs - stepMs * 2;
      const bufferEndMs = endMs + stepMs * 2;

      const startDate = new Date(bufferStartMs);
      const firstHourMs = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), Math.floor(startDate.getHours() / stepHours) * stepHours).getTime();

      let curr = firstHourMs;
      while (curr <= bufferEndMs) {
        const hourEpoch = Math.floor(curr / stepMs);
        const pct = ((curr - startMs) / durationMs) * 100;
        if (pct >= 0 && pct <= 100) {
          const d = new Date(curr);
          let label = '';
          if (d.getHours() === 0) {
            label = `${d.getDate()} ${monthNames[d.getMonth()]}`;
          } else {
            label = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          }
          marks.push({
            id: `hour-${hourEpoch}`,
            timeLabel: label,
            leftPct: pct
          });
        }
        curr += stepMs;
      }
    } else {
      // Escala corta (<= 4h): divisiones continuas por paso fijo de minutos
      const stepMinutes = zoomSec <= 600 ? 2 : (zoomSec <= 3600 ? 10 : 30);
      const stepMs = stepMinutes * 60 * 1000;

      const bufferStartMs = startMs - stepMs * 2;
      const bufferEndMs = endMs + stepMs * 2;

      const startDate = new Date(bufferStartMs);
      const firstMinMs = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), startDate.getHours(), Math.floor(startDate.getMinutes() / stepMinutes) * stepMinutes).getTime();

      let curr = firstMinMs;
      while (curr <= bufferEndMs) {
        const minEpoch = Math.floor(curr / stepMs);
        const pct = ((curr - startMs) / durationMs) * 100;
        if (pct >= 0 && pct <= 100) {
          const d = new Date(curr);
          const label = zoomSec <= 600
            ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          marks.push({
            id: `min-${minEpoch}`,
            timeLabel: label,
            leftPct: pct
          });
        }
        curr += stepMs;
      }
    }

    return marks;
  });

  isDraggingTimeline = signal<boolean>(false);
  isSeekingNeedle = signal<boolean>(false);
  private dragStartX = 0;
  private dragStartEndMs = 0;
  private dragTrackWidth = 1000;

  onTimelineMouseDown(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const target = (event.currentTarget || event.target) as HTMLElement;
    const wrapper = target ? (target.closest('.timeline-slider-wrapper') as HTMLElement) : null;
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width > 0) {
        this.dragTrackWidth = rect.width;
      }
    }

    if (event.button === 2 || event.button === 1) {
      // Clic Derecho o Clic Central de Rueda (Button 1) -> Arrastrar y desplazar ventana de tiempo
      this.isDraggingTimeline.set(true);
      document.body.classList.add('is-timeline-dragging');
      this.dragStartX = event.clientX;
      const range = this.timelineRange();
      this.dragStartEndMs = range.end.getTime();

      // Suprimir el menú contextual del navegador aunque el mouse se suelte fuera del contenedor
      const suppressContextMenu = (e: Event) => { e.preventDefault(); };
      document.addEventListener('contextmenu', suppressContextMenu, { capture: true, once: true });
    } else if (event.button === 0) {
      // Clic Izquierdo -> Desplazar aguja roja de reproducción
      this.isSeekingNeedle.set(true);
      document.body.classList.add('is-timeline-dragging');
      this.seekNeedleToEvent(event);
    }
  }

  private isRafMovePending = false;
  private pendingMouseMoveEvent: MouseEvent | null = null;

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(event: MouseEvent): void {
    if (!this.isDraggingTimeline() && !this.isSeekingNeedle()) return;
    event.preventDefault();

    this.pendingMouseMoveEvent = event;
    if (!this.isRafMovePending) {
      this.isRafMovePending = true;
      requestAnimationFrame(() => {
        this.isRafMovePending = false;
        if (this.pendingMouseMoveEvent) {
          this.processTimelineMouseMove(this.pendingMouseMoveEvent);
        }
      });
    }
  }

  private processTimelineMouseMove(event: MouseEvent): void {
    if (this.isDraggingTimeline()) {
      const deltaX = event.clientX - this.dragStartX;
      const durationMs = Math.min(86400 * 1000, this.zoomRangeSeconds() * 1000);
      const width = this.dragTrackWidth > 0 ? this.dragTrackWidth : window.innerWidth;
      const deltaMs = - (deltaX / width) * durationMs;

      const bounds = this.activeDayBounds();
      const minEndMs = bounds.start.getTime() + durationMs;
      const maxEndMs = bounds.end.getTime();
      const newEndMs = Math.max(minEndMs, Math.min(maxEndMs, this.dragStartEndMs + deltaMs));

      this.playbackWindowEnd.set(new Date(newEndMs));
    } else if (this.isSeekingNeedle()) {
      this.seekNeedleToEvent(event);
    }
  }

  @HostListener('window:mouseup', ['$event'])
  onTimelineMouseUp(event?: MouseEvent): void {
    if (this.isDraggingTimeline()) {
      this.isDraggingTimeline.set(false);
      document.body.classList.remove('is-timeline-dragging');
    }
    if (this.isSeekingNeedle()) {
      this.isSeekingNeedle.set(false);
      document.body.classList.remove('is-timeline-dragging');
    }
  }

  private seekNeedleToEvent(event: MouseEvent): void {
    if (this.selectedFlagId() !== null) {
      this.selectedFlagId.set(null);
    }

    const durationMs = Math.min(86400 * 1000, this.zoomRangeSeconds() * 1000);
    const width = this.dragTrackWidth > 0 ? this.dragTrackWidth : window.innerWidth;

    const wrapper = document.querySelector('.timeline-slider-wrapper') as HTMLElement;
    const rect = wrapper ? wrapper.getBoundingClientRect() : null;
    const left = rect ? rect.left : 0;
    const trackWidth = rect ? rect.width : width;

    const mouseX = Math.max(0, Math.min(event.clientX - left, trackWidth));
    const pct = trackWidth > 0 ? mouseX / trackWidth : 0;

    const range = this.timelineRange();
    const bounds = this.activeDayBounds();
    const now = new Date();
    const nowMs = now.getTime();
    const rawTargetMs = range.start.getTime() + durationMs * pct;
    const targetMs = Math.min(nowMs, Math.max(bounds.start.getTime(), rawTargetMs));

    if (targetMs >= nowMs - 1000) {
      this.setLiveMode();
      return;
    }

    const targetDate = new Date(targetMs);

    if (this.playbackMode() === 'live') {
      this.playbackWindowEnd.set(now);
      this.playbackMode.set('playback');
      this.paused.set(true);
    }

    this.isEditingTimeSegments = false;
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.hoursSegmentStr.set(pad(targetDate.getHours()));
    this.minutesSegmentStr.set(pad(targetDate.getMinutes()));
    this.secondsSegmentStr.set(pad(targetDate.getSeconds()));

    this.currentTimePointer.set(targetDate);
  }

  onTimelineWheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const bounds = this.activeDayBounds();
    const durationMs = Math.min(86400 * 1000, this.zoomRangeSeconds() * 1000);
    const minEndMs = bounds.start.getTime() + durationMs;
    const maxEndMs = bounds.end.getTime();

    // Desplazamiento horizontal cuando hay movimiento horizontal (deltaX)
    if (Math.abs(event.deltaX) > 0) {
      const width = this.dragTrackWidth > 0 ? this.dragTrackWidth : window.innerWidth;
      const deltaMs = (event.deltaX / width) * durationMs * 0.5;

      const currentEndMs = this.timelineRange().end.getTime();
      const newEndMs = Math.max(minEndMs, Math.min(maxEndMs, currentEndMs + deltaMs));

      this.playbackWindowEnd.set(new Date(newEndMs));
      return;
    }

    // Zoom en regla de tiempo (máximo 24 horas = 86400s)
    const target = event.currentTarget as HTMLElement;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const mouseX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const cursorPct = rect.width > 0 ? mouseX / rect.width : 0.5;

    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    const currDurationMs = endMs - startMs;

    const cursorTimeMs = startMs + currDurationMs * cursorPct;

    const factor = event.deltaY > 0 ? 1.25 : 0.8;
    const newZoomSec = Math.max(60, Math.min(86400, Math.round((currDurationMs / 1000) * factor)));
    const newDurationMs = newZoomSec * 1000;

    const calcMinEndMs = bounds.start.getTime() + newDurationMs;
    const newEndMs = Math.max(calcMinEndMs, Math.min(maxEndMs, cursorTimeMs + newDurationMs * (1 - cursorPct)));

    this.playbackWindowEnd.set(new Date(newEndMs));
    this.zoomRangeSeconds.set(newZoomSec);
  }

  readonly timelineHoverInfo = signal<{ visible: boolean; leftPct: number; timeLabel: string; eventCount: number }>({
    visible: false,
    leftPct: 0,
    timeLabel: '',
    eventCount: 0
  });

  onTimelineMouseMove(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (!target) return;
    const rect = target.getBoundingClientRect();

    if (this.isDraggingTimeline()) {
      const deltaX = event.clientX - this.dragStartX;
      const durationMs = this.zoomRangeSeconds() * 1000;
      const deltaMs = - (deltaX / rect.width) * durationMs;
      const maxEndMs = this.maxTimelineEnd().getTime();
      const newEndMs = Math.min(maxEndMs, this.dragStartEndMs + deltaMs);

      this.playbackWindowEnd.set(new Date(newEndMs));
      return;
    }

    const mouseX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const leftPct = (mouseX / rect.width) * 100;

    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    const hoverMs = startMs + (endMs - startMs) * (leftPct / 100);
    const hoverDate = new Date(hoverMs);

    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const datePart = `${hoverDate.getDate()} ${monthNames[hoverDate.getMonth()]} ${hoverDate.getFullYear()}`;
    const timePart = hoverDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const fullLabel = `${datePart} • ${timePart}`;

    const count = this.eventsList().filter(e => Math.abs(new Date(e.timestamp).getTime() - hoverMs) <= 30000).length;

    this.timelineHoverInfo.set({
      visible: true,
      leftPct,
      timeLabel: fullLabel,
      eventCount: count
    });
  }

  onTimelineMouseLeave(): void {
    this.timelineHoverInfo.set({ visible: false, leftPct: 0, timeLabel: '', eventCount: 0 });
  }

  readonly currentTimeInputValue = computed(() => {
    const d = this.currentTimePointer();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  });

  onSegmentFocus(): void {
    this.isEditingTimeSegments = true;
  }

  onHoursSegmentInput(val: string, nextInput?: HTMLInputElement): void {
    const digitsOnly = val.replace(/\D/g, '');
    let num = parseInt(digitsOnly, 10);
    if (!isNaN(num)) {
      if (num > 23) num = 23;
      const clampedStr = num.toString();
      this.hoursSegmentStr.set(clampedStr);
      if (clampedStr.length >= 2 && nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    } else {
      this.hoursSegmentStr.set(digitsOnly);
    }
    this.commitSegmentedTime();
  }

  onMinutesSegmentInput(val: string, nextInput?: HTMLInputElement): void {
    const digitsOnly = val.replace(/\D/g, '');
    let num = parseInt(digitsOnly, 10);
    if (!isNaN(num)) {
      if (num > 59) num = 59;
      const clampedStr = num.toString();
      this.minutesSegmentStr.set(clampedStr);
      if (clampedStr.length >= 2 && nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    } else {
      this.minutesSegmentStr.set(digitsOnly);
    }
    this.commitSegmentedTime();
  }

  onSecondsSegmentInput(val: string): void {
    const digitsOnly = val.replace(/\D/g, '');
    let num = parseInt(digitsOnly, 10);
    if (!isNaN(num)) {
      if (num > 59) num = 59;
      this.secondsSegmentStr.set(num.toString());
    } else {
      this.secondsSegmentStr.set(digitsOnly);
    }
    this.commitSegmentedTime();
  }

  onSegmentKeydown(event: KeyboardEvent, currentVal: string, prevInput?: HTMLInputElement, nextInput?: HTMLInputElement): void {
    if (event.key === 'Backspace' && (currentVal === '' || currentVal === '0' || currentVal === '00') && prevInput) {
      event.preventDefault();
      prevInput.focus();
      prevInput.select();
    } else if (event.key === 'ArrowRight' && nextInput) {
      event.preventDefault();
      nextInput.focus();
      nextInput.select();
    } else if (event.key === 'ArrowLeft' && prevInput) {
      event.preventDefault();
      prevInput.focus();
      prevInput.select();
    }
  }

  onSegmentBlur(segment: 'h' | 'm' | 's'): void {
    this.isEditingTimeSegments = false;
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (segment === 'h') {
      let h = parseInt(this.hoursSegmentStr(), 10);
      if (isNaN(h) || h < 0) h = 0;
      if (h > 23) h = 23;
      this.hoursSegmentStr.set(pad(h));
    } else if (segment === 'm') {
      let m = parseInt(this.minutesSegmentStr(), 10);
      if (isNaN(m) || m < 0) m = 0;
      if (m > 59) m = 59;
      this.minutesSegmentStr.set(pad(m));
    } else if (segment === 's') {
      let s = parseInt(this.secondsSegmentStr(), 10);
      if (isNaN(s) || s < 0) s = 0;
      if (s > 59) s = 59;
      this.secondsSegmentStr.set(pad(s));
    }
    this.commitSegmentedTime();
  }

  private commitSegmentedTime(): void {
    let h = parseInt(this.hoursSegmentStr(), 10);
    let m = parseInt(this.minutesSegmentStr(), 10);
    let s = parseInt(this.secondsSegmentStr(), 10);

    if (isNaN(h)) h = 0;
    if (isNaN(m)) m = 0;
    if (isNaN(s)) s = 0;

    h = Math.max(0, Math.min(23, h));
    m = Math.max(0, Math.min(59, m));
    s = Math.max(0, Math.min(59, s));

    const now = new Date();
    const current = this.currentTimePointer();
    const updated = new Date(current.getFullYear(), current.getMonth(), current.getDate(), h, m, s);
    const maxEndMs = this.maxTimelineEnd().getTime();
    
    // NUNCA permitir que la hora sobrepase el instante actual `now`
    const targetMs = Math.min(now.getTime(), Math.min(maxEndMs, updated.getTime()));

    if (targetMs >= now.getTime()) {
      this.setLiveMode();
      return;
    }

    if (this.playbackMode() === 'live') {
      this.playbackMode.set('playback');
      this.paused.set(true);
    }
    this.currentTimePointer.set(new Date(targetMs));
  }

  onDateSegmentFocus(): void {
    this.isEditingDateSegments = true;
  }

  onDaySegmentInput(val: string, nextInput?: HTMLInputElement): void {
    const digitsOnly = val.replace(/\D/g, '');
    let num = parseInt(digitsOnly, 10);
    if (!isNaN(num)) {
      if (num > 31) num = 31;
      this.dateDayStr.set(digitsOnly);
      if (digitsOnly.length >= 2 && nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    } else {
      this.dateDayStr.set(digitsOnly);
    }
    this.commitSegmentedDate();
  }

  onMonthSegmentInput(val: string, nextInput?: HTMLInputElement): void {
    const digitsOnly = val.replace(/\D/g, '');
    let num = parseInt(digitsOnly, 10);
    if (!isNaN(num)) {
      if (num > 12) num = 12;
      this.dateMonthStr.set(digitsOnly);
      if (digitsOnly.length >= 2 && nextInput) {
        nextInput.focus();
        nextInput.select();
      }
    } else {
      this.dateMonthStr.set(digitsOnly);
    }
    this.commitSegmentedDate();
  }

  onYearSegmentInput(val: string): void {
    const digitsOnly = val.replace(/\D/g, '');
    let num = parseInt(digitsOnly, 10);
    const currentYear = new Date().getFullYear();
    if (!isNaN(num)) {
      if (num > currentYear) num = currentYear;
      this.dateYearStr.set(digitsOnly);
    } else {
      this.dateYearStr.set(digitsOnly);
    }
    if (digitsOnly.length >= 4) {
      this.commitSegmentedDate();
    }
  }

  onDateSegmentKeydown(event: KeyboardEvent, currentVal: string, prevInput?: HTMLInputElement, nextInput?: HTMLInputElement): void {
    if (event.key === 'Backspace' && (currentVal === '' || currentVal === '0' || currentVal === '00' || currentVal === '0000') && prevInput) {
      event.preventDefault();
      prevInput.focus();
      prevInput.select();
    } else if (event.key === 'ArrowRight' && nextInput) {
      event.preventDefault();
      nextInput.focus();
      nextInput.select();
    } else if (event.key === 'ArrowLeft' && prevInput) {
      event.preventDefault();
      prevInput.focus();
      prevInput.select();
    }
  }

  onDateSegmentBlur(segment: 'd' | 'm' | 'y'): void {
    this.isEditingDateSegments = false;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();

    let day = parseInt(this.dateDayStr(), 10);
    let month = parseInt(this.dateMonthStr(), 10);
    let year = parseInt(this.dateYearStr(), 10);

    if (isNaN(day) || day < 1) day = currentDay;
    if (day > 31) day = 31;

    if (isNaN(month) || month < 1) month = currentMonth;
    if (month > 12) month = 12;

    if (isNaN(year) || year < 1) year = currentYear;
    if (year > currentYear) year = currentYear;

    // Bloquear fechas posteriores al día de hoy
    if (year === currentYear) {
      if (month > currentMonth) {
        month = currentMonth;
        day = currentDay;
      } else if (month === currentMonth && day > currentDay) {
        day = currentDay;
      }
    }

    this.dateDayStr.set(pad(day));
    this.dateMonthStr.set(pad(month));
    this.dateYearStr.set(year.toString().padStart(4, '0'));

    this.commitSegmentedDate();
  }

  private commitSegmentedDate(): void {
    let day = parseInt(this.dateDayStr(), 10);
    let month = parseInt(this.dateMonthStr(), 10);
    let year = parseInt(this.dateYearStr(), 10);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;
    const currentDay = now.getDate();

    if (isNaN(day) || day < 1) day = 1;
    if (isNaN(month) || month < 1) month = 1;
    if (isNaN(year) || year < 1) year = currentYear;

    day = Math.min(31, Math.max(1, day));
    month = Math.min(12, Math.max(1, month));

    // Garantizar que NUNCA se seleccione una fecha posterior al día de hoy
    if (year > currentYear) {
      year = currentYear;
      month = currentMonth;
      day = currentDay;
    } else if (year === currentYear) {
      if (month > currentMonth) {
        month = currentMonth;
        day = currentDay;
      } else if (month === currentMonth && day > currentDay) {
        day = currentDay;
      }
    }

    if (!this.isEditingDateSegments) {
      const pad = (n: number) => n.toString().padStart(2, '0');
      this.dateDayStr.set(pad(day));
      this.dateMonthStr.set(pad(month));
      this.dateYearStr.set(year.toString().padStart(4, '0'));
    }

    const isSelectedToday = year === currentYear && month === currentMonth && day === currentDay;

    if (isSelectedToday) {
      this.selectedManualDate.set(null);
      this.zoomRangeSeconds.set(86400);
      this.playbackWindowEnd.set(null);
      if (this.currentTimePointer().getTime() > now.getTime()) {
        this.currentTimePointer.set(now);
      }
      this.playbackMode.set('live');
      this.paused.set(false);
    } else {
      const selected = new Date(year, month - 1, day, 12, 0, 0);
      this.selectedManualDate.set(selected);

      const current = this.currentTimePointer();
      const updated = new Date(year, month - 1, day, current.getHours(), current.getMinutes(), current.getSeconds());
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

      const nowMs = now.getTime();
      const targetMs = Math.min(nowMs, updated.getTime());
      const endMs = Math.min(nowMs, endOfDay.getTime());

      this.zoomRangeSeconds.set(86400);
      this.playbackWindowEnd.set(new Date(endMs));

      if (this.playbackMode() === 'live') {
        this.playbackMode.set('playback');
        this.paused.set(true);
      }

      this.currentTimePointer.set(new Date(targetMs));
    }
    this.pruneEventsOlderThan24h();
  }

  onTimeInput(timeStr: string): void {
    if (!timeStr) return;
    const parts = timeStr.trim().split(':');
    if (parts.length < 2) return;

    let h = parseInt(parts[0], 10);
    let m = parseInt(parts[1], 10);
    let s = parts.length > 2 ? parseInt(parts[2], 10) : 0;

    const pad = (n: number) => n.toString().padStart(2, '0');
    this.hoursSegmentStr.set(pad(h));
    this.minutesSegmentStr.set(pad(m));
    this.secondsSegmentStr.set(pad(s));
    this.commitSegmentedTime();
  }

  readonly currentDateInputValue = computed(() => {
    const d = this.currentTimePointer();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });

  readonly maxDateInputValue = computed(() => {
    const d = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });

  onDateInput(dateStr: string): void {
    if (!dateStr) return;
    const parts = dateStr.split('-');
    if (parts.length < 3) return;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    if (!year || !month || !day) return;

    const now = new Date();
    const isSelectedToday = year === now.getFullYear() && (month - 1) === now.getMonth() && day === now.getDate();

    if (isSelectedToday) {
      this.selectedManualDate.set(null);
      this.zoomRangeSeconds.set(86400);
      this.playbackWindowEnd.set(null);
      this.currentTimePointer.set(now);
      this.playbackMode.set('live');
      this.paused.set(false);
    } else {
      const selected = new Date(year, month - 1, day, 12, 0, 0);
      this.selectedManualDate.set(selected);

      const current = this.currentTimePointer();
      const updated = new Date(year, month - 1, day, current.getHours(), current.getMinutes(), current.getSeconds());
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);

      const nowMs = now.getTime();
      const targetMs = Math.min(nowMs, updated.getTime());
      const endMs = Math.min(nowMs, endOfDay.getTime());

      this.zoomRangeSeconds.set(86400);
      this.playbackWindowEnd.set(new Date(endMs));

      if (this.playbackMode() === 'live') {
        this.playbackMode.set('playback');
        this.paused.set(true);
      }

      this.currentTimePointer.set(new Date(targetMs));
    }
    this.pruneEventsOlderThan24h();
  }

  readonly currentScrubberValue = computed(() => {
    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const pointerMs = this.currentTimePointer().getTime();

    if (pointerMs <= startMs) return 0;
    if (pointerMs >= range.end.getTime()) return this.zoomRangeSeconds();

    return Math.floor((pointerMs - startMs) / 1000);
  });



  readonly sortedEvents = computed(() => {
    return [...this.eventsList()].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  });

  // --- Filtros e Info Sidebar ---
  readonly filteredEvents = computed(() => {
    let list = this.eventsList();

    // Filtrar eventos por cámaras seleccionadas en ambos modos (SYNC y ASYNC)
    // Sin selección → muestra todos. Con selección → solo las seleccionadas
    if (this.selectedCameraNames().size > 0) {
      const selectedNames = this.selectedCameraNames();
      list = list.filter(e => selectedNames.has(e.nombreCamara));
    }

    const search = this.eventSearchQuery().trim().toLowerCase();
    const analytic = this.eventAnalyticFilter();
    const desde = this.eventDesdeFilter();
    const hasta = this.eventHastaFilter();

    // En modo PLAYBACK al buscar en la línea de tiempo, sincronizar los eventos hasta la posición de la aguja
    if (this.playbackMode() === 'playback') {
      const pointerMs = this.currentTimePointer().getTime();
      list = list.filter(e => (e.timestampMs || (e.timestampMs = new Date(e.timestamp).getTime())) <= pointerMs);
    }

    // Filtrar por búsqueda de texto de cámara en la barra superior
    if (search) {
      const matchingCanvasCameraNames = new Set<string>();
      for (const slot of this.gridSlots()) {
        if (slot.camera && slot.camera.name.toLowerCase().includes(search)) {
          matchingCanvasCameraNames.add(slot.camera.name);
        }
      }
      list = list.filter(e =>
        matchingCanvasCameraNames.has(e.nombreCamara) ||
        e.nombreCamara.toLowerCase().includes(search)
      );
    }

    if (analytic && analytic !== 'all') {
      list = list.filter(e => e.analitica.toLowerCase() === analytic.toLowerCase());
    }

    if (desde) {
      const desdeMs = desde.getTime();
      list = list.filter(e => (e.timestampMs || (e.timestampMs = new Date(e.timestamp).getTime())) >= desdeMs);
    }

    if (hasta) {
      const hastaMs = hasta.getTime();
      list = list.filter(e => (e.timestampMs || (e.timestampMs = new Date(e.timestamp).getTime())) <= hastaMs);
    }

    // Retorna la totalidad de eventos coincidentes en el rango de 24h (sin recortes fijos)
    return list;
  });

  readonly totalSidebarPages = computed(() => {
    const total = this.filteredEvents().length;
    return Math.max(1, Math.ceil(total / this.sidebarPageSize));
  });

  // Ventana deslizante de 3 páginas: [Página K-1, Página K, Página K+1] (Máximo 750 elementos en el DOM)
  readonly visibleSidebarEvents = computed(() => {
    const all = this.filteredEvents();
    const totalPages = this.totalSidebarPages();
    const currentPage = Math.min(totalPages, Math.max(1, this.currentSidebarPage()));

    const startPage = Math.max(1, currentPage - 1);
    const endPage = Math.min(totalPages, currentPage + 1);

    const startIndex = (startPage - 1) * this.sidebarPageSize;
    const endIndex = endPage * this.sidebarPageSize;

    return all.slice(startIndex, endIndex);
  });

  onSidebarScroll(event: Event): void {
    const target = event.target as HTMLElement;
    if (!target) return;

    const scrollTop = target.scrollTop;
    const scrollHeight = target.scrollHeight;
    const clientHeight = target.clientHeight;

    if (scrollHeight <= clientHeight) return;

    const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
    const currentPage = this.currentSidebarPage();
    const totalPages = this.totalSidebarPages();

    // Scroll descendente (~75% del contenedor): avanzar a la página siguiente precargando la subsecuente
    if (scrollPercentage > 0.75 && currentPage < totalPages) {
      this.currentSidebarPage.update(p => Math.min(totalPages, p + 1));
    }
    // Scroll ascendente (~25% superior): retroceder a la página anterior
    else if (scrollTop < clientHeight * 0.25 && currentPage > 1) {
      this.currentSidebarPage.update(p => Math.max(1, p - 1));
    }
  }

  readonly activeAnalyticOptions = computed(() => {
    const set = new Set<string>();
    this.eventsList().forEach(e => {
      if (e.analitica) set.add(e.analitica);
    });
    return Array.from(set).sort();
  });

  readonly activeAnalytics = computed(() => {
    const activeCamIds = this.gridSlots()
      .map(s => s.camera)
      .filter((c): c is Camera => c !== null)
      .map(c => c.id);

    if (activeCamIds.length === 0) return [];

    return this.analyticService.analytics().filter(a =>
      a.targetCameraIds.some(id => activeCamIds.includes(id))
    );
  });

  readonly camerasInCanvas = computed(() => {
    const seen = new Set<string>();
    const list: Camera[] = [];
    const selectedNames = this.selectedCameraNames();

    for (const slot of this.gridSlots()) {
      if (slot.camera && !seen.has(slot.camera.id)) {
        // Filtrar por selección en ambos modos (SYNC y ASYNC)
        // Sin selección → todas las cámaras del lienzo
        if (selectedNames.size > 0 && !selectedNames.has(slot.camera.name)) {
          continue;
        }
        seen.add(slot.camera.id);
        list.push(slot.camera);
      }
    }
    return list;
  });

  readonly collapsedCameraAccordionIds = signal<Set<string>>(new Set());

  toggleCameraAccordion(cameraId: string): void {
    const current = new Set(this.collapsedCameraAccordionIds());
    if (current.has(cameraId)) {
      current.delete(cameraId);
    } else {
      current.add(cameraId);
    }
    this.collapsedCameraAccordionIds.set(current);
  }

  isCameraAccordionExpanded(cameraId: string): boolean {
    return !this.collapsedCameraAccordionIds().has(cameraId);
  }

  getAnalyticsForCamera(cameraId: string): Analytic[] {
    return this.analyticService.analytics().filter(a => a.targetCameraIds.includes(cameraId));
  }

  readonly camerasGroupedByHost = computed(() => {
    const hosts = this.allHosts();
    const cameras = this.allCameras();
    const grouped: { host: Host; cameras: Camera[] }[] = [];

    hosts.forEach(h => {
      const hostCams = cameras.filter(c => c.hostFingerprint === h.fingerprint);
      grouped.push({
        host: h,
        cameras: hostCams
      });
    });

    return grouped;
  });

  isCameraActiveInGrid(camera: Camera): boolean {
    return this.gridSlots().some(s => s.camera?.id === camera.id);
  }

  // --- Modal Cámara & Asignación ---
  toggleCameraSelection(camera: Camera): void {
    this.toggleCameraSelectionLocal(camera);
  }

  toggleCameraSelectionLocal(camera: Camera): void {
    this.selectedCameraIds.update(set => {
      const next = new Set(set);
      if (next.has(camera.id)) {
        next.delete(camera.id);
      } else {
        next.add(camera.id);
      }
      return next;
    });
  }

  areAllNodeCamerasSelected(cameras: Camera[]): boolean {
    if (cameras.length === 0) return false;
    const selected = this.selectedCameraIds();
    return cameras.every(c => selected.has(c.id));
  }

  someNodeCamerasSelected(cameras: Camera[]): boolean {
    if (cameras.length === 0) return false;
    const selected = this.selectedCameraIds();
    const count = cameras.filter(c => selected.has(c.id)).length;
    return count > 0 && count < cameras.length;
  }

  selectAllCamerasInNode(cameras: Camera[], event: Event): void {
    event.stopPropagation();
    const nextIds = new Set(this.selectedCameraIds());
    const allSelected = this.areAllNodeCamerasSelected(cameras);
    if (allSelected) {
      cameras.forEach(c => nextIds.delete(c.id));
    } else {
      cameras.forEach(c => nextIds.add(c.id));
    }
    this.selectedCameraIds.set(nextIds);
  }

  areAllSystemCamerasSelected(): boolean {
    const cams = this.filteredCamerasForModal();
    if (cams.length === 0) return false;
    const selected = this.selectedCameraIds();
    return cams.every(c => selected.has(c.id));
  }

  toggleAllSystemCameras(): void {
    const cams = this.filteredCamerasForModal();
    const nextIds = new Set(this.selectedCameraIds());
    const allSelected = this.areAllSystemCamerasSelected();
    if (allSelected) {
      cams.forEach(c => nextIds.delete(c.id));
    } else {
      cams.forEach(c => nextIds.add(c.id));
    }
    this.selectedCameraIds.set(nextIds);
  }

  confirmCameraSelection(): void {
    this.saveStateToHistory();
    const nextIds = this.selectedCameraIds();
    const selectedCams = this.allCameras().filter(c => nextIds.has(c.id));
    const N = selectedCams.length;

    if (N === 0) {
      this.gridSlots.set([
        { id: 'slot-1-1', camera: null, col: 1, row: 1, spanX: 1, spanY: 1 }
      ]);
      this.cols.set(1);
      this.rows.set(1);
      this.showModal.set(false);
      this.targetAddCol.set(null);
      this.targetAddRow.set(null);
      this.showToast('Canales de monitoreo vaciados', 'warning');
      return;
    }

    // Obtener los slots ocupados actuales que siguen seleccionados
    const currentSlots = this.gridSlots().filter(s => s.camera !== null);
    const preservedSlots: GridSlot[] = currentSlots.filter(s => s.camera && nextIds.has(s.camera.id));

    if (preservedSlots.length === 0) {
      // Si no hay cámaras previas a conservar, generar una distribución limpia
      let C = 1;
      let R = 1;
      if (N <= 1) {
        C = 1; R = 1;
      } else if (N === 2) {
        C = 2; R = 1;
      } else if (N <= 4) {
        C = 2; R = 2;
      } else if (N <= 6) {
        C = 3; R = 2;
      } else if (N <= 9) {
        C = 3; R = 3;
      } else if (N <= 12) {
        C = 4; R = 3;
      } else if (N <= 16) {
        C = 4; R = 4;
      } else {
        C = Math.ceil(Math.sqrt(N));
        R = (C * (C - 1) >= N) ? C - 1 : C;
      }

      const nextSlots: GridSlot[] = selectedCams.map((cam, i) => {
        const col = (i % C) + 1;
        const row = Math.floor(i / C) + 1;
        return {
          id: `slot-${col}-${row}-${Math.floor(Math.random() * 1000000)}`,
          camera: cam,
          col,
          row,
          spanX: 1,
          spanY: 1
        };
      });

      this.gridSlots.set(nextSlots);
    } else {
      // Si hay cámaras previas, conservar sus posiciones y tamaños intactos
      const preservedCameraIds = new Set(preservedSlots.map(s => s.camera!.id));
      const newCams = selectedCams.filter(c => !preservedCameraIds.has(c.id));

      let maxCol = 1;
      preservedSlots.forEach(s => {
        const endCol = s.col + s.spanX - 1;
        if (endCol > maxCol) maxCol = endCol;
      });

      const nextSlots = preservedSlots.map(s => ({ ...s }));
      const limitCols = Math.max(4, maxCol);

      // Ubicar las nuevas cámaras agregadas al final del último objeto de la última fila (currentMaxRow)
      newCams.forEach((cam) => {
        // Encontrar la última fila ocupada en nextSlots actual
        let currentMaxRow = 0;
        nextSlots.forEach(s => {
          const endRow = s.row + s.spanY - 1;
          if (endRow > currentMaxRow) currentMaxRow = endRow;
        });

        if (currentMaxRow === 0) {
          nextSlots.push({
            id: `slot-1-1-${Math.floor(Math.random() * 1000000)}`,
            camera: cam,
            col: 1,
            row: 1,
            spanX: 1,
            spanY: 1
          });
          return;
        }

        // Encontrar el último objeto (columna más a la derecha) en la última fila
        let maxColInLastRow = 0;
        nextSlots.forEach(s => {
          const occupiesLastRow = s.row <= currentMaxRow && (s.row + s.spanY - 1) >= currentMaxRow;
          if (occupiesLastRow) {
            const endCol = s.col + s.spanX - 1;
            if (endCol > maxColInLastRow) {
              maxColInLastRow = endCol;
            }
          }
        });

        let col = maxColInLastRow + 1;
        let row = currentMaxRow;

        if (col > limitCols) {
          col = 1;
          row = currentMaxRow + 1;
        }

        // Asegurarse de que no solape con ningún slot
        while (true) {
          const overlaps = nextSlots.some(s =>
            col >= s.col && col < s.col + s.spanX &&
            row >= s.row && row < s.row + s.spanY
          );
          if (!overlaps) {
            break;
          }
          col++;
          if (col > limitCols) {
            col = 1;
            row++;
          }
        }

        nextSlots.push({
          id: `slot-${col}-${row}-${Math.floor(Math.random() * 1000000)}`,
          camera: cam,
          col,
          row,
          spanX: 1,
          spanY: 1
        });
      });

      this.gridSlots.set(nextSlots);
    }

    this.recalculateGridDimensions();

    // Auto-centrar el lienzo al crear/actualizar cámaras
    setTimeout(() => {
      this.resetCanvas();
    }, 100);

    this.showModal.set(false);
    this.targetAddCol.set(null);
    this.targetAddRow.set(null);
    this.showToast('Canales de monitoreo actualizados', 'success');
  }

  deleteSelectedCameras(): void {
    const selectedIds = this.selectedCanvasSlotIds();
    if (selectedIds.size === 0) return;

    const occupiedSelectedSlots = this.gridSlots().filter(s => selectedIds.has(s.id) && s.camera !== null);
    if (occupiedSelectedSlots.length === 0) return;

    // Guardar estado actual en el historial de Deshacer antes de la eliminación masiva
    this.saveStateToHistory();

    const slots = this.gridSlots().map(s => ({
      ...s,
      camera: s.camera ? { ...s.camera } : null
    }));

    occupiedSelectedSlots.forEach(targetSlot => {
      const idx = slots.findIndex(s => s.id === targetSlot.id);
      if (idx !== -1) {
        slots[idx].camera = null;
      }
    });

    this.gridSlots.set(slots);
    this.selectedCanvasSlotIds.set(new Set());
    this.recalculateGridDimensions();

    if (occupiedSelectedSlots.length === 1) {
      const camName = occupiedSelectedSlots[0].camera?.name;
      this.showToast(`Cámara ${camName || ''} removida del slot`, 'warning');
    } else {
      this.showToast(`${occupiedSelectedSlots.length} cámaras removidas del lienzo`, 'warning');
    }
  }

  removeCameraFromSlot(col: number, row: number, event: Event): void {
    event.stopPropagation();

    // Si la cámara objetivo está seleccionada y hay múltiples cámaras seleccionadas, realizar eliminación masiva
    const targetSlot = this.gridSlots().find(s => s.col === col && s.row === row);
    if (targetSlot && this.selectedCanvasSlotIds().has(targetSlot.id) && this.selectedCanvasSlotIds().size > 1) {
      this.deleteSelectedCameras();
      return;
    }

    this.saveStateToHistory();
    const slots = this.gridSlots().map(s => ({
      ...s,
      camera: s.camera ? { ...s.camera } : null
    }));
    const idx = slots.findIndex(s => s.col === col && s.row === row);

    if (idx !== -1) {
      const camName = slots[idx].camera?.name;
      slots[idx].camera = null;
      if (camName) {
        this.showToast(`Cámara ${camName} removida del slot`, 'warning');
      }
    }

    if (targetSlot) {
      const nextSelected = new Set(this.selectedCanvasSlotIds());
      nextSelected.delete(targetSlot.id);
      this.selectedCanvasSlotIds.set(nextSelected);
    }

    this.gridSlots.set(slots);
    this.recalculateGridDimensions();
  }

  openSelectionModal(col: number | null, row: number | null): void {
    this.targetAddCol.set(col);
    this.targetAddRow.set(row);

    // Resetear filtros locales de la modal al abrir
    this.modalSearchQuery.set('');
    this.modalStatusFilter.set('all');

    // Inicializar checklist de la modal con las cámaras activas en el grid
    const activeIds = new Set(
      this.gridSlots()
        .map(s => s.camera?.id)
        .filter((id): id is string => !!id)
    );
    this.selectedCameraIds.set(activeIds);

    this.showModal.set(true);
    this.activeModalTab.set('nodos');
  }

  toggleNodeCollapse(fingerprint: string): void {
    this.expandedNodes.update(s => {
      const next = new Set(s);
      if (next.has(fingerprint)) {
        next.delete(fingerprint);
      } else {
        next.add(fingerprint);
      }
      return next;
    });
  }

  // --- Interacción con Alertas (Highlight Cell & Center) ---
  highlightCameraSlot(cameraName: string): void {
    this.highlightedCellCameraName.set(cameraName);

    const slotMatch = this.gridSlots().find(s => s.camera && s.camera.name === cameraName);
    if (slotMatch) {
      this.centerOnSlot(slotMatch);
    }

    setTimeout(() => {
      if (this.highlightedCellCameraName() === cameraName) {
        this.highlightedCellCameraName.set(null);
      }
    }, 3000);
  }

  // --- Marcas en la línea de tiempo (Agrupamiento Inteligente / Clustering) ---
  readonly visibleTimelineFlags = computed(() => {
    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    let events = this.eventsList();

    // Filtrar banderas de la línea de tiempo por cámaras seleccionadas en ambos modos (SYNC y ASYNC)
    // Sin selección → muestra banderas de todas las cámaras del lienzo
    if (this.selectedCameraNames().size > 0) {
      const selectedNames = this.selectedCameraNames();
      events = events.filter(e => selectedNames.has(e.nombreCamara));
    }

    // Filtrar banderas por búsqueda de texto de cámara en la barra superior
    const search = this.eventSearchQuery().trim().toLowerCase();
    if (search) {
      const matchingCanvasCameraNames = new Set<string>();
      for (const slot of this.gridSlots()) {
        if (slot.camera && slot.camera.name.toLowerCase().includes(search)) {
          matchingCanvasCameraNames.add(slot.camera.name);
        }
      }
      events = events.filter(e =>
        matchingCanvasCameraNames.has(e.nombreCamara) ||
        e.nombreCamara.toLowerCase().includes(search)
      );
    }

    const rawFlags = events
      .filter(e => {
        const t = e.timestampMs || (e.timestampMs = new Date(e.timestamp).getTime());
        return t >= startMs && t <= endMs;
      })
      .map(e => {
        const t = e.timestampMs || (e.timestampMs = new Date(e.timestamp).getTime());
        const pct = ((t - startMs) / (endMs - startMs)) * 100;
        return {
          event: e,
          leftPct: pct,
          color: this.getAnalyticColor(e.analitica)
        };
      })
      .sort((a, b) => a.leftPct - b.leftPct);

    if (rawFlags.length === 0) return [];

    // Umbral de agrupación adaptativo según el nivel de zoom actual:
    // A zoom máximo (zoomRangeSeconds <= 300s / 5 minutos o menos), el umbral baja a 0.05% para des-agrupar totalmente todas las banderas individuales.
    const zoomSec = this.zoomRangeSeconds();
    let clusterThresholdPct = 3.5;
    if (zoomSec <= 300) {
      clusterThresholdPct = 0.05; // Des-agrupación total a nivel de segundos individuales al hacer zoom profundo
    } else if (zoomSec <= 1800) {
      clusterThresholdPct = 0.5;
    } else if (zoomSec <= 7200) {
      clusterThresholdPct = 1.2;
    } else if (zoomSec <= 21600) {
      clusterThresholdPct = 2.2;
    }
    const clusters: Array<{
      event: EventRecord;
      leftPct: number;
      color: string;
      count: number;
      events: EventRecord[];
    }> = [];

    let currentGroup: typeof rawFlags = [];

    for (const flag of rawFlags) {
      if (currentGroup.length === 0) {
        currentGroup.push(flag);
      } else {
        const firstInGroup = currentGroup[0];
        if (flag.leftPct - firstInGroup.leftPct <= clusterThresholdPct) {
          currentGroup.push(flag);
        } else {
          const avgPct = currentGroup.reduce((sum, item) => sum + item.leftPct, 0) / currentGroup.length;
          const mainEvent = currentGroup[currentGroup.length - 1].event;
          clusters.push({
            event: mainEvent,
            leftPct: avgPct,
            color: currentGroup[0].color,
            count: currentGroup.length,
            events: currentGroup.map(g => g.event)
          });
          currentGroup = [flag];
        }
      }
    }

    if (currentGroup.length > 0) {
      const avgPct = currentGroup.reduce((sum, item) => sum + item.leftPct, 0) / currentGroup.length;
      const mainEvent = currentGroup[currentGroup.length - 1].event;
      clusters.push({
        event: mainEvent,
        leftPct: avgPct,
        color: currentGroup[0].color,
        count: currentGroup.length,
        events: currentGroup.map(g => g.event)
      });
    }

    return clusters;
  });

  setZoomRange(seconds: number): void {
    this.zoomRangeSeconds.set(seconds);
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  openEventDetails(event: EventRecord): void {
    if (!event || !event.timestamp) return;

    this.selectedEvent.set(event);
    this.selectedModalEvent.set(event);
    this.selectedFlagId.set(event.id);
    this.isZoomed.set(false);

    // Auto-seleccionar y destacar la cámara correspondiente en el lienzo
    if (event.nombreCamara || event.idCamara) {
      const slotMatch = this.gridSlots().find(s => s.camera && (s.camera.name === event.nombreCamara || s.camera.id === event.idCamara));
      if (slotMatch && slotMatch.camera) {
        this.selectedCanvasSlotIds.set(new Set([slotMatch.id]));
        this.highlightedCellCameraName.set(slotMatch.camera.name);
      } else if (event.nombreCamara) {
        this.highlightedCellCameraName.set(event.nombreCamara);
      }
    }

    // Mover la aguja de la línea de tiempo y cambiar a modo PLAYBACK
    const eventDate = new Date(event.timestamp);
    const nowMs = new Date().getTime();
    const targetMs = Math.min(nowMs, eventDate.getTime());
    const targetDate = new Date(targetMs);

    if (this.playbackMode() === 'live') {
      if (this.playbackWindowEnd() === null) {
        this.playbackWindowEnd.set(new Date());
      }
      this.playbackMode.set('playback');
      this.paused.set(true);
    }

    this.isEditingTimeSegments = false;
    this.isEditingDateSegments = false;

    const pad = (n: number) => n.toString().padStart(2, '0');
    this.hoursSegmentStr.set(pad(targetDate.getHours()));
    this.minutesSegmentStr.set(pad(targetDate.getMinutes()));
    this.secondsSegmentStr.set(pad(targetDate.getSeconds()));
    this.dateDayStr.set(pad(targetDate.getDate()));
    this.dateMonthStr.set(pad(targetDate.getMonth() + 1));
    this.dateYearStr.set(targetDate.getFullYear().toString());

    this.currentTimePointer.set(targetDate);
  }

  closeEventDetails(): void {
    this.selectedModalEvent.set(null);
    this.isZoomed.set(false);
  }

  formatDate(date: any): string {
    if (!date) return '';
    const d = parseUtcDate(date);
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  formatDateCombined(date: any): string {
    if (!date) return '';
    const d = parseUtcDate(date);
    const day = d.getDate().toString().padStart(2, '0');
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const month = monthNames[d.getMonth()];
    const year = d.getFullYear();
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    const secs = d.getSeconds().toString().padStart(2, '0');
    return `${day} ${month} ${year}, ${hours}:${mins}:${secs}`;
  }

  formatDatePart(date: any): string {
    if (!date) return '';
    const d = parseUtcDate(date);
    const day = d.getDate().toString().padStart(2, '0');
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const year = d.getFullYear();
    return `${day} ${monthNames[d.getMonth()]} ${year}`;
  }

  formatTimePart(date: any): string {
    if (!date) return '';
    const d = parseUtcDate(date);
    const hours = d.getHours().toString().padStart(2, '0');
    const mins = d.getMinutes().toString().padStart(2, '0');
    const secs = d.getSeconds().toString().padStart(2, '0');
    return `${hours}:${mins}:${secs}`;
  }

  /**
   * Formatea los números flotantes de muchos decimales dentro de un texto de descripción.
   * Ej: "1796.7047259807587 segundos" → "1,796.70 segundos"
   * Solo actúa sobre números con 3+ decimales para no afectar valores cortos válidos.
   */
  formatDetalleEvento(text: string): string {
    if (!text) return '';
    return text.replace(/(\d+\.\d{3,})/g, (match) => {
      const n = parseFloat(match);
      return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    });
  }

  getAnalyticColor(analitica: string): string {
    if (!analitica) return 'var(--primary)';
    const lower = analitica.toLowerCase();
    if (lower.includes('trafico') || lower.includes('tráfico')) return '#6366f1';
    if (lower.includes('aforo')) return '#f59e0b';
    if (lower.includes('cruce') || lower.includes('linea') || lower.includes('línea')) return '#10b981';
    if (lower.includes('facial') || lower.includes('rostro') || lower.includes('face')) return '#a855f7';
    if (lower.includes('permanencia') || lower.includes('estacionamiento')) return '#0891b2';
    if (lower.includes('objeto') || lower.includes('area') || lower.includes('área')) return '#3b82f6';
    if (lower.includes('intrusion') || lower.includes('intrusión')) return '#ef4444';
    if (lower.includes('placa') || lower.includes('plate')) return '#00bba7';
    return '#2b7fff';
  }

  getAnalyticLabel(type: string): string {
    return type ? type.replace(/_/g, ' ') : 'Desconocido';
  }

  // --- Zoom Lens ---
  toggleZoom(event: MouseEvent): void {
    this.isZoomed.update(z => !z);
    if (this.isZoomed()) {
      this.onZoomMouseMove(event);
    }
  }

  onZoomMouseMove(event: MouseEvent): void {
    if (!this.isZoomed()) return;
    const container = event.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    this.zoomX.set(x);
    this.zoomY.set(y);

    const zoomFactor = 2.5;
    const lensSize = 350;

    this.zoomBgX.set(Math.round(- (x * zoomFactor - lensSize / 2)));
    this.zoomBgY.set(Math.round(- (y * zoomFactor - lensSize / 2)));
    this.zoomBgWidth.set(Math.round(rect.width * zoomFactor));
    this.zoomBgHeight.set(Math.round(rect.height * zoomFactor));
  }

  copyToClipboard(text: string, field: string): void {
    if (!text) return;
    copyToClipboard(text).then(() => {
      this.copiedField.set(field);
      setTimeout(() => this.copiedField.set(null), 2000);
    }).catch(err => console.error('Error al copiar:', err));
  }

  hasMetrics(record: EventRecord): boolean {
    return record.conteoAforo !== null ||
      record.tiempoPermanencia !== null ||
      record.objetosEnArea !== null ||
      record.espaciosLibres !== null;
  }

  getGoogleMapsUrl(record: EventRecord): string {
    if (!record?.location) return '#';
    return `https://maps.google.com?q=${record.location.lat},${record.location.lon}`;
  }

  // --- Sidebar Filter Panel ---
  toggleSidebarFilters(event: Event): void {
    event.stopPropagation();
    this.showSidebarFilters.update(v => !v);
    if (!this.showSidebarFilters()) {
      // close any open sub-popovers when hiding the panel
      this.activeCalendarField.set(null);
      this.activeNestedCalendar.set(null);
      this.activeTimeField.set(null);
      this.showTimeRangeDropdown.set(false);
    }
  }

  setDatePreset(preset: '24h' | '7d' | 'today' | 'clear'): void {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const now = new Date();
    if (preset === 'clear') {
      this.filterDateDesdeStr.set('');
      this.filterDateHastaStr.set('');
      this.filterTimeDesdeStr.set('00:00');
      this.filterTimeHastaStr.set('23:59');
      this.eventDesdeFilter.set(null);
      this.eventHastaFilter.set(null);
    } else if (preset === 'today') {
      this.filterDateDesdeStr.set(fmt(now));
      this.filterDateHastaStr.set(fmt(now));
      this.filterTimeDesdeStr.set('00:00');
      this.filterTimeHastaStr.set('23:59');
    } else if (preset === '24h') {
      const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      this.filterDateDesdeStr.set(fmt(from));
      this.filterDateHastaStr.set(fmt(now));
      this.filterTimeDesdeStr.set(`${pad(from.getHours())}:${pad(from.getMinutes())}`);
      this.filterTimeHastaStr.set(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
    } else if (preset === '7d') {
      const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      this.filterDateDesdeStr.set(fmt(from));
      this.filterDateHastaStr.set(fmt(now));
      this.filterTimeDesdeStr.set('00:00');
      this.filterTimeHastaStr.set('23:59');
    }
    this.applyDateTimeFilter('desde');
    this.applyDateTimeFilter('hasta');
    // sync calendar temp state
    this.tempDateStart.set(this.filterDateDesdeStr());
    this.tempDateEnd.set(this.filterDateHastaStr());
  }

  // --- Date/Time Filters ---
  @HostListener('document:click')
  onDocumentClick(): void {
    this.activeCalendarField.set(null);
    this.activeNestedCalendar.set(null);
    this.activeTimeField.set(null);
    this.showTimeRangeDropdown.set(false);
  }

  toggleDropdown(dropdownName: string, event: Event): void {
    event.stopPropagation();
    if (this.activeCalendarField() === dropdownName) {
      this.activeCalendarField.set(null);
    } else {
      this.activeCalendarField.set(dropdownName as any);
      this.showTimeRangeDropdown.set(false);
      this.activeTimeField.set(null);
      this.activeNestedCalendar.set(null);
      if (dropdownName === 'fechas' || dropdownName === 'registro-fechas') {
        this.tempDateStart.set(this.filterDateDesdeStr() || '');
        this.tempDateEnd.set(this.filterDateHastaStr() || '');
        this.isSelectingRange.set(false);
        this.calendarViewMonth.set(new Date().getMonth());
        this.calendarViewYear.set(new Date().getFullYear());
      }
    }
  }

  toggleTimeDropdown(event: Event): void {
    event.stopPropagation();
    const current = this.showTimeRangeDropdown();
    this.showTimeRangeDropdown.set(!current);
    if (!current) {
      this.activeCalendarField.set(null);
      this.activeNestedCalendar.set(null);
      this.activeTimeField.set(null);
    }
  }

  openCalendarField(field: 'desde' | 'hasta', event: Event): void {
    event.stopPropagation();
    if (this.activeNestedCalendar() === field) {
      this.activeNestedCalendar.set(null);
    } else {
      this.activeNestedCalendar.set(field);
      this.activeTimeField.set(null);
      this.calendarViewMonth.set(new Date().getMonth());
      this.calendarViewYear.set(new Date().getFullYear());
    }
  }

  selectCalendarDay(day: number, event?: Event): void {
    if (event) event.stopPropagation();
    const pad = (num: number) => num.toString().padStart(2, '0');
    const dateStr = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    const activeField = this.activeNestedCalendar();

    // Metadatos-style: if activeNestedCalendar is 'desde' or 'hasta', set directly
    if (activeField === 'desde') {
      this.filterDateDesdeStr.set(dateStr);
      this.tempDateStart.set(dateStr);
      this.applyDateTimeFilter('desde');
      this.activeNestedCalendar.set(null);
      return;
    }
    if (activeField === 'hasta') {
      this.filterDateHastaStr.set(dateStr);
      this.tempDateEnd.set(dateStr);
      this.applyDateTimeFilter('hasta');
      this.activeNestedCalendar.set(null);
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
      this.filterDateDesdeStr.set(this.tempDateStart());
      this.filterDateHastaStr.set(this.tempDateEnd());
      this.applyDateTimeFilter('desde');
      this.applyDateTimeFilter('hasta');
    }
  }

  isCalendarDateSelected(day: number): boolean {
    const pad = (num: number) => num.toString().padStart(2, '0');
    const target = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    return this.tempDateStart() === target || this.tempDateEnd() === target;
  }

  isCalendarDateInRange(day: number): boolean {
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

  getMonths(): string[] {
    return ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  }

  getCalendarGrid() {
    const month = this.calendarViewMonth();
    const year = this.calendarViewYear();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    return {
      emptyDays: Array.from({ length: firstDay }, (_, i) => i),
      days: Array.from({ length: totalDays }, (_, i) => i + 1)
    };
  }

  prevCalendarMonth(event: Event): void {
    event.stopPropagation();
    if (this.calendarViewMonth() === 0) {
      this.calendarViewMonth.set(11);
      this.calendarViewYear.update(y => y - 1);
    } else {
      this.calendarViewMonth.update(m => m - 1);
    }
  }

  nextCalendarMonth(event: Event): void {
    event.stopPropagation();
    if (this.calendarViewMonth() === 11) {
      this.calendarViewMonth.set(0);
      this.calendarViewYear.update(y => y + 1);
    } else {
      this.calendarViewMonth.update(m => m + 1);
    }
  }

  openTimePickerField(field: 'desde' | 'hasta', event: Event): void {
    event.stopPropagation();
    if (this.activeTimeField() === field) {
      this.activeTimeField.set(null);
      return;
    }
    this.activeTimeField.set(field);
    this.activeNestedCalendar.set(null);
  }

  selectTimeHour(h: number, event?: Event): void {
    if (event) event.stopPropagation();
    const field = this.activeTimeField();
    if (!field) return;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ts = field === 'desde' ? this.filterTimeDesdeStr() : this.filterTimeHastaStr();
    const parts = ts.split(':');
    const newTs = `${pad(h)}:${parts[1] || '00'}`;
    if (field === 'desde') {
      this.filterTimeDesdeStr.set(newTs);
      this.applyDateTimeFilter('desde');
    } else {
      this.filterTimeHastaStr.set(newTs);
      this.applyDateTimeFilter('hasta');
    }
  }

  selectTimeMinute(m: number, event?: Event): void {
    if (event) event.stopPropagation();
    const field = this.activeTimeField();
    if (!field) return;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ts = field === 'desde' ? this.filterTimeDesdeStr() : this.filterTimeHastaStr();
    const parts = ts.split(':');
    const newTs = `${parts[0] || '00'}:${pad(m)}`;
    if (field === 'desde') {
      this.filterTimeDesdeStr.set(newTs);
      this.applyDateTimeFilter('desde');
    } else {
      this.filterTimeHastaStr.set(newTs);
      this.applyDateTimeFilter('hasta');
    }
  }

  isTimeHourSelected(h: number): boolean {
    const field = this.activeTimeField();
    if (!field) return false;
    const ts = field === 'desde' ? this.filterTimeDesdeStr() : this.filterTimeHastaStr();
    return parseInt(ts.split(':')[0], 10) === h;
  }

  isTimeMinuteSelected(m: number): boolean {
    const field = this.activeTimeField();
    if (!field) return false;
    const ts = field === 'desde' ? this.filterTimeDesdeStr() : this.filterTimeHastaStr();
    return parseInt(ts.split(':')[1], 10) === m;
  }

  applyDateTimeFilter(field: 'desde' | 'hasta'): void {
    const dateStr = field === 'desde' ? this.filterDateDesdeStr() : this.filterDateHastaStr();
    const timeStr = field === 'desde' ? this.filterTimeDesdeStr() : this.filterTimeHastaStr();
    if (!dateStr) return;

    const date = new Date(`${dateStr}T${timeStr}`);
    if (isNaN(date.getTime())) return;

    if (field === 'desde') {
      this.eventDesdeFilter.set(date);
    } else {
      this.eventHastaFilter.set(date);
    }
  }

  resetFilters(): void {
    this.eventSearchControl.setValue('');
    this.eventSearchQuery.set('');
    this.eventAnalyticFilter.set('all');
    this.eventDesdeFilter.set(null);
    this.eventHastaFilter.set(null);
    this.filterDateDesdeStr.set('');
    this.filterDateHastaStr.set('');
    this.filterTimeDesdeStr.set('00:00');
    this.filterTimeHastaStr.set('23:59');
  }

  formatCalendarDateLabel(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}`;
    }
    return dateStr;
  }

  // --- Real association computed method ---
  getCameraAnalytics(camera: Camera): string[] {
    const list: string[] = [];
    const analytics = this.analyticService.analytics();
    analytics.forEach(a => {
      if (a.targetCameraIds.includes(camera.id)) {
        list.push(this.getAnalyticLabel(a.type));
      }
    });

    // Mock fallbacks if none configured to look premium and fully styled
    if (list.length === 0) {
      const name = camera.name.toLowerCase();
      if (name.includes('facial') || name.includes('rostro')) {
        list.push('Facial');
      } else if (name.includes('vehiculo') || name.includes('placa') || name.includes('patente') || name.includes('porton')) {
        list.push('LPR');
      } else if (name.includes('intrusion') || name.includes('cerca') || name.includes('perimetro')) {
        list.push('Intrusión');
      } else {
        list.push('Detección');
      }
    }
    return list;
  }

  getCameraSpecs(camera: Camera): string {
    if (camera.streamType && camera.streamType.toLowerCase().includes('webrtc')) {
      return '4K @ 15 FPS';
    }
    if (camera.streamType && camera.streamType.toLowerCase() === 'mjpeg') {
      return '1080p @ 30 FPS';
    }
    return '1080p @ 25 FPS';
  }

  isCameraOnline(camera: Camera | null | undefined): boolean {
    const status = getCameraEffectiveStatus(camera, this.hostService.allHosts());
    return status === 'Online';
  }

  getCameraStatusClass(camera: Camera | null | undefined): string {
    const status = getCameraEffectiveStatus(camera, this.hostService.allHosts());
    return getCameraStatusCssClass(status);
  }

  getCameraStatusLabel(camera: Camera | null | undefined): string {
    return getCameraEffectiveStatus(camera, this.hostService.allHosts());
  }

  getClampedSpan(span: number): number {
    return span;
  }

  /**
   * Determina si un slot debe atenuarse (menor opacidad) durante una búsqueda por texto de cámara.
   * Solo atenúa cuando hay texto activo en el buscador superior y la cámara no coincide.
   */
  isSlotDimmed(slot: GridSlot): boolean {
    if (!slot.camera) return false;
    const search = this.eventSearchQuery().trim().toLowerCase();
    if (!search) return false;
    return !slot.camera.name.toLowerCase().includes(search);
  }

  // --- Filtered computed properties for modal ---
  readonly filteredCamerasForModal = computed(() => {
    const query = this.modalSearchQuery().trim().toLowerCase();
    const statusFilter = this.modalStatusFilter();
    let cams = this.allCameras();

    if (query) {
      cams = cams.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        (c.streamType && c.streamType.toLowerCase().includes(query))
      );
    }

    if (statusFilter === 'online') {
      cams = cams.filter(c => c.status?.toLowerCase() === 'online' || c.status?.toLowerCase() === 'active');
    } else if (statusFilter === 'offline') {
      cams = cams.filter(c => c.status?.toLowerCase() !== 'online' && c.status?.toLowerCase() !== 'active');
    }

    return cams;
  });

  readonly filteredNodeGroupsForModal = computed(() => {
    const query = this.modalSearchQuery().trim().toLowerCase();
    const statusFilter = this.modalStatusFilter();
    const hosts = this.allHosts();
    const cameras = this.allCameras();

    const groups: { host: Host; cameras: Camera[] }[] = [];

    hosts.forEach(h => {
      let hostCams = cameras.filter(c => c.hostFingerprint === h.fingerprint);

      if (query) {
        hostCams = hostCams.filter(c =>
          c.name.toLowerCase().includes(query) ||
          c.id.toLowerCase().includes(query) ||
          (c.streamType && c.streamType.toLowerCase().includes(query))
        );
      }

      if (statusFilter === 'online') {
        hostCams = hostCams.filter(c => c.status?.toLowerCase() === 'online' || c.status?.toLowerCase() === 'active');
      } else if (statusFilter === 'offline') {
        hostCams = hostCams.filter(c => c.status?.toLowerCase() !== 'online' && c.status?.toLowerCase() !== 'active');
      }

      const matchesHost = query ? (h.hostname.toLowerCase().includes(query) || h.fingerprint.toLowerCase().includes(query)) : false;

      const finalCams = matchesHost
        ? cameras.filter(c => c.hostFingerprint === h.fingerprint && (statusFilter === 'all' || (statusFilter === 'online' ? (c.status?.toLowerCase() === 'online' || c.status?.toLowerCase() === 'active') : (c.status?.toLowerCase() !== 'online' && c.status?.toLowerCase() !== 'active'))))
        : hostCams;

      if (finalCams.length > 0) {
        groups.push({
          host: h,
          cameras: finalCams
        });
      }
    });

    return groups;
  });
}
