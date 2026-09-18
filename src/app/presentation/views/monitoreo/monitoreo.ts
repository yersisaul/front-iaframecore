import { Component, OnInit, OnDestroy, AfterViewInit, inject, signal, computed, effect, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';

import { CameraService } from '../../../core/services/camera.service';
import { HostService } from '../../../core/services/host.service';
import { AnalyticService } from '../../../core/services/analytic.service';
import { EventService } from '../../../core/services/event.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { WebsocketConnectionService } from '../../../core/services/websocket-connection.service';
import { WebsocketService } from '../../../core/services/websocket.service';
import { IEventRepository } from '../../../core/domain/repositories/event.repository';

import { Camera } from '../../../core/domain/entities/camera.models';
import { Host } from '../../../core/domain/entities/host.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { EventRecord } from '../../../core/domain/entities/event.models';
import { parseUtcDate } from '../../../core/utils/date-utils';
import { copyToClipboard } from '../../../core/utils/clipboard.util';
import { getCameraEffectiveStatus, getCameraStatusCssClass, getCameraStatusFilterLabel } from '../../../core/utils/camera-status.utils';
import { EventDetailModalComponent } from '../../shared/event-detail-modal/event-detail-modal.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { SearchInputComponent } from '../../shared/search-input/search-input.component';
import { CameraDetailDrawerComponent } from '../../shared/camera-detail-drawer/camera-detail-drawer.component';
import { CameraGridCanvasComponent } from '../../shared/camera-grid-canvas/camera-grid-canvas.component';
import { CameraSelectionModalComponent } from '../../shared/camera-selection-modal/camera-selection-modal.component';
import { MonitoringTimelineComponent } from '../../shared/monitoring-timeline/monitoring-timeline.component';
import { MonitoringEventsSidebarComponent } from '../../shared/monitoring-events-sidebar/monitoring-events-sidebar.component';
import { MediaUrlPipe } from '../../shared/pipes/media-url.pipe';

import { MonitoringStateService, GridSlot, CanvasStateSnapshot } from '../../../core/services/monitoring-state.service';
import { MonitoringStreamService } from '../../../core/services/monitoring-stream.service';
export type { GridSlot, CanvasStateSnapshot };

@Component({
  selector: 'app-monitoreo',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, EventDetailModalComponent, PageHeaderComponent, SearchInputComponent, CameraDetailDrawerComponent, CameraGridCanvasComponent, CameraSelectionModalComponent, MonitoringTimelineComponent, MonitoringEventsSidebarComponent, MediaUrlPipe],
  templateUrl: './monitoreo.html',
  styleUrl: './monitoreo.css'
})
export class Monitoreo implements OnInit, OnDestroy, AfterViewInit {
  public monitoringStateService = inject(MonitoringStateService);
  public streamService = inject(MonitoringStreamService);
  private cameraService = inject(CameraService);
  private hostService = inject(HostService);
  public analyticService = inject(AnalyticService);
  private eventService = inject(EventService);
  private sidebarService = inject(SidebarService);
  private wsConnectionService = inject(WebsocketConnectionService);
  private websocketService = inject(WebsocketService);
  private eventRepository = inject(IEventRepository);
  public permissionsService = inject(PermissionsService);
  private cdr = inject(ChangeDetectorRef);

  // Camera Detail Drawer State (Shared Component)
  readonly showCameraConfigDrawer = signal<boolean>(false);
  readonly selectedConfigCamera = signal<Camera | null>(null);

  openCameraConfig(camera: Camera, event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.selectedConfigCamera.set(camera);
    this.showCameraConfigDrawer.set(true);
  }

  onDrawerCameraUpdated(updatedCamera: Camera): void {
    this.cameraService.cameras.update(cams => cams.map(c => c.id === updatedCamera.id ? updatedCamera : c));
  }

  // WebRTC Live Video Connections & States vinculados al servicio singleton
  private get activeWebRtcConnections() { return this.monitoringStateService.activeWebRtcConnections; }
  private get activeGridCamerasMap() { return this.monitoringStateService.activeGridCamerasMap; }
  readonly webRtcStates = this.monitoringStateService.webRtcStates;

  // Layout Grid States (Coordinate slots) - Persistentes en MonitoringStateService
  readonly rows = this.monitoringStateService.rows;
  readonly cols = this.monitoringStateService.cols;
  readonly gridSlots = this.monitoringStateService.gridSlots;

  readonly targetAddCol = signal<number | null>(null);
  readonly targetAddRow = signal<number | null>(null);
  readonly modalTriggerMode = signal<'general' | 'add-row' | 'add-column' | 'slot'>('general');

  // Custom Drag & Resize Signals
  readonly draggingSlotId = signal<string | null>(null);
  readonly isGroupDragging = signal<boolean>(false);
  readonly draggingDropTargets = signal<{ col: number; row: number; spanX: number; spanY: number; isValid: boolean }[]>([]);
  readonly resizingSlotId = signal<string | null>(null);
  readonly swapPulseSlotId = signal<string | null>(null);
  readonly activeHoveredExpander = signal<'column' | 'row' | 'both' | null>(null);

  // Canvas Mode, Panning and Zooming Signals for Grid > 4x4
  readonly canvasPanX = this.monitoringStateService.canvasPanX;
  readonly canvasPanY = this.monitoringStateService.canvasPanY;
  readonly canvasZoom = this.monitoringStateService.canvasZoom;
  readonly showMinimap = signal<boolean>(false);
  readonly isCanvasPinned = this.monitoringStateService.isCanvasPinned;
  readonly isCanvasActive = signal<boolean>(true);
  readonly isCanvasAnimating = signal<boolean>(false);
  private canvasAnimationTimeout: any = null;
  private marqueeZoomRaf: number | null = null;
  readonly isCanvasMode = computed(() => this.gridSlots().some(s => s.camera !== null));

  /**
   * Factor de escala compensado (Semantic Zoom HUD) para evitar que los controles,
   * textos, iconos SVG y botones crezcan desmedidamente con zoom in o se vuelvan
   * ilegibles/inoperables con zoom out.
   */
  readonly uiCompensatedScale = computed<number>(() => {
    if (!this.isCanvasMode()) return 1.0;
    const z = this.canvasZoom();
    if (!z || z <= 0.01) return 1.0;

    if (z >= 1.0) {
      // Zoom In: atenuación fuerte para mantener el HUD casi constante en pantalla (~1.1x máx a 5x zoom)
      const scale = 1 / Math.pow(z, 0.82);
      return Math.max(0.24, Math.min(1.0, scale));
    } else {
      // Zoom Out: atenuación moderada con tope ergonómico para cuadrículas amplias
      const scale = 1 / Math.pow(z, 0.45);
      return Math.max(1.0, Math.min(1.85, scale));
    }
  });

  /**
   * Factor de escala compensado específico para el dock vertical de acciones (.feed-actions-vertical-dock):
   * - En Zoom In (z >= 1.0): Aplica atenuación para mantener tamaño ergonómico constante en pantalla.
   * - En Zoom Out (z < 1.0): Se tope en 1.85 (86% de la altura de la celda) para no desbordar ni cortarse jamás.
   */
  readonly dockCompensatedScale = computed<number>(() => {
    if (!this.isCanvasMode()) return 1.85;
    const uiScale = this.uiCompensatedScale();
    return Math.min(uiScale, 1.0) * 1.85;
  });

  /**
   * Factor de escala compensado específico para el badge de analítica (.canvas-slot-badge-bottom-left):
   * - En Zoom In (z >= 1.5): Mantiene tamaño constante y legible en pantalla.
   * - Por debajo de 150% (z < 1.5): Se congela la escala relativa a la celda (~1.18x) para no crecer
   *   dentro de la tarjeta y encogerse armónicamente con ella.
   */
  readonly badgeCompensatedScale = computed<number>(() => {
    if (!this.isCanvasMode()) return 1.18;
    const uiScale = this.uiCompensatedScale();
    const uiScaleAt150 = 1 / Math.pow(1.5, 0.82); // ~0.7175
    return Math.min(uiScale, uiScaleAt150) * 1.65;
  });

  /**
   * Factor de escala compensado específico para la fecha y hora (.canvas-slot-time-bottom-right):
   * - En Zoom >= 75% (z >= 0.75): Mantiene tamaño constante y legible en pantalla.
   * - Por debajo de 75% (z < 0.75): Se congela la escala relativa a la celda (~1.14x) para no seguir
   *   creciendo dentro de la tarjeta y encogerse armónicamente con ella.
   */
  readonly timeCompensatedScale = computed<number>(() => {
    if (!this.isCanvasMode()) return 1.0;
    const uiScale = this.uiCompensatedScale();
    const uiScaleAt75 = 1 / Math.pow(0.75, 0.45); // ~1.1383
    return Math.min(uiScale, uiScaleAt75);
  });

  /**
   * Factor de escala compensado específico para celdas vacías (.empty-slot-content):
   * - En Zoom In (z >= 1.0): Atenuación para mantener el botón '+' y texto 'Agregar' ergonómicos.
   * - En Zoom Out (z < 1.0): Se congela en 1.0 para que no crezca relativo a la celda y se encoja
   *   armónicamente sin tocar los bordes.
   */
  readonly emptySlotCompensatedScale = computed<number>(() => {
    if (!this.isCanvasMode()) return 1.0;
    const uiScale = this.uiCompensatedScale();
    return Math.min(uiScale, 1.0);
  });

