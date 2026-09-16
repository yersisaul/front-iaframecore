import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  inject,
  signal,
  computed,
  effect,
  Input,
  Output,
  EventEmitter,
  ChangeDetectionStrategy,
  ViewEncapsulation,
  ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MonitoringStateService, GridSlot } from '../../../core/services/monitoring-state.service';
import { Camera } from '../../../core/domain/entities/camera.models';
import { getCameraEffectiveStatus, getCameraStatusCssClass, getCameraStatusFilterLabel } from '../../../core/utils/camera-status.utils';
import { parseUtcDate } from '../../../core/utils/date-utils';
import { MediaUrlPipe } from '../pipes/media-url.pipe';

@Component({
  selector: 'app-camera-grid-canvas',
  standalone: true,
  imports: [CommonModule, MediaUrlPipe],
  templateUrl: './camera-grid-canvas.component.html',
  styleUrl: './camera-grid-canvas.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None
})
export class CameraGridCanvasComponent implements OnInit, OnDestroy, AfterViewInit {
  public monitoringStateService = inject(MonitoringStateService);
  private elementRef = inject(ElementRef);

  // --- Modos de Operación ---
  @Input() mode: 'monitoreo' | 'pip' = 'monitoreo';
  @Input() videoIdPrefix: string = 'video-feed';

  // --- Opciones de Visualización y Controles ---
  @Input() isInteractive: boolean = true;
  @Input() showCellActions: boolean = true;
  @Input() showExpanders: boolean = true;
  @Input() isExpanding: boolean = false;

  // --- Estados visuales propagados desde el padre ---
  @Input() activeHoveredExpander: string | null = null;
  @Input() resizingSlotId: string | null = null;
  @Input() draggingSlotId: string | null = null;
  @Input() selectedSlotIds: Set<string> = new Set();
  @Input() dimmedSlotIds: Set<string> = new Set();
  @Input() isSyncMode: boolean = true;
  @Input() highlightedCameraName: string | null = null;
  @Input() flashEffects: Record<string, boolean> = {};
  @Input() pausedFeeds: Record<string, boolean> = {};
  @Input() activeAiOverlays: Record<string, boolean> = {};
  @Input() aiBoundingBoxes: Record<string, any> = {};
  @Input() draggingDropTargets: { col: number; row: number; spanX: number; spanY: number; isValid: boolean }[] = [];
  @Input() swapPulseSlotId: string | null = null;

  // LOD y Compensación de escala
  @Input() isCanvasAnimating: boolean = false;
  @Input() canvasLodMode: 'normal' | 'compact' | 'detailed' = 'normal';
  @Input() uiCompensatedScale: number = 1;
  @Input() dockCompensatedScale: number = 1.85;
  @Input() badgeCompensatedScale: number = 1.18;
  @Input() timeCompensatedScale: number = 1.14;
  @Input() emptySlotCompensatedScale: number = 1;

  // Dimensiones / overrides opcionales de transform y grid
  @Input() customTransform: string | null = null;
  @Input() customWidth: string | null = null;
  @Input() customHeight: string | null = null;
  @Input() customGridTemplateColumns: string | null = null;
  @Input() customGridTemplateRows: string | null = null;
  @Input() getCameraAnalyticsFn?: (camera: Camera) => string[];
  @Input() isSlotInPlaybackModeFn?: (slot: GridSlot) => boolean;
  @Input() isFeedPausedFn?: (cameraName: string) => boolean;
  @Input() isSlotDimmedFn?: (slot: GridSlot) => boolean;

