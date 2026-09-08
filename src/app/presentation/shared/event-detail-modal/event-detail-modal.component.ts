import { Component, Input, Output, EventEmitter, signal, HostListener, ViewChild, ElementRef, OnDestroy, inject, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EventRecord } from '../../../core/domain/entities/event.models';
import { copyToClipboard as utilCopyToClipboard } from '../../../core/utils/clipboard.util';
import { FacialMatchService, FacialMatchInfo } from '../../../core/services/facial-match.service';

@Component({
  selector: 'app-event-detail-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './event-detail-modal.component.html',
  styleUrl: './event-detail-modal.component.css'
})
export class EventDetailModalComponent implements OnDestroy, OnChanges {
  private facialMatchService = inject(FacialMatchService);

  @Input() event: EventRecord | null = null;
  @Output() close = new EventEmitter<void>();

  readonly copiedField = signal<string | null>(null);
  readonly hasImageError = signal<boolean>(false);
  readonly hasMatchImageError = signal<boolean>(false);
  readonly hasVideoError = signal<boolean>(false);
  readonly activeMediaType = signal<'image' | 'comparison' | 'video'>('image');
  readonly mediaAspectRatio = signal<number | null>(null);
  readonly matchData = signal<FacialMatchInfo | null>(null);
  readonly isMatchLoading = signal<boolean>(false);
  readonly focusedComparisonCard = signal<'detection' | 'reference' | null>(null);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['event'] && this.event) {
      this.hasImageError.set(false);
      this.hasMatchImageError.set(false);
      this.hasVideoError.set(false);
      this.activeMediaType.set('image');
      this.mediaAspectRatio.set(null);
      this.focusedComparisonCard.set(null);

      if (this.isComparisonAvailable(this.event)) {
        this.isMatchLoading.set(true);
        this.facialMatchService.getMatchInfo(this.event).subscribe({
          next: (info) => {
            this.matchData.set(info);
            this.isMatchLoading.set(false);
          },
          error: () => {
            this.isMatchLoading.set(false);
          }
        });
      } else {
        this.matchData.set(null);
        this.isMatchLoading.set(false);
      }
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.focusedComparisonCard()) {
      this.focusedComparisonCard.set(null);
      return;
    }
    if (this.isZoomed()) {
      this.isZoomed.set(false);
      return;
    }
    if (this.event) {
      this.onClose();
    }
  }

  /**
   * Alterna la vista maximizada de una tarjeta en comparativa
   */
  toggleComparisonFocus(cardType: 'detection' | 'reference', mouseEvent?: MouseEvent): void {
    if (mouseEvent) {
      mouseEvent.stopPropagation();
    }
    this.focusedComparisonCard.update(current => current === cardType ? null : cardType);
  }

  /**
   * Cambia de tipo de medio y reinicia estados de zoom y foco
   */
  setMediaType(type: 'image' | 'comparison' | 'video'): void {
    this.activeMediaType.set(type);
    this.isZoomed.set(false);
    this.focusedComparisonCard.set(null);
  }

  // Lente Lupa Magnifier Zoom
  readonly isZoomed = signal<boolean>(false);
  readonly zoomX = signal<number>(0);
  readonly zoomY = signal<number>(0);
  readonly zoomBgX = signal<number>(0);
  readonly zoomBgY = signal<number>(0);
  readonly zoomBgWidth = signal<number>(0);
  readonly zoomBgHeight = signal<number>(0);
  readonly zoomLensDiameter = signal<number>(500);

  private boundImgWrapper: HTMLDivElement | null = null;

  @ViewChild('imgWrapper') set imgWrapper(ref: ElementRef<HTMLDivElement> | undefined) {
    if (this.boundImgWrapper) {
      this.boundImgWrapper.removeEventListener('wheel', this.handleWheel);
      this.boundImgWrapper = null;
    }
    if (ref?.nativeElement) {
      this.boundImgWrapper = ref.nativeElement;
      // Registro explícito no pasivo para permitir preventDefault() sobre el zoom nativo de la página
      this.boundImgWrapper.addEventListener('wheel', this.handleWheel, { passive: false });
    }
  }

  ngOnDestroy(): void {
    if (this.boundImgWrapper) {
      this.boundImgWrapper.removeEventListener('wheel', this.handleWheel);
      this.boundImgWrapper = null;
    }
  }

  private handleWheel = (wheelEvent: WheelEvent): void => {
    // CONDICIÓN CLAVE: Si la lupa NO está activada o no estamos en modo imagen, no interceptar
    if (!this.isZoomed() || this.activeMediaType() !== 'image') return;

    wheelEvent.preventDefault();
    wheelEvent.stopPropagation();

    const step = wheelEvent.deltaY < 0 ? 45 : -45;
    const currentSize = this.zoomLensDiameter();
    const newSize = Math.max(180, Math.min(850, currentSize + step));

    this.zoomLensDiameter.set(newSize);

    const container = this.boundImgWrapper;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, wheelEvent.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, wheelEvent.clientY - rect.top));

    const zoomFactor = 2.5;
    this.zoomBgX.set(Math.round(newSize / 2 - x * zoomFactor));
    this.zoomBgY.set(Math.round(newSize / 2 - y * zoomFactor));
    this.zoomBgWidth.set(Math.round(rect.width * zoomFactor));
    this.zoomBgHeight.set(Math.round(rect.height * zoomFactor));
  };

  toggleZoom(mouseEvent: MouseEvent): void {
    if (this.activeMediaType() !== 'image') return;
    this.isZoomed.update(z => !z);
    if (this.isZoomed()) {
      this.onZoomMouseMove(mouseEvent);
    }
  }

  onZoomMouseMove(mouseEvent: MouseEvent): void {
    if (!this.isZoomed() || this.activeMediaType() !== 'image') return;
    const container = (mouseEvent.currentTarget as HTMLElement) || this.boundImgWrapper;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, mouseEvent.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, mouseEvent.clientY - rect.top));

    const lensSize = this.zoomLensDiameter();
    const zoomFactor = 2.5;

    this.zoomX.set(x);
    this.zoomY.set(y);
    this.zoomBgX.set(Math.round(lensSize / 2 - x * zoomFactor));
    this.zoomBgY.set(Math.round(lensSize / 2 - y * zoomFactor));
    this.zoomBgWidth.set(Math.round(rect.width * zoomFactor));
    this.zoomBgHeight.set(Math.round(rect.height * zoomFactor));
  }

  private backdropMouseDownTarget: EventTarget | null = null;

  onBackdropMouseDown(event: MouseEvent): void {
    if (event.button === 0) {
      this.backdropMouseDownTarget = event.target;
    }
  }

  onBackdropMouseUp(event: MouseEvent): void {
    if (event.button !== 0 || !this.backdropMouseDownTarget) {
      this.backdropMouseDownTarget = null;
      return;
    }

    const downTarget = this.backdropMouseDownTarget as HTMLElement;
    const upTarget = event.target as HTMLElement;

    const isInsideContent = (target: HTMLElement | null): boolean => {
      if (!target) return false;

      // El panel lateral de detalles técnicos siempre es interactivo
      if (target.closest('.event-detail-drawer')) {
        return true;
      }

      // La consola inferior de pestañas y botones siempre es interactiva
      if (target.closest('.biometric-hud-console')) {
        return true;
      }

      // Comprobar si hay un medio activo válido visible en el workspace
      const isVideoMode = this.activeMediaType() === 'video';
      const isComparisonMode = this.activeMediaType() === 'comparison';
      const hasValidVideo = !!this.event?.urlVideo && !this.hasVideoError();
      const hasValidImage = !!this.event?.urlImg && !this.hasImageError();

      const hasActiveMedia = isComparisonMode
        ? (hasValidImage || hasValidVideo)
        : (isVideoMode ? hasValidVideo : hasValidImage);

      // Si no hay medio activo visible (ej: sin imagen de captura, o pestaña de video sin video),
      // todo el área del workspace es tratada como fondo clicable para cerrar el modal!
      if (!hasActiveMedia) {
        return false;
      }

      // Si sí hay un medio activo válido, evitar que clics sobre la imagen/video cierren el modal
      return !!(
        target.closest('.stage-media-card') ||
        target.closest('.stage-img-box') ||
        target.closest('.modal-img-wrapper') ||
        target.closest('.comparison-card')
      );
    };

    if (!isInsideContent(downTarget) && !isInsideContent(upTarget)) {
      this.onClose();
    }
    this.backdropMouseDownTarget = null;
  }

  onClose(): void {
    this.isZoomed.set(false);
    this.hasImageError.set(false);
    this.hasVideoError.set(false);
    this.activeMediaType.set('image');
    this.mediaAspectRatio.set(null);
    this.focusedComparisonCard.set(null);
    this.close.emit();
  }

  onImageLoad(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      this.mediaAspectRatio.set(img.naturalWidth / img.naturalHeight);
    }
  }

  onVideoLoadedMetadata(event: Event): void {
    const video = event.target as HTMLVideoElement;
    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
      this.mediaAspectRatio.set(video.videoWidth / video.videoHeight);
    }
  }

  onVideoError(event: Event): void {
    this.hasVideoError.set(true);
  }

  onImageError(errEvent: Event): void {
    this.hasImageError.set(true);
  }

  copyToClipboard(text: string, field: string): void {
    if (!text) return;
    utilCopyToClipboard(text).then(() => {
      this.copiedField.set(field);
      setTimeout(() => this.copiedField.set(null), 2000);
    }).catch(err => console.error('Error al copiar:', err));
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

  /**
   * Determina si la opción de 'Comparativa' está disponible para el evento
   */
  isComparisonAvailable(record: EventRecord | null | undefined): boolean {
    return this.facialMatchService.isComparisonApplicable(record);
  }

  /**
   * Determina si es un evento de reconocimiento facial
   */
  isFacialEvent(record: EventRecord | null | undefined): boolean {
    if (!record?.analitica) return false;
    const lower = record.analitica.toLowerCase();
    return lower.includes('facial') || lower.includes('rostro') || lower.includes('face');
  }

  /**
   * Determina si es un evento de reconocimiento de placas vehicular
   */
  isPlateEvent(record: EventRecord | null | undefined): boolean {
    if (!record?.analitica) return false;
    const lower = record.analitica.toLowerCase();
    return lower.includes('placa') || lower.includes('plate') || lower.includes('lpr');
  }

  /**
   * Determina si es un evento con coincidencia en lista de control (Facial o Placas)
   */
  isMatchEvent(record: EventRecord | null | undefined): boolean {
    return this.isFacialEvent(record) || this.isPlateEvent(record) || !!record?.matchDetail;
  }

  onMatchImageError(errEvent: Event): void {
    this.hasMatchImageError.set(true);
  }

  /**
   * Obtiene la similitud real del evento o match sin recurrir a fallbacks hardcodeados
   */
  getDisplaySimilarity(): number {
    if (typeof this.matchData()?.similarity === 'number') {
      return this.matchData()!.similarity;
    }
    if (typeof this.event?.porcentajeSimilitud === 'number') {
      return this.event.porcentajeSimilitud;
    }
    if (typeof this.event?.matchDetail?.confianza === 'number') {
      const c = this.event.matchDetail.confianza;
      return Math.round(c <= 1 ? c * 100 : c);
    }
    return 0;
  }

  /**
   * Color semántico según el nivel de similitud
   */
  getSimilarityColor(similarity: number): string {
    if (similarity >= 80) return '#10b981'; // Verde esmeralda (Alta)
    if (similarity >= 65) return '#f59e0b'; // Ámbar cálido (Media)
    return '#ef4444'; // Rojo / Alerta (Baja)
  }

  /**
   * Clase CSS de badge según similitud
   */
  getSimilarityBadgeClass(similarity: number): string {
    if (similarity >= 80) return 'similarity-high';
    if (similarity >= 65) return 'similarity-mid';
    return 'similarity-low';
  }

  /**
   * Formatea los números flotantes de muchos decimales dentro de un texto
   * de descripción (ej: "1796.7047259807587 segundos" → "1,796.70 segundos").
   */
  formatDetalleEvento(text: string): string {
    if (!text) return '';
    return text.replace(/(\d+\.\d{3,})/g, (match) => {
      const n = parseFloat(match);
      return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    });
  }
}
