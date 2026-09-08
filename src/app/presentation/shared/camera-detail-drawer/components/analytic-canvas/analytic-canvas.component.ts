import { Component, Input, Output, EventEmitter, signal, computed, ElementRef, ViewChild, HostListener, AfterViewInit, OnDestroy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface Point2D {
  x: number; // Normalizado 0..1000
  y: number; // Normalizado 0..1000
}

export interface CanvasShape {
  id: string;
  points: Point2D[];
  isClosed: boolean;
}

interface CanvasSnapshot {
  shapes: CanvasShape[];
}

@Component({
  selector: 'app-analytic-canvas',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analytic-canvas.component.html',
  styleUrls: ['./analytic-canvas.component.css']
})
export class AnalyticCanvasComponent implements AfterViewInit, OnDestroy, OnChanges {
  @Input() imageUrl: string = '';
  @Input() cameraId: string = '';
  @Input() strDirection: string = 'Bidireccional';
  @Input() geometryType: 'polygon' | 'speed_quad' | 'line' = 'polygon';
  @Input() maxShapes: number = 10;
  @Input() scaleFactor: number = 1.2;
  @Input() zoneWidth: number = 40;
  @Input() speedDistAB: number = 14;
  @Input() speedDistBC: number = 60;
  @Input() initialData: any = null;
  @Input() highlightError: boolean = false;

  @Output() geometryChanged = new EventEmitter<any>();

  @ViewChild('canvasContainer', { static: false }) canvasContainer!: ElementRef<HTMLDivElement>;

  // Estado primario de formas/áreas en el lienzo
  readonly shapes = signal<CanvasShape[]>([]);
  readonly activeDragInfo = signal<{ shapeIndex: number; pointIndex: number } | null>(null);
  readonly canvasAspectRatio = signal<number>(1.7778);
  // Estados interactivos para UX/UI avanzadas
  readonly currentMousePos = signal<Point2D | null>(null);
  readonly hoverEdgeInfo = signal<{ shapeIndex: number; edgeIndex: number; splitPoint: Point2D } | null>(null);
  readonly draggingGroupInfo = signal<{ shapeIndexes: number[]; startMouse: Point2D; initialShapesPoints: Map<number, Point2D[]> } | null>(null);
  readonly selectedShapeIndexes = signal<Set<number>>(new Set());
  readonly selectedShapeIndex = computed<number | null>(() => this.selectedShapeIndexes().size > 0 ? Array.from(this.selectedShapeIndexes())[0] : null);
  readonly recentlyClosedShapeIndex = signal<number | null>(null);
  readonly hoveredShapeIndex = signal<number | null>(null);
  readonly contextMenuState = signal<{ shapeIndex: number; x: number; y: number } | null>(null);
  readonly isMagnetSnapped = signal<boolean>(false);

  // Dimensiones del contenedor medidas dinámicamente para reactividad en cualquier resolución
  readonly containerWidth = signal<number>(800);
  readonly containerHeight = signal<number>(450);
  readonly imageAspectRatio = signal<number | null>(null);

  // Resolución Nativa Real de la Captura de Cámara (Adaptable dinámicamente a la resolución original de la cámara)
  readonly naturalImageWidth = signal<number>(1920);
  readonly naturalImageHeight = signal<number>(1080);
  readonly hasDeterminedResolution = signal<boolean>(false);

  // Conversión entre Pixeles Reales de Imagen (0..naturalWidth / 0..naturalHeight) y Pixeles SVG del Contenedor (0..Width / 0..Height)
  toSvgX(imgX: number): number {
    const maxW = this.naturalImageWidth();
    const containerW = this.containerWidth();
    if (!maxW || !containerW) return 0;
    return (imgX / maxW) * containerW;
  }

  toSvgY(imgY: number): number {
    const maxH = this.naturalImageHeight();
    const containerH = this.containerHeight();
    if (!maxH || !containerH) return 0;
    return (imgY / maxH) * containerH;
  }

  toNormX(svgX: number): number {
    const w = this.containerWidth() || 800;
    const maxW = this.naturalImageWidth();
    const rawX = Math.round((svgX / w) * maxW);
    const snapMargin = Math.round(maxW * 0.02); // Snap magnético a 2% del borde real de imagen
    if (rawX <= snapMargin) return 0;
    if (rawX >= maxW - snapMargin) return maxW;
    return Math.max(0, Math.min(maxW, rawX));
  }

  toNormY(svgY: number): number {
    const h = this.containerHeight() || 450;
    const maxH = this.naturalImageHeight();
    const rawY = Math.round((svgY / h) * maxH);
    const snapMargin = Math.round(maxH * 0.02); // Snap magnético a 2% del borde real de imagen
    if (rawY <= snapMargin) return 0;
    if (rawY >= maxH - snapMargin) return maxH;
    return Math.max(0, Math.min(maxH, rawY));
  }

  get magnetSnapThresholdReal(): number {
    // 4% del ancho nativo real de la imagen
    return (this.naturalImageWidth() || 1920) * 0.04;
  }

  formatSvgPoints(points: Point2D[]): string {
    return points.map(p => `${this.toSvgX(p.x).toFixed(1)},${this.toSvgY(p.y).toFixed(1)}`).join(' ');
  }

  // Radios SVG dinámicos en pixeles reales (100% circulares, cero deformación)
  readonly coreRadius = 6;
  readonly haloRadius = 14;
  readonly labelFontSizeValue = 13;
  readonly imageUrlSignal = signal<string>('');

  readonly effectiveImageUrl = computed(() => {
    return this.imageUrlSignal() || this.imageUrl || '';
  });

  readonly imageFailed = signal<boolean>(false);

  // Estado de bloqueo total del lienzo cuando no hay imagen disponible (Prioridad 3)
  readonly isCanvasLocked = computed<boolean>(() => !this.effectiveImageUrl() || this.imageFailed());

  // Historial Undo/Redo (deshabilitado cuando el lienzo está bloqueado)
  readonly undoStack = signal<CanvasSnapshot[]>([]);
  readonly redoStack = signal<CanvasSnapshot[]>([]);
  readonly canUndo = computed(() => !this.isCanvasLocked() && this.undoStack().length > 0);
  readonly canRedo = computed(() => !this.isCanvasLocked() && this.redoStack().length > 0);

  // Signal reactivo para cambios de tipo de geometría en tiempo real
  readonly currentGeometryType = signal<'polygon' | 'speed_quad' | 'line'>('polygon');

  // Estado derivado
  readonly totalShapesCount = computed(() => this.shapes().length);
  readonly totalPointsCount = computed(() => this.shapes().reduce((acc, s) => acc + s.points.length, 0));
  readonly isSpeedQuad = computed(() => this.currentGeometryType() === 'speed_quad');
  readonly isLine = computed(() => this.currentGeometryType() === 'line');

  readonly activeOpenShape = computed(() => {
    if (this.isCanvasLocked()) return null;
    const current = this.shapes();
    if (current.length === 0) return null;
    const last = current[current.length - 1];
    return !last.isClosed ? last : null;
  });

  readonly geometryStatusLabel = computed(() => {
    if (this.isCanvasLocked()) {
      return this.shapes().length > 0
        ? `${this.shapes().length} ${this.shapes().length === 1 ? 'área' : 'áreas'} (Solo lectura)`
        : 'Solo lectura · Sin captura';
    }
    const gType = this.currentGeometryType();
    const typeName = gType === 'polygon' ? 'Polígono'
      : gType === 'speed_quad' ? 'Cuadrilátero'
        : 'Línea';
    const count = this.totalShapesCount();
    const max = this.maxShapes || 10;
    const pts = this.totalPointsCount();
    const activeOpen = this.activeOpenShape();
    if (activeOpen) {
      return `Trazando (${activeOpen.points.length} pts) — Clic en 1er punto para cerrar`;
    }
    if (count === 0) return `${typeName} · 0/${max}`;
    return `${typeName} · ${count}/${max} (${pts} pts)`;
  });

  private resizeObserver: ResizeObserver | null = null;

  onImageError(event: Event): void {
    this.imageFailed.set(true);
  }

  // --- Lifecycle ---

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['imageUrl']) {
      this.imageUrlSignal.set(this.imageUrl || '');
      this.imageFailed.set(false);
    }
    if (changes['initialData'] && this.initialData) {
      this.loadInitialData(this.initialData);
    }
    if (changes['maxShapes']) {
      const limit = this.maxShapes || 10;
      if (this.shapes().length > limit) {
        this.shapes.update(list => list.slice(0, limit));
        this.emitGeometry();
      }
    }
    if (changes['zoneWidth']) {
      if (this.shapes().length > 0) {
        this.emitGeometry();
      }
    }
    if (changes['scaleFactor']) {
      if (this.shapes().length > 0) {
        this.emitGeometry();
      }
    }
    if (changes['geometryType']) {
      const newType = this.geometryType || 'polygon';
      const oldType = changes['geometryType'].previousValue;
      this.currentGeometryType.set(newType);
      if (!changes['geometryType'].firstChange && oldType && oldType !== newType) {
        const current = this.shapes();
        const isCompatible = (newType === 'polygon' && current.some(s => s.points.length >= 3)) ||
          (newType === 'line' && current.some(s => s.points.length === 2)) ||
          (newType === 'speed_quad' && current.some(s => s.points.length === 4));
        if (!isCompatible) {
          // Reiniciar el lienzo únicamente cuando el tipo de analítica cambie de verdad a un tipo incompatible
          this.shapes.set([]);
          this.activeDragInfo.set(null);
          this.draggingGroupInfo.set(null);
          this.hoverEdgeInfo.set(null);
          this.selectedShapeIndexes.set(new Set());
          this.undoStack.set([]);
          this.redoStack.set([]);
          this.closeContextMenu();
          this.emitGeometry();
        }
      }
    }
  }

  ngAfterViewInit(): void {
    if (this.canvasContainer?.nativeElement) {
      this.updateCanvasAspectRatio();
      this.resizeObserver = new ResizeObserver(() => this.updateCanvasAspectRatio());
      this.resizeObserver.observe(this.canvasContainer.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
  }

  updateCanvasAspectRatio(): void {
    if (this.canvasContainer?.nativeElement) {
      const rect = this.canvasContainer.nativeElement.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        this.containerWidth.set(rect.width);
        this.containerHeight.set(rect.height);
        this.canvasAspectRatio.set(rect.width / rect.height);
      }
    }
  }

  private cachedInitialData: any = null;

  onImageLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      const newW = img.naturalWidth;
      const newH = img.naturalHeight;
      const oldW = this.naturalImageWidth();
      const oldH = this.naturalImageHeight();

      this.naturalImageWidth.set(newW);
      this.naturalImageHeight.set(newH);
      this.imageAspectRatio.set(newW / newH);
      this.hasDeterminedResolution.set(true);

      // Si teníamos datos iniciales esperando la resolución real de la cámara, re-aplicarlos con la resolución nativa
      if (this.cachedInitialData) {
        this.loadInitialData(this.cachedInitialData);
      } else if (this.shapes().length > 0 && (oldW !== newW || oldH !== newH)) {
        // Si el usuario ya había modificado o dibujado puntos, re-escalar proporcionalmente al nuevo tamaño
        this.shapes.update(shapesList =>
          shapesList.map(s => ({
            ...s,
            points: s.points.map(p => ({
              x: Math.max(0, Math.min(newW, Math.round((p.x / oldW) * newW))),
              y: Math.max(0, Math.min(newH, Math.round((p.y / oldH) * newH)))
            }))
          }))
        );
        this.emitGeometry();
      }
    }
    this.updateCanvasAspectRatio();
  }

  private normalizePoints(rawPts: any[]): Point2D[] {
    if (!Array.isArray(rawPts)) return [];
    return rawPts.map(pt => {
      if (pt && typeof pt === 'object') {
        if ('x' in pt && 'y' in pt) {
          return { x: Number(pt.x), y: Number(pt.y) };
        }
        if (Array.isArray(pt) && pt.length >= 2) {
          return { x: Number(pt[0]), y: Number(pt[1]) };
        }
      }
      return { x: 0, y: 0 };
    });
  }

  private loadInitialData(data: any): void {
    if (!data) return;
    this.cachedInitialData = data;

    const currentW = this.naturalImageWidth() || 1920;
    const currentH = this.naturalImageHeight() || 1080;

    const parseAndScalePoints = (rawPts: any[]): Point2D[] => {
      const raw = this.normalizePoints(rawPts);
      if (raw.length === 0) return [];

      // 1. Detectar si los puntos vienen normalizados 0..1
      const isNormalized01 = raw.every(p => p.x <= 1.05 && p.y <= 1.05 && p.x >= 0 && p.y >= 0);
      if (isNormalized01) {
        return raw.map(p => ({
          x: Math.max(0, Math.min(currentW, Math.round(p.x * currentW))),
          y: Math.max(0, Math.min(currentH, Math.round(p.y * currentH)))
        }));
      }

      // 2. Detectar si los puntos provienen de la escala previa del sistema (1920x1080 o 3840x2160)
      const maxX = Math.max(...raw.map(p => p.x), 0);
      const maxY = Math.max(...raw.map(p => p.y), 0);

      if (maxX > currentW || maxY > currentH) {
        let refW = 1920;
        let refH = 1080;
        if (maxX > 1920 || maxY > 1080) {
          refW = 3840;
          refH = 2160;
        }

        const scaleX = currentW / refW;
        const scaleY = currentH / refH;

        return raw.map(p => ({
          x: Math.max(0, Math.min(currentW, Math.round(p.x * scaleX))),
          y: Math.max(0, Math.min(currentH, Math.round(p.y * scaleY)))
        }));
      }

      // 3. Puntos dentro del rango de la resolución de la cámara
      return raw.map(p => ({
        x: Math.max(0, Math.min(currentW, Math.round(p.x))),
        y: Math.max(0, Math.min(currentH, Math.round(p.y)))
      }));
    };

    const polyList = data.polygons || data.poligonos || data.speed_quads || data.areas;
    const lineList = data.lines || data.lineas;
    const pointsList = data.points || data.puntos;

    if (Array.isArray(polyList) && polyList.length > 0) {
      const loaded: CanvasShape[] = polyList.map((p: any, idx: number) => {
        const raw = p.original_area || p.outer_area || p.points || [];
        return {
          id: `shape_init_${idx}`,
          points: parseAndScalePoints(raw),
          isClosed: p.isClosed ?? true
        };
      });
      this.shapes.set(loaded);
      this.emitGeometry();
    } else if (Array.isArray(lineList) && lineList.length > 0) {
      const loaded: CanvasShape[] = lineList.map((l: any, idx: number) => {
        const raw = l.extreme_points || l.points || l.analysis_zone || [];
        const pts = parseAndScalePoints(raw);
        return {
          id: `shape_init_${idx}`,
          points: pts,
          isClosed: pts.length >= 2
        };
      });
      this.shapes.set(loaded);
      this.emitGeometry();
    } else if (Array.isArray(pointsList) && pointsList.length > 0) {
      this.shapes.set([{
        id: 'shape_init_0',
        points: parseAndScalePoints(pointsList),
        isClosed: data.isClosed ?? true
      }]);
      this.emitGeometry();
    }
  }

  // --- Historial Undo/Redo ---

  private pushUndoSnapshot(): void {
    const snapshot: CanvasSnapshot = {
      shapes: this.shapes().map(s => ({
        id: s.id,
        points: s.points.map(p => ({ x: p.x, y: p.y })),
        isClosed: s.isClosed
      }))
    };
    this.undoStack.update(stack => [...stack, snapshot]);
    this.redoStack.set([]);
  }

  undo(): void {
    if (this.isCanvasLocked()) return;
    const stack = this.undoStack();
    if (stack.length === 0) return;

    // Guardar estado actual en redo
    const currentSnapshot: CanvasSnapshot = {
      shapes: this.shapes().map(s => ({
        id: s.id,
        points: s.points.map(p => ({ x: p.x, y: p.y })),
        isClosed: s.isClosed
      }))
    };
    this.redoStack.update(s => [...s, currentSnapshot]);

    // Restaurar estado anterior
    const prev = stack[stack.length - 1];
    this.undoStack.update(s => s.slice(0, -1));
    this.shapes.set(prev.shapes.map(s => ({
      id: s.id,
      points: s.points.map(p => ({ x: p.x, y: p.y })),
      isClosed: s.isClosed
    })));
    this.hoverEdgeInfo.set(null);
    this.isMagnetSnapped.set(false);
    this.closeContextMenu();
    this.emitGeometry();
  }

  redo(): void {
    if (this.isCanvasLocked()) return;
    const stack = this.redoStack();
    if (stack.length === 0) return;

    // Guardar estado actual en undo
    const currentSnapshot: CanvasSnapshot = {
      shapes: this.shapes().map(s => ({
        id: s.id,
        points: s.points.map(p => ({ x: p.x, y: p.y })),
        isClosed: s.isClosed
      }))
    };
    this.undoStack.update(s => [...s, currentSnapshot]);

    // Restaurar estado siguiente
    const next = stack[stack.length - 1];
    this.redoStack.update(s => s.slice(0, -1));
    this.shapes.set(next.shapes.map(s => ({
      id: s.id,
      points: s.points.map(p => ({ x: p.x, y: p.y })),
      isClosed: s.isClosed
    })));
    this.hoverEdgeInfo.set(null);
    this.isMagnetSnapped.set(false);
    this.closeContextMenu();
    this.emitGeometry();
  }

  private justFinishedDrag = false;

  // --- Acciones del Lienzo ---

  onCanvasContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isCanvasLocked()) return;
  }

  private startNewShape(normX: number, normY: number, isHoldDrag: boolean = false): void {
    if (this.isCanvasLocked()) return;
    const currentShapes = this.shapes();
    if (currentShapes.length >= (this.maxShapes || 10)) {
      return; // Límite máximo de áreas alcanzado
    }

    this.pushUndoSnapshot();
    const newShape: CanvasShape = {
      id: `shape_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      points: [{ x: normX, y: normY }],
      isClosed: false
    };
    this.shapes.update(s => [...s, newShape]);
    const newShapeIdx = this.shapes().length - 1;
    this.selectedShapeIndexes.set(new Set()); // Limpiar selección durante trazado activo

    if (isHoldDrag) {
      this.activeDragInfo.set({ shapeIndex: newShapeIdx, pointIndex: 0 });
    } else {
      this.activeDragInfo.set(null);
    }

    this.emitGeometry();
  }

  onCanvasDblClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isCanvasLocked()) return;
  }

  onCanvasMouseDown(event: MouseEvent): void {
    event.preventDefault();
    if (this.isCanvasLocked()) return;
    // Deshabilitar menú de contexto nativo del navegador en clic derecho
    if (event.button === 2) {
      return;
    }

    this.closeContextMenu();

    if (this.activeDragInfo() !== null || this.draggingGroupInfo() !== null || this.justFinishedDrag) return;

    // Solo des-seleccionar si NO hay una figura activa en construcción y hay figuras cerradas seleccionadas
    const hasClosedSelectedShapes = this.activeOpenShape() === null && this.selectedShapeIndexes().size > 0;

    // Desseleccionar todas las formas si se hace clic simple en fondo vacío (sin Shift)
    if (!event.shiftKey && !event.ctrlKey) {
      this.selectedShapeIndexes.set(new Set());
    }

    // REGLA DE DESSELECCIÓN EXPLICITA: Si había áreas cerradas seleccionadas antes de este clic,
    // el clic sirve ÚNICAMENTE para des-seleccionar las áreas. RETORNAR SIN CREAR PUNTO NUEVO.
    if (hasClosedSelectedShapes) {
      return;
    }

    // Si se hizo clic sobre un punto fantasma de división de arista:
    const edgeCandidate = this.hoverEdgeInfo();
    if (edgeCandidate) {
      this.splitEdge(event);
      return;
    }

    const rect = this.canvasContainer.nativeElement.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const clickY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

    const normX = this.toNormX(clickX);
    const normY = this.toNormY(clickY);

    const currentShapes = this.shapes();
    const activeShape = currentShapes.length > 0 ? currentShapes[currentShapes.length - 1] : null;

    // Si NO hay forma activa abierta en trazado, el clic simple INICIA la creación de una nueva área
    if (!activeShape || activeShape.isClosed) {
      this.startNewShape(normX, normY, event.buttons === 1);
      return;
    }

    // Si HAY una forma activa abierta en trazado:
    // 1) Si es polígono y se presiona mousedown cerca del primer punto (dist < magnetSnapThresholdReal), cerrar
    if (this.geometryType === 'polygon' && activeShape.points.length >= 3) {
      const first = activeShape.points[0];
      const dist = Math.hypot(normX - first.x, normY - first.y);
      if (dist < this.magnetSnapThresholdReal) {
        this.pushUndoSnapshot();
        const activeShapeIdx = currentShapes.length - 1;
        this.shapes.update(shapesList => {
          const copy = shapesList.map(s => ({ ...s, points: [...s.points] }));
          copy[activeShapeIdx].isClosed = true;
          return copy;
        });
        this.triggerCloseAnimation(activeShapeIdx);
        this.emitGeometry();
        return;
      }
    }

    // 2) Clic simple para agregar nuevo punto a la forma abierta e iniciar su arrastre
    this.pushUndoSnapshot();
    let newPointIdx = -1;
    const activeShapeIdx = currentShapes.length - 1;

    this.shapes.update(shapesList => {
      const copy = shapesList.map(s => ({ ...s, points: [...s.points] }));
      const active = copy[activeShapeIdx];
      active.points.push({ x: normX, y: normY });
      newPointIdx = active.points.length - 1;

      if (this.isSpeedQuad() && active.points.length === 4) {
        active.isClosed = true;
        this.triggerCloseAnimation(activeShapeIdx);
        this.selectedShapeIndexes.set(new Set());
      } else if (this.isLine() && active.points.length === 2) {
        active.isClosed = true;
        this.triggerCloseAnimation(activeShapeIdx);
        this.selectedShapeIndexes.set(new Set());
      }

      return copy;
    });

    if (newPointIdx >= 0 && event.buttons === 1) {
      this.activeDragInfo.set({ shapeIndex: activeShapeIdx, pointIndex: newPointIdx });
    } else {
      this.activeDragInfo.set(null);
    }

    this.isMagnetSnapped.set(false);
    this.emitGeometry();
  }

  removeLastPoint(): void {
    if (this.isCanvasLocked()) return;
    const currentShapes = this.shapes();
    if (currentShapes.length === 0) return;

    this.pushUndoSnapshot();

    this.shapes.update(shapesList => {
      const copy = shapesList.map(s => ({ ...s, points: [...s.points] }));
      const active = copy[copy.length - 1];

      if (active.isClosed) {
        active.isClosed = false;
      } else if (active.points.length > 0) {
        active.points.pop();
      }

      if (active.points.length === 0) {
        copy.pop();
      }

      return copy;
    });

    this.emitGeometry();
  }

  clearCanvas(): void {
    if (this.isCanvasLocked()) return;
    if (this.shapes().length === 0) return;

    this.pushUndoSnapshot();
    this.shapes.set([]);
    this.activeDragInfo.set(null);
    this.draggingGroupInfo.set(null);
    this.hoverEdgeInfo.set(null);
    this.selectedShapeIndexes.set(new Set());
    this.isMagnetSnapped.set(false);
    this.closeContextMenu();
    this.emitGeometry();
  }

  // --- Menú Contextual (Click Derecho) ---

  onShapeContextMenu(shapeIndex: number, event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isCanvasLocked()) return;

    // Si hay una figura activa en trazado, deshabilitar selección y menú contextual en otras áreas
    if (this.activeOpenShape() !== null) return;

    if (!this.canvasContainer) return;
    const rect = this.canvasContainer.nativeElement.getBoundingClientRect();
    const x = Math.round(event.clientX - rect.left);
    const y = Math.round(event.clientY - rect.top);

    // Si la figura donde se hizo clic derecho no está en la selección actual, seleccionar solo esta figura.
    // Si ya forma parte de la selección múltiple (ej. 7 áreas), mantener la selección intacta para borrar las 7 en grupo.
    const currentSelected = this.selectedShapeIndexes();
    if (!currentSelected.has(shapeIndex)) {
      this.selectedShapeIndexes.set(new Set([shapeIndex]));
    }

    this.contextMenuState.set({ shapeIndex, x, y });
  }

  closeContextMenu(): void {
    if (this.contextMenuState() !== null) {
      this.contextMenuState.set(null);
    }
  }

  // --- Borrado de Área Individual y Selección Múltiple ---

  deleteShape(shapeIndex: number, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    if (this.isCanvasLocked()) return;

    if (shapeIndex < 0 || shapeIndex >= this.shapes().length) return;

    this.pushUndoSnapshot();
    this.shapes.update(list => list.filter((_, idx) => idx !== shapeIndex));
    this.selectedShapeIndexes.update(set => {
      const copy = new Set(set);
      copy.delete(shapeIndex);
      return copy;
    });
    this.hoverEdgeInfo.set(null);
    this.isMagnetSnapped.set(false);
    this.closeContextMenu();
    this.emitGeometry();
  }

  deleteSelectedShapes(): void {
    if (this.isCanvasLocked()) return;
    const selectedSet = this.selectedShapeIndexes();
    if (selectedSet.size === 0) return;

    this.pushUndoSnapshot();
    this.shapes.update(list => list.filter((_, idx) => !selectedSet.has(idx)));
    this.selectedShapeIndexes.set(new Set());
    this.activeDragInfo.set(null);
    this.draggingGroupInfo.set(null);
    this.hoverEdgeInfo.set(null);
    this.isMagnetSnapped.set(false);
    this.closeContextMenu();
    this.emitGeometry();
  }

  toggleShapeSelection(shapeIndex: number, event?: MouseEvent): void {
    if (this.isCanvasLocked()) return;
    if (event?.shiftKey || event?.ctrlKey) {
      this.selectedShapeIndexes.update(set => {
        const copy = new Set(set);
        if (copy.has(shapeIndex)) {
          copy.delete(shapeIndex);
        } else {
          copy.add(shapeIndex);
        }
        return copy;
      });
    } else {
      this.selectedShapeIndexes.set(new Set([shapeIndex]));
    }
  }

  // --- Borrado de Punto Individual por Doble Clic ---

  deletePoint(shapeIndex: number, pointIndex: number, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.isCanvasLocked()) return;

    // En cuadrilátero de velocidad (4 puntos A,B,C,D) o líneas (2 puntos P1,P2), eliminar un punto borra la forma completa
    if (this.isSpeedQuad() || this.isLine()) {
      this.deleteShape(shapeIndex, event);
      return;
    }

    const shapesList = this.shapes();
    const targetShape = shapesList[shapeIndex];
    if (!targetShape) return;

    this.pushUndoSnapshot();

    const minRequired = 3;

    if (targetShape.points.length > minRequired) {
      // Eliminar sólo ese punto específico
      this.shapes.update(list => {
        const copy = list.map(s => ({ ...s, points: [...s.points] }));
        copy[shapeIndex].points.splice(pointIndex, 1);
        return copy;
      });
    } else {
      // Si la figura tiene el número mínimo de puntos requeridos (ej. 3 puntos en polígono), eliminar la forma completa
      this.shapes.update(list => list.filter((_, idx) => idx !== shapeIndex));
      this.selectedShapeIndexes.update(set => {
        const copy = new Set(set);
        copy.delete(shapeIndex);
        return copy;
      });
    }

    this.activeDragInfo.set(null);
    this.hoverEdgeInfo.set(null);
    this.isMagnetSnapped.set(false);
    this.emitGeometry();
  }

  // --- Dividir Arista e Insertar Punto (Edge Splitting) ---

  splitEdge(event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    if (this.isCanvasLocked()) return;

    const info = this.hoverEdgeInfo();
    if (!info) return;

    const newPointIdx = info.edgeIndex + 1;

    this.pushUndoSnapshot();
    this.shapes.update(list => {
      const copy = list.map(s => ({ ...s, points: [...s.points] }));
      const target = copy[info.shapeIndex];
      if (target) {
        target.points.splice(newPointIdx, 0, info.splitPoint);
      }
      return copy;
    });

    this.hoverEdgeInfo.set(null);
    // Activar inmediatamente el arrastre (drag) del nuevo punto creado al presionar '+'
    this.activeDragInfo.set({ shapeIndex: info.shapeIndex, pointIndex: newPointIdx });
    this.emitGeometry();
  }

  // --- Mover Formas Seleccionadas en Grupo (Group Dragging) ---

  startDragShape(shapeIndex: number, event: MouseEvent): void {
    if (this.isCanvasLocked()) return;
    this.closeContextMenu();

    // Si se está trazando una nueva área activa (activeOpenShape() !== null), bloquear selección/arrastre de otras áreas
    // y redirigir el clic a la colocación de puntos para el área activa
    if (this.activeOpenShape() !== null) {
      this.onCanvasMouseDown(event);
      return;
    }

    event.stopPropagation();

    // Deshabilitar arrastrar formas con clic derecho (el clic derecho sólo abre menú contextual)
    if (event.button === 2) {
      this.onShapeContextMenu(shapeIndex, event);
      return;
    }

    // PRIORIDAD ABSOLUTA: Si el botón '+' de división de arista está activo cerca del cursor, ejecutar la creación y arrastre del nuevo punto en lugar de mover el área completa
    const edgeCandidate = this.hoverEdgeInfo();
    if (edgeCandidate) {
      this.splitEdge(event);
      return;
    }

    const targetShape = this.shapes()[shapeIndex];
    if (!targetShape || !targetShape.isClosed) return;

    // Manejar selección al iniciar arrastre:
    // 1) Si Shift/Ctrl está presionado -> alternar selección múltiple
    // 2) Si NO está presionado Shift/Ctrl, pero la forma YA PERTENECE al grupo seleccionado -> conservar todo el grupo para moverlas en bloque
    // 3) Si NO está presionado y la forma NO estaba en la selección -> seleccionar sólo esta forma
    if (event.shiftKey || event.ctrlKey) {
      this.toggleShapeSelection(shapeIndex, event);
    } else if (!this.selectedShapeIndexes().has(shapeIndex)) {
      this.selectedShapeIndexes.set(new Set([shapeIndex]));
    }

    const selectedIndexes = Array.from(this.selectedShapeIndexes());
    const initialShapesPoints = new Map<number, Point2D[]>();
    const allShapes = this.shapes();

    for (const idx of selectedIndexes) {
      if (allShapes[idx] && allShapes[idx].isClosed) {
        initialShapesPoints.set(idx, allShapes[idx].points.map(p => ({ ...p })));
      }
    }

    if (!this.canvasContainer) return;
    const rect = this.canvasContainer.nativeElement.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const clickY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

    const normX = this.toNormX(clickX);
    const normY = this.toNormY(clickY);

    this.justFinishedDrag = false;
    this.pushUndoSnapshot();
    this.draggingGroupInfo.set({
      shapeIndexes: selectedIndexes,
      startMouse: { x: normX, y: normY },
      initialShapesPoints
    });
  }

  // --- Drag & Drop de Puntos de Control ---

  startDrag(shapeIndex: number, pointIndex: number, event: MouseEvent): void {
    if (this.isCanvasLocked()) return;
    this.closeContextMenu();

    // Si se está dibujando una nueva figura y el punto pertenece a OTRA figura existente, ignorar y colocar punto nuevo
    const activeOpen = this.activeOpenShape();
    if (activeOpen !== null && shapeIndex !== (this.shapes().length - 1)) {
      this.onCanvasMouseDown(event);
      return;
    }

    event.stopPropagation();

    // Deshabilitar arrastrar puntos con clic derecho
    if (event.button === 2) {
      event.preventDefault();
      return;
    }

    event.preventDefault();

    const shape = this.shapes()[shapeIndex];
    // Si se hace clic en el primer punto de un polígono abierto con >= 3 puntos, cerrar el polígono
    if (shape && pointIndex === 0 && !shape.isClosed && this.geometryType === 'polygon' && shape.points.length >= 3) {
      this.pushUndoSnapshot();
      this.shapes.update(shapesList => {
        const copy = shapesList.map(s => ({ ...s, points: [...s.points] }));
        copy[shapeIndex].isClosed = true;
        return copy;
      });
      this.triggerCloseAnimation(shapeIndex);
      this.selectedShapeIndexes.set(new Set());
      this.emitGeometry();
      return;
    }

    this.justFinishedDrag = false;
    this.pushUndoSnapshot();
    this.activeDragInfo.set({ shapeIndex, pointIndex });
  }

  @HostListener('document:mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (this.isCanvasLocked() || !this.canvasContainer) return;

    const rect = this.canvasContainer.nativeElement.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const clickY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));

    const normX = this.toNormX(clickX);
    const normY = this.toNormY(clickY);

    this.currentMousePos.set({ x: normX, y: normY });

    // 1) Caso: Arrastre de un punto de control individual (con Imán magnético al primer punto)
    const dragPoint = this.activeDragInfo();
    if (dragPoint) {
      this.shapes.update(shapesList => {
        const copy = shapesList.map(s => ({ ...s, points: [...s.points] }));
        const active = copy[dragPoint.shapeIndex];
        if (active && active.points[dragPoint.pointIndex]) {
          let targetX = normX;
          let targetY = normY;

          // Atracción magnética al primer punto si es un polígono abierto con >= 3 puntos:
          if (this.geometryType === 'polygon' && !active.isClosed && active.points.length >= 3 && dragPoint.pointIndex > 0) {
            const first = active.points[0];
            const distNorm = Math.hypot(normX - first.x, normY - first.y);
            if (distNorm < this.magnetSnapThresholdReal) {
              targetX = first.x;
              targetY = first.y;
              this.isMagnetSnapped.set(true);
            } else {
              this.isMagnetSnapped.set(false);
            }
          } else {
            this.isMagnetSnapped.set(false);
          }

          active.points[dragPoint.pointIndex] = { x: targetX, y: targetY };
        }
        return copy;
      });
      this.emitGeometry();
      return;
    }

    // 2) Caso: Arrastre de grupo de formas seleccionadas
    const dragGroup = this.draggingGroupInfo();
    if (dragGroup) {
      const dx = normX - dragGroup.startMouse.x;
      const dy = normY - dragGroup.startMouse.y;
      const maxW = this.naturalImageWidth();
      const maxH = this.naturalImageHeight();

      this.shapes.update(shapesList => {
        const copy = shapesList.map(s => ({ ...s, points: [...s.points] }));
        for (const idx of dragGroup.shapeIndexes) {
          const initialPts = dragGroup.initialShapesPoints.get(idx);
          if (copy[idx] && initialPts) {
            copy[idx].points = initialPts.map(p => ({
              x: Math.max(0, Math.min(maxW, Math.round(p.x + dx))),
              y: Math.max(0, Math.min(maxH, Math.round(p.y + dy)))
            }));
          }
        }
        return copy;
      });
      this.emitGeometry();
      return;
    }

    // 3) Caso: Detección de arista cercana en pixeles reales para mostrar punto fantasma (+)
    this.updateEdgeSplitCandidate(clickX, clickY);
  }

  private updateEdgeSplitCandidate(clickX: number, clickY: number): void {
    // Solo permitir dividir aristas en polígonos libres (deshabilitado en líneas y cuadrilátero de velocidad)
    if (this.isLine() || this.isSpeedQuad() || this.activeOpenShape() !== null || this.activeDragInfo() !== null || this.draggingGroupInfo() !== null || this.contextMenuState() !== null) {
      if (this.hoverEdgeInfo() !== null) this.hoverEdgeInfo.set(null);
      return;
    }

    let closestCandidate: { shapeIndex: number; edgeIndex: number; splitPoint: Point2D } | null = null;
    let minDistance = 18; // 18 pixeles reales de margen de detección estable sin brincos

    const allShapes = this.shapes();
    for (let sIdx = 0; sIdx < allShapes.length; sIdx++) {
      const shape = allShapes[sIdx];
      if (!shape.isClosed || shape.points.length < 2) continue;

      const numEdges = this.geometryType === 'line' ? shape.points.length - 1 : shape.points.length;

      for (let eIdx = 0; eIdx < numEdges; eIdx++) {
        const p1Norm = shape.points[eIdx];
        const p2Norm = shape.points[(eIdx + 1) % shape.points.length];

        const x1 = this.toSvgX(p1Norm.x);
        const y1 = this.toSvgY(p1Norm.y);
        const x2 = this.toSvgX(p2Norm.x);
        const y2 = this.toSvgY(p2Norm.y);

        const vx = x2 - x1;
        const vy = y2 - y1;
        const lenSq = vx * vx + vy * vy;

        if (lenSq === 0) continue;

        const wx = clickX - x1;
        const wy = clickY - y1;
        const t = (wx * vx + wy * vy) / lenSq;

        // Limitar t a un rango entre 0.08 y 0.92 para no solapar con los vértices existentes
        if (t >= 0.08 && t <= 0.92) {
          const projX = x1 + t * vx;
          const projY = y1 + t * vy;
          const dist = Math.hypot(clickX - projX, clickY - projY);

          if (dist < minDistance) {
            minDistance = dist;
            closestCandidate = {
              shapeIndex: sIdx,
              edgeIndex: eIdx,
              splitPoint: {
                x: this.toNormX(projX),
                y: this.toNormY(projY)
              }
            };
          }
        }
      }
    }

    this.hoverEdgeInfo.set(closestCandidate);
  }

  @HostListener('document:mouseup')
  onMouseUp(): void {
    const dragPoint = this.activeDragInfo();
    if (dragPoint) {
      const shape = this.shapes()[dragPoint.shapeIndex];
      if (shape && !shape.isClosed && this.geometryType === 'polygon' && shape.points.length >= 3) {
        const first = shape.points[0];
        const currentPt = shape.points[dragPoint.pointIndex];

        // Cierre definitivo del polígono al soltar mouseup en estado de atracción magnética:
        if (this.isMagnetSnapped() || (currentPt && Math.hypot(currentPt.x - first.x, currentPt.y - first.y) < this.magnetSnapThresholdReal)) {
          this.shapes.update(shapesList => {
            const copy = shapesList.map(s => ({ ...s, points: [...s.points] }));
            const active = copy[dragPoint.shapeIndex];
            active.isClosed = true;
            // Si el punto arrastrado era el punto de cola duplicado, removerlo para dejar polígono limpio
            if (dragPoint.pointIndex === active.points.length - 1 && active.points.length > 3) {
              active.points.pop();
            }
            return copy;
          });
          this.triggerCloseAnimation(dragPoint.shapeIndex);
          this.selectedShapeIndexes.set(new Set());
        }
      }

      this.justFinishedDrag = true;
      this.activeDragInfo.set(null);
      this.isMagnetSnapped.set(false);
      setTimeout(() => {
        this.justFinishedDrag = false;
      }, 100);
      this.emitGeometry();
      return;
    }

    if (this.draggingGroupInfo() !== null) {
      this.justFinishedDrag = true;
      this.draggingGroupInfo.set(null);
      this.isMagnetSnapped.set(false);
      setTimeout(() => {
        this.justFinishedDrag = false;
      }, 100);
    }
  }

  triggerCloseAnimation(shapeIndex: number): void {
    this.recentlyClosedShapeIndex.set(shapeIndex);
    setTimeout(() => {
      if (this.recentlyClosedShapeIndex() === shapeIndex) {
        this.recentlyClosedShapeIndex.set(null);
      }
    }, 600);
  }

  // --- Cálculo de Centroide de una Forma ---

  getShapeCentroid(shapeIndex: number): Point2D {
    const shape = this.shapes()[shapeIndex];
    const defaultX = Math.round((this.naturalImageWidth() || 1920) / 2);
    const defaultY = Math.round((this.naturalImageHeight() || 1080) / 2);
    if (!shape || shape.points.length === 0) return { x: defaultX, y: defaultY };
    const sumX = shape.points.reduce((acc, p) => acc + p.x, 0);
    const sumY = shape.points.reduce((acc, p) => acc + p.y, 0);
    return {
      x: Math.round(sumX / shape.points.length),
      y: Math.round(sumY / shape.points.length)
    };
  }

  // --- Keyboard Shortcuts ---

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (this.isCanvasLocked()) return;
    const key = event.key.toLowerCase();

    // Tecla Supr / Delete -> Eliminar áreas seleccionadas
    if (key === 'delete' || key === 'del') {
      if (this.selectedShapeIndexes().size > 0) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.deleteSelectedShapes();
        return;
      }
    }

    if (event.ctrlKey || event.metaKey) {
      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.undo();
      } else if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.redo();
      }
    }
  }

  // --- Utilidades ---

  formatPoints(points: Point2D[]): string {
    return points.map(p => `${p.x},${p.y}`).join(' ');
  }

  // Muestra etiquetas A/B/C/D en cuadrilátero de velocidad o P1/P2 en líneas
  getLabelForPoint(shapeIndex: number, pointIndex: number): string {
    if (this.isSpeedQuad()) {
      const labels: ('A' | 'B' | 'C' | 'D')[] = ['A', 'B', 'C', 'D'];
      return labels[pointIndex] || '';
    }
    return '';
  }

  // Genera un cuadrilátero de velocidad centrado y estructurado A-B-C-D por defecto
  generateDefaultSpeedQuad(): void {
    if (this.isCanvasLocked()) return;
    const maxW = this.naturalImageWidth() || 1920;
    const maxH = this.naturalImageHeight() || 1080;

    const marginX = Math.round(maxW * 0.28);
    const marginY = Math.round(maxH * 0.28);
    const width = Math.round(maxW * 0.44);
    const height = Math.round(maxH * 0.44);

    const quadShape: CanvasShape = {
      id: `shape_speed_${Date.now()}`,
      points: [
        { x: marginX, y: marginY },                   // A: Superior Izquierdo
        { x: marginX + width, y: marginY },           // B: Superior Derecho
        { x: marginX + width, y: marginY + height },  // C: Inferior Derecho
        { x: marginX, y: marginY + height }           // D: Inferior Izquierdo
      ],
      isClosed: true
    };

    this.pushUndoSnapshot();
    this.shapes.set([quadShape]);
    this.selectedShapeIndexes.set(new Set()); // No seleccionar por defecto al crear área
    this.activeDragInfo.set(null);
    this.triggerCloseAnimation(0);
    this.emitGeometry();
  }

  // --- Cálculo Matemático Inteligente de Posicionamiento Exterior (Smart Outward Offset) ---

  getSmartPointLabelInfo(shapeIndex: number, pointIndex: number): { x: number; y: number; label: string } | null {
    const shape = this.shapes()[shapeIndex];
    if (!shape || shape.points.length <= pointIndex) return null;

    const label = this.getLabelForPoint(shapeIndex, pointIndex);
    if (!label) return null;

    const ptNorm = shape.points[pointIndex];
    const vx = this.toSvgX(ptNorm.x);
    const vy = this.toSvgY(ptNorm.y);

    const numPoints = shape.points.length;
    if (numPoints < 3) {
      // Para líneas (2 puntos), desplazar de forma exterior al segmento
      const otherIdx = pointIndex === 0 ? 1 : 0;
      const otherPt = shape.points[otherIdx];
      if (!otherPt) return { x: vx + 22, y: vy - 18, label };
      const dx = vx - this.toSvgX(otherPt.x);
      const dy = vy - this.toSvgY(otherPt.y);
      const len = Math.hypot(dx, dy) || 1;
      return {
        x: Math.round(vx + (dx / len) * 24),
        y: Math.round(vy + (dy / len) * 24),
        label
      };
    }

    // Centroide de la forma en pixeles SVG
    const centroid = this.getShapeCentroidSvg(shapeIndex);

    // Vector exterior desde centroide hacia el vértice
    let dirX = vx - centroid.x;
    let dirY = vy - centroid.y;
    let len = Math.hypot(dirX, dirY);

    if (len === 0) {
      dirX = 0;
      dirY = -1;
      len = 1;
    }

    // Offset exterior (32px) para separar el badge del vértice y de la arista
    const offsetDist = 32;
    const smartX = Math.round(vx + (dirX / len) * offsetDist);
    const smartY = Math.round(vy + (dirY / len) * offsetDist);

    return {
      x: smartX,
      y: smartY,
      label
    };
  }

  getSmartEdgeInfo(shapeIndex: number, edgeIndex: number): { x: number; y: number; title: string; distanceMeters: number } | null {
    const shape = this.shapes()[shapeIndex];
    if (!shape || shape.points.length < 2) return null;
    const numPoints = shape.points.length;

    const numEdges = (this.isLine() || !shape.isClosed) ? numPoints - 1 : numPoints;
    if (edgeIndex >= numEdges) return null;

    const p1Norm = shape.points[edgeIndex];
    const p2Norm = shape.points[(edgeIndex + 1) % numPoints];
    if (!p1Norm || !p2Norm) return null;

    // Puntos en pixeles SVG
    const x1 = this.toSvgX(p1Norm.x);
    const y1 = this.toSvgY(p1Norm.y);
    const x2 = this.toSvgX(p2Norm.x);
    const y2 = this.toSvgY(p2Norm.y);

    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    const edgeDx = x2 - x1;
    const edgeDy = y2 - y1;

    // Vector perpendicular a la arista
    let perpX = -edgeDy;
    let perpY = edgeDx;

    if (numPoints >= 3 && shape.isClosed) {
      // Centroide SVG de la forma
      const centroid = this.getShapeCentroidSvg(shapeIndex);
      const toMidX = midX - centroid.x;
      const toMidY = midY - centroid.y;

      // Orientar vector perpendicular para que apunte hacia el EXTERIOR del polígono
      if (perpX * toMidX + perpY * toMidY < 0) {
        perpX = -perpX;
        perpY = -perpY;
      }
    }

    const perpLen = Math.hypot(perpX, perpY) || 1;
    // Offset exterior ampliado para los lados izquierdo y derecho (38px) y arriba/abajo (30px)
    const isVerticalEdge = this.isSpeedQuad() && (edgeIndex === 1 || edgeIndex === 3);
    const offsetDist = isVerticalEdge ? 38 : 30;

    const smartX = Math.round(midX + (perpX / perpLen) * offsetDist);
    const smartY = Math.round(midY + (perpY / perpLen) * offsetDist);

    let title = `Arista ${edgeIndex + 1}`;
    let distanceMeters = 0;

    if (this.isSpeedQuad() && numPoints === 4) {
      const titles = [
        'Ancho A-B',
        'Largo B-C',
        'Ancho C-D',
        'Largo D-A'
      ];
      title = titles[edgeIndex] || `Arista ${edgeIndex + 1}`;
      distanceMeters = (edgeIndex === 0 || edgeIndex === 2)
        ? (this.speedDistAB && this.speedDistAB > 0 ? this.speedDistAB : 14)
        : (this.speedDistBC && this.speedDistBC > 0 ? this.speedDistBC : 60);
    } else if (this.isLine()) {
      title = `Línea ${shapeIndex + 1}`;
    }

    return {
      x: smartX,
      y: smartY,
      title,
      distanceMeters
    };
  }

  getShapeCentroidSvg(shapeIndex: number): { x: number; y: number } {
    const shape = this.shapes()[shapeIndex];
    if (!shape || shape.points.length === 0) return { x: this.containerWidth() / 2, y: this.containerHeight() / 2 };
    const sumX = shape.points.reduce((acc, p) => acc + this.toSvgX(p.x), 0);
    const sumY = shape.points.reduce((acc, p) => acc + this.toSvgY(p.y), 0);
    return {
      x: sumX / shape.points.length,
      y: sumY / shape.points.length
    };
  }

  private distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.hypot(px - ax, py - ay);

    let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = ax + t * dx;
    const projY = ay + t * dy;

    return Math.hypot(px - projX, py - projY);
  }

  getSmartDragTooltipInfo(): { x: number; y: number; ptX: number; ptY: number; transX: number; transY: number } | null {
    const drag = this.activeDragInfo();
    if (!drag) return null;

    const shape = this.shapes()[drag.shapeIndex];
    if (!shape || !shape.points[drag.pointIndex]) return null;

    const ptIndex = drag.pointIndex;
    const pt = shape.points[ptIndex];
    const vx = this.toSvgX(pt.x);
    const vy = this.toSvgY(pt.y);

    const numPoints = shape.points.length;
    let netLinesX = 0;
    let netLinesY = 0;

    // 1. Sumar los vectores unitarios de todas las aristas conectadas al punto actual
    if (numPoints > 1) {
      // Arista previa (hacia el punto anterior)
      const hasPrev = ptIndex > 0 || (shape.isClosed && !this.isLine());
      if (hasPrev) {
        const prevIdx = (ptIndex - 1 + numPoints) % numPoints;
        const prevPt = shape.points[prevIdx];
        if (prevPt) {
          const dx = this.toSvgX(prevPt.x) - vx;
          const dy = this.toSvgY(prevPt.y) - vy;
          const len = Math.hypot(dx, dy) || 1;
          netLinesX += dx / len;
          netLinesY += dy / len;
        }
      }

      // Arista siguiente (hacia el punto siguiente)
      const hasNext = ptIndex < numPoints - 1 || (shape.isClosed && !this.isLine());
      if (hasNext) {
        const nextIdx = (ptIndex + 1) % numPoints;
        const nextPt = shape.points[nextIdx];
        if (nextPt) {
          const dx = this.toSvgX(nextPt.x) - vx;
          const dy = this.toSvgY(nextPt.y) - vy;
          const len = Math.hypot(dx, dy) || 1;
          netLinesX += dx / len;
          netLinesY += dy / len;
        }
      }
    }

    // 2. Vector Órbita Opuesto (Dar la contra a las líneas conectadas)
    let orbitX = -netLinesX;
    let orbitY = -netLinesY;
    let lenOrbit = Math.hypot(orbitX, orbitY);

    // Si no hay líneas conectadas (1er punto colocado) o las aristas son simétricas, mostrar centrado recto arriba (0, -1)
    if (lenOrbit < 0.1) {
      orbitX = 0;
      orbitY = -1;
      lenOrbit = 1;
    } else {
      orbitX /= lenOrbit;
      orbitY /= lenOrbit;
    }

    // Distancia de órbita fluida fuera del nodo del punto (26px)
    const gapDist = 26;
    let anchorX = Math.round(vx + orbitX * gapDist);
    let anchorY = Math.round(vy + orbitY * gapDist);

    // Mapeo 100% continuo e interpolado de transX (-100% a 0%) y transY (-100% a 0%)
    // Elimina cualquier salto o "teletransportación" brusca al orbitar 360°
    const transX = Math.round((-50 + orbitX * 45) * 10) / 10;
    const transY = Math.round((-50 + orbitY * 45) * 10) / 10;

    // Clamping dinámico de seguridad dentro de los bordes del lienzo
    const marginX = 15;
    const marginY = 15;
    const canvasW = this.containerWidth() || 800;
    const canvasH = this.containerHeight() || 450;

    if (anchorX < marginX || anchorX > canvasW - marginX) {
      orbitX = -orbitX;
      anchorX = Math.round(vx + orbitX * gapDist);
    }
    if (anchorY < marginY || anchorY > canvasH - marginY) {
      orbitY = -orbitY;
      anchorY = Math.round(vy + orbitY * gapDist);
    }

    anchorX = Math.max(marginX, Math.min(canvasW - marginX, anchorX));
    anchorY = Math.max(marginY, Math.min(canvasH - marginY, anchorY));

    return {
      x: anchorX,
      y: anchorY,
      ptX: pt.x,
      ptY: pt.y,
      transX,
      transY
    };
  }

  // Devuelve el color CSS para el borde/arista de un shape según su índice
  getShapeColor(shapeIndex: number): string {
    const colors = [
      'rgba(59, 130, 246, 1)',    // Azul
      'rgba(16, 185, 129, 1)',    // Esmeralda
      'rgba(245, 158, 11, 1)',    // Ámbar
      'rgba(168, 85, 247, 1)',    // Violeta
      'rgba(236, 72, 153, 1)',    // Rosa
      'rgba(6, 182, 212, 1)',     // Cian
      'rgba(239, 68, 68, 1)',     // Rojo
      'rgba(132, 204, 22, 1)',    // Lima
      'rgba(99, 102, 241, 1)',    // Índigo
      'rgba(249, 115, 22, 1)',    // Naranja
    ];
    return colors[shapeIndex % colors.length];
  }

  getShapeFill(shapeIndex: number): string {
    const fills = [
      'rgba(59, 130, 246, 0.12)',
      'rgba(16, 185, 129, 0.12)',
      'rgba(245, 158, 11, 0.12)',
      'rgba(168, 85, 247, 0.12)',
      'rgba(236, 72, 153, 0.12)',
      'rgba(6, 182, 212, 0.12)',
      'rgba(239, 68, 68, 0.12)',
      'rgba(132, 204, 22, 0.12)',
      'rgba(99, 102, 241, 0.12)',
      'rgba(249, 115, 22, 0.12)',
    ];
    return fills[shapeIndex % fills.length];
  }

  // --- Funciones Matemáticas de Geometría y Coordenadas ---

  calculateCentroid(points: Point2D[]): Point2D {
    if (!points || points.length === 0) return { x: 0, y: 0 };
    const sumX = points.reduce((acc, p) => acc + p.x, 0);
    const sumY = points.reduce((acc, p) => acc + p.y, 0);
    return {
      x: sumX / points.length,
      y: sumY / points.length
    };
  }

  calculateOuterArea(originalPoints: Point2D[], scale: number): Point2D[] {
    if (!originalPoints || originalPoints.length < 3) return originalPoints || [];

    const n = originalPoints.length;
    const factor = scale !== undefined && scale !== null && scale > 0 ? scale : 1.2;

    if (Math.abs(factor - 1.0) < 0.001) {
      return originalPoints.map(p => ({ x: p.x, y: p.y }));
    }

    // 1. Calcular el área firmada para determinar la orientación de los vértices (CW o CCW)
    let signedArea = 0;
    for (let i = 0; i < n; i++) {
      const p1 = originalPoints[i];
      const p2 = originalPoints[(i + 1) % n];
      signedArea += (p1.x * p2.y - p2.x * p1.y);
    }
    const isCCW = signedArea > 0;

    // 2. Calcular la distancia de desplazamiento uniforme 'd' basada en el radio promedio del polígono
    const centroid = this.calculateCentroid(originalPoints);
    let totalDist = 0;
    for (const p of originalPoints) {
      totalDist += Math.hypot(p.x - centroid.x, p.y - centroid.y);
    }
    const avgRadius = totalDist / n;
    const d = avgRadius * (factor - 1.0);

    // 3. Normales externas perpendiculares para cada segmento de arista
    const edgeNormals: { x: number; y: number }[] = [];
    for (let i = 0; i < n; i++) {
      const p1 = originalPoints[i];
      const p2 = originalPoints[(i + 1) % n];
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);

      if (len === 0) {
        edgeNormals.push({ x: 0, y: 0 });
      } else {
        const nx = isCCW ? dy / len : -dy / len;
        const ny = isCCW ? -dx / len : dx / len;
        edgeNormals.push({ x: nx, y: ny });
      }
    }

    // 4. Desplazamiento paralelo en la bisectriz de cada vértice manteniendo bordes 100% paralelos
    const outerPoints: Point2D[] = [];
    for (let i = 0; i < n; i++) {
      const prevNormal = edgeNormals[(i + n - 1) % n];
      const currNormal = edgeNormals[i];

      let bx = prevNormal.x + currNormal.x;
      let by = prevNormal.y + currNormal.y;
      let blen = Math.hypot(bx, by);

      if (blen < 0.001) {
        bx = currNormal.x;
        by = currNormal.y;
        blen = 1;
      } else {
        bx /= blen;
        by /= blen;
      }

      // Factor de corrección de inglete (miter length factor)
      const dot = bx * currNormal.x + by * currNormal.y;
      const miter = dot > 0.1 ? Math.min(2.5, 1.0 / dot) : 1.0;

      const p = originalPoints[i];
      const maxW = this.naturalImageWidth() || 1920;
      const maxH = this.naturalImageHeight() || 1080;
      outerPoints.push({
        x: Math.max(0, Math.min(maxW, Math.round(p.x + bx * d * miter))),
        y: Math.max(0, Math.min(maxH, Math.round(p.y + by * d * miter)))
      });
    }

    return outerPoints;
  }

  calculateWorldPointsToSpeed(distAB: number, distBC: number): Point2D[] {
    const ab = distAB && distAB > 0 ? distAB : 14;
    const bc = distBC && distBC > 0 ? distBC : 60;
    return [
      { x: 0, y: 0 },
      { x: ab, y: 0 },
      { x: ab, y: bc },
      { x: 0, y: bc }
    ];
  }

  calculateDirectionPoints(p1: Point2D, p2: Point2D, offsetDistance: number = 15): Point2D[] {
    if (!p1 || !p2) return [];

    const mx = (p1.x + p2.x) / 2;
    const my = (p1.y + p2.y) / 2;

    const vx = p2.x - p1.x;
    const vy = p2.y - p1.y;
    const len = Math.hypot(vx, vy);

    const maxW = this.naturalImageWidth() || 1920;
    const maxH = this.naturalImageHeight() || 1080;
    const clamp = (val: number, maxVal: number) => Math.max(0, Math.min(maxVal, Math.round(val)));

    if (len === 0) {
      return [{ x: clamp(mx, maxW), y: clamp(my, maxH) }, { x: clamp(mx, maxW), y: clamp(my, maxH) }];
    }

    const nx = -vy / len;
    const ny = vx / len;

    const dist = offsetDistance > 0 ? offsetDistance : 15;

    const pA = {
      x: clamp(mx + nx * dist, maxW),
      y: clamp(my + ny * dist, maxH)
    };
    const pB = {
      x: clamp(mx - nx * dist, maxW),
      y: clamp(my - ny * dist, maxH)
    };

    return [pA, pB];
  }

  getDirectionArrowLine(p1: Point2D, p2: Point2D, offsetDistance: number = 35, trimRadius: number = 20): { x1: number; y1: number; x2: number; y2: number } | null {
    const dirPts = this.calculateDirectionPoints(p1, p2, offsetDistance);
    if (dirPts.length !== 2) return null;

    const pAx = this.toSvgX(dirPts[0].x);
    const pAy = this.toSvgY(dirPts[0].y);
    const pBx = this.toSvgX(dirPts[1].x);
    const pBy = this.toSvgY(dirPts[1].y);

    const dx = pBx - pAx;
    const dy = pBy - pAy;
    const dist = Math.hypot(dx, dy);

    if (dist <= trimRadius * 2) {
      return { x1: pAx, y1: pAy, x2: pBx, y2: pBy };
    }

    const ux = dx / dist;
    const uy = dy / dist;

    return {
      x1: Math.round(pAx + ux * trimRadius),
      y1: Math.round(pAy + uy * trimRadius),
      x2: Math.round(pBx - ux * trimRadius),
      y2: Math.round(pBy - uy * trimRadius)
    };
  }

  calculateAnalysisZone(p1: Point2D, p2: Point2D, halfWidth: number = 20): Point2D[] {
    if (!p1 || !p2) return [];

    const vx = p2.x - p1.x;
    const vy = p2.y - p1.y;
    const len = Math.hypot(vx, vy);

    const maxW = this.naturalImageWidth() || 1920;
    const maxH = this.naturalImageHeight() || 1080;
    const clamp = (val: number, maxVal: number) => Math.max(0, Math.min(maxVal, Math.round(val)));

    if (len === 0) return [p1, p1, p2, p2];

    const nx = -vy / len;
    const ny = vx / len;

    const hw = halfWidth > 0 ? halfWidth : 20;

    const ox = nx * hw;
    const oy = ny * hw;

    const v1 = {
      x: clamp(p1.x - ox, maxW),
      y: clamp(p1.y - oy, maxH)
    };
    const v2 = {
      x: clamp(p1.x + ox, maxW),
      y: clamp(p1.y + oy, maxH)
    };
    const v3 = {
      x: clamp(p2.x + ox, maxW),
      y: clamp(p2.y + oy, maxH)
    };
    const v4 = {
      x: clamp(p2.x - ox, maxW),
      y: clamp(p2.y - oy, maxH)
    };

    return [v1, v2, v3, v4];
  }

  emitGeometry(): void {
    const allShapes = this.shapes();
    const maxW = this.naturalImageWidth() || 1920;
    const maxH = this.naturalImageHeight() || 1080;
    const clamp = (val: number, maxVal: number) => Math.max(0, Math.min(maxVal, Math.round(val)));

    if (this.geometryType === 'polygon' || this.geometryType === 'speed_quad') {
      const polygons = allShapes.map((s, idx) => {
        const origArea = s.points.map(p => ({ x: clamp(p.x, maxW), y: clamp(p.y, maxH) }));
        const outerArea = this.calculateOuterArea(origArea, this.scaleFactor).map(p => ({ x: clamp(p.x, maxW), y: clamp(p.y, maxH) }));
        const item: any = {
          label: `Polygon${idx + 1}`,
          original_area: origArea,
          outer_area: outerArea
        };
        if (this.geometryType === 'speed_quad') {
          item.world_points_to_speed = this.calculateWorldPointsToSpeed(this.speedDistAB, this.speedDistBC);
        }
        return item;
      });

      const payload = {
        polygons,
        lines: []
      };
      this.geometryChanged.emit(payload);
    } else if (this.geometryType === 'line') {
      const lines = allShapes.map((s, idx) => {
        const p1 = s.points[0] || { x: 0, y: 0 };
        const p2 = s.points[1] || p1;
        const halfW = (this.zoneWidth && this.zoneWidth > 0 ? this.zoneWidth : 40) / 2;

        return {
          camera_id: this.cameraId || '',
          label: `Linea${idx + 1}`,
          extreme_points: s.points.map(p => ({ x: clamp(p.x, maxW), y: clamp(p.y, maxH) })),
          direction_points: this.calculateDirectionPoints(p1, p2, 15).map(p => ({ x: clamp(p.x, maxW), y: clamp(p.y, maxH) })),
          analysis_zone: this.calculateAnalysisZone(p1, p2, halfW).map(p => ({ x: clamp(p.x, maxW), y: clamp(p.y, maxH) }))
        };
      });

      const payload = {
        polygons: [],
        lines
      };
      this.geometryChanged.emit(payload);
    }
  }
}