  // --- Eventos Emitidos hacia el Padre ---
  @Output() slotClick = new EventEmitter<{ slot: GridSlot; event: MouseEvent }>();
  @Output() slotDblClick = new EventEmitter<{ slot: GridSlot; event: MouseEvent }>();
  @Output() slotMouseDown = new EventEmitter<{ slot: GridSlot; event: MouseEvent; index: number }>();
  @Output() slotMouseEnter = new EventEmitter<HTMLElement>();
  @Output() slotMouseLeave = new EventEmitter<HTMLElement>();
  @Output() slotRefreshStream = new EventEmitter<GridSlot>();
  @Output() slotTakeSnapshot = new EventEmitter<GridSlot>();
  @Output() slotToggleLock = new EventEmitter<GridSlot>();
  @Output() slotRemoveCamera = new EventEmitter<{ col: number; row: number; event: MouseEvent }>();
  @Output() slotResizeInit = new EventEmitter<{ slot: GridSlot; event: MouseEvent; element: HTMLElement }>();
  @Output() expanderClick = new EventEmitter<{ col: number; row: number; type: 'add-column' | 'add-row' }>();

  // --- Signals del Singleton StateService ---
  readonly gridSlots = this.monitoringStateService.gridSlots;
  readonly cols = this.monitoringStateService.cols;
  readonly rows = this.monitoringStateService.rows;
  readonly canvasPanX = this.monitoringStateService.canvasPanX;
  readonly canvasPanY = this.monitoringStateService.canvasPanY;
  readonly canvasZoom = this.monitoringStateService.canvasZoom;
  readonly pipPanX = this.monitoringStateService.pipPanX;
  readonly pipPanY = this.monitoringStateService.pipPanY;
  readonly pipZoom = this.monitoringStateService.pipZoom;
  readonly isCanvasPinned = this.monitoringStateService.isCanvasPinned;
  readonly webRtcStates = this.monitoringStateService.webRtcStates;
  readonly livePlayingSlots = this.monitoringStateService.livePlayingSlots;

  readonly isCanvasMode = computed(() => this.gridSlots().some(s => s.camera !== null));

