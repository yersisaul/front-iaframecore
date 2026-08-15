import { Component, Input, Output, EventEmitter, signal, HostListener, ViewChild, ElementRef, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { EventRecord } from '../../../core/domain/entities/event.models';
import { copyToClipboard as utilCopyToClipboard } from '../../../core/utils/clipboard.util';

@Component({
  selector: 'app-event-detail-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './event-detail-modal.component.html',
  styleUrl: './event-detail-modal.component.css'
})
export class EventDetailModalComponent implements OnDestroy {
  @Input() event: EventRecord | null = null;
  @Output() close = new EventEmitter<void>();

  readonly copiedField = signal<string | null>(null);
  readonly hasImageError = signal<boolean>(false);
  readonly activeMediaType = signal<'image' | 'video'>('image');
  readonly mediaAspectRatio = signal<number | null>(null);

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.event) {
      this.onClose();
    }
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
    // CONDICIÓN CLAVE: Si la lupa NO está activada, NO interceptar ni modificar el comportamiento nativo del navegador
    if (!this.isZoomed()) return;

    // Si la lupa SÍ está activada y el cursor está sobre la imagen:
    // Desactivar el zoom/scroll nativo de página del navegador y modificar el tamaño de la lupa
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
      return !!(
        target.closest('.modal-img-wrapper') ||
        target.closest('.no-image-text-container') ||
        target.closest('.event-detail-drawer')
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
    this.activeMediaType.set('image');
    this.mediaAspectRatio.set(null);
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

  toggleZoom(mouseEvent: MouseEvent): void {
    this.isZoomed.update(z => !z);
    if (this.isZoomed()) {
      this.onZoomMouseMove(mouseEvent);
    }
  }

  onZoomMouseMove(mouseEvent: MouseEvent): void {
    if (!this.isZoomed()) return;
    const container = mouseEvent.currentTarget as HTMLElement;
    const rect = container.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, mouseEvent.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, mouseEvent.clientY - rect.top));

    this.zoomX.set(x);
    this.zoomY.set(y);

    const zoomFactor = 2.5;
    const lensSize = this.zoomLensDiameter();

    this.zoomBgX.set(Math.round(lensSize / 2 - x * zoomFactor));
    this.zoomBgY.set(Math.round(lensSize / 2 - y * zoomFactor));
    this.zoomBgWidth.set(Math.round(rect.width * zoomFactor));
    this.zoomBgHeight.set(Math.round(rect.height * zoomFactor));
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
