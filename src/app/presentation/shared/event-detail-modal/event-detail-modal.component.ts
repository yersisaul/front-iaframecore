import { Component, Input, Output, EventEmitter, signal } from '@angular/core';
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
export class EventDetailModalComponent {
  @Input() event: EventRecord | null = null;
  @Output() close = new EventEmitter<void>();

  readonly copiedField = signal<string | null>(null);

  // Lente Lupa Magnifier Zoom
  readonly isZoomed = signal<boolean>(false);
  readonly zoomX = signal<number>(0);
  readonly zoomY = signal<number>(0);
  readonly zoomBgX = signal<number>(0);
  readonly zoomBgY = signal<number>(0);
  readonly zoomBgWidth = signal<number>(0);
  readonly zoomBgHeight = signal<number>(0);

  onClose(): void {
    this.isZoomed.set(false);
    this.close.emit();
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
    const x = mouseEvent.clientX - rect.left;
    const y = mouseEvent.clientY - rect.top;

    this.zoomX.set(x);
    this.zoomY.set(y);

    const zoomFactor = 2.5;
    const lensSize = 350;

    this.zoomBgX.set(Math.round(- (x * zoomFactor - lensSize / 2)));
    this.zoomBgY.set(Math.round(- (y * zoomFactor - lensSize / 2)));
    this.zoomBgWidth.set(Math.round(rect.width * zoomFactor));
    this.zoomBgHeight.set(Math.round(rect.height * zoomFactor));
  }

  onImageError(errEvent: Event): void {
    const target = errEvent.target as HTMLElement;
    if (target) {
      target.style.display = 'none';
    }
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
}
