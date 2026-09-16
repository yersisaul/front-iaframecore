import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  computed,
  ViewEncapsulation,
  ChangeDetectionStrategy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Camera } from '../../../core/domain/entities/camera.models';
import { EventRecord } from '../../../core/domain/entities/event.models';
import { parseUtcDate } from '../../../core/utils/date-utils';
import { MediaUrlPipe } from '../pipes/media-url.pipe';

@Component({
  selector: 'app-monitoring-events-sidebar',
  standalone: true,
  imports: [CommonModule, MediaUrlPipe],
  templateUrl: './monitoring-events-sidebar.component.html',
  styleUrl: './monitoring-events-sidebar.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None
})
export class MonitoringEventsSidebarComponent {
  // --- Reactive Signals for Inputs ---
  readonly collapsedSignal = signal<boolean>(false);
  readonly eventsSignal = signal<EventRecord[]>([]);
  readonly isLoadingSignal = signal<boolean>(false);
  readonly currentTimePointerSignal = signal<Date>(new Date());
  readonly camerasInCanvasSignal = signal<Camera[]>([]);
  readonly eventSearchQuerySignal = signal<string>('');
  readonly selectedCameraNamesSignal = signal<Set<string>>(new Set());

  // --- Inputs ---
  @Input() set collapsed(val: boolean) {
    this.collapsedSignal.set(val);
  }
  get collapsed(): boolean {
    return this.collapsedSignal();
  }

  @Input() set events(val: EventRecord[] | null | undefined) {
    this.eventsSignal.set(val || []);
  }
  get events(): EventRecord[] {
    return this.eventsSignal();
  }

  @Input() set isLoading(val: boolean) {
    this.isLoadingSignal.set(val);
  }
  get isLoading(): boolean {
    return this.isLoadingSignal();
  }

  @Input() set currentTimePointer(val: Date | null | undefined) {
    if (val) {
      this.currentTimePointerSignal.set(val);
    }
  }
  get currentTimePointer(): Date {
    return this.currentTimePointerSignal();
  }

  @Input() set camerasInCanvas(val: Camera[] | null | undefined) {
    this.camerasInCanvasSignal.set(val || []);
  }
  get camerasInCanvas(): Camera[] {
    return this.camerasInCanvasSignal();
  }

  @Input() set eventSearchQuery(val: string | null | undefined) {
    this.eventSearchQuerySignal.set(val || '');
  }
  get eventSearchQuery(): string {
    return this.eventSearchQuerySignal();
  }

  @Input() set selectedCameraNames(val: Set<string> | null | undefined) {
    this.selectedCameraNamesSignal.set(val || new Set());
  }
  get selectedCameraNames(): Set<string> {
    return this.selectedCameraNamesSignal();
  }

  @Input() getAnalyticColor?: (analitica: string) => string;

  // --- Outputs ---
  @Output() toggleCollapse = new EventEmitter<void>();
  @Output() eventClick = new EventEmitter<EventRecord>();
  @Output() cameraConfigClick = new EventEmitter<{ camera: Camera; event?: MouseEvent }>();

  // --- Estado interno de pestañas ---
  readonly activeRightTab = signal<'registro' | 'analiticas'>('registro');

  // --- Paginación reactiva deslizante (Ventana de 3 páginas) ---
  readonly sidebarPageSize = 250;
  readonly currentSidebarPage = signal<number>(1);

  readonly totalSidebarPages = computed(() => {
    const total = this.eventsSignal().length;
    return Math.max(1, Math.ceil(total / this.sidebarPageSize));
  });

  readonly visibleSidebarEvents = computed(() => {
    const all = this.eventsSignal();
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

    if (scrollPercentage > 0.75 && currentPage < totalPages) {
      this.currentSidebarPage.update(p => Math.min(totalPages, p + 1));
    } else if (scrollTop < clientHeight * 0.25 && currentPage > 1) {
      this.currentSidebarPage.update(p => Math.max(1, p - 1));
    }
  }

  onToggleCollapse(): void {
    this.toggleCollapse.emit();
  }

  onEventClick(event: EventRecord): void {
    this.eventClick.emit(event);
  }

  onCameraConfig(camera: Camera, event?: MouseEvent): void {
    if (event) event.stopPropagation();
    this.cameraConfigClick.emit({ camera, event });
  }

  resolveAnalyticColor(analitica: string): string {
    if (this.getAnalyticColor) {
      return this.getAnalyticColor(analitica);
    }
    return this.defaultAnalyticColor(analitica);
  }

  private defaultAnalyticColor(analitica: string): string {
    if (!analitica) return 'var(--primary, #2b7fff)';
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

  formatDetalleEvento(text: string): string {
    if (!text) return '';
    return text.replace(/(\d+\.\d{3,})/g, (match) => {
      const n = parseFloat(match);
      return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    });
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLElement;
    if (target) {
      target.style.opacity = '0';
    }
  }

  // --- Animaciones de texto largo (Marquee) en hover ---
  onEventCardMouseEnter(cardEl: HTMLElement): void {
    if (!cardEl) return;
    const titleEl = cardEl.querySelector('.vms-evt-card__cam') as HTMLElement | null;
    const containerEl = cardEl.querySelector('.vms-evt-card__cam-container') as HTMLElement | null;
    if (!titleEl || !containerEl) return;

    const availableWidth = containerEl.clientWidth;
    const textWidth = titleEl.scrollWidth;

    if (textWidth > (availableWidth + 2) && availableWidth > 0) {
      const shift = Math.ceil(textWidth - availableWidth) + 16;
      titleEl.style.setProperty('--marquee-shift', `-${shift}px`);
      cardEl.classList.add('vms-evt-needs-marquee');
    } else {
      titleEl.style.removeProperty('--marquee-shift');
      cardEl.classList.remove('vms-evt-needs-marquee');
    }
  }

  onEventCardMouseLeave(cardEl: HTMLElement): void {
    if (!cardEl) return;
    cardEl.classList.remove('vms-evt-needs-marquee');
    const titleEl = cardEl.querySelector('.vms-evt-card__cam') as HTMLElement | null;
    if (titleEl) {
      titleEl.style.removeProperty('--marquee-shift');
    }
  }

  onAccordionCardMouseEnter(cardEl: HTMLElement): void {
    if (!cardEl) return;
    const titleEl = cardEl.querySelector('.camera-accordion-title') as HTMLElement | null;
    const containerEl = cardEl.querySelector('.camera-accordion-title-container') as HTMLElement | null;
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

  onAccordionCardMouseLeave(cardEl: HTMLElement): void {
    if (!cardEl) return;
    cardEl.classList.remove('camera-title-needs-marquee');
    const titleEl = cardEl.querySelector('.camera-accordion-title') as HTMLElement | null;
    if (titleEl) {
      titleEl.style.removeProperty('--marquee-shift');
    }
  }
}
