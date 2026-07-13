import { Component, OnInit, OnDestroy, AfterViewInit, inject, DestroyRef, signal, computed, HostListener, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, combineLatest } from 'rxjs';
import { debounceTime, skip } from 'rxjs/operators';
import { MetadataService } from '../../../core/services/metadata.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { MetaIndexName, MetaColor, MetaRecord, MetaPostura } from '../../../core/domain/entities/metadata.models';
import { MetaFilterState } from '../../../core/domain/entities/metadata.filters.models';
import { parseUtcDate } from '../../../core/utils/date-utils';
import { IStorageRepository } from '../../../core/domain/repositories/storage.repository';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';

import { ListService } from '../../../core/services/list.service';
import { CameraService } from '../../../core/services/camera.service';
import { PermissionsService } from '../../../core/services/permissions.service';
 
@Component({
  selector: 'app-metadatos',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './metadatos.html',
  styleUrl: './metadatos.css'
})
export class Metadatos implements OnInit, OnDestroy, AfterViewInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private metadataService = inject(MetadataService);
  private sidebarService = inject(SidebarService);
  private storageRepository = inject(IStorageRepository);
  private destroyRef = inject(DestroyRef);
  private listService = inject(ListService);
  private cameraService = inject(CameraService);
  public permissionsService = inject(PermissionsService);

  // Watchlist Modal Integration
  readonly showAddToWatchlistModal = signal<boolean>(false);
  readonly selectedRecordForWatchlist = signal<any | null>(null);
  readonly selectedWatchlistId = signal<string>('');
  readonly subjectWatchlistName = signal<string>('');
  readonly isWatchlistLoading = this.listService.isLoading;
  readonly watchlists = this.listService.lists;

  // Filtered watchlists based on active metadata category
  readonly compatibleWatchlists = computed(() => {
    const category = this.activeIndex();
    const type = category === 'vehiculos' ? 'plate_recognition' : 'face_recognition';
    return this.watchlists().filter(w => w.list_type === type);
  });

  @ViewChild('metadataGrid', { static: false }) metadataGrid!: ElementRef<HTMLDivElement>;
  @ViewChild('imageInput') imageInput!: ElementRef<HTMLInputElement>;

  // Expose signals from service
  readonly activeIndex = this.metadataService.activeIndex;
  readonly records = this.metadataService.records;
  readonly totalRecords = this.metadataService.totalRecords;
  readonly filters = this.metadataService.filters;
  readonly filterOptions = this.metadataService.filterOptions;
  readonly isLoading = this.metadataService.isLoading;
  readonly currentPage = this.metadataService.currentPage;
  readonly pageSize = this.metadataService.pageSize;
  readonly newRecordIds = this.metadataService.newRecordIds;

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  // ── Computed Filter Options (API + Selected + Fallbacks) ──────────────────────
  readonly tipoObjetoOptions = computed<string[]>(() => {
    const opts = this.filterOptions();
    const dynamic = opts ? opts.tipoObjeto || [] : [];
    const temp = this.tempFilters()?.tipoObjeto || [];
    const idx = this.activeIndex();
    let fallbacks: string[] = [];
    if (idx === 'personas') fallbacks = ['persona', 'ciclista', 'peatón'];
    else if (idx === 'vehiculos') fallbacks = ['auto', 'camioneta', 'motocicleta', 'camión', 'omnibús'];
    else if (idx === 'otros') fallbacks = ['mochila', 'maleta', 'bolso'];
    
    return Array.from(new Set([...dynamic, ...temp, ...fallbacks])).filter(Boolean);
  });

  readonly coloresOptions = computed<string[]>(() => {
    const opts = this.filterOptions();
    const dynamic = opts ? opts.colores || [] : [];
    const temp = this.tempFilters()?.colores || [];
    const fallbacks = ['negro', 'blanco', 'gris', 'rojo', 'azul', 'verde', 'amarillo', 'marrón'];
    return Array.from(new Set([...dynamic, ...temp, ...fallbacks])).filter(Boolean);
  });

  readonly posturasOptions = computed<string[]>(() => {
    const opts = this.filterOptions();
    const dynamic = opts ? opts.posturas || [] : [];
    const temp = this.tempFilters()?.posturas || [];
    const fallbacks = ['caminando', 'parado', 'sentado', 'corriendo'];
    return Array.from(new Set([...dynamic, ...temp, ...fallbacks])).filter(Boolean);
  });

  readonly edadesOptions = computed<string[]>(() => {
    const opts = this.filterOptions();
    const dynamic = opts ? opts.edades || [] : [];
    const temp = this.tempFilters()?.edad ? [this.tempFilters().edad!] : [];
    const fallbacks = ['niño', 'joven', 'adulto', 'anciano'];
    return Array.from(new Set([...dynamic, ...temp, ...fallbacks])).filter(Boolean);
  });

  readonly generosOptions = computed<string[]>(() => {
    const opts = this.filterOptions();
    const dynamic = opts ? opts.generos || [] : [];
    const temp = this.tempFilters()?.genero ? [this.tempFilters().genero!] : [];
    const fallbacks = ['masculino', 'femenino'];
    return Array.from(new Set([...dynamic, ...temp, ...fallbacks])).filter(Boolean);
  });

  readonly camarasOptions = computed<string[]>(() => {
    const opts = this.filterOptions();
    const dynamic = opts ? opts.camaras || [] : [];
    const temp = this.tempFilters()?.camaras || [];
    // Fallback: incluir todos los nombres de cámaras registradas en el sistema.
    // Esto garantiza que el desplegable tenga opciones aunque OpenSearch aún no tenga
    // documentos indexados para esas cámaras o si las agregaciones fallan.
    const systemCameras = this.cameraService.cameras().map(c => c.name);
    return Array.from(new Set([...dynamic, ...temp, ...systemCameras])).filter(Boolean);
  });

  readonly reconocimientosOptions = computed<string[]>(() => {
    const opts = this.filterOptions();
    const dynamic = opts ? opts.reconocimientos || [] : [];
    const temp = this.tempFilters()?.reconocimiento ? [this.tempFilters().reconocimiento!] : [];
    return Array.from(new Set([...dynamic, ...temp])).filter(Boolean);
  });

  // ── Pagination conscious of grid ──
  readonly columns = signal(this.getInitialColumns());

  readonly limitOptions = computed(() => {
    const cols = this.columns();
    return [cols * 10, cols * 20, cols * 30];
  });

  // Filter drawer/panel visibility
  readonly showFilterPanel = signal<boolean>(false);

  // Active filter dropdown inside the panel
  readonly activeDropdown = signal<string | null>(null);

  // Toggle state to hide/show horizontal filters
  readonly showFilters = signal<boolean>(true);

  // Unified search control
  readonly searchControl = new FormControl('');

  // Local draft filters state
  readonly tempFilters = signal<MetaFilterState>(this.getInitialFilters());

  // Hover and mouse coordinates for floating metadata cards popover
  readonly activeHoverCardId = signal<string | null>(null);
  readonly mouseX = signal<number>(0);
  readonly mouseY = signal<number>(0);

  // ── Custom Calendar & Time Picker State ──────────────────────────────────────
  readonly activeCalendarField = signal<'desde' | 'hasta' | null>(null);
  readonly calendarViewMonth = signal<number>(new Date().getMonth());
  readonly calendarViewYear = signal<number>(new Date().getFullYear());

  readonly activeTimeField = signal<'desde' | 'hasta' | null>(null);
  readonly hoursList = Array.from({ length: 24 }, (_, i) => i);
  readonly minutesList = Array.from({ length: 60 }, (_, i) => i);

  // Date strings for calendar picker (YYYY-MM-DD)
  readonly dateDesdeStr = signal<string>('');
  readonly dateHastaStr = signal<string>('');
  // Time strings for time picker (HH:MM)
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

  // Computed check to see if any filter is active in the service
  readonly hasActiveFilters = computed(() => {
    const f = this.filters();
    return f.camaras.length > 0 ||
           f.tipoObjeto.length > 0 ||
           f.edad !== null ||
           f.genero !== null ||
           f.reconocimiento !== null ||
           f.colores.length > 0 ||
           f.posturas.length > 0 ||
           f.confiabilidadMin > 0 ||
           f.confiabilidadMax < 1 ||
           f.timestampDesde !== null ||
           f.timestampHasta !== null ||
           (f.search && f.search.trim().length > 0) ||
           (f.imageEmbedding !== null && f.imageEmbedding !== undefined) ||
           (f.imageSearchUrl !== null && f.imageSearchUrl !== undefined) ||
           f.coincidenciaFiltro !== 'all';
  });

  readonly hasActiveTempFilters = computed(() => {
    const f = this.tempFilters();
    return f.camaras.length > 0 ||
           f.tipoObjeto.length > 0 ||
           f.edad !== null ||
           f.genero !== null ||
           f.reconocimiento !== null ||
           f.colores.length > 0 ||
           f.posturas.length > 0 ||
           f.confiabilidadMin > 0 ||
           f.confiabilidadMax < 1 ||
           f.timestampDesde !== null ||
           f.timestampHasta !== null ||
           (f.search && f.search.trim().length > 0) ||
           (f.imageEmbedding !== null && f.imageEmbedding !== undefined) ||
           (f.imageSearchUrl !== null && f.imageSearchUrl !== undefined) ||
           f.coincidenciaFiltro !== 'all';
  });

  // True only when tempFilters differ from the currently applied filters (dirty state)
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
           !arraysEqual([...t.tipoObjeto].sort(), [...a.tipoObjeto].sort()) ||
           t.edad !== a.edad ||
           t.genero !== a.genero ||
           t.reconocimiento !== a.reconocimiento ||
           !arraysEqual([...t.colores].sort(), [...a.colores].sort()) ||
           !arraysEqual([...t.posturas].sort(), [...a.posturas].sort()) ||
           t.confiabilidadMin !== a.confiabilidadMin ||
           t.confiabilidadMax !== a.confiabilidadMax ||
           !datesEqual(t.timestampDesde, a.timestampDesde) ||
           !datesEqual(t.timestampHasta, a.timestampHasta) ||
           (t.search || '') !== (a.search || '') ||
           t.coincidenciaFiltro !== (a.coincidenciaFiltro || 'all');
  });

  // Responsive calculations
  private resizeSubject = new Subject<number>();
  private resizeSubscription?: Subscription;
  private resizeObserver?: ResizeObserver;

  private getInitialFilters(): MetaFilterState {
    return {
      camaras: [],
      tipoObjeto: [],
      edad: null,
      genero: null,
      reconocimiento: null,
      colores: [],
      posturas: [],
      confiabilidadMin: 0,
      confiabilidadMax: 1,
      timestampDesde: null,
      timestampHasta: null,
      search: '',
      imageEmbedding: null,
      imageSearchUrl: null,
      imageFile: null,
      coincidenciaFiltro: 'all'
    };
  }

  constructor() {
    // Sync service filters to tempFilters
    toObservable(this.filters).pipe(
      takeUntilDestroyed()
    ).subscribe(f => {
      this.tempFilters.set({
        camaras: [...f.camaras],
        tipoObjeto: [...f.tipoObjeto],
        edad: f.edad,
        genero: f.genero,
        reconocimiento: f.reconocimiento,
        colores: [...f.colores],
        posturas: [...f.posturas],
        confiabilidadMin: f.confiabilidadMin,
        confiabilidadMax: f.confiabilidadMax,
        timestampDesde: f.timestampDesde ? new Date(f.timestampDesde) : null,
        timestampHasta: f.timestampHasta ? new Date(f.timestampHasta) : null,
        search: f.search || '',
        imageEmbedding: f.imageEmbedding || null,
        imageSearchUrl: f.imageSearchUrl || null,
        imageFile: f.imageFile || null,
        coincidenciaFiltro: f.coincidenciaFiltro || 'all'
      });
      this.searchControl.setValue(f.search || '', { emitEvent: false });
    });

    // Unified search debounce subscriber
    this.searchControl.valueChanges.pipe(
      debounceTime(300),
      takeUntilDestroyed()
    ).subscribe(val => {
      const text = val || '';
      this.tempFilters.update(f => ({ ...f, search: text }));
      this.metadataService.updateFilters({ search: text });
      this.metadataService.setPage(1);
    });

    // Synchronize page, pageSize, indexName, and filters to query parameters in the URL
    combineLatest({
      indexName: toObservable(this.activeIndex),
      page: toObservable(this.currentPage),
      pageSize: toObservable(this.pageSize),
      filters: toObservable(this.filters)
    }).pipe(
      debounceTime(100),
      takeUntilDestroyed()
    ).subscribe(({ indexName, page, pageSize, filters }) => {
      if (!indexName) return;

      const queryParams: any = {};
      queryParams['page'] = page > 1 ? page : null;

      const defaultPageSize = this.columns() * 10;
      queryParams['limit'] = pageSize !== defaultPageSize ? pageSize : null;

      // Sync active filters
      queryParams['camaras'] = filters.camaras && filters.camaras.length > 0 ? filters.camaras.join(',') : null;
      queryParams['tipoObjeto'] = filters.tipoObjeto && filters.tipoObjeto.length > 0 ? filters.tipoObjeto.join(',') : null;
      queryParams['edad'] = filters.edad || null;
      queryParams['genero'] = filters.genero || null;
      queryParams['reconocimiento'] = filters.reconocimiento || null;
      queryParams['colores'] = filters.colores && filters.colores.length > 0 ? filters.colores.join(',') : null;
      queryParams['posturas'] = filters.posturas && filters.posturas.length > 0 ? filters.posturas.join(',') : null;
      queryParams['confiabilidadMin'] = filters.confiabilidadMin !== 0 ? filters.confiabilidadMin : null;
      queryParams['confiabilidadMax'] = filters.confiabilidadMax !== 1 ? filters.confiabilidadMax : null;
      queryParams['desde'] = filters.timestampDesde ? filters.timestampDesde.toISOString() : null;
      queryParams['hasta'] = filters.timestampHasta ? filters.timestampHasta.toISOString() : null;
      queryParams['search'] = filters.search || null;
      queryParams['coincidenciaFiltro'] = filters.coincidenciaFiltro !== 'all' ? filters.coincidenciaFiltro : null;

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams,
        queryParamsHandling: 'merge'
      });
    });
  }

  ngOnInit(): void {
    this.metadataService.isViewActive.set(true);
    // Load watchlists globally
    this.listService.loadLists().subscribe();

    // Precargar todas las cámaras del sistema para poblar el desplegable de filtro
    // aunque OpenSearch no tenga documentos indexados para esas cámaras aún.
    this.cameraService.getAllCameras().subscribe();

    // Coordinate path parameters and query parameters to avoid duplicate network calls
    combineLatest({
      params: this.route.paramMap,
      queryParams: this.route.queryParams
    }).pipe(
      debounceTime(50),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(({ params, queryParams }) => {
      const idx = params.get('indexName') as MetaIndexName;
      if (idx) {
        const pageVal = queryParams['page'] ? parseInt(queryParams['page'], 10) : 1;
        const page = !isNaN(pageVal) && pageVal > 0 ? pageVal : 1;

        const defaultPageSize = this.columns() * 10;
        const limitVal = queryParams['limit'] ? parseInt(queryParams['limit'], 10) : null;
        const pageSize = limitVal && !isNaN(limitVal) && limitVal > 0 ? limitVal : defaultPageSize;

        const parsedFilters = this.parseFiltersFromParams(queryParams);

        this.metadataService.initializeIndexAndState(idx, page, pageSize, parsedFilters);
      }
    });
  }

  ngAfterViewInit(): void {
    this.resizeSubscription = this.resizeSubject.pipe(
      debounceTime(150)
    ).subscribe(width => {
      this.adjustColumnsAndLimit(width);
    });

    if (typeof ResizeObserver !== 'undefined' && this.metadataGrid) {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          this.resizeSubject.next(entry.contentRect.width);
        }
      });
      this.resizeObserver.observe(this.metadataGrid.nativeElement);
    }

    // Trigger initial adjustment
    setTimeout(() => {
      if (this.metadataGrid) {
        const width = this.metadataGrid.nativeElement.getBoundingClientRect().width;
        this.adjustColumnsAndLimit(width);
      }
    }, 50);
  }

  ngOnDestroy(): void {
    this.metadataService.isViewActive.set(false);
    this.metadataService.activeIndex.set(null);
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

  private getInitialRows(): number {
    return 3;
  }

  private adjustColumnsAndLimit(containerWidth: number): void {
    if (containerWidth <= 0) return;
    const newCols = Math.max(1, Math.floor((containerWidth + 24) / (335 + 24)));
    const oldCols = this.columns();
    
    if (newCols !== oldCols) {
      const currentSize = this.pageSize();
      const validOptions = [newCols * 10, newCols * 20, newCols * 30];
      
      this.columns.set(newCols);
      if (!validOptions.includes(currentSize)) {
        this.metadataService.setPageSize(newCols * 10);
      }
      this.metadataService.setPage(1);
    }
  }

  onLimitChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newLimit = parseInt(select.value, 10);
    this.metadataService.setPageSize(newLimit);
  }

  private parseFiltersFromParams(params: any): MetaFilterState {
    const camaras = params['camaras'] ? params['camaras'].split(',') : [];
    const tipoObjeto = params['tipoObjeto'] ? params['tipoObjeto'].split(',') : [];
    const edad = params['edad'] || null;
    const genero = params['genero'] || null;
    const reconocimiento = params['reconocimiento'] || null;
    const colores = params['colores'] ? params['colores'].split(',') : [];
    const posturas = params['posturas'] ? params['posturas'].split(',') : [];
    const confiabilidadMin = params['confiabilidadMin'] ? parseFloat(params['confiabilidadMin']) : 0;
    const confiabilidadMax = params['confiabilidadMax'] ? parseFloat(params['confiabilidadMax']) : 1;
    const timestampDesde = params['desde'] && !isNaN(Date.parse(params['desde'])) ? new Date(params['desde']) : null;
    const timestampHasta = params['hasta'] && !isNaN(Date.parse(params['hasta'])) ? new Date(params['hasta']) : null;
    const search = params['search'] || '';
    const coincidenciaFiltro = params['coincidenciaFiltro'] || 'all';

    return {
      camaras,
      tipoObjeto,
      edad,
      genero,
      reconocimiento,
      colores,
      posturas,
      confiabilidadMin,
      confiabilidadMax,
      timestampDesde,
      timestampHasta,
      search,
      coincidenciaFiltro
    };
  }

  // --- Filter helpers & operations ---

  toggleFilterPanel(): void {
    this.showFilterPanel.update(v => !v);
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
    this.metadataService.resetFilters();
    this.metadataService.setPage(1);
  }

  onApplyFilters(): void {
    this.metadataService.updateFilters(this.tempFilters());
    this.metadataService.setPage(1);
  }

  // Multi-select terms (e.g. tipoObjeto, colores, posturas, camaras)
  toggleMultiSelectFilter(field: 'tipoObjeto' | 'colores' | 'posturas' | 'camaras', value: string): void {
    const currentList = this.tempFilters()[field] as string[];
    const newList = currentList.includes(value)
      ? currentList.filter(item => item !== value)
      : [...currentList, value];

    this.tempFilters.update(f => ({ ...f, [field]: newList }));
  }

  selectSingleFilter(field: 'edad' | 'genero' | 'reconocimiento', value: string | null): void {
    const currentValue = this.tempFilters()[field];
    const newValue = currentValue === value ? null : value;
    this.tempFilters.update(f => ({ ...f, [field]: newValue }));
    this.activeDropdown.set(null);
  }

  selectCoincidenciaFilter(value: 'all' | 'coincidencia' | 'sin_coincidencia'): void {
    this.tempFilters.update(f => ({ ...f, coincidenciaFiltro: value }));
    this.activeDropdown.set(null);
  }

  // Range filters
  onConfiabilidadChange(event: Event, type: 'min' | 'max'): void {
    const input = event.target as HTMLInputElement;
    const val = parseFloat(input.value);
    if (!isNaN(val)) {
      if (type === 'min') {
        this.tempFilters.update(f => ({ ...f, confiabilidadMin: val }));
      } else {
        this.tempFilters.update(f => ({ ...f, confiabilidadMax: val }));
      }
    }
  }

  selectConfiabilidadPreset(type: 'all' | 'high' | 'veryHigh'): void {
    if (type === 'all') {
      this.tempFilters.update(f => ({ ...f, confiabilidadMin: 0, confiabilidadMax: 1 }));
    } else if (type === 'high') {
      this.tempFilters.update(f => ({ ...f, confiabilidadMin: 0.7, confiabilidadMax: 1 }));
    } else if (type === 'veryHigh') {
      this.tempFilters.update(f => ({ ...f, confiabilidadMin: 0.9, confiabilidadMax: 1 }));
    }
  }

  onDateChange(event: Event, type: 'desde' | 'hasta'): void {
    const input = event.target as HTMLInputElement;
    const val = input.value ? new Date(input.value) : null;
    if (type === 'desde') {
      this.tempFilters.update(f => ({ ...f, timestampDesde: val }));
    } else {
      this.tempFilters.update(f => ({ ...f, timestampHasta: val }));
    }
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

  // Pagination controls
  setPage(page: number): void {
    const total = this.totalPages();
    if (page >= 1 && page <= total) {
      this.metadataService.setPage(page);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.metadataService.setPage(this.currentPage() + 1);
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.metadataService.setPage(this.currentPage() - 1);
    }
  }

  totalPages(): number {
    const total = this.totalRecords();
    const size = this.pageSize();
    return total > 0 ? Math.ceil(total / size) : 1;
  }

  readonly pages = computed(() => {
    const total = this.totalPages();
    return Array.from({ length: total }, (_, i) => i + 1);
  });

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

  // Utility to format metadata dates nicely
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

  // Utility to generate a preview color block CSS/style string
  getColorStyle(color: MetaColor): string {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  // Helper to determine text color for a color pill (dark text vs light text) based on luminance
  getColorLuminance(r: number, g: number, b: number): number {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  getTimestampString(date: Date | null): string {
    return date ? date.toISOString().slice(0, 16) : '';
  }

  getTipoObjeto(record: MetaRecord): string {
    return ('tipoObjeto' in record) ? (record as any).tipoObjeto : '';
  }

  getEdad(record: MetaRecord): string {
    return ('edad' in record) ? (record as any).edad : '';
  }

  getGenero(record: MetaRecord): string {
    return ('genero' in record) ? (record as any).genero : '';
  }

  getReconocimiento(record: MetaRecord): string {
    return ('reconocimiento' in record) ? (record as any).reconocimiento : '';
  }

  getPosturas(record: MetaRecord): MetaPostura[] {
    return ('posturas' in record) ? (record as any).posturas : [];
  }

  onCardMouseMove(event: MouseEvent, recordId: string): void {
    this.activeHoverCardId.set(recordId);
    const cardElement = event.currentTarget as HTMLElement;
    const rect = cardElement.getBoundingClientRect();
    
    // Position of the mouse relative to the card
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    
    // Viewport collision detection: popover has a width of 360px in CSS
    const popoverWidth = 360;
    const margin = 20;
    const verticalMargin = 85; // Safety margin to account for main layout padding and bottom navigation offsets
    
    // Dynamically estimate popover height with generous padding to prevent vertical viewport overflow
    let popoverHeight = 160; // baseline height (padding, header, margins)
    const record = this.records().find(r => String(r.id) === String(recordId));
    if (record) {
      const hasIdent = this.getTipoObjeto(record) || this.getEdad(record) || this.getGenero(record) || this.getReconocimiento(record);
      if (hasIdent) {
        popoverHeight += 60;
      }
      const posturas = this.getPosturas(record);
      if (posturas && posturas.length > 0) {
        popoverHeight += 60;
        if (posturas.length > 3) {
          popoverHeight += 35;
        }
      }
      if (record.colores && record.colores.length > 0) {
        popoverHeight += 60;
        if (record.colores.length > 4) {
          popoverHeight += 40;
        }
      }
    }
    
    if (event.clientX + popoverWidth + 15 > window.innerWidth - margin) {
      // Flip popover to the left of the cursor
      this.mouseX.set(x - popoverWidth - 15);
    } else {
      // Default position to the right of the cursor
      this.mouseX.set(x + 15);
    }
    
    if (event.clientY + popoverHeight + 15 > window.innerHeight - verticalMargin) {
      // Flip popover to the top of the cursor to prevent spawning vertical scrollbar
      this.mouseY.set(y - popoverHeight - 15);
    } else {
      // Default position below the cursor
      this.mouseY.set(y + 15);
    }
  }

  onCardMouseLeave(): void {
    this.activeHoverCardId.set(null);
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  triggerImageUpload(): void {
    if (this.imageInput && this.imageInput.nativeElement) {
      this.imageInput.nativeElement.click();
    }
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      
      // Revocar el object URL anterior si existía para evitar fugas de memoria
      const prevUrl = this.tempFilters().imageSearchUrl;
      if (prevUrl && prevUrl.startsWith('blob:')) {
        URL.revokeObjectURL(prevUrl);
      }

      const localUrl = URL.createObjectURL(file);
      this.tempFilters.update(f => ({
        ...f,
        imageSearchUrl: localUrl,
        imageFile: file
      }));

      this.metadataService.searchFacesByImage(file, localUrl).subscribe({
        next: () => {
          input.value = '';
        },
        error: (err) => {
          console.error('Error performing face search by image:', err);
          input.value = '';
        }
      });
    }
  }

  clearImageSearch(): void {
    if (this.imageInput && this.imageInput.nativeElement) {
      this.imageInput.nativeElement.value = '';
    }
    const currentUrl = this.tempFilters().imageSearchUrl;
    if (currentUrl && currentUrl.startsWith('blob:')) {
      URL.revokeObjectURL(currentUrl);
    }
    this.tempFilters.update(f => ({
      ...f,
      imageEmbedding: null,
      imageSearchUrl: null,
      imageFile: null
    }));
    this.metadataService.updateFilters({
      imageEmbedding: null,
      imageSearchUrl: null,
      imageFile: null
    });
    this.metadataService.setPage(1);
  }

  // ── Watchlist Modal Methods ──
  openAddToListModal(record: any): void {
    this.selectedRecordForWatchlist.set(record);
    this.selectedWatchlistId.set('');
    // Prefill name if available
    const recName = this.getReconocimiento(record) || '';
    this.subjectWatchlistName.set(recName);
    this.showAddToWatchlistModal.set(true);
  }

  closeAddToListModal(): void {
    this.showAddToWatchlistModal.set(false);
    this.selectedRecordForWatchlist.set(null);
    this.selectedWatchlistId.set('');
    this.subjectWatchlistName.set('');
  }

  saveRecordToList(): void {
    const listId = this.selectedWatchlistId();
    const record = this.selectedRecordForWatchlist();
    const name = this.subjectWatchlistName();
    const category = this.activeIndex();

    if (!listId || !record) return;

    const listType = category === 'vehiculos' ? 'plate_recognition' : 'face_recognition';
    this.listService.registerSubjectFromRecord(listId, name, record, listType).subscribe({
      next: () => {
        this.closeAddToListModal();
      },
      error: (err) => {
        console.error('Error registering subject to list:', err);
        alert('Error al agregar el sujeto a la lista de control.');
      }
    });
  }

  filtrarPorCoincidencia(record: any): void {
    if (!record || !record.embedding || record.embedding.length === 0) {
      alert('Este registro no contiene un vector de características (embedding) disponible para filtrar.');
      return;
    }

    this.metadataService.updateFilters({
      imageEmbedding: record.embedding,
      imageSearchUrl: record.imagenRemota,
      imageFile: null
    });
    this.metadataService.setPage(1);
  }
}