  // Réplica exacta 1:1 de los slots visibles y vacíos en la cuadrícula
  readonly visibleGridSlots = computed(() => {
    const slots = this.gridSlots();
    const totalCols = Math.max(1, this.cols());
    const totalRows = Math.max(1, this.rows());

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

  constructor() {
    effect(() => {
      // Reaccionar cuando cambien los slots para vincular y sincronizar elementos de video
      const slots = this.gridSlots();
      if (slots.length > 0) {
        setTimeout(() => {
          this.attachAllLiveVideos();
        }, 100);
      }
    });
  }

  ngOnInit(): void {}

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.attachAllLiveVideos();
    }, 150);
  }

  ngOnDestroy(): void {}

  // --- Dimensiones de Celda y Cuadrícula ---
  getCellDimensions(): { cellW: number; cellH: number } {
    const isCanvas = this.mode === 'pip' ? true : this.isCanvasMode();
    if (isCanvas) {
      // En modo lienzo / PiP, las dimensiones base son fijas y consistentes (16:9)
      const cellW = 280;
      const cellH = 158;
      return { cellW, cellH };
    }

    const colsVal = Math.max(1, this.cols());
    const rowsVal = Math.max(1, this.rows());

    let availableWidth = 1200 - 20 - (colsVal - 1) * 12;
    let availableHeight = 700 - 20 - (rowsVal - 1) * 12;

    if (this.mode === 'monitoreo' && typeof document !== 'undefined') {
      const gridContainer = document.querySelector('.monitoring-grid-container');
      if (gridContainer && gridContainer.clientWidth > 0) {
        availableWidth = (gridContainer.clientWidth - 20) - (colsVal - 1) * 12;
      }
      if (gridContainer && gridContainer.clientHeight > 0) {
        availableHeight = (gridContainer.clientHeight - 20) - (rowsVal - 1) * 12;
      }
    }

    const cellW = Math.max(180, availableWidth / colsVal);
    const cellH = Math.max(135, Math.round(availableHeight / rowsVal));

    return { cellW, cellH };
  }

  getExtenderDimensions(): { width: number; height: number; fontSize: number; iconSize: number } {
    const isCanvas = this.mode === 'pip' ? true : this.isCanvasMode();
    if (!isCanvas) {
      return { width: 44, height: 44, fontSize: 11, iconSize: 14 };
    }
    const z = Math.max(0.05, this.mode === 'pip' ? this.pipZoom() : this.canvasZoom());
    const { cellW } = this.getCellDimensions();

    const scaleFactor = 1 / Math.pow(z, 0.4);
    const maxThickness = Math.max(40, Math.min(56, Math.round(cellW * 0.22)));
    const thickness = Math.max(32, Math.min(maxThickness, Math.round(44 * Math.min(scaleFactor, 1.25))));
    const fontSize = Math.max(10, Math.min(13, Math.round(11 * Math.min(scaleFactor, 1.2))));
    const iconSize = Math.max(13, Math.min(18, Math.round(14 * Math.min(scaleFactor, 1.25))));

    return { width: thickness, height: thickness, fontSize, iconSize };
  }

  getCanvasDimensions(): { width: number; height: number } {
    const { cellW, cellH } = this.getCellDimensions();
    const colsVal = Math.max(1, this.cols());
    const rowsVal = Math.max(1, this.rows());

    const isCanvas = this.mode === 'pip' ? true : this.isCanvasMode();
    const showColExpander = this.mode === 'monitoreo' && isCanvas && !this.isCanvasPinned() && this.activeHoveredExpander !== 'column' && this.activeHoveredExpander !== 'both';
    const showRowExpander = this.mode === 'monitoreo' && isCanvas && !this.isCanvasPinned() && this.activeHoveredExpander !== 'row' && this.activeHoveredExpander !== 'both';
    
    const extDim = this.getExtenderDimensions();
    const expanderW = this.isExpanding ? extDim.width : (showColExpander ? extDim.width : 0);
    const expanderH = this.isExpanding ? extDim.height : (showRowExpander ? extDim.height : 0);

    const width = colsVal * cellW + (colsVal - 1) * 12 + 20 + expanderW;
    const height = rowsVal * cellH + (rowsVal - 1) * 12 + 20 + expanderH;

    return { width, height };
  }

  // --- Estilos Dinámicos del Contenedor de Cuadrícula ---
  getWrapperTransform(): string {
    if (this.customTransform) return this.customTransform;
    if (this.mode === 'pip') {
      return `translate(${this.pipPanX()}px, ${this.pipPanY()}px) scale(${this.pipZoom()})`;
    }
    const isCanvas = this.isCanvasMode();
    return isCanvas
      ? `translate(${this.canvasPanX()}px, ${this.canvasPanY()}px) scale(${this.canvasZoom()})`
      : 'none';
  }

  getWrapperWidth(): string {
    if (this.customWidth) return this.customWidth;
    const isCanvas = this.mode === 'pip' ? true : this.isCanvasMode();
    return isCanvas ? `${this.getCanvasDimensions().width}px` : '100%';
  }

  getWrapperHeight(): string {
    if (this.customHeight) return this.customHeight;
    const isCanvas = this.mode === 'pip' ? true : this.isCanvasMode();
    return isCanvas ? `${this.getCanvasDimensions().height}px` : '100%';
  }

  getGridColsStyle(): string {
    if (this.customGridTemplateColumns) return this.customGridTemplateColumns;
    const isCanvas = this.mode === 'pip' ? true : this.isCanvasMode();
    const { cellW } = this.getCellDimensions();
    const extDim = this.getExtenderDimensions();
    const hasExpander = this.isExpanding || (this.mode === 'monitoreo' && !this.isCanvasPinned() && this.activeHoveredExpander !== 'column' && this.activeHoveredExpander !== 'both');

    return isCanvas
      ? `repeat(${this.cols()}, ${cellW}px)${hasExpander ? ` ${extDim.width}px` : ''}`
      : `repeat(${this.cols()}, minmax(0, 1fr))`;
  }

  getGridRowsStyle(): string {
    if (this.customGridTemplateRows) return this.customGridTemplateRows;
    const isCanvas = this.mode === 'pip' ? true : this.isCanvasMode();
    const { cellH } = this.getCellDimensions();
    const extDim = this.getExtenderDimensions();
    const hasExpander = this.isExpanding || (this.mode === 'monitoreo' && !this.isCanvasPinned() && this.activeHoveredExpander !== 'row' && this.activeHoveredExpander !== 'both');

    return isCanvas
      ? `repeat(${this.rows()}, ${cellH}px)${hasExpander ? ` ${extDim.height}px` : ''}`
      : `repeat(${this.rows()}, minmax(${cellH}px, 1fr))`;
  }

  // --- Helpers de Estado, Formateo y Video ---
  attachAllLiveVideos(): void {
    const slots = this.gridSlots();
    for (const slot of slots) {
      if (slot.camera) {
        const videoId = `${this.videoIdPrefix}-${slot.id}`;
        const videoEl = document.getElementById(videoId) as HTMLVideoElement;
        if (videoEl) {
          const connKey = `${slot.id}_${slot.camera.id}`;
          if (this.monitoringStateService.mediaStreamsMap.has(slot.id)) {
            this.monitoringStateService.attachStreamToVideo(slot.id, videoEl);
          } else if (!this.monitoringStateService.isMonitoringPaused()) {
            this.monitoringStateService.startWebRtcStreamByKey(slot, connKey, videoEl);
          }
        }
      }
    }
  }

  getDisplayedEventForSlot(slot: GridSlot): any | null {
    if (!slot || !slot.camera) return null;
    return this.monitoringStateService.getLatestEventForCamera(slot.camera.name, slot.camera.id);
  }

  isSlotInPlaybackMode(slot: GridSlot): boolean {
    if (this.isSlotInPlaybackModeFn) {
      return this.isSlotInPlaybackModeFn(slot);
    }
    return false;
  }

  isSlotPlayingLiveVideo(slot: GridSlot): boolean {
    if (!slot || !slot.camera) return false;
    if (this.isSlotInPlaybackMode(slot)) return false;
    return this.monitoringStateService.isSlotVideoPlaying(slot.id);
  }

  onVideoPlaying(slotId: string, event: Event): void {
    const video = event.target as HTMLVideoElement;
    console.log(`%c[CameraGridCanvas Slot ${slotId}] Evento 'playing' disparado -> Dimensiones de video: ${video?.videoWidth}x${video?.videoHeight}, currentTime: ${video?.currentTime}`, 'color: #2ed573; font-weight: bold;');
    if (video && (video.videoWidth > 0 || video.currentTime > 0)) {
      this.monitoringStateService.setSlotVideoPlaying(slotId, true);
    }
  }

  onVideoLoadedData(slotId: string, event: Event): void {
    const video = event.target as HTMLVideoElement;
    console.log(`[CameraGridCanvas Slot ${slotId}] Evento 'loadeddata' / frame recibido -> Dimensiones: ${video?.videoWidth}x${video?.videoHeight}`);
    if (video && video.videoWidth > 0 && !video.paused) {
      this.monitoringStateService.setSlotVideoPlaying(slotId, true);
    }
  }

  onVideoPaused(slotId: string): void {
    console.log(`[CameraGridCanvas Slot ${slotId}] Evento 'pause' o 'waiting' disparado`);
    this.monitoringStateService.setSlotVideoPlaying(slotId, false);
  }

  onVideoError(slotId: string, event: Event): void {
    console.error(`[CameraGridCanvas Slot ${slotId}] Error en elemento <video>:`, event);
    this.monitoringStateService.setSlotVideoPlaying(slotId, false);
  }

  isSlotShowingEventPhoto(slot: GridSlot): boolean {
    if (!slot || !slot.camera) return false;
    if (this.isSlotPlayingLiveVideo(slot)) {
      return false;
    }
    const displayedEvt = this.getDisplayedEventForSlot(slot);
    return displayedEvt !== null && !!(displayedEvt.imgMinioObjectName || displayedEvt.urlImg);
  }

  getCameraAnalytics(camera: Camera): string[] {
    if (this.getCameraAnalyticsFn) {
      return this.getCameraAnalyticsFn(camera);
    }
    return ['Detección'];
  }

  getCameraStatusClass(camera: Camera | null): string {
    if (!camera) return 'status-inactive';
    const status = getCameraEffectiveStatus(camera);
    return getCameraStatusCssClass(status);
  }

  getCameraStatusLabel(camera: Camera | null): string {
    if (!camera) return 'Sin cámara';
    const status = getCameraEffectiveStatus(camera);
    return getCameraStatusFilterLabel(status);
  }

  getClampedSpan(spanX?: number): number {
    return Math.min(spanX || 1, 3);
  }

  isSlotDimmed(slot: GridSlot): boolean {
    if (this.isSlotDimmedFn) {
      return this.isSlotDimmedFn(slot);
    }
    return this.dimmedSlotIds.has(slot.id);
  }

  isFeedPaused(cameraName?: string): boolean {
    if (!cameraName) return false;
    if (this.isFeedPausedFn) {
      return this.isFeedPausedFn(cameraName);
    }
    return !!this.pausedFeeds[cameraName] || !!this.flashEffects[cameraName + '_paused'];
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

  onImageLoad(event: Event): void {
    const target = event.target as HTMLElement;
    if (target) {
      target.style.display = '';
    }
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLElement;
    if (target) {
      target.style.display = 'none';
    }
  }

  // --- Manejadores de Eventos del Lienzo ---
  onSlotClick(slot: GridSlot, event: MouseEvent): void {
    this.slotClick.emit({ slot, event });
  }

  onSlotDblClick(slot: GridSlot, event: MouseEvent): void {
    this.slotDblClick.emit({ slot, event });
  }

  onSlotMouseDown(slot: GridSlot, event: MouseEvent, index: number): void {
    this.slotMouseDown.emit({ slot, event, index });
  }

  onRefreshCameraStream(slot: GridSlot, event: MouseEvent): void {
    event.stopPropagation();
    this.slotRefreshStream.emit(slot);
  }

  onTakeSnapshot(slot: GridSlot, event: MouseEvent): void {
    event.stopPropagation();
    this.slotTakeSnapshot.emit(slot);
  }

  onToggleLockSlot(slot: GridSlot, event: MouseEvent): void {
    event.stopPropagation();
    this.slotToggleLock.emit(slot);
  }

  onRemoveCameraFromSlot(col: number, row: number, event: MouseEvent): void {
    event.stopPropagation();
    this.slotRemoveCamera.emit({ col, row, event });
  }

  onInitResize(slot: GridSlot, event: MouseEvent, cardEl: HTMLElement): void {
    event.stopPropagation();
    this.slotResizeInit.emit({ slot, event, element: cardEl });
  }

  onSlotMouseEnter(cardEl: HTMLElement): void {
    this.checkSlotMarquee(cardEl);
    this.slotMouseEnter.emit(cardEl);
  }

  onSlotMouseLeave(cardEl: HTMLElement): void {
    this.clearSlotMarquee(cardEl);
    this.slotMouseLeave.emit(cardEl);
  }

  checkSlotMarquee(cardEl: HTMLElement): void {
    if (!cardEl) return;
    const titleEl = cardEl.querySelector('.slot-camera-name') as HTMLElement | null;
    const containerEl = cardEl.querySelector('.slot-camera-name-container') as HTMLElement | null;
    if (!titleEl || !containerEl) return;

    const availableWidth = containerEl.clientWidth;
    const textWidth = titleEl.scrollWidth;

    if (textWidth > (availableWidth + 2) && availableWidth > 0) {
      const shift = Math.ceil(textWidth - availableWidth) + 16;
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

  onExpanderClick(col: number, row: number, type: 'add-column' | 'add-row'): void {
    this.expanderClick.emit({ col, row, type });
  }
}
