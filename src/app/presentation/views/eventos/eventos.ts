import { Component, OnInit, OnDestroy, AfterViewInit, inject, DestroyRef, signal, computed, HostListener, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, combineLatest } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { EventService } from '../../../core/services/event.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { EventFilters, EventRecord, defaultEventFilters } from '../../../core/domain/entities/event.models';
import { parseUtcDate } from '../../../core/utils/date-utils';
import { copyToClipboard as utilCopyToClipboard } from '../../../core/utils/clipboard.util';

@Component({
  selector: 'app-eventos',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './eventos.html',
  styleUrl: './eventos.css'
})
export class Eventos implements OnInit, OnDestroy, AfterViewInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private eventService = inject(EventService);
  private sidebarService = inject(SidebarService);
  private permissionsService = inject(PermissionsService);
  private destroyRef = inject(DestroyRef);

  @ViewChild('eventosContainer', { static: false }) eventosContainer!: ElementRef<HTMLDivElement>;

  // Expose signals from service
  readonly records = this.eventService.records;
  readonly totalRecords = this.eventService.totalRecords;
  readonly filters = this.eventService.filters;
  readonly filterOptions = this.eventService.filterOptions;
  readonly isLoading = this.eventService.isLoading;
  readonly currentPage = this.eventService.currentPage;
  readonly pageSize = this.eventService.pageSize;
  readonly newRecordIds = this.eventService.newRecordIds;
  readonly bufferedEvents = this.eventService.bufferedEvents;

  applyBufferedEvents(): void {
    this.eventService.applyBufferedEvents();
  }

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  // Grid conscious columns
  readonly columns = signal(this.getInitialColumns());

  readonly limitOptions = computed(() => {
    const cols = this.columns();
    return [cols * 10, cols * 20, cols * 30];
  });

  // Filter dropdown toggle states
  readonly activeDropdown = signal<string | null>(null);
  readonly showFilters = signal<boolean>(true);

  // Search Control
  readonly searchControl = new FormControl('');

  // Local draft filter state
  readonly tempFilters = signal<EventFilters>(defaultEventFilters());

  // Hover popover coordinate states
  readonly activeHoverCardId = signal<string | null>(null);
  readonly mouseX = signal<number>(0);
  readonly mouseY = signal<number>(0);

  // Modal state
  readonly selectedEventForModal = signal<EventRecord | null>(null);
  
  // Magnifier Zoom state in modal
  readonly isZoomed = signal<boolean>(false);
  readonly zoomX = signal<number>(0);
  readonly zoomY = signal<number>(0);
  readonly zoomBgX = signal<number>(0);
  readonly zoomBgY = signal<number>(0);
  readonly zoomBgWidth = signal<number>(0);
  readonly zoomBgHeight = signal<number>(0);

  // Event Detail Panel — copy-to-clipboard feedback
  readonly copiedField = signal<string | null>(null);

  // Calendar State
  readonly activeCalendarField = signal<'desde' | 'hasta' | null>(null);
  readonly calendarViewMonth = signal<number>(new Date().getMonth());
  readonly calendarViewYear = signal<number>(new Date().getFullYear());

  // Time Picker State
  readonly activeTimeField = signal<'desde' | 'hasta' | null>(null);
  readonly hoursList = Array.from({ length: 24 }, (_, i) => i);
  readonly minutesList = Array.from({ length: 60 }, (_, i) => i);

  // Date picker strings
  readonly dateDesdeStr = signal<string>('');
  readonly dateHastaStr = signal<string>('');
  readonly timeDesdeStr = signal<string>('00:00');
  readonly timeHastaStr = signal<string>('23:59');

  readonly calendarGrid = computed(() => {
    const month = this.calendarViewMonth();
    const year = this.calendarViewYear();
    const firstDay = new Date(year, month, 1);
    const startDayOfWeek = firstDay.getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const emptyDays = Array.from({ length: startDayOfWeek }, (_, i) => i);
    const days = Array.from({ length: totalDays }, (_, i) => i + 1);
    return { emptyDays, days };
  });

  // Resize handling
  private resizeSubject = new Subject<number>();
  private resizeSubscription?: Subscription;
  private resizeObserver?: ResizeObserver;

  constructor() {
    // Sync service filters to local state
    toObservable(this.filters).pipe(
      takeUntilDestroyed()
    ).subscribe(f => {
      this.tempFilters.set({
        search: f.search || '',
        camaras: [...f.camaras],
        analiticas: [...f.analiticas],
        objetos: [...f.objetos],
        timestampDesde: f.timestampDesde ? new Date(f.timestampDesde) : null,
        timestampHasta: f.timestampHasta ? new Date(f.timestampHasta) : null
      });
      this.searchControl.setValue(f.search || '', { emitEvent: false });
    });

    // Unified search control debounce
    this.searchControl.valueChanges.pipe(
      debounceTime(350),
      takeUntilDestroyed()
    ).subscribe(val => {
      const text = val || '';
      this.tempFilters.update(f => ({ ...f, search: text }));
      this.eventService.updateFilters({ search: text });
    });

    // Synchronize filters to query parameters in url
    combineLatest({
      page: toObservable(this.currentPage),
      pageSize: toObservable(this.pageSize),
      filters: toObservable(this.filters)
    }).pipe(
      debounceTime(150),
      takeUntilDestroyed()
    ).subscribe(({ page, pageSize, filters }) => {
      const queryParams: any = {};
      queryParams['page'] = page > 1 ? page : null;

      const defaultPageSize = this.columns() * 10;
      queryParams['limit'] = pageSize !== defaultPageSize ? pageSize : null;

      queryParams['camaras'] = filters.camaras && filters.camaras.length > 0 ? filters.camaras.join(',') : null;
      queryParams['analiticas'] = filters.analiticas && filters.analiticas.length > 0 ? filters.analiticas.join(',') : null;
      queryParams['objetos'] = filters.objetos && filters.objetos.length > 0 ? filters.objetos.join(',') : null;
      queryParams['desde'] = filters.timestampDesde ? filters.timestampDesde.toISOString() : null;
      queryParams['hasta'] = filters.timestampHasta ? filters.timestampHasta.toISOString() : null;
      queryParams['search'] = filters.search || null;

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams,
        queryParamsHandling: 'merge'
      });
    });
  }

  ngOnInit(): void {
    this.eventService.isViewActive.set(true);

    // Handle initialization from route parameters
    this.route.queryParams.pipe(
      debounceTime(50),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(queryParams => {
      const pageVal = queryParams['page'] ? parseInt(queryParams['page'], 10) : 1;
      const page = !isNaN(pageVal) && pageVal > 0 ? pageVal : 1;

      const defaultPageSize = this.columns() * 10;
      const limitVal = queryParams['limit'] ? parseInt(queryParams['limit'], 10) : null;
      const pageSize = limitVal && !isNaN(limitVal) && limitVal > 0 ? limitVal : defaultPageSize;

      const parsedFilters = this.parseFiltersFromParams(queryParams);

      this.eventService.setPageSize(pageSize);
      this.eventService.currentPage.set(page);
      this.eventService.filters.set(parsedFilters);
      this.eventService.loadCurrentPage();
    });
  }

  ngAfterViewInit(): void {
    this.resizeSubscription = this.resizeSubject.pipe(
      debounceTime(150)
    ).subscribe(width => {
      this.adjustColumnsAndLimit(width);
    });

    if (typeof ResizeObserver !== 'undefined' && this.eventosContainer) {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          this.resizeSubject.next(entry.contentRect.width);
        }
      });
      this.resizeObserver.observe(this.eventosContainer.nativeElement);
    }

    setTimeout(() => {
      if (this.eventosContainer) {
        const width = this.eventosContainer.nativeElement.getBoundingClientRect().width;
        this.adjustColumnsAndLimit(width);
      }
    }, 50);
  }

  ngOnDestroy(): void {
    this.eventService.isViewActive.set(false);
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
    }
  }

  private estimateContainerWidth(): number {
    if (typeof window === 'undefined') return 1200;
    const sidebarWidth = this.isSidebarCollapsed() ? 78 : 260;
    return window.innerWidth - sidebarWidth - 48;
  }

  private getInitialColumns(): number {
    const w = this.estimateContainerWidth();
    return Math.max(1, Math.floor((w + 24) / (335 + 24)));
  }

  private adjustColumnsAndLimit(containerWidth: number): void {
    if (containerWidth <= 0) return;
    const newCols = Math.max(1, Math.floor((containerWidth + 24) / (335 + 24)));
    const oldCols = this.columns();
    
    if (newCols !== oldCols) {
      const currentSize = this.pageSize();
      let multiplier = Math.round(currentSize / oldCols);
      if (multiplier !== 10 && multiplier !== 20 && multiplier !== 30) {
        multiplier = 10;
      }
      this.columns.set(newCols);
      this.eventService.setPageSize(newCols * multiplier);
      this.eventService.setPage(1);
    }
  }

  onLimitChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newLimit = parseInt(select.value, 10);
    this.eventService.setPageSize(newLimit);
  }

  private parseFiltersFromParams(params: any): EventFilters {
    const camaras = params['camaras'] ? params['camaras'].split(',') : [];
    const analiticas = params['analiticas'] ? params['analiticas'].split(',') : [];
    const objetos = params['objetos'] ? params['objetos'].split(',') : [];
    const timestampDesde = params['desde'] && !isNaN(Date.parse(params['desde'])) ? new Date(params['desde']) : null;
    const timestampHasta = params['hasta'] && !isNaN(Date.parse(params['hasta'])) ? new Date(params['hasta']) : null;
    const search = params['search'] || '';

    // Initialize string helpers for visual inputs
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (timestampDesde) {
      this.dateDesdeStr.set(`${timestampDesde.getFullYear()}-${pad(timestampDesde.getMonth() + 1)}-${pad(timestampDesde.getDate())}`);
      this.timeDesdeStr.set(`${pad(timestampDesde.getHours())}:${pad(timestampDesde.getMinutes())}`);
    } else {
      this.dateDesdeStr.set('');
      this.timeDesdeStr.set('00:00');
    }

    if (timestampHasta) {
      this.dateHastaStr.set(`${timestampHasta.getFullYear()}-${pad(timestampHasta.getMonth() + 1)}-${pad(timestampHasta.getDate())}`);
      this.timeHastaStr.set(`${pad(timestampHasta.getHours())}:${pad(timestampHasta.getMinutes())}`);
    } else {
      this.dateHastaStr.set('');
      this.timeHastaStr.set('23:59');
    }

    return {
      camaras,
      analiticas,
      objetos,
      timestampDesde,
      timestampHasta,
      search
    };
  }

  // --- Filter methods ---
  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  toggleFiltersVisibility(): void {
    this.showFilters.update(v => !v);
  }

  toggleDropdown(dropdownName: string, event: Event): void {
    event.stopPropagation();
    if (this.activeDropdown() === dropdownName) {
      this.activeDropdown.set(null);
    } else {
      this.activeDropdown.set(dropdownName);
    }
  }

  @HostListener('document:click')
  closeDropdowns(): void {
    this.activeDropdown.set(null);
    this.activeCalendarField.set(null);
    this.activeTimeField.set(null);
  }

  onResetFilters(): void {
    this.dateDesdeStr.set('');
    this.timeDesdeStr.set('00:00');
    this.dateHastaStr.set('');
    this.timeHastaStr.set('23:59');
    this.eventService.resetFilters();
  }

  onApplyFilters(): void {
    this.eventService.updateFilters(this.tempFilters());
  }

  toggleMultiSelectFilter(field: 'camaras' | 'analiticas' | 'objetos', value: string): void {
    const currentList = this.tempFilters()[field] as string[];
    const newList = currentList.includes(value)
      ? currentList.filter(item => item !== value)
      : [...currentList, value];

    this.tempFilters.update(f => ({ ...f, [field]: newList }));
  }

  // --- Dynamic Date custom pickers ---
  getMonths(): string[] {
    return [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
  }

  openCalendarField(field: 'desde' | 'hasta', event: Event): void {
    event.stopPropagation();
    if (this.activeCalendarField() === field) {
      this.activeCalendarField.set(null);
      return;
    }
    const dateStr = field === 'desde' ? this.dateDesdeStr() : this.dateHastaStr();
    if (dateStr) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[0], 10);
        if (!isNaN(m) && m >= 0 && m <= 11) this.calendarViewMonth.set(m);
        if (!isNaN(y)) this.calendarViewYear.set(y);
      }
    } else {
      this.calendarViewMonth.set(new Date().getMonth());
      this.calendarViewYear.set(new Date().getFullYear());
    }
    this.activeCalendarField.set(field);
    this.activeTimeField.set(null);
  }

  selectCalendarDay(day: number): void {
    const field = this.activeCalendarField();
    if (!field) return;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    if (field === 'desde') {
      this.dateDesdeStr.set(dateStr);
      this._applyDateTimeToFilter('desde');
    } else {
      this.dateHastaStr.set(dateStr);
      this._applyDateTimeToFilter('hasta');
    }
    this.activeCalendarField.set(null);
  }

  isCalendarDaySelected(day: number): boolean {
    const field = this.activeCalendarField();
    if (!field) return false;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const target = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    return field === 'desde' ? this.dateDesdeStr() === target : this.dateHastaStr() === target;
  }

  prevCalendarMonth(event: Event): void {
    event.stopPropagation();
    const m = this.calendarViewMonth();
    if (m > 0) {
      this.calendarViewMonth.update(v => v - 1);
    } else {
      this.calendarViewMonth.set(11);
      this.calendarViewYear.update(v => v - 1);
    }
  }

  nextCalendarMonth(event: Event): void {
    event.stopPropagation();
    const m = this.calendarViewMonth();
    if (m < 11) {
      this.calendarViewMonth.update(v => v + 1);
    } else {
      this.calendarViewMonth.set(0);
      this.calendarViewYear.update(v => v + 1);
    }
  }

  openTimePickerField(field: 'desde' | 'hasta', event: Event): void {
    event.stopPropagation();
    if (this.activeTimeField() === field) {
      this.activeTimeField.set(null);
      return;
    }
    this.activeTimeField.set(field);
    this.activeCalendarField.set(null);
  }

  private _getTimeParts(timeStr: string): { hour: number; minute: number } {
    if (!timeStr) return { hour: 0, minute: 0 };
    const parts = timeStr.split(':');
    return { hour: parseInt(parts[0], 10) || 0, minute: parseInt(parts[1], 10) || 0 };
  }

  isTimeHourSelected(h: number): boolean {
    const field = this.activeTimeField();
    if (!field) return false;
    const ts = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    return this._getTimeParts(ts).hour === h;
  }

  isTimeMinuteSelected(m: number): boolean {
    const field = this.activeTimeField();
    if (!field) return false;
    const ts = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    return this._getTimeParts(ts).minute === m;
  }

  selectTimeHour(h: number): void {
    const field = this.activeTimeField();
    if (!field) return;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ts = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    const parts = this._getTimeParts(ts);
    const newTs = `${pad(h)}:${pad(parts.minute)}`;
    if (field === 'desde') { this.timeDesdeStr.set(newTs); this._applyDateTimeToFilter('desde'); }
    else { this.timeHastaStr.set(newTs); this._applyDateTimeToFilter('hasta'); }
  }

  selectTimeMinute(m: number): void {
    const field = this.activeTimeField();
    if (!field) return;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ts = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    const parts = this._getTimeParts(ts);
    const newTs = `${pad(parts.hour)}:${pad(m)}`;
    if (field === 'desde') { this.timeDesdeStr.set(newTs); this._applyDateTimeToFilter('desde'); }
    else { this.timeHastaStr.set(newTs); this._applyDateTimeToFilter('hasta'); }
  }

  private _applyDateTimeToFilter(field: 'desde' | 'hasta'): void {
    const dateStr = field === 'desde' ? this.dateDesdeStr() : this.dateHastaStr();
    const timeStr = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    if (!dateStr) return;
    const combined = `${dateStr}T${timeStr || '00:00'}`;
    const date = new Date(combined);
    if (isNaN(date.getTime())) return;
    if (field === 'desde') this.tempFilters.update(f => ({ ...f, timestampDesde: date }));
    else this.tempFilters.update(f => ({ ...f, timestampHasta: date }));
  }

  formatCalendarDateLabel(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const date = new Date(year, month, day);
    return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'long' }).format(date);
  }

  setDatePreset(preset: 'today' | '24h' | '7d' | 'clear'): void {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const toTimeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    if (preset === 'today') {
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      this.dateDesdeStr.set(toDateStr(todayStart));
      this.timeDesdeStr.set('00:00');
      this.dateHastaStr.set('');
      this.timeHastaStr.set('23:59');
      this.tempFilters.update(f => ({ ...f, timestampDesde: todayStart, timestampHasta: null }));
    } else if (preset === '24h') {
      const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      this.dateDesdeStr.set(toDateStr(past24h));
      this.timeDesdeStr.set(toTimeStr(past24h));
      this.dateHastaStr.set(toDateStr(now));
      this.timeHastaStr.set(toTimeStr(now));
      this.tempFilters.update(f => ({ ...f, timestampDesde: past24h, timestampHasta: now }));
    } else if (preset === '7d') {
      const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      this.dateDesdeStr.set(toDateStr(past7d));
      this.timeDesdeStr.set(toTimeStr(past7d));
      this.dateHastaStr.set(toDateStr(now));
      this.timeHastaStr.set(toTimeStr(now));
      this.tempFilters.update(f => ({ ...f, timestampDesde: past7d, timestampHasta: now }));
    } else if (preset === 'clear') {
      this.dateDesdeStr.set('');
      this.timeDesdeStr.set('00:00');
      this.dateHastaStr.set('');
      this.timeHastaStr.set('23:59');
      this.tempFilters.update(f => ({ ...f, timestampDesde: null, timestampHasta: null }));
    }
  }

  // --- Active State computations ---
  readonly hasActiveFilters = computed(() => {
    const f = this.filters();
    return f.camaras.length > 0 ||
           f.analiticas.length > 0 ||
           f.objetos.length > 0 ||
           f.timestampDesde !== null ||
           f.timestampHasta !== null ||
           (f.search && f.search.trim().length > 0);
  });

  readonly hasActiveTempFilters = computed(() => {
    const f = this.tempFilters();
    return f.camaras.length > 0 ||
           f.analiticas.length > 0 ||
           f.objetos.length > 0 ||
           f.timestampDesde !== null ||
           f.timestampHasta !== null ||
           (f.search && f.search.trim().length > 0);
  });

  readonly hasPendingFilterChanges = computed(() => {
    const t = this.tempFilters();
    const a = this.filters();

    const arraysEqual = (x: string[], y: string[]) =>
      x.length === y.length && x.every((v, i) => v === y[i]);

    const datesEqual = (x: Date | null, y: Date | null) => {
      if (x === null && y === null) return true;
      if (x === null || y === null) return false;
      return x.getTime() === y.getTime();
    };

    return !arraysEqual([...t.camaras].sort(), [...a.camaras].sort()) ||
           !arraysEqual([...t.analiticas].sort(), [...a.analiticas].sort()) ||
           !arraysEqual([...t.objetos].sort(), [...a.objetos].sort()) ||
           !datesEqual(t.timestampDesde, a.timestampDesde) ||
           !datesEqual(t.timestampHasta, a.timestampHasta) ||
           (t.search || '') !== (a.search || '');
  });

  // --- Pagination operations ---
  setPage(page: number): void {
    const total = this.totalPages();
    if (page >= 1 && page <= total) {
      this.eventService.setPage(page);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.eventService.setPage(this.currentPage() + 1);
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.eventService.setPage(this.currentPage() - 1);
    }
  }

  totalPages(): number {
    const total = this.totalRecords();
    const size = this.pageSize();
    return total > 0 ? Math.ceil(total / size) : 1;
  }

  readonly visiblePages = computed(() => {
    const current = this.currentPage();
    const total = this.totalPages();
    const pagesToShow = 5;

    let start = Math.max(1, current - 2);
    let end = Math.min(total, current + 2);

    if (current <= 3) {
      end = Math.min(total, pagesToShow);
    }
    if (current >= total - 2) {
      start = Math.max(1, total - pagesToShow + 1);
    }

    const pageArr: number[] = [];
    for (let i = start; i <= end; i++) {
      if (i >= 1 && i <= total) {
        pageArr.push(i);
      }
    }
    return pageArr;
  });

  onPageInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^0-9]/g, '');
  }

  jumpToPage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = parseInt(input.value, 10);
    const total = this.totalPages();
    if (!isNaN(val) && val >= 1 && val <= total) {
      this.setPage(val);
    }
    input.value = '';
  }

  formatTotalRecords(val: number): string {
    if (val >= 1000000) {
      const millions = val / 1000000;
      const formatted = millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1);
      return `${formatted}M+`;
    }
    return val.toLocaleString('es-ES');
  }

  formatDate(date: any): string {
    if (!date) return '';
    const d = parseUtcDate(date);
    return d.toLocaleString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  // --- Hover Popover Logic ---
  onCardMouseMove(event: MouseEvent, cardId: string): void {
    this.activeHoverCardId.set(cardId);
    
    // Get grid or card container position to place coordinates relatively if needed
    const cardEl = event.currentTarget as HTMLElement;
    const rect = cardEl.getBoundingClientRect();
    
    // Calculate tooltip offsets
    let x = event.clientX - rect.left + 15;
    let y = event.clientY - rect.top + 15;
    
    const viewportWidth = window.innerWidth;
    const tooltipWidth = 260; // Estimated width
    
    if (event.clientX + tooltipWidth > viewportWidth) {
      x = event.clientX - rect.left - tooltipWidth - 15;
    }
    
    this.mouseX.set(x);
    this.mouseY.set(y);
  }

  onCardMouseLeave(): void {
    this.activeHoverCardId.set(null);
  }

  // --- Event Detail Panel Helpers ---

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

  copyToClipboard(text: string, field: string): void {
    if (!text) return;
    utilCopyToClipboard(text).then(() => {
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

  // --- Image Detail Modal & Magnifier Zoom Logic ---
  openImageDetailsModal(record: EventRecord): void {
    this.selectedEventForModal.set(record);
    this.isZoomed.set(false);
  }

  closeImageDetailsModal(): void {
    this.selectedEventForModal.set(null);
    this.isZoomed.set(false);
  }

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
}
