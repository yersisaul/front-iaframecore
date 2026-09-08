import {
  Component,
  OnInit,
  OnDestroy,
  AfterViewInit,
  ElementRef,
  inject,
  signal,
  computed,
  effect,
  HostListener,
  ChangeDetectorRef,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MonitoringStateService, GridSlot } from '../../../core/services/monitoring-state.service';
import { getCameraEffectiveStatus, getCameraStatusCssClass, getCameraStatusFilterLabel } from '../../../core/utils/camera-status.utils';
import { parseUtcDate } from '../../../core/utils/date-utils';
import { Camera } from '../../../core/domain/entities/camera.models';

@Component({
  selector: 'app-monitoring-pip',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './monitoring-pip.component.html',
  styleUrl: './monitoring-pip.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MonitoringPipComponent implements OnInit, OnDestroy, AfterViewInit {
  public stateService = inject(MonitoringStateService);
  private cdr = inject(ChangeDetectorRef);
  private elementRef = inject(ElementRef);

  // Inactividad: 10 minutos (600,000 ms)
  private readonly INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
  private inactivityTimer: any = null;

  // Visibilidad de los controles en la parte superior (aparecen en hover / interacción)
  readonly showControls = signal<boolean>(false);
  private controlsHideTimeout: any = null;

  // Estados de arrastre, redimensionamiento y expansión calculada
  readonly isDragging = signal<boolean>(false);
  readonly isResizing = signal<boolean>(false);
  readonly isExpanding = signal<boolean>(false);
  readonly expandingLeft = signal<number | null>(null);
  readonly expandingTop = signal<number | null>(null);
  readonly expandingWidth = signal<number | null>(null);
  readonly expandingHeight = signal<number | null>(null);
  private activeResizeEdge: string | null = null;

  private dragStartMouseX = 0;
  private dragStartMouseY = 0;
  private dragStartPosX = 0;
  private dragStartPosY = 0;
  private hasMovedDuringDrag = false;

  private resizeStartWidth = 0;
  private resizeStartHeight = 0;
  private resizeStartMouseX = 0;
  private resizeStartMouseY = 0;

  // Estados de desplazamiento (Panning) y Zoom independientes y centrados para el PiP
  readonly isPanning = signal<boolean>(false);
  private panStartMouseX = 0;
  private panStartMouseY = 0;
  private panStartCanvasX = 0;
  private panStartCanvasY = 0;

  readonly pipPanX = this.stateService.canvasPanX;
  readonly pipPanY = this.stateService.canvasPanY;
  readonly pipZoom = this.stateService.canvasZoom;

  // Referencias a los slots del servicio singleton
  readonly gridSlots = this.stateService.gridSlots;
  readonly cols = this.stateService.cols;
  readonly rows = this.stateService.rows;

  readonly isPaused = this.stateService.isMonitoringPaused;
  readonly isInactivityPaused = this.stateService.isPipInactivityPaused;
  readonly isPipMinimized = this.stateService.isPipMinimized;
  readonly isEventPulsing = this.stateService.isEventPulsing;
  readonly webRtcStates = this.stateService.webRtcStates;

  readonly activeCameraCount = this.stateService.activeCameraCount;
  readonly isVisible = this.stateService.isPipVisible;

  // Réplica exacta 1:1 del lienzo de monitoreo (conserva posiciones, espacios vacíos y redimensionamientos spanX/spanY)
  readonly visibleGridSlots = computed(() => {
    const slots = this.gridSlots();
    const totalCols = Math.max(1, this.cols());
    const totalRows = Math.max(1, this.rows());

    const cells: (GridSlot & { isEmpty: boolean })[] = [];
    const occupiedSet = new Set<string>();

    // 1. Slots configurados (con sus posiciones col/row y dimensiones spanX/spanY)
    slots.forEach(s => {
      for (let r = s.row; r < s.row + s.spanY; r++) {
        for (let c = s.col; c < s.col + s.spanX; c++) {
          occupiedSet.add(`${r},${c}`);
        }
      }
      cells.push({ ...s, isEmpty: s.camera === null });
    });

    // 2. Espacios vacíos correspondientes a las coordenadas de la cuadrícula
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
    // Sincronizar elementos de video y centrar lienzo cuando el PiP se hace visible
    effect(() => {
      if (this.isVisible()) {
        setTimeout(() => {
          this.centerPipCanvas();
          if (!this.isPaused()) {
            this.attachAllLiveVideos();
          }
        }, 120);
      }
    });
  }

  ngOnInit(): void {
    this.resetInactivityTimer();
  }

  ngAfterViewInit(): void {
    this.ensureDefaultPosition();
    this.centerPipCanvas();
    this.attachAllLiveVideos();
  }

  ngOnDestroy(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
    if (this.controlsHideTimeout) {
      clearTimeout(this.controlsHideTimeout);
    }
  }

  // --- Prevenir Menú Contextual del Navegador en el PiP ---

  @HostListener('contextmenu', ['$event'])
  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  // --- Zoom Mínimo Acotado al Centrado Completo del PiP ---

  getMinZoom(): number {
    const pipSize = this.stateService.pipSize();
    const viewportW = pipSize.width;
    const viewportH = pipSize.height;
    const { width: totalW, height: totalH } = this.getCanvasDimensions();
    if (totalW <= 0 || totalH <= 0) return 0.05;

    const zoomToFitX = (viewportW * 0.90) / totalW;
    const zoomToFitY = (viewportH * 0.90) / totalH;
    return Math.min(zoomToFitX, zoomToFitY);
  }

  // --- Centrado por Defecto a Todas las Cámaras ---

  centerPipCanvas(): void {
    const pipSize = this.stateService.pipSize();
    const viewportW = pipSize.width;
    const viewportH = pipSize.height;

    const { width: totalW, height: totalH } = this.getCanvasDimensions();
    const currentZoom = this.pipZoom();
    const rawPanX = (viewportW - totalW * currentZoom) / 2;
    const rawPanY = (viewportH - totalH * currentZoom) / 2;

    const constrained = this.constrainPan(rawPanX, rawPanY, currentZoom);

    this.pipPanX.set(constrained.x);
    this.pipPanY.set(constrained.y);
  }

  // --- Zoom In / Zoom Out con Rueda del Ratón (Wheel) con Límites y Punto Focal ---

  onCanvasWheel(event: WheelEvent): void {
    event.preventDefault();
    event.stopPropagation();

    this.onPipUserActivity();

    const zoomDelta = event.deltaY < 0 ? 0.08 : -0.08;
    const currentZoom = this.pipZoom();
    const minZoom = this.getMinZoom();
    const nextZoom = Math.max(minZoom, Math.min(5.0, currentZoom + zoomDelta));

    const pipEl = this.elementRef.nativeElement.querySelector('.monitoring-pip-window');
    if (!pipEl) {
      this.pipZoom.set(nextZoom);
      return;
    }

    const rect = pipEl.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    const canvasX = (mouseX - this.pipPanX()) / currentZoom;
    const canvasY = (mouseY - this.pipPanY()) / currentZoom;

    const newPanX = mouseX - canvasX * nextZoom;
    const newPanY = mouseY - canvasY * nextZoom;

    const constrained = this.constrainPan(newPanX, newPanY, nextZoom);

    this.pipZoom.set(nextZoom);
    this.pipPanX.set(constrained.x);
    this.pipPanY.set(constrained.y);
  }

  // --- Temporizador de Inactividad de 10 Minutos ---
  private lastActivityTimestamp = 0;

  @HostListener('pointerdown')
  @HostListener('wheel')
  @HostListener('touchstart')
  onPipUserActivity(): void {
    const now = Date.now();
    if (now - this.lastActivityTimestamp < 2000 && !this.isInactivityPaused()) {
      return;
    }
    this.lastActivityTimestamp = now;

    // Si estaba pausado por inactividad, reactivar inmediatamente al interactuar
    if (this.isInactivityPaused()) {
      this.resumeStreaming();
    } else {
      this.resetInactivityTimer();
    }

    // Mostrar controles en interacción
    this.revealControls();
  }

  private resetInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }

    this.inactivityTimer = setTimeout(() => {
      console.log('[MonitoringPip] 10 minutos de inactividad alcanzados. Pausando y difuminando PiP.');
      this.stateService.pauseAllStreams(true);
      this.cdr.markForCheck();
    }, this.INACTIVITY_LIMIT_MS);
  }

  // --- Controles de la Barra Superior ---

  revealControls(): void {
    this.showControls.set(true);
    if (this.controlsHideTimeout) {
      clearTimeout(this.controlsHideTimeout);
    }

    // Ocultar automáticamente tras 2.5s si no está en pausa ni inactivo
    if (!this.isPaused() && !this.isInactivityPaused()) {
      this.controlsHideTimeout = setTimeout(() => {
        if (!this.isDragging() && !this.isResizing() && !this.isPanning()) {
          this.showControls.set(false);
          this.cdr.markForCheck();
        }
      }, 2500);
    }
  }

  onMouseLeavePip(): void {
    if (!this.isPaused() && !this.isInactivityPaused() && !this.isDragging() && !this.isPanning()) {
      this.showControls.set(false);
    }
  }

  togglePause(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (this.isPaused()) {
      this.resumeStreaming();
    } else {
      this.stateService.pauseAllStreams(false);
    }
    this.resetInactivityTimer();
    this.revealControls();
  }

  resumeStreaming(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.stateService.resumeAllStreams();
    this.resetInactivityTimer();
    this.revealControls();
    setTimeout(() => this.attachAllLiveVideos(), 150);
  }

  /**
   * Obtiene la posición y dimensiones exactas del lienzo del Visor Táctico (.monitoring-grid-container)
   * para limitar el crecimiento del PiP exactamente al marco del lienzo de monitoreo de cámaras.
   */
  getTargetGridRect(): { left: number; top: number; width: number; height: number } {
    const existingContainer = document.querySelector('.monitoring-grid-container') as HTMLElement;
    if (existingContainer) {
      const r = existingContainer.getBoundingClientRect();
      if (r.width > 100 && r.height > 100) {
        return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
      }
    }

    const mainContent = (document.querySelector('.main-content') || document.querySelector('.main-container') || document.body) as HTMLElement;
    const mainRect = mainContent ? mainContent.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

    // Medidas calculadas pixel-perfect del layout de Monitoreo:
    const paddingLeft = 24; // px (container-fluid padding left)
    const headerTopTotal = 94; // px (pt-4: 24px + view-header: 46px + mb-4: 24px)
    const bottomTotal = 72; // px (timeline: 52px + gap: 12px + pb-2: 8px)
    
    // Panel lateral derecho de eventos (30% del ancho disponible, mínimo 352px, máximo 512px)
    const rightPanelWidth = Math.min(512, Math.max(352, (mainRect.width - 48) * 0.30));
    const layoutGap = 14; // px (gap: 0.85rem)
    const rightTotal = 24 + rightPanelWidth + layoutGap;

    const targetLeft = mainRect.left + paddingLeft;
    const targetTop = mainRect.top + headerTopTotal;
    const targetWidth = Math.max(320, mainRect.width - paddingLeft - rightTotal);
    const targetHeight = Math.max(200, mainRect.height - headerTopTotal - bottomTotal);

    return {
      left: Math.round(targetLeft),
      top: Math.round(targetTop),
      width: Math.round(targetWidth),
      height: Math.round(targetHeight)
    };
  }

  /**
   * Expande de forma calculada el PiP creciendo suavemente desde sus coordenadas actuales
   * hasta ocupar exactamente el tamaño del lienzo de Monitoreo de cámaras (.monitoring-grid-container),
   * conservando el zoom y desplazamiento del lienzo para una transición continua y estética.
   */
  expandToMonitoring(event?: Event): void {
    if (event) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (this.isExpanding()) return;

    const pipEl = this.elementRef.nativeElement.querySelector('.monitoring-pip-window') as HTMLElement;
    if (!pipEl) {
      this.stateService.navigateToMonitoring();
      return;
    }

    // 1. Posición y tamaño exacto actual del PiP medidos en tiempo real
    const startRect = pipEl.getBoundingClientRect();

    // 2. Área objetivo exacta del lienzo del Visor Táctico (.monitoring-grid-container)
    const targetRect = this.getTargetGridRect();

    // 3. Zoom y Pan del PiP que se conservan idénticos en el Visor Táctico
    const pipCurrentZoom = Math.max(0.05, this.pipZoom());
    const pipCurrentPanX = this.pipPanX();
    const pipCurrentPanY = this.pipPanY();

    // Sincronizar de inmediato al servicio de estado para que Monitoreo use exactamente este mismo zoom
    this.stateService.canvasZoom.set(pipCurrentZoom);
    this.stateService.canvasPanX.set(pipCurrentPanX);
    this.stateService.canvasPanY.set(pipCurrentPanY);

    // 4. Fijar explícitamente las coordenadas iniciales en los signals
    this.expandingLeft.set(startRect.left);
    this.expandingTop.set(startRect.top);
    this.expandingWidth.set(startRect.width);
    this.expandingHeight.set(startRect.height);

    this.isExpanding.set(true);

    // 5. En el siguiente ciclo de renderizado, animar hacia el área exacta del lienzo de monitoreo conservando el zoom
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.expandingLeft.set(targetRect.left);
        this.expandingTop.set(targetRect.top);
        this.expandingWidth.set(targetRect.width);
        this.expandingHeight.set(targetRect.height);

        // El zoom y pan se conservan constantes durante toda la animación
        this.pipZoom.set(pipCurrentZoom);
        this.pipPanX.set(pipCurrentPanX);
        this.pipPanY.set(pipCurrentPanY);
      });
    });

    // 6. Al finalizar la animación (420ms), completar la navegación hacia el visor táctico
    setTimeout(() => {
      this.stateService.navigateToMonitoring();
      setTimeout(() => {
        this.isExpanding.set(false);
        this.expandingLeft.set(null);
        this.expandingTop.set(null);
        this.expandingWidth.set(null);
        this.expandingHeight.set(null);
      }, 150);
    }, 420);
  }

  goToFullScreenMonitoring(event?: Event): void {
    this.expandToMonitoring(event);
  }

  closePip(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.stateService.closePip();
  }

  // --- Vinculación de Video Streams y Eventos ---

  attachAllLiveVideos(): void {
    const slots = this.gridSlots();
    for (const slot of slots) {
      if (slot.camera) {
        const videoEl = document.getElementById(`pip-video-feed-${slot.id}`) as HTMLVideoElement;
        if (videoEl) {
          const connKey = `${slot.id}_${slot.camera.id}`;
          if (this.stateService.mediaStreamsMap.has(slot.id)) {
            this.stateService.attachStreamToVideo(slot.id, videoEl);
          } else if (!this.isPaused()) {
            this.stateService.startWebRtcStreamByKey(slot, connKey, videoEl);
          }
        }
      }
    }
  }

  getDisplayedEventForSlot(slot: GridSlot): any | null {
    if (!slot || !slot.camera) return null;
    return this.stateService.getLatestEventForCamera(slot.camera.name, slot.camera.id);
  }

  // --- Desplazamiento (Panning con Clic Derecho) y Arrastre de Ventana (Clic Izquierdo) ---

  onOverlayMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('button') || target.closest('.pip-yt-action-btn')) {
      return;
    }

    // 1. CLIC DERECHO O BOTÓN CENTRAL: Panning / Desplazarse por el lienzo dentro del PiP
    if (event.button === 2 || event.button === 1) {
      event.preventDefault();
      event.stopPropagation();

      this.isPanning.set(true);
      this.panStartMouseX = event.clientX;
      this.panStartMouseY = event.clientY;
      this.panStartCanvasX = this.pipPanX();
      this.panStartCanvasY = this.pipPanY();

      const onMouseMove = (e: MouseEvent) => {
        if (!this.isPanning()) return;
        const deltaX = e.clientX - this.panStartMouseX;
        const deltaY = e.clientY - this.panStartMouseY;

        const rawPanX = this.panStartCanvasX + deltaX;
        const rawPanY = this.panStartCanvasY + deltaY;
        const constrained = this.constrainPan(rawPanX, rawPanY, this.pipZoom());

        this.pipPanX.set(constrained.x);
        this.pipPanY.set(constrained.y);
        this.onPipUserActivity();
      };

      const onMouseUp = () => {
        this.isPanning.set(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      return;
    }

    // 2. CLIC IZQUIERDO: Mover / Arrastrar la ventana flotante PiP
    if (event.button === 0) {
      event.preventDefault();
      this.isDragging.set(true);
      this.hasMovedDuringDrag = false;
      this.dragStartMouseX = event.clientX;
      this.dragStartMouseY = event.clientY;

      const currentPos = this.stateService.pipPosition() || this.getDefaultPosition();
      this.dragStartPosX = currentPos.x;
      this.dragStartPosY = currentPos.y;

      const onMouseMove = (e: MouseEvent) => {
        if (!this.isDragging()) return;
        const deltaX = e.clientX - this.dragStartMouseX;
        const deltaY = e.clientY - this.dragStartMouseY;

        if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
          this.hasMovedDuringDrag = true;
        }

        const size = this.stateService.pipSize();
        const maxX = window.innerWidth - size.width - 12;
        const maxY = window.innerHeight - size.height - 12;

        const newX = Math.max(12, Math.min(maxX, this.dragStartPosX + deltaX));
        const newY = Math.max(12, Math.min(maxY, this.dragStartPosY + deltaY));

        this.stateService.pipPosition.set({ x: newX, y: newY });
        this.resetInactivityTimer();
      };

      const onMouseUp = () => {
        this.isDragging.set(false);
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
  }

  onOverlayClick(event: MouseEvent): void {
    if (this.hasMovedDuringDrag) {
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest('button')) {
      return;
    }

    if (this.isPaused() || this.isInactivityPaused()) {
      this.resumeStreaming();
    } else {
      this.revealControls();
    }
  }

  getCanvasAspectRatio(): number {
    const targetRect = this.getTargetGridRect();
    if (targetRect.width > 50 && targetRect.height > 50) {
      return targetRect.width / targetRect.height;
    }
    return 16 / 10;
  }

  // --- Redimensionamiento (Resize) de la Ventana PiP con Relación de Aspecto Bloqueada ---

  onResizeHandleMouseDown(event: MouseEvent, edge: string): void {
    event.preventDefault();
    event.stopPropagation();

    this.isResizing.set(true);
    this.activeResizeEdge = edge;
    this.resizeStartMouseX = event.clientX;
    this.resizeStartMouseY = event.clientY;

    const currentSize = this.stateService.pipSize();
    this.resizeStartWidth = currentSize.width;
    this.resizeStartHeight = currentSize.height;

    const currentPos = this.stateService.pipPosition() || this.getDefaultPosition();
    const startPosX = currentPos.x;
    const startPosY = currentPos.y;

    const ar = this.getCanvasAspectRatio();
    const minW = 320;
    const maxW = Math.min(Math.round(window.innerWidth * 0.92), Math.round((window.innerHeight * 0.88) * ar));
    const minH = Math.round(minW / ar);
    const maxH = Math.round(maxW / ar);

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isResizing()) return;
      const deltaX = e.clientX - this.resizeStartMouseX;
      const deltaY = e.clientY - this.resizeStartMouseY;

      let calcWidth = this.resizeStartWidth;
      let newPosX = startPosX;
      let newPosY = startPosY;

      if (edge === 'right' || edge === 'edge-right') {
        calcWidth = this.resizeStartWidth + deltaX;
      } else if (edge === 'bottom' || edge === 'edge-bottom') {
        calcWidth = (this.resizeStartHeight + deltaY) * ar;
      } else if (edge === 'bottom-right' || edge === 'corner-bottom-right') {
        const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY * ar) ? deltaX : deltaY * ar;
        calcWidth = this.resizeStartWidth + dominantDelta;
      } else if (edge === 'left' || edge === 'edge-left') {
        calcWidth = this.resizeStartWidth - deltaX;
        const clampedW = Math.max(minW, Math.min(maxW, calcWidth));
        newPosX = startPosX + (this.resizeStartWidth - clampedW);
      } else if (edge === 'top' || edge === 'edge-top') {
        const calcHeight = this.resizeStartHeight - deltaY;
        calcWidth = calcHeight * ar;
        const clampedH = Math.max(minH, Math.min(maxH, calcHeight));
        newPosY = startPosY + (this.resizeStartHeight - clampedH);
      } else if (edge === 'bottom-left' || edge === 'corner-bottom-left') {
        const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY * ar) ? -deltaX : deltaY * ar;
        calcWidth = this.resizeStartWidth + dominantDelta;
        const clampedW = Math.max(minW, Math.min(maxW, calcWidth));
        newPosX = startPosX + (this.resizeStartWidth - clampedW);
      } else if (edge === 'top-right' || edge === 'corner-top-right') {
        const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY * ar) ? deltaX : -deltaY * ar;
        calcWidth = this.resizeStartWidth + dominantDelta;
        const clampedH = Math.max(minH, Math.min(maxH, Math.round(calcWidth / ar)));
        newPosY = startPosY + (this.resizeStartHeight - clampedH);
      } else if (edge === 'top-left' || edge === 'corner-top-left') {
        const dominantDelta = Math.abs(deltaX) > Math.abs(deltaY * ar) ? -deltaX : -deltaY * ar;
        calcWidth = this.resizeStartWidth + dominantDelta;
        const clampedW = Math.max(minW, Math.min(maxW, calcWidth));
        const clampedH = Math.round(clampedW / ar);
        newPosX = startPosX + (this.resizeStartWidth - clampedW);
        newPosY = startPosY + (this.resizeStartHeight - clampedH);
      }

      const finalWidth = Math.max(minW, Math.min(maxW, Math.round(calcWidth)));
      const finalHeight = Math.round(finalWidth / ar);

      if (edge.includes('left')) {
        newPosX = startPosX + (this.resizeStartWidth - finalWidth);
      }
      if (edge.includes('top')) {
        newPosY = startPosY + (this.resizeStartHeight - finalHeight);
      }

      // Clamping dentro del viewport de pantalla
      newPosX = Math.max(10, Math.min(window.innerWidth - finalWidth - 10, newPosX));
      newPosY = Math.max(10, Math.min(window.innerHeight - finalHeight - 10, newPosY));

      this.stateService.pipSize.set({ width: finalWidth, height: finalHeight });
      this.stateService.pipPosition.set({ x: newPosX, y: newPosY });

      const constrained = this.constrainPan(this.pipPanX(), this.pipPanY(), this.pipZoom());
      this.pipPanX.set(constrained.x);
      this.pipPanY.set(constrained.y);

      this.resetInactivityTimer();
    };

    const onMouseUp = () => {
      this.isResizing.set(false);
      this.activeResizeEdge = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  // --- Dimensiones y Posicionamiento de la Cuadrícula ---

  private getDefaultPosition(): { x: number; y: number } {
    const size = this.stateService.pipSize();
    const x = Math.max(16, window.innerWidth - size.width - 24);
    const y = Math.max(16, window.innerHeight - size.height - 24);
    return { x, y };
  }

  private ensureDefaultPosition(): void {
    const ar = this.getCanvasAspectRatio();
    const currentSize = this.stateService.pipSize();
    const idealWidth = Math.max(360, currentSize.width);
    const idealHeight = Math.round(idealWidth / ar);
    this.stateService.pipSize.set({ width: idealWidth, height: idealHeight });

    if (!this.stateService.pipPosition()) {
      this.stateService.pipPosition.set(this.getDefaultPosition());
    }
  }

  getCellDimensions(): { cellW: number; cellH: number } {
    const colsVal = Math.max(1, this.cols());
    const refCols = 4;
    // Dimensiones base de celda proporcionales a 16:9 idénticas a Monitoreo
    const availableWidth = 1200 - 20 - (refCols - 1) * 12;
    const cellW = Math.max(180, availableWidth / refCols);
    const cellH = Math.round(cellW * (9 / 16));
    return { cellW, cellH };
  }

  getSlotDimensions(): { cellW: number; cellH: number } {
    return this.getCellDimensions();
  }

  getExtenderDimensions(): { width: number; height: number } {
    const zoom = Math.max(0.05, this.isExpanding() ? this.stateService.canvasZoom() : this.pipZoom());
    const width = Math.round(48 / zoom);
    const height = Math.round(48 / zoom);
    return { width, height };
  }

  getCanvasDimensions(): { width: number; height: number } {
    const { cellW, cellH } = this.getCellDimensions();
    const colsVal = Math.max(1, this.cols());
    const rowsVal = Math.max(1, this.rows());

    // Al expandir hacia el Visor Táctico, incluir las dimensiones de los expansores de fila y columna
    const extDim = this.getExtenderDimensions();
    const expanderW = this.isExpanding() ? extDim.width : 0;
    const expanderH = this.isExpanding() ? extDim.height : 0;

    const width = colsVal * cellW + (colsVal - 1) * 12 + 20 + expanderW;
    const height = rowsVal * cellH + (rowsVal - 1) * 12 + 20 + expanderH;
    return { width, height };
  }

  constrainPan(panX: number, panY: number, zoom: number): { x: number; y: number } {
    const { width: totalW, height: totalH } = this.getCanvasDimensions();
    const pipSize = this.stateService.pipSize();
    const viewportW = pipSize.width;
    const viewportH = pipSize.height;

    // Límites de desplazamiento acotados idénticos a Monitoreo (margen buffer del 12% del viewport)
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

  // Helpers de estado de cámara
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

  isCameraNameOverflowing(name: string | undefined | null, spanX: number = 1): boolean {
    if (!name) return false;
    // Determina si el texto excede el espacio visual disponible según el span de la tarjeta
    const maxChars = spanX * 18;
    return name.trim().length > maxChars;
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
}