  /**
   * Nivel de detalle semántico (LOD) del lienzo:
   * - 'compact': Zoom out extremo (< 45%), simplifica controles para vista panorámica
   * - 'normal': Vista estándar interactiva (45% a 170%)
   * - 'detailed': Inspección de alta magnificación (> 170%)
   */
  readonly canvasLodMode = computed<'compact' | 'normal' | 'detailed'>(() => {
    if (!this.isCanvasMode()) return 'normal';
    const z = this.canvasZoom();
    if (z < 0.45) return 'compact';
    if (z > 1.35) return 'detailed';
    return 'normal';
  });

  readonly isRightPanelCollapsed = signal<boolean>(false);
  private canvasActivityTimer: any = null;

  // Zen Mode & Canvas Dropup Menu Signals
  readonly isZenMode = signal<boolean>(false);
  readonly isZenHintVisible = signal<boolean>(false);
  readonly showCanvasMenuDropdown = signal<boolean>(false);
  private zenHintTimeout: any = null;

  // Off-screen Viewport Throttling Signal & Observer
  readonly offscreenSlotIds = signal<Set<string>>(new Set());
  private offscreenObserver: IntersectionObserver | null = null;

  // Box Selection (Recuadro de Selección por Clic + Arrastre) Signals & Sync State
  readonly isSyncMode = this.monitoringStateService.isSyncMode;
  readonly isBoxSelecting = signal<boolean>(false);
  readonly selectionBox = signal<{ x: number; y: number; width: number; height: number } | null>(null);
  readonly selectedCanvasSlotIds = this.monitoringStateService.selectedCanvasSlotIds;

  // Pilas Undo / Redo
  readonly undoStack = this.monitoringStateService.undoStack;
  readonly redoStack = this.monitoringStateService.redoStack;

  // Camera Fullscreen Overlay Signal & Origin Animation
  readonly fullscreenSlot = signal<GridSlot | null>(null);
  readonly fullscreenTransformOrigin = signal<string>('center center');

  // --- Bridge Methods para CameraGridCanvasComponent ---
  readonly getCameraAnalyticsBound = (camera: Camera) => this.getCameraAnalytics(camera);
  readonly isSlotInPlaybackModeBound = (slot: GridSlot) => this.isSlotInPlaybackMode(slot);
  readonly isFeedPausedBound = (cameraName: string) => this.isFeedPaused(cameraName);
  readonly isSlotDimmedBound = (slot: GridSlot) => this.isSlotDimmed(slot);
  // --- Bridge Methods para MonitoringTimelineComponent ---
  readonly getAnalyticColorBound = (type: string): string => this.getAnalyticColor(type);

  onTimelineTimeChange(date: Date): void {
    this.currentTimePointer.set(date);
  }

  onTimelinePlaybackModeChange(mode: 'live' | 'playback'): void {
    this.playbackMode.set(mode);
    if (mode === 'live') {
      this.selectedFlagId.set(null);
      this.selectedCanvasSlotIds.set(new Set());
      this.highlightedCellCameraName.set(null);
    }
  }

  onTimelinePausedChange(paused: boolean): void {
    this.paused.set(paused);
  }

  onTimelinePlaybackWindowEndChange(end: Date | null): void {
    this.playbackWindowEnd.set(end);
  }

  onTimelineFlagClick(data: { event: EventRecord; count: number; nativeEvent?: MouseEvent }): void {
    this.toggleTimelineFlag(data.event, data.count, data.nativeEvent);
  }

  onTimelineZoomChange(zoomSeconds: number): void {
    this.zoomRangeSeconds.set(zoomSeconds);
  }


  onSharedSlotClick(data: { slot: GridSlot; event: MouseEvent }): void {
    if (data.slot.isEmpty) {
      this.openSelectionModal(data.slot.col, data.slot.row, 'slot');
    }
  }

  onSharedSlotDblClick(data: { slot: GridSlot; event: MouseEvent }): void {
    if (!data.slot.isEmpty) {
      this.openFullscreen(data.slot, data.event);
    }
  }

  onSharedSlotMouseDown(data: { slot: GridSlot; event: MouseEvent; index: number }): void {
    if (!data.slot.isEmpty) {
      this.onSlotMouseDown(data.slot, data.event, data.index);
    }
  }

  onSharedExpanderClick(data: { col: number; row: number; type: 'add-column' | 'add-row' }): void {
    this.openSelectionModal(data.col, data.row, data.type);
  }

  toggleZenMode(): void {
    const next = !this.isZenMode();
    this.isZenMode.set(next);
    this.showCanvasMenuDropdown.set(false);
    if (next) {
      this.isRightPanelCollapsed.set(true);
      document.body.classList.add('zen-mode-active');
      this.isZenHintVisible.set(true);
      if (this.zenHintTimeout) clearTimeout(this.zenHintTimeout);
      this.zenHintTimeout = setTimeout(() => {
        this.isZenHintVisible.set(false);
        this.zenHintTimeout = null;
      }, 3200);
    } else {
      document.body.classList.remove('zen-mode-active');
      this.isZenHintVisible.set(false);
      if (this.zenHintTimeout) {
        clearTimeout(this.zenHintTimeout);
        this.zenHintTimeout = null;
      }
    }
    this.showToast(next ? '🖥️ Modo Zen activado (Pantalla completa)' : 'Modo estándar restaurado', 'primary');
    setTimeout(() => this.resetCanvas(), 100);
  }

  toggleCanvasMenuDropdown(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.showCanvasMenuDropdown.update(v => !v);
  }

  closeCanvasMenuDropdown(): void {
    this.showCanvasMenuDropdown.set(false);
  }

  checkSlotMarquee(cardEl: HTMLElement): void {
    if (!cardEl) return;
    const titleEl = cardEl.querySelector('.slot-camera-name') as HTMLElement | null;
    const containerEl = cardEl.querySelector('.slot-camera-name-container') as HTMLElement | null;
    if (!titleEl || !containerEl) return;

    // Medir ancho visible del contenedor y longitud real de texto
    const availableWidth = containerEl.clientWidth;
    const textWidth = titleEl.scrollWidth;

    if (textWidth > (availableWidth + 2) && availableWidth > 0) {
      const shift = Math.ceil(textWidth - availableWidth) + 20;
      titleEl.style.setProperty('--marquee-shift', `-${shift}px`);
      cardEl.classList.add('camera-title-needs-marquee');
    } else {
      titleEl.style.removeProperty('--marquee-shift');
      cardEl.classList.remove('camera-title-needs-marquee');
    }
  }

  clearSlotMarquee(cardEl: HTMLElement): void {
    if (!cardEl) return;
    cardEl.classList.remove('camera-title-needs-marquee');
    const titleEl = cardEl.querySelector('.slot-camera-name') as HTMLElement | null;
    if (titleEl) {
      titleEl.style.removeProperty('--marquee-shift');
    }
  }

  onSlotMouseEnter(cardEl: HTMLElement): void {
    this.checkSlotMarquee(cardEl);
  }

  onSlotMouseLeave(cardEl: HTMLElement): void {
    this.clearSlotMarquee(cardEl);
  }


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
    } else if (this.showCanvasMenuDropdown()) {
      this.showCanvasMenuDropdown.set(false);
    } else if (this.isZenMode()) {
      this.isZenMode.set(false);
      this.isZenHintVisible.set(false);
      if (this.zenHintTimeout) clearTimeout(this.zenHintTimeout);
      document.body.classList.remove('zen-mode-active');
      this.showToast('Modo estándar restaurado', 'primary');
      setTimeout(() => this.resetCanvas(), 100);
    }
  }

  showZenHintDirectly(): void {
    if (!this.isZenMode()) return;
    if (this.zenHintTimeout) {
      clearTimeout(this.zenHintTimeout);
      this.zenHintTimeout = null;
    }
    if (!this.isZenHintVisible()) {
      this.isZenHintVisible.set(true);
    }
  }

  hideZenHintDirectly(): void {
    if (!this.isZenMode()) return;
    if (!this.zenHintTimeout && this.isZenHintVisible()) {
      this.isZenHintVisible.set(false);
    }
  }

  @HostListener('window:mousemove', ['$event'])
  handleZenTopMouseMove(event: MouseEvent): void {
    if (!this.isZenMode()) return;
    const clientY = event.clientY;
    if (clientY <= 120) {
      this.showZenHintDirectly();
    } else if (clientY > 160) {
      this.hideZenHintDirectly();
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



  // Player & Timeline States
  readonly playbackMode = signal<'live' | 'playback'>('live');
  readonly paused = signal<boolean>(false);
  readonly playbackSpeed = signal<number>(1);
  readonly zoomRangeSeconds = signal<number>(86400); // 24 horas por defecto
  readonly currentTimePointer = signal<Date>(new Date());
  readonly playbackWindowEnd = signal<Date | null>(null);


  // Collections
  readonly allCameras = this.cameraService.cameras;
  readonly allHosts = this.hostService.allHosts;
  readonly eventsList = this.monitoringStateService.eventsList;
  readonly bufferedEvents = signal<EventRecord[]>([]);
  readonly latestEventsMap = this.monitoringStateService.latestEventsMap;
  readonly isLoadingEvents = signal<boolean>(false);

  // Individual feed configurations (Delegados a MonitoringStreamService)
  readonly activeAiOverlays = this.streamService.activeAiOverlays;
  readonly activeRecStatuses = this.streamService.activeRecStatuses;
  readonly flashEffects = this.streamService.flashEffects;

  refreshCameraStream(slot: GridSlot, event?: MouseEvent): void {
    this.streamService.refreshCameraStream(slot, event);
  }



  // Highlight effect
  readonly highlightedCellCameraName = signal<string | null>(null);

  // Logs Feed Control
  readonly isLogsFeedPaused = signal<boolean>(false);

  // UI Tabs & Toggles
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

  // Sidebar filter panel visibility
  readonly showSidebarFilters = signal<boolean>(false);
  readonly hasActiveSidebarFilters = computed(() =>
    this.eventAnalyticFilter() !== 'all'
  );

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
      target.style.opacity = '0';
    }
  }

  onImageLoad(event: Event): void {
    const target = event.target as HTMLElement;
    if (target) {
      target.style.display = '';
      target.style.opacity = '1';
    }
  }

  // Sidebar state
  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  private wsSubscription?: Subscription;
  private timelineTimer: any;

  constructor() {
    // Re-evaluar dinámicamente el marquee de tarjetas en hover cuando cambia el zoom o la escala del lienzo
    effect(() => {
      this.uiCompensatedScale();
      this.canvasZoom();

      if (this.marqueeZoomRaf !== null) {
        cancelAnimationFrame(this.marqueeZoomRaf);
      }

      this.marqueeZoomRaf = requestAnimationFrame(() => {
        this.marqueeZoomRaf = null;
        const hoveredCard = document.querySelector('.grid-slot-cell:hover') as HTMLElement | null;

        // Limpiar marquee en cualquier tarjeta que ya no esté bajo hover
        document.querySelectorAll('.grid-slot-cell.camera-title-needs-marquee').forEach(el => {
          if (el !== hoveredCard) {
            this.clearSlotMarquee(el as HTMLElement);
          }
        });

        // Evaluar la tarjeta actualmente bajo el cursor
        if (hoveredCard) {
          this.checkSlotMarquee(hoveredCard);
        }
      });
    });

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



    // Cargar eventos históricos SOLO cuando realmente se agregan nuevas cámaras al lienzo o cambia la fecha manual
    let lastCameraIdSet = new Set<string>();
    let lastEventsQueryKey = '';

    effect(() => {
      const activeCams = this.gridSlots()
        .map(s => s.camera)
        .filter((c): c is Camera => c !== null);

      const currentIds = Array.from(new Set(activeCams.map(c => c.id))).sort();
      const currentIdSet = new Set(currentIds);
      const key = currentIds.join(',');
      const manualDate = this.selectedManualDate();
      const manualDateTime = manualDate ? manualDate.getTime() : 0;
      const queryKey = `${key}_${manualDateTime}`;

      if (!key) {
        lastEventsQueryKey = '';
        lastCameraIdSet.clear();
        this.eventsList.set([]);
        this.latestEventsMap.set({});
        return;
      }

      // Si el conjunto de cámaras y la fecha no han cambiado (ej. solo cambio de posición/swap), no hacer nada
      if (queryKey === lastEventsQueryKey) {
        return;
      }

      // CASO 1: Si solo se ELIMINARON cámaras (el conjunto actual es un subconjunto estricto del anterior con la misma fecha)
      const isOnlyRemoval = lastEventsQueryKey.endsWith(`_${manualDateTime}`) &&
        lastCameraIdSet.size > 0 &&
        currentIds.every(id => lastCameraIdSet.has(id)) &&
        currentIds.length < lastCameraIdSet.size;

      if (isOnlyRemoval) {
        lastEventsQueryKey = queryKey;
        lastCameraIdSet = currentIdSet;

        const activeCamNamesSet = new Set(activeCams.map(c => c.name.trim().toLowerCase()));
        const activeCamIdsSet = new Set(activeCams.map(c => c.id));

        // Filtrar en memoria instantáneamente SIN petición de red ni spinner de carga
        this.eventsList.update(list => list.filter(e => {
          const matchName = e.nombreCamara && activeCamNamesSet.has(e.nombreCamara.trim().toLowerCase());
          const matchId = e.idCamara && activeCamIdsSet.has(e.idCamara);
          return matchName || matchId;
        }));

        this.latestEventsMap.update(map => {
          const nextMap: Record<string, EventRecord> = {};
          Object.entries(map).forEach(([k, evt]) => {
            const matchName = evt.nombreCamara && activeCamNamesSet.has(evt.nombreCamara.trim().toLowerCase());
            const matchId = evt.idCamara && activeCamIdsSet.has(evt.idCamara);
            if (matchName || matchId) {
              nextMap[k] = evt;
            }
          });
          return nextMap;
        });
        return;
      }

      lastEventsQueryKey = queryKey;
      lastCameraIdSet = currentIdSet;

      // CASO 2: Se agregaron cámaras nuevas o cambió la fecha manual -> Consultar sin borrar la lista previa si ya hay elementos
      let start: Date;
      let end: Date;
      if (!manualDate) {
        end = new Date();
        start = new Date(end.getTime() - 24 * 3600 * 1000);
      } else {
        start = new Date(manualDate.getFullYear(), manualDate.getMonth(), manualDate.getDate(), 0, 0, 0, 0);
        end = new Date(manualDate.getFullYear(), manualDate.getMonth(), manualDate.getDate(), 23, 59, 59, 999);
      }

      const cameraNames = Array.from(new Set(activeCams.map(c => c.name)));
      if (this.eventsList().length === 0) {
        this.isLoadingEvents.set(true);
      }

      this.eventRepository.search({
        search: '',
        camaras: cameraNames,
        analiticas: [],
        objetos: [],
        timestampDesde: start,
        timestampHasta: end
      }, 1, 10000).subscribe({
        next: (res) => {
          const recordsWithMs = res.records.map(r => {
            r.timestampMs = r.timestampMs || new Date(r.timestamp).getTime();
            return r;
          });
          this.eventsList.set(recordsWithMs);
          this.pruneEventsOlderThan24h();
          this.isLoadingEvents.set(false);

          // Rellenar mapa de últimos eventos de forma insensible a mayúsculas/minúsculas y por ID/Nombre
          const latestMap: Record<string, EventRecord> = {};
          res.records.forEach(r => {
            if (r.nombreCamara) {
              if (!latestMap[r.nombreCamara]) latestMap[r.nombreCamara] = r;
              const lowerName = r.nombreCamara.trim().toLowerCase();
              if (!latestMap[lowerName]) latestMap[lowerName] = r;
            }
            if (r.idCamara) {
              if (!latestMap[r.idCamara]) latestMap[r.idCamara] = r;
            }
          });
          this.latestEventsMap.set(latestMap);
        },
        error: (err) => {
          console.error('[Monitoreo] Error al cargar histórico de eventos:', err);
          this.isLoadingEvents.set(false);
        }
      });
    }, { allowSignalWrites: true });

    // Sincronizar conexiones de WebRTC activas basadas en las celdas ocupadas
    effect(() => {
      this.streamService.syncWebRtcConnections(
        this.gridSlots(),
        this.draggingSlotId() !== null,
        this.resizingSlotId() !== null
      );
    });

    // Sincronizar eventos WebSocket (webrtc_start y webrtc_stop) cuando cambian las cámaras del lienzo
    effect(() => {
      this.streamService.syncWebSocketCameras(this.gridSlots());
    }, { allowSignalWrites: true });
  }

  readonly liveTickerClock = signal<Date>(new Date());

  ngOnInit(): void {
    this.monitoringStateService.onEnterMonitoreo();
    this.cameraService.isViewActive.set(true);
    this.analyticService.isViewActive.set(true);
    this.hostService.isViewActive.set(true);
    this.eventService.isViewActive.set(true);

    this.cameraService.getAllCameras().subscribe();
    this.hostService.loadAllHosts().subscribe();
    this.analyticService.getAllAnalytics().subscribe();

    this.setupWebSocketSubscription();
    this.resetCanvasActivityTimer();

    // Si ya existen conexiones previas con MediaStream, re-adjuntarlas a los elementos de video
    setTimeout(() => {
      for (const slot of this.gridSlots()) {
        if (slot.camera) {
          const videoId = `video-feed-${slot.id}`;
          const videoEl = document.getElementById(videoId) as HTMLVideoElement;
          if (videoEl) {
            this.monitoringStateService.attachStreamToVideo(slot.id, videoEl);
          }
        }
      }
    }, 150);
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
    if (this.selectedManualDate()) return;

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

  @HostListener('window:resize')
  onWindowResize(): void {
    const container = document.querySelector('.monitoring-grid-container');
    if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      this.monitoringStateService.monitoreoViewportSize.set({
        width: container.clientWidth,
        height: container.clientHeight
      });
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      const container = document.querySelector('.monitoring-grid-container');
      if (container && container.clientWidth > 0 && container.clientHeight > 0) {
        this.monitoringStateService.monitoreoViewportSize.set({
          width: container.clientWidth,
          height: container.clientHeight
        });
      }

      const currentZoom = this.canvasZoom();
      if (!currentZoom || currentZoom <= 0.05) {
        this.resetCanvas();
      }
      this.setupOffscreenObserver();
    }, 150);
  }

  /**
   * Configura un IntersectionObserver para detectar qué cámaras quedan fuera del viewport visible
   * en modo lienzo (paneo/zoom) y pausar su decodificación de video para ahorrar CPU/GPU.
   */
  setupOffscreenObserver(): void {
    if (typeof IntersectionObserver === 'undefined') return;
    const container = document.querySelector('.monitoring-grid-container');
    if (!container) return;

    this.offscreenObserver?.disconnect();
    this.offscreenObserver = new IntersectionObserver((entries) => {
      // Ignorar eventos durante la animación activa de zoom/pan para evitar parpadeo y recarga de videos
      if (this.isCanvasAnimating()) return;

      const currentOffscreen = new Set(this.offscreenSlotIds());
      let changed = false;

      entries.forEach(entry => {
        const slotId = entry.target.getAttribute('data-id');
        if (!slotId) return;

        const videoEl = entry.target.querySelector('video') as HTMLVideoElement;
        if (!entry.isIntersecting) {
          if (!currentOffscreen.has(slotId)) {
            currentOffscreen.add(slotId);
            changed = true;
            if (videoEl && !videoEl.paused) {
              videoEl.pause();
            }
          }
        } else {
          if (currentOffscreen.has(slotId)) {
            currentOffscreen.delete(slotId);
            changed = true;
            if (videoEl && videoEl.paused) {
              videoEl.play().catch(() => {});
            }
          }
        }
      });

      if (changed) {
        this.offscreenSlotIds.set(currentOffscreen);
      }
    }, {
      root: container,
      rootMargin: '120px', // Buffer de precarga para transiciones suaves al mover el lienzo
      threshold: 0.01
    });

    // Observar cada celda del grid
    document.querySelectorAll('.grid-slot-cell').forEach(cell => {
      this.offscreenObserver?.observe(cell);
    });
  }

  ngOnDestroy(): void {
    if (this.offscreenObserver) {
      this.offscreenObserver.disconnect();
      this.offscreenObserver = null;
    }

    this.cameraService.isViewActive.set(false);
    this.analyticService.isViewActive.set(false);
    this.hostService.isViewActive.set(false);
    this.eventService.isViewActive.set(false);

    if (this.wsSubscription) {
      this.wsSubscription.unsubscribe();
    }
    if (this.timelineTimer) {
      clearInterval(this.timelineTimer);
    }
    if (this.canvasActivityTimer) {
      clearTimeout(this.canvasActivityTimer);
    }
    if (this.zenHintTimeout) {
      clearTimeout(this.zenHintTimeout);
    }
    if (this.marqueeZoomRaf !== null) {
      cancelAnimationFrame(this.marqueeZoomRaf);
    }

    document.body.classList.remove('zen-mode-active');

    // Delegar ciclo de vida de salida a MonitoringStateService
    this.monitoringStateService.onLeaveMonitoreo();
  }

  startWebRtcStreamByKey(slot: GridSlot, connKey: string): Promise<void> {
    return this.streamService.startWebRtcStreamByKey(slot, connKey);
  }

  stopWebRtcStreamByKey(connKey: string): void {
    this.streamService.stopWebRtcStreamByKey(connKey);
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
    const isCanvas = this.isCanvasMode();
    if (isCanvas) {
      // En modo lienzo, dimensiones base fijas (16:9) para consistencia absoluta en transformaciones
      const cellW = 280;
      const cellH = 158;
      return { cellW, cellH };
    }

    const gridContainer = document.querySelector('.monitoring-grid-container');
    if (!gridContainer) return { cellW: 240, cellH: 135 };

    const colsVal = this.cols();
    const rowsVal = this.rows();

    const totalWidth = gridContainer.clientWidth - 20;
    const availableWidth = totalWidth - (colsVal - 1) * 12;
    const cellW = availableWidth / colsVal;

    const totalHeight = gridContainer.clientHeight - 20;
    const availableHeight = totalHeight - (rowsVal - 1) * 12;
    const cellH = availableHeight / rowsVal;

    return { cellW, cellH };
  }

  getExtenderDimensions(): { width: number; height: number; fontSize: number; iconSize: number } {
    const isCanvas = this.isCanvasMode();
    if (!isCanvas) {
      return { width: 44, height: 44, fontSize: 11, iconSize: 14 };
    }
    const z = Math.max(0.05, this.canvasZoom());
    const { cellW } = this.getCellDimensions();

    // Amortiguación moderada: evita distorsiones drásticas de la cuadrícula
    const scaleFactor = 1 / Math.pow(z, 0.4);

    // Bounding estricto del grosor del track en canvas (entre 32px y 56px, máx 22% de celda)
    const maxThickness = Math.max(40, Math.min(56, Math.round(cellW * 0.22)));
    const thickness = Math.max(32, Math.min(maxThickness, Math.round(44 * Math.min(scaleFactor, 1.25))));

    // Tipografía e icono legibles y acotados
    const fontSize = Math.max(10, Math.min(13, Math.round(11 * Math.min(scaleFactor, 1.2))));
    const iconSize = Math.max(13, Math.min(18, Math.round(14 * Math.min(scaleFactor, 1.25))));

    return { width: thickness, height: thickness, fontSize, iconSize };
  }

  getCanvasDimensions(): { width: number; height: number } {
    const { cellW, cellH } = this.getCellDimensions();
    const colsVal = this.cols();
    const rowsVal = this.rows();

    const showColExpander = this.isCanvasMode() && !this.isCanvasPinned() && this.activeHoveredExpander() !== 'column' && this.activeHoveredExpander() !== 'both';
    const showRowExpander = this.isCanvasMode() && !this.isCanvasPinned() && this.activeHoveredExpander() !== 'row' && this.activeHoveredExpander() !== 'both';
    const extDim = this.getExtenderDimensions();
    const draggingOffsetW = showColExpander ? extDim.width : 0;
    const draggingOffsetH = showRowExpander ? extDim.height : 0;

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

  getMinimapAspectRatio(): string {
    const world = this.getMinimapWorldBounds();
    if (!world || !world.height || world.height === 0) return '16 / 9';
    const ratio = world.width / world.height;
    const clampedRatio = Math.max(0.5, Math.min(2.5, ratio));
    return `${clampedRatio.toFixed(3)}`;
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

  animateFitCanvas(durationMs: number = 480): void {
    const gridContainer = document.querySelector('.monitoring-grid-container') as HTMLElement;
    if (!gridContainer) return;

    const { cellW, cellH } = this.getCellDimensions();
    const colsVal = Math.max(1, this.cols());
    const rowsVal = Math.max(1, this.rows());

    const totalW = colsVal * cellW + (colsVal - 1) * 12 + 20;
    const totalH = rowsVal * cellH + (rowsVal - 1) * 12 + 20;
    const viewportW = gridContainer.clientWidth;
    const viewportH = gridContainer.clientHeight;

    if (totalW === 0 || totalH === 0 || viewportW === 0 || viewportH === 0) return;

    const padding = 0.94; // 6% margen de seguridad
    const zoomToFitX = (viewportW * padding) / totalW;
    const zoomToFitY = (viewportH * padding) / totalH;
    const targetZoom = Math.max(0.05, Math.min(3.0, zoomToFitX, zoomToFitY));

    const targetPanX = (viewportW - totalW * targetZoom) / 2;
    const targetPanY = (viewportH - totalH * targetZoom) / 2;

    if (this.canvasAnimationTimeout) {
      clearTimeout(this.canvasAnimationTimeout);
    }

    this.isCanvasAnimating.set(true);

    requestAnimationFrame(() => {
      this.canvasZoom.set(targetZoom);
      this.canvasPanX.set(targetPanX);
      this.canvasPanY.set(targetPanY);
    });

    this.canvasAnimationTimeout = setTimeout(() => {
      this.isCanvasAnimating.set(false);
      this.canvasAnimationTimeout = null;
    }, durationMs + 50);
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
    const willCollapse = !this.isRightPanelCollapsed();
    this.isRightPanelCollapsed.set(willCollapse);
    this.isCanvasAnimating.set(true);

    const gridContainer = document.querySelector('.monitoring-grid-container') as HTMLElement;
    const rightPanel = document.querySelector('.monitoring-right-panel') as HTMLElement;

    if (gridContainer && rightPanel) {
      const currentViewportW = gridContainer.clientWidth;
      const currentViewportH = gridContainer.clientHeight;
      const currentRightW = rightPanel.offsetWidth;

      // Calcular el ancho proyectado del viewport con base en el nuevo estado del panel
      const collapsedRightW = Math.max(38, Math.round(window.innerWidth * 0.025));
      const expandedRightW = Math.max(352, Math.min(512, Math.round(window.innerWidth * 0.30)));
      const deltaW = willCollapse ? (currentRightW - collapsedRightW) : (collapsedRightW - expandedRightW);
      const projectedViewportW = Math.max(100, currentViewportW + deltaW);

      const { cellW, cellH } = this.getCellDimensions();
      const colsVal = Math.max(1, this.cols());
      const rowsVal = Math.max(1, this.rows());
      const totalW = colsVal * cellW + (colsVal - 1) * 12 + 20;
      const totalH = rowsVal * cellH + (rowsVal - 1) * 12 + 20;

      if (totalW > 0 && totalH > 0 && projectedViewportW > 0 && currentViewportH > 0) {
        const padding = 0.94;
        const zoomToFitX = (projectedViewportW * padding) / totalW;
        const zoomToFitY = (currentViewportH * padding) / totalH;
        const targetZoom = Math.max(0.05, Math.min(3.0, zoomToFitX, zoomToFitY));

        const targetPanX = (projectedViewportW - totalW * targetZoom) / 2;
        const targetPanY = (currentViewportH - totalH * targetZoom) / 2;

        requestAnimationFrame(() => {
          this.canvasZoom.set(targetZoom);
          this.canvasPanX.set(targetPanX);
          this.canvasPanY.set(targetPanY);
        });
      }
    }

    if (this.canvasAnimationTimeout) {
      clearTimeout(this.canvasAnimationTimeout);
    }
    // Conclusión precisa y limpia en un solo movimiento sin rebote
    this.canvasAnimationTimeout = setTimeout(() => {
      this.isCanvasAnimating.set(false);
      this.canvasAnimationTimeout = null;
    }, 390);
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

    this.recalculateGridDimensions(true);
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

    this.recalculateGridDimensions(true);
    this.showToast('Cambio rehecho', 'primary');
  }

  // --- Manejo Global de Teclado (Delete / Suprimir para eliminación masiva, Ctrl+Z / Ctrl+Y para Undo/Redo) ---
  @HostListener('window:keydown', ['$event'])
  onGlobalKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable || target.closest('input, textarea, select, .modal, app-camera-detail-drawer, .drawer-container, [class*="drawer"]'))) {
      return;
    }

    // Ignorar atajos de monitoreo si el drawer de detalle/analítica de cámara está abierto
    if (this.showCameraConfigDrawer()) {
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

      const suppressContextMenu = (e: Event) => {
        e.preventDefault();
        e.stopPropagation();
      };
      window.addEventListener('contextmenu', suppressContextMenu, { capture: true, once: true });

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
        window.removeEventListener('blur', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      window.addEventListener('blur', onMouseUp, { once: true });
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

  private zoomToPoint(nextZoom: number, clientX: number, clientY: number, containerEl?: HTMLElement | null): void {
    const minZoom = this.getMinZoom();
    const clampedZoom = Math.max(minZoom, Math.min(5.0, nextZoom));
    const currentZoom = this.canvasZoom();

    const targetEl = containerEl || (document.querySelector('.monitoring-grid-container') as HTMLElement);
    if (!targetEl) {
      this.canvasZoom.set(clampedZoom);
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const canvasX = (mouseX - this.canvasPanX()) / currentZoom;
    const canvasY = (mouseY - this.canvasPanY()) / currentZoom;

    const newPanX = mouseX - canvasX * clampedZoom;
    const newPanY = mouseY - canvasY * clampedZoom;

    const constrained = this.constrainPan(newPanX, newPanY, clampedZoom);

    this.canvasZoom.set(clampedZoom);
    this.canvasPanX.set(constrained.x);
    this.canvasPanY.set(constrained.y);
  }

  onCanvasWheel(event: WheelEvent): void {
    if (!this.isCanvasMode() || this.isCanvasPinned()) return;
    event.preventDefault();

    // Si no hay variación vertical relevante, ignorar
    if (event.deltaY === 0) return;

    let zoomDelta = 0;

    if (event.ctrlKey) {
      // Gesto pinch-to-zoom en touchpad/trackpad
      zoomDelta = -(event.deltaY) * 0.01;
    } else if (event.deltaMode === WheelEvent.DOM_DELTA_LINE || Math.abs(event.deltaY) >= 80) {
      // Rueda discreta de ratón físico (pasos estándar ±100, ±120 o DOM_DELTA_LINE)
      zoomDelta = event.deltaY < 0 ? 0.08 : -0.08;
    } else {
      // Scroll continuo suave de touchpad/trackpad: solo zoom progresivo proporcional, CERO desplazamiento de lienzo
      zoomDelta = -(event.deltaY) * 0.0012;
    }

    // Acotar el incremento unitario de zoom para garantizar transiciones fluidas y controladas
    zoomDelta = Math.max(-0.12, Math.min(0.12, zoomDelta));

    const currentZoom = this.canvasZoom();
    const nextZoom = currentZoom + zoomDelta;
    const gridContainer = (event.currentTarget || document.querySelector('.monitoring-grid-container')) as HTMLElement;
    this.zoomToPoint(nextZoom, event.clientX, event.clientY, gridContainer);
  }

  onCanvasContextMenu(event: MouseEvent): void {
    if (this.isCanvasMode()) {
      event.preventDefault();
      event.stopPropagation();
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

  getOptimalColumnsForCount(N: number): number {
    if (N <= 1) return 1;
    if (N <= 2) return 2;
    if (N <= 4) return 2;
    if (N <= 6) return 3;
    if (N <= 9) return 3;
    if (N <= 12) return 4;
    if (N <= 16) return 4;
    if (N <= 20) return 5;
    if (N <= 25) return 5;
    if (N <= 30) return 6;
    if (N <= 36) return 6;
    if (N <= 42) return 7;
    if (N <= 49) return 7;
    if (N <= 56) return 8;
    if (N <= 64) return 8;
    if (N <= 72) return 9;
    if (N <= 81) return 9;
    return Math.ceil(Math.sqrt(N * 1.2));
  }

  /**
   * Compacta y optimiza la distribución del lienzo eliminando huecos vacíos
   * y reorganizando todas las cámaras activas en una cuadrícula óptima balanceada (16:9 / cuadrada).
   */
  autoPackGrid(): void {
    const occupiedSlots = this.gridSlots().filter(s => s.camera !== null);
    if (occupiedSlots.length === 0) {
      this.showToast('No hay cámaras en el lienzo para compactar', 'warning');
      return;
    }

    this.saveStateToHistory();

    const N = occupiedSlots.length;
    const C = this.getOptimalColumnsForCount(N);
    const R = Math.max(1, Math.ceil(N / C));

    // Ordenar cámaras de forma natural (fila por fila, de izquierda a derecha) para preservar el orden visual
    const sortedCams = [...occupiedSlots].sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    const newSlots: GridSlot[] = sortedCams.map((slot, i) => {
      const col = (i % C) + 1;
      const row = Math.floor(i / C) + 1;
      return {
        ...slot,
        col,
        row,
        spanX: 1,
        spanY: 1
      };
    });

    this.gridSlots.set(newSlots);
    this.recalculateGridDimensions(true);
    this.showToast(`Lienzo optimizado y compactado (${C}x${R})`, 'success');
  }

  recalculateGridDimensions(animate: boolean = false): void {
    this.compressGrid();

    const slots = this.gridSlots();
    const occupied = slots.filter(s => s.camera !== null);
    if (occupied.length === 0) {
      this.cols.set(1);
      this.rows.set(1);
      if (animate) {
        this.animateFitCanvas();
      } else {
        this.resetCanvas();
      }
      return;
    }

    const dims = this.getDimensionsForArray(occupied);
    this.cols.set(dims.cols);
    this.rows.set(dims.rows);

    if (animate) {
      this.animateFitCanvas();
    } else {
      // Ajustar zoom actual si el lienzo se encoge y excede el zoom mínimo dinámico
      const minZoom = this.getMinZoom();
      if (this.canvasZoom() < minZoom) {
        this.canvasZoom.set(minZoom);
        const constrained = this.constrainPan(this.canvasPanX(), this.canvasPanY(), minZoom);
        this.canvasPanX.set(constrained.x);
        this.canvasPanY.set(constrained.y);
      }
    }

    setTimeout(() => this.setupOffscreenObserver(), animate ? 550 : 120);
  }

  compressGrid(): void {
    const slots = this.gridSlots();
    const occupiedSlots = slots.filter(s => s.camera !== null);

    if (occupiedSlots.length === 0) {
      this.gridSlots.set([
        { id: 'slot-1-1', camera: null, col: 1, row: 1, spanX: 1, spanY: 1 }
      ]);
      this.cols.set(1);
      this.rows.set(1);
      return;
    }

    // 1. Desplazar columnas hacia la izquierda si hay columnas vacías intermedias o iniciales
    let changed = true;
    while (changed) {
      changed = false;
      const maxCol = Math.max(...occupiedSlots.map(s => s.col + s.spanX - 1));
      for (let c = 1; c <= maxCol; c++) {
        const colHasCamera = occupiedSlots.some(s => s.col <= c && (s.col + s.spanX - 1) >= c);
        if (!colHasCamera) {
          occupiedSlots.forEach(s => {
            if (s.col > c) s.col -= 1;
          });
          changed = true;
          break;
        }
      }
    }

    // 2. Desplazar filas hacia arriba si hay filas vacías intermedias o iniciales
    changed = true;
    while (changed) {
      changed = false;
      const maxRow = Math.max(...occupiedSlots.map(s => s.row + s.spanY - 1));
      for (let r = 1; r <= maxRow; r++) {
        const rowHasCamera = occupiedSlots.some(s => s.row <= r && (s.row + s.spanY - 1) >= r);
        if (!rowHasCamera) {
          occupiedSlots.forEach(s => {
            if (s.row > r) s.row -= 1;
          });
          changed = true;
          break;
        }
      }
    }

    const finalCols = Math.max(1, ...occupiedSlots.map(s => s.col + s.spanX - 1));
    const finalRows = Math.max(1, ...occupiedSlots.map(s => s.row + s.spanY - 1));

    this.gridSlots.set(occupiedSlots);
    this.cols.set(finalCols);
    this.rows.set(finalRows);
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

  // Resuelve solapamientos para arrastres grupales garantizando que las cámaras del grupo mantengan su posición exacta
  private resolveGroupOverlapConflicts(groupSlots: GridSlot[], slots: GridSlot[]): void {
    const occupied = new Set<string>();
    const colsLimit = Math.max(1, this.cols());
    const groupSlotIdSet = new Set(groupSlots.map(s => s.id));

    // 1. Reservar el espacio exacto de todas las cámaras del grupo
    groupSlots.forEach(gSlot => {
      for (let r = gSlot.row; r < gSlot.row + gSlot.spanY; r++) {
        for (let c = gSlot.col; c < gSlot.col + gSlot.spanX; c++) {
          occupied.add(`${r},${c}`);
        }
      }
    });

    // 2. Ordenar las cámaras ajenas al grupo para mantener estabilidad
    const nonGroupCams = slots.filter(s => !groupSlotIdSet.has(s.id) && s.camera !== null);
    nonGroupCams.sort((a, b) => {
      if (a.row !== b.row) return a.row - b.row;
      return a.col - b.col;
    });

    // 3. Reubicar únicamente las cámaras ajenas que colisionan con las reservadas por el grupo
    nonGroupCams.forEach(cam => {
      let col = cam.col;
      let row = cam.row;
      const cSpanX = cam.spanX;
      const cSpanY = cam.spanY;

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

    // Retornar celdas en orden estable sin re-ordenar el DOM para evitar desconexiones/recargas del pipeline de video
    return cells;
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

  // --- Arrastre por Mousedown con Clonación Ghost y Detección de Destino (Individual y en Grupo) ---
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

    // GUARDAR ESTADO ORIGINAL PARA PREVIEWS TEMPORALES
    const backupSlots = this.gridSlots().map(s => ({ ...s }));
    const originalCols = this.cols();
    const originalRows = this.rows();

    // Detección de arrastre en grupo si la celda pertenece a una multiselección activa
    const selectedIds = this.selectedCanvasSlotIds();
    const isSlotInSelection = selectedIds.has(slot.id);
    const groupSlots = (isSlotInSelection && selectedIds.size > 1)
      ? backupSlots.filter(s => selectedIds.has(s.id) && !s.isLocked && s.camera !== null)
      : [slot];
    const isGroup = groupSlots.length > 1;
    this.isGroupDragging.set(isGroup);

    // Contenedor maestro de clones Ghost para mover todo el grupo visualmente
    const anchorRect = cellEl.getBoundingClientRect();
    const ghostContainer = document.createElement('div');
    ghostContainer.className = 'ghost-multi-drag-container';
    ghostContainer.style.position = 'fixed';
    ghostContainer.style.left = '0px';
    ghostContainer.style.top = '0px';
    ghostContainer.style.width = '0px';
    ghostContainer.style.height = '0px';
    ghostContainer.style.pointerEvents = 'none';
    ghostContainer.style.zIndex = '99999';

    const ghostItems: { element: HTMLElement; relX: number; relY: number }[] = [];

    groupSlots.forEach(gSlot => {
      const gCellEl = document.querySelector(`.grid-slot-cell[data-id="${gSlot.id}"]`) as HTMLElement;
      if (gCellEl) {
        const gRect = gCellEl.getBoundingClientRect();
        const clone = gCellEl.cloneNode(true) as HTMLElement;
        clone.classList.add('ghost-drag-card');
        clone.style.position = 'fixed';
        clone.style.width = `${gRect.width}px`;
        clone.style.height = `${gRect.height}px`;
        clone.style.left = `${gRect.left}px`;
        clone.style.top = `${gRect.top}px`;
        clone.style.pointerEvents = 'none';
        clone.style.zIndex = '99999';
        clone.style.opacity = '0.88';
        clone.style.boxShadow = '0 20px 40px rgba(0, 0, 0, 0.6)';
        clone.style.border = '2px solid var(--primary)';
        clone.style.borderRadius = '10px';
        ghostContainer.appendChild(clone);

        ghostItems.push({
          element: clone,
          relX: gRect.left - anchorRect.left,
          relY: gRect.top - anchorRect.top
        });
      }
    });

    document.body.appendChild(ghostContainer);
    this.draggingSlotId.set(slot.id);
    document.body.classList.add('grabbing-active');

    const groupSlotIdSet = new Set(groupSlots.map(s => s.id));
    const groupDeltas = groupSlots.map(s => ({
      id: s.id,
      dCol: s.col - slot.col,
      dRow: s.row - slot.row,
      spanX: s.spanX,
      spanY: s.spanY
    }));

    let lastTargetKey = '';
    let finalSlots = [...backupSlots];
    let hoverSuccess = false;
    let pendingExpanderDrop: 'column' | 'row' | 'both' | null = null;
    let lastHoverTargetCol = 1;
    let lastHoverTargetRow = 1;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const anchorX = moveEvent.clientX - offsetX;
      const anchorY = moveEvent.clientY - offsetY;

      // Actualizar posición de todos los clones flotantes del grupo
      ghostItems.forEach(item => {
        item.element.style.left = `${anchorX + item.relX}px`;
        item.element.style.top = `${anchorY + item.relY}px`;
      });

      const wrapperEl = document.querySelector('.monitoring-grid-canvas-wrapper') as HTMLElement;
      if (!wrapperEl) return;
      const wrapperRect = wrapperEl.getBoundingClientRect();

      const isOutside = (
        moveEvent.clientX < wrapperRect.left - 200 ||
        moveEvent.clientX > wrapperRect.right + 200 ||
        moveEvent.clientY < wrapperRect.top - 200 ||
        moveEvent.clientY > wrapperRect.bottom + 200
      );

      if (!isOutside) {
        const { cellW, cellH } = this.getCellDimensions();
        const gap = 12;
        const zoom = this.isCanvasMode() ? this.canvasZoom() : 1.0;

        const localX = (moveEvent.clientX - wrapperRect.left) / zoom;
        const localY = (moveEvent.clientY - wrapperRect.top) / zoom;

        const rawCol = Math.floor(localX / (cellW + gap)) + 1;
        const rawRow = Math.floor(localY / (cellH + gap)) + 1;

        let anchorCol = Math.max(1, rawCol);
        let anchorRow = Math.max(1, rawRow);

        // Si es arrastre en grupo, calibrar para que ninguna celda quede con col < 1 o row < 1
        if (isGroup) {
          const minGroupCol = Math.min(...groupDeltas.map(d => anchorCol + d.dCol));
          const minGroupRow = Math.min(...groupDeltas.map(d => anchorRow + d.dRow));
          if (minGroupCol < 1) anchorCol += (1 - minGroupCol);
          if (minGroupRow < 1) anchorRow += (1 - minGroupRow);
        }

        // Calcular el límite máximo que ocupará la selección (individual o grupo)
        const maxGroupCol = isGroup ? Math.max(...groupDeltas.map(d => anchorCol + d.dCol + d.spanX - 1)) : (anchorCol + slot.spanX - 1);
        const maxGroupRow = isGroup ? Math.max(...groupDeltas.map(d => anchorRow + d.dRow + d.spanY - 1)) : (anchorRow + slot.spanY - 1);

        const isExpandingCols = maxGroupCol > originalCols;
        const isExpandingRows = maxGroupRow > originalRows;

        let type: 'cell' | 'vertical-expander' | 'horizontal-expander' | 'both-expanders' = 'cell';
        if (isExpandingCols && isExpandingRows) {
          type = 'both-expanders';
        } else if (isExpandingCols) {
          type = 'vertical-expander';
        } else if (isExpandingRows) {
          type = 'horizontal-expander';
        } else {
          type = 'cell';
        }

        lastHoverTargetCol = anchorCol;
        lastHoverTargetRow = anchorRow;

        const targetKey = `${type}-${anchorCol}-${anchorRow}-${maxGroupCol}-${maxGroupRow}`;

        if (targetKey !== lastTargetKey) {
          lastTargetKey = targetKey;

          if (isExpandingCols || isExpandingRows) {
            // El grupo o celda está extendiendo la cuadrícula en filas, columnas o ambas
            this.cols.set(Math.max(originalCols, maxGroupCol));
            this.rows.set(Math.max(originalRows, maxGroupRow));

            const tempSlots = backupSlots.map(s => ({ ...s }));
            if (isGroup) {
              const updatedGroupSlots: GridSlot[] = [];
              groupDeltas.forEach(d => {
                const gSlot = tempSlots.find(s => s.id === d.id);
                if (gSlot) {
                  gSlot.col = anchorCol + d.dCol;
                  gSlot.row = anchorRow + d.dRow;
                  updatedGroupSlots.push(gSlot);
                }
              });
              this.resolveGroupOverlapConflicts(updatedGroupSlots, tempSlots);
              this.draggingDropTargets.set(groupDeltas.map(d => ({
                col: anchorCol + d.dCol,
                row: anchorRow + d.dRow,
                spanX: d.spanX,
                spanY: d.spanY,
                isValid: true
              })));
            } else {
              const dragSlot = tempSlots.find(s => s.id === slot.id);
              if (dragSlot) {
                dragSlot.col = anchorCol;
                dragSlot.row = anchorRow;
                this.resolveOverlapConflictsForArray(dragSlot, tempSlots);
              }
              this.draggingDropTargets.set([{
                col: anchorCol,
                row: anchorRow,
                spanX: slot.spanX,
                spanY: slot.spanY,
                isValid: true
              }]);
            }

            finalSlots = tempSlots;
            hoverSuccess = true;
            pendingExpanderDrop = (isExpandingCols && isExpandingRows) ? 'both' : (isExpandingCols ? 'column' : 'row');
            this.activeHoveredExpander.set(pendingExpanderDrop);
            return;
          }

          // Dentro de los límites originales de la cuadrícula
          this.cols.set(originalCols);
          this.rows.set(originalRows);
          this.activeHoveredExpander.set(null);
          pendingExpanderDrop = null;

          if (anchorCol === slot.col && anchorRow === slot.row) {
            finalSlots = [...backupSlots];
            hoverSuccess = false;
            this.draggingDropTargets.set([]);
            return;
          }

          const tempSlots = backupSlots.map(s => ({ ...s }));
          let validHover = false;

          if (!isGroup) {
            // Arrastre individual interno
            const dragSlot = tempSlots.find(s => s.id === slot.id);
            if (!dragSlot) return;

            const overlapsLocked = backupSlots.some(s =>
              s.isLocked && s.id !== slot.id &&
              anchorCol < s.col + s.spanX && anchorCol + slot.spanX > s.col &&
              anchorRow < s.row + s.spanY && anchorRow + slot.spanY > s.row
            );

            if (!overlapsLocked) {
              const targetSlotInBackup = backupSlots.find(s =>
                s.camera !== null &&
                anchorCol >= s.col && anchorCol < s.col + s.spanX &&
                anchorRow >= s.row && anchorRow < s.row + s.spanY
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
                dragSlot.col = anchorCol;
                dragSlot.row = anchorRow;
                this.resolveOverlapConflictsForArray(dragSlot, tempSlots);
                validHover = true;
              }
            }

            if (validHover) {
              finalSlots = tempSlots;
              hoverSuccess = true;
              this.draggingDropTargets.set([{
                col: anchorCol,
                row: anchorRow,
                spanX: slot.spanX,
                spanY: slot.spanY,
                isValid: true
              }]);
            } else {
              finalSlots = [...backupSlots];
              hoverSuccess = false;
              this.draggingDropTargets.set([]);
            }
          } else {
            // Arrastre en grupo interno
            const overlapsLocked = backupSlots.some(s =>
              s.isLocked && !groupSlotIdSet.has(s.id) &&
              groupDeltas.some(d => {
                const c = anchorCol + d.dCol;
                const r = anchorRow + d.dRow;
                return c < s.col + s.spanX && c + d.spanX > s.col &&
                       r < s.row + s.spanY && r + d.spanY > s.row;
              })
            );

            if (!overlapsLocked) {
              const updatedGroupSlots: GridSlot[] = [];
              groupDeltas.forEach(d => {
                const gSlot = tempSlots.find(s => s.id === d.id);
                if (gSlot) {
                  gSlot.col = anchorCol + d.dCol;
                  gSlot.row = anchorRow + d.dRow;
                  updatedGroupSlots.push(gSlot);
                }
              });

              // Resolver conflictos con las celdas ajenas respetando el grupo intacto
              this.resolveGroupOverlapConflicts(updatedGroupSlots, tempSlots);

              validHover = true;
            }

            if (validHover) {
              finalSlots = tempSlots;
              hoverSuccess = true;
              this.draggingDropTargets.set(groupDeltas.map(d => ({
                col: anchorCol + d.dCol,
                row: anchorRow + d.dRow,
                spanX: d.spanX,
                spanY: d.spanY,
                isValid: true
              })));
            } else {
              finalSlots = [...backupSlots];
              hoverSuccess = false;
              this.draggingDropTargets.set([]);
            }
          }
        }
      } else {
        if (lastTargetKey !== '') {
          lastTargetKey = '';
          this.cols.set(originalCols);
          this.rows.set(originalRows);
          finalSlots = [...backupSlots];
          hoverSuccess = false;
          pendingExpanderDrop = null;
          this.activeHoveredExpander.set(null);
          this.draggingDropTargets.set([]);
        }
      }
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);

      if (ghostContainer && ghostContainer.parentNode) {
        ghostContainer.parentNode.removeChild(ghostContainer);
      }

      document.body.classList.remove('grabbing-active');
      this.draggingSlotId.set(null);
      this.isGroupDragging.set(false);
      this.activeHoveredExpander.set(null);
      this.draggingDropTargets.set([]);

      if (hoverSuccess) {
        this.pushToUndoStack({ slots: backupSlots, cols: originalCols, rows: originalRows });
        this.gridSlots.set(finalSlots);
        this.recalculateGridDimensions(true);
        this.swapPulseSlotId.set(slot.id);
        setTimeout(() => this.swapPulseSlotId.set(null), 1000);
        this.showToast(isGroup ? `${groupSlots.length} cámaras reubicadas en grupo` : 'Distribución de canales reordenada', 'primary');
      } else {
        this.cols.set(originalCols);
        this.rows.set(originalRows);
        this.gridSlots.set(backupSlots);
        this.recalculateGridDimensions(true);
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
      this.recalculateGridDimensions(true);
      this.showToast(`Grid ajustado: Cámara redimensionada a ${lastSpanX}x${lastSpanX}`, 'primary');
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  // --- Acciones de Feed Individual (Delegadas a MonitoringStreamService) ---
  toggleAiOverlay(cameraName: string): void {
    this.streamService.toggleAiOverlay(cameraName);
  }

  toggleFeedPause(cameraName: string): void {
    const isResumed = this.streamService.toggleFeedPause(cameraName);
    this.showToast(isResumed ? `Feed de ${cameraName} reanudado` : `Feed de ${cameraName} pausado`, 'warning');
  }

  isFeedPaused(cameraName: string): boolean {
    return this.streamService.isFeedPaused(cameraName);
  }

  toggleRecording(cameraName: string): void {
    const isStarted = this.streamService.toggleRecording(cameraName);
    this.showToast(isStarted ? `🔴 Grabando feed histórico de ${cameraName}` : `💾 Grabación de ${cameraName} guardada exitosamente`, isStarted ? 'danger' : 'success');
  }

  takeSnapshot(slotOrName: GridSlot | string): void {
    let slot: GridSlot | undefined;
    if (typeof slotOrName === 'string') {
      slot = this.gridSlots().find(s => s.camera?.name === slotOrName);
    } else {
      slot = slotOrName;
    }
    if (!slot || !slot.camera) return;

    const isPlayback = this.isSlotInPlaybackMode(slot);
    const playbackSnapshot = isPlayback ? this.getSnapshotForCameraAt(slot.camera.name) : null;
    const latestSnapshot = this.latestEventsMap()[slot.camera.name];

    this.streamService.takeSnapshot(slot, {
      isPlayback,
      playbackSnapshotUrl: playbackSnapshot?.urlImg,
      latestSnapshotUrl: latestSnapshot?.urlImg,
      onSuccess: (msg) => this.showToast(msg, 'success')
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
      bestMatch = this.getLatestEventForCamera(cameraName) || null;
    }

    return bestMatch;
  }

  getLatestEventForCamera(cameraName: string, cameraId?: string): EventRecord | null {
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

      const latestEvt = this.getLatestEventForCamera(cameraName, cameraId);
      if (latestEvt) return latestEvt;

      return null;
    }

    // 3. Fallback en la lista/mapa de eventos para cámaras estáticas o como póster base mientras conecta WebRTC
    const latestEvt = this.getLatestEventForCamera(cameraName, cameraId);
    if (latestEvt) return latestEvt;

    return null;
  }

  isSlotPlayingLiveVideo(slot: GridSlot): boolean {
    if (!slot || !slot.camera) return false;
    if (this.isSlotInPlaybackMode(slot)) return false;
    return this.monitoringStateService.isSlotVideoPlaying(slot.id);
  }

  onVideoPlaying(slotId: string, event: Event): void {
    const video = event.target as HTMLVideoElement;
    console.log(`%c[Monitoreo Fullscreen Slot ${slotId}] Evento 'playing' disparado -> Dimensiones: ${video?.videoWidth}x${video?.videoHeight}, currentTime: ${video?.currentTime}`, 'color: #2ed573; font-weight: bold;');
    if (video && (video.videoWidth > 0 || video.currentTime > 0)) {
      this.monitoringStateService.setSlotVideoPlaying(slotId, true);
    }
  }

  onVideoLoadedData(slotId: string, event: Event): void {
    const video = event.target as HTMLVideoElement;
    console.log(`[Monitoreo Fullscreen Slot ${slotId}] Evento 'loadeddata' / frame recibido -> Dimensiones: ${video?.videoWidth}x${video?.videoHeight}`);
    if (video && video.videoWidth > 0 && !video.paused) {
      this.monitoringStateService.setSlotVideoPlaying(slotId, true);
    }
  }

  onVideoPaused(slotId: string): void {
    console.log(`[Monitoreo Fullscreen Slot ${slotId}] Evento 'pause' o 'waiting' disparado`);
    this.monitoringStateService.setSlotVideoPlaying(slotId, false);
  }

  onVideoError(slotId: string, event: Event): void {
    console.error(`[Monitoreo Fullscreen Slot ${slotId}] Error en elemento <video>:`, event);
    this.monitoringStateService.setSlotVideoPlaying(slotId, false);
  }

  isSlotShowingEventPhoto(slot: GridSlot): boolean {
    if (!slot || !slot.camera) return false;

    // Si la celda está reproduciendo video WebRTC en vivo y no en reproducción histórica, no se muestra badge de foto
    if (this.isSlotPlayingLiveVideo(slot)) {
      return false;
    }

    // Solo se muestra foto/insignia si se encontró un evento real válido con imagen
    const displayedEvt = this.getDisplayedEventForSlot(slot);
    return displayedEvt !== null && !!(displayedEvt.imgMinioObjectName || displayedEvt.urlImg);
  }


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


  readonly selectedFlagId = signal<string | null>(null);

  isFlagSelected(flag: { event: EventRecord; events?: EventRecord[] }): boolean {
    const currentSelectedId = this.selectedFlagId();
    if (!currentSelectedId || !flag) return false;
    if (flag.event && flag.event.id === currentSelectedId) return true;
    if (flag.events && flag.events.length > 0) {
      return flag.events.some(e => e.id === currentSelectedId);
    }
    return false;
  }

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

    this.currentTimePointer.set(targetDate);
    this.showToast(`📍 Evento activo: ${eventRecord.analitica || 'Alerta'} (${eventRecord.nombreCamara})`, 'primary');
  }


  setLiveModeKeepWindow(): void {
    const now = new Date();
    this.playbackMode.set('live');
    this.paused.set(false);
    this.selectedFlagId.set(null);
    this.selectedCanvasSlotIds.set(new Set());
    this.highlightedCellCameraName.set(null);
    this.currentTimePointer.set(now);

    this.showToast('⚡ Transmisión En Vivo reanudada', 'success');
  }




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
    const search = this.eventSearchQuery().trim().toLowerCase();

    for (const slot of this.gridSlots()) {
      if (slot.camera && !seen.has(slot.camera.id)) {
        // Filtrar por selección en ambos modos (SYNC y ASYNC)
        // Sin selección → todas las cámaras del lienzo
        if (selectedNames.size > 0 && !selectedNames.has(slot.camera.name)) {
          continue;
        }
        // Filtrar por búsqueda de texto de cámara en la barra superior
        if (search && !slot.camera.name.toLowerCase().includes(search)) {
          continue;
        }
        seen.add(slot.camera.id);
        list.push(slot.camera);
      }
    }
    return list;
  });


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

  // --- Modal Cámara & Asignación (Confirmación delegada a CameraSelectionModalComponent) ---
  onCameraSelectionConfirmed(selectedIds: Set<string>): void {
    this.selectedCameraIds.set(selectedIds);
    this.confirmCameraSelection();
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
      const nextSlots = preservedSlots.map(s => ({ ...s }));
      const mode = this.modalTriggerMode();

      // Determinar dimensiones máximas ocupadas actuales
      let currentMaxCol = 1;
      let currentMaxRow = 1;
      nextSlots.forEach(s => {
        const endCol = s.col + s.spanX - 1;
        const endRow = s.row + s.spanY - 1;
        if (endCol > currentMaxCol) currentMaxCol = endCol;
        if (endRow > currentMaxRow) currentMaxRow = endRow;
      });

      const isSlotOccupied = (col: number, row: number): boolean => {
        return nextSlots.some(s =>
          col >= s.col && col < s.col + s.spanX &&
          row >= s.row && row < s.row + s.spanY
        );
      };

      const totalCams = nextSlots.length + newCams.length;
      const optimalCols = this.getOptimalColumnsForCount(totalCams);
      const optimalRows = Math.max(1, Math.ceil(totalCams / optimalCols));

      if (mode === 'add-row') {
        // Modo Añadir Fila: Completar la fila hacia la derecha hasta colsLimit y luego saltar a la siguiente fila
        const colsLimit = Math.max(1, this.cols(), currentMaxCol, optimalCols);
        let targetRow = currentMaxRow + 1;
        let targetCol = 1;

        newCams.forEach(cam => {
          while (isSlotOccupied(targetCol, targetRow)) {
            targetCol++;
            if (targetCol > colsLimit) {
              targetCol = 1;
              targetRow++;
            }
          }

          nextSlots.push({
            id: `slot-${targetCol}-${targetRow}-${Math.floor(Math.random() * 1000000)}`,
            camera: cam,
            col: targetCol,
            row: targetRow,
            spanX: 1,
            spanY: 1
          });

          targetCol++;
          if (targetCol > colsLimit) {
            targetCol = 1;
            targetRow++;
          }
        });
      } else if (mode === 'add-column') {
        // Modo Añadir Columna: Completar la columna hacia abajo hasta rowsLimit y luego saltar a la siguiente columna
        const rowsLimit = Math.max(1, this.rows(), currentMaxRow, optimalRows);
        let targetCol = currentMaxCol + 1;
        let targetRow = 1;

        newCams.forEach(cam => {
          while (isSlotOccupied(targetCol, targetRow)) {
            targetRow++;
            if (targetRow > rowsLimit) {
              targetRow = 1;
              targetCol++;
            }
          }

          nextSlots.push({
            id: `slot-${targetCol}-${targetRow}-${Math.floor(Math.random() * 1000000)}`,
            camera: cam,
            col: targetCol,
            row: targetRow,
            spanX: 1,
            spanY: 1
          });

          targetRow++;
          if (targetRow > rowsLimit) {
            targetRow = 1;
            targetCol++;
          }
        });
      } else if (mode === 'slot' && this.targetAddCol() !== null && this.targetAddRow() !== null) {
        // Modo Slot: Primera cámara en la celda clickeada, las siguientes llenan los huecos vacíos o añaden filas proporcionadas
        const specifiedCol = this.targetAddCol()!;
        const specifiedRow = this.targetAddRow()!;
        const colsLimit = Math.max(1, this.cols(), currentMaxCol, optimalCols);

        newCams.forEach((cam, idx) => {
          let targetCol = specifiedCol;
          let targetRow = specifiedRow;

          if (idx === 0 && !isSlotOccupied(specifiedCol, specifiedRow)) {
            targetCol = specifiedCol;
            targetRow = specifiedRow;
          } else {
            // Buscar primer hueco vacío en el grid existente
            let foundEmpty = false;
            for (let r = 1; r <= currentMaxRow; r++) {
              for (let c = 1; c <= colsLimit; c++) {
                if (!isSlotOccupied(c, r)) {
                  targetCol = c;
                  targetRow = r;
                  foundEmpty = true;
                  break;
                }
              }
              if (foundEmpty) break;
            }

            // Si no hay huecos vacíos, agregar a la siguiente fila
            if (!foundEmpty) {
              let r = currentMaxRow + 1;
              let c = 1;
              while (isSlotOccupied(c, r)) {
                c++;
                if (c > colsLimit) {
                  c = 1;
                  r++;
                }
              }
              targetCol = c;
              targetRow = r;
            }
          }

          nextSlots.push({
            id: `slot-${targetCol}-${targetRow}-${Math.floor(Math.random() * 1000000)}`,
            camera: cam,
            col: targetCol,
            row: targetRow,
            spanX: 1,
            spanY: 1
          });
        });
      } else {
        // Modo General ("Gestionar Cámaras"): Rellenar huecos existentes y expandir proporcionalmente respetando la posición y orden previo
        const colsLimit = Math.max(1, this.cols(), currentMaxCol, optimalCols);

        newCams.forEach(cam => {
          let targetCol = 1;
          let targetRow = 1;
          let found = false;

          // 1. Intentar llenar huecos dentro de las filas existentes hasta el límite de columnas óptimo
          for (let r = 1; r <= currentMaxRow; r++) {
            for (let c = 1; c <= colsLimit; c++) {
              if (!isSlotOccupied(c, r)) {
                targetCol = c;
                targetRow = r;
                found = true;
                break;
              }
            }
            if (found) break;
          }

          // 2. Si no hay huecos en las filas existentes, añadir a las siguientes filas
          if (!found) {
            let r = currentMaxRow + 1;
            let c = 1;
            while (isSlotOccupied(c, r)) {
              c++;
              if (c > colsLimit) {
                c = 1;
                r++;
              }
            }
            targetCol = c;
            targetRow = r;
          }

          nextSlots.push({
            id: `slot-${targetCol}-${targetRow}-${Math.floor(Math.random() * 1000000)}`,
            camera: cam,
            col: targetCol,
            row: targetRow,
            spanX: 1,
            spanY: 1
          });
        });
      }

      this.gridSlots.set(nextSlots);
    }

    this.recalculateGridDimensions(true);

    this.showModal.set(false);
    this.targetAddCol.set(null);
    this.targetAddRow.set(null);
    this.modalTriggerMode.set('general');
    this.showToast('Canales de monitoreo actualizados', 'success');
  }

  deleteSelectedCameras(): void {
    const selectedIds = this.selectedCanvasSlotIds();
    if (selectedIds.size === 0) return;

    const occupiedSelectedSlots = this.gridSlots().filter(s => selectedIds.has(s.id) && s.camera !== null);
    if (occupiedSelectedSlots.length === 0) return;

    // Guardar estado actual en el historial de Deshacer antes de la eliminación masiva
    this.saveStateToHistory();

    const remainingSlots = this.gridSlots().filter(s => !selectedIds.has(s.id) && s.camera !== null);

    this.gridSlots.set(remainingSlots);
    this.selectedCanvasSlotIds.set(new Set());
    this.recalculateGridDimensions(true);

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

    const targetCameraName = targetSlot?.camera?.name;
    const remainingSlots = this.gridSlots().filter(s => s.id !== targetSlot?.id && s.camera !== null);

    if (targetSlot) {
      const nextSelected = new Set(this.selectedCanvasSlotIds());
      nextSelected.delete(targetSlot.id);
      this.selectedCanvasSlotIds.set(nextSelected);
    }

    this.gridSlots.set(remainingSlots);
    this.recalculateGridDimensions(true);

    if (targetCameraName) {
      this.showToast(`Cámara ${targetCameraName} removida del slot`, 'warning');
    }
  }

  openSelectionModal(col: number | null, row: number | null, mode?: 'general' | 'add-row' | 'add-column' | 'slot'): void {
    this.targetAddCol.set(col);
    this.targetAddRow.set(row);

    if (mode) {
      this.modalTriggerMode.set(mode);
    } else if (col === null && row === null) {
      this.modalTriggerMode.set('general');
    } else if (col === 1 && row === this.rows() + 1) {
      this.modalTriggerMode.set('add-row');
    } else if (col === this.cols() + 1 && row === 1) {
      this.modalTriggerMode.set('add-column');
    } else {
      this.modalTriggerMode.set('slot');
    }

    // Inicializar checklist de la modal con las cámaras activas en el grid
    const activeIds = new Set(
      this.gridSlots()
        .map(s => s.camera?.id)
        .filter((id): id is string => !!id)
    );
    this.selectedCameraIds.set(activeIds);

    this.showModal.set(true);
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
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

    this.zoomX.set(x);
    this.zoomY.set(y);

    const zoomFactor = 2.5;
    const lensEl = container.querySelector('.magnifier-lens') as HTMLElement;
    const lensSize = (lensEl && lensEl.offsetWidth > 0) ? lensEl.offsetWidth : 500;

    this.zoomBgX.set(Math.round(lensSize / 2 - x * zoomFactor));
    this.zoomBgY.set(Math.round(lensSize / 2 - y * zoomFactor));
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
  }

  resetFilters(): void {
    this.eventSearchControl.setValue('');
    this.eventSearchQuery.set('');
    this.eventAnalyticFilter.set('all');
    this.eventDesdeFilter.set(null);
    this.eventHastaFilter.set(null);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.showCanvasMenuDropdown.set(false);
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

  getStatusFilterLabel(status: string): string {
    return getCameraStatusFilterLabel(status);
  }

  getStatusCssClass(status: string): string {
    const stLower = status.trim().toLowerCase();
    if (stLower === 'all' || stLower === 'todos') return 'all';
    if (stLower === 'online' || stLower === 'active' || stLower === 'activo') return 'online';
    if (stLower === 'degraded' || stLower === 'degradado') return 'degraded';
    if (stLower === 'recovering' || stLower === 'recuperando') return 'recovering';
    if (stLower === 'pending' || stLower === 'pendiente') return 'pending';
    return 'offline';
  }


}
