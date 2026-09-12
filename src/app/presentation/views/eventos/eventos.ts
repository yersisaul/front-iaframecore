import { Component, OnInit, OnDestroy, AfterViewInit, inject, DestroyRef, signal, computed, HostListener, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, Subscription, combineLatest } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';

import { EventService } from '../../../core/services/event.service';
import { CameraService } from '../../../core/services/camera.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { EventFilters, EventRecord, defaultEventFilters } from '../../../core/domain/entities/event.models';
import { parseUtcDate } from '../../../core/utils/date-utils';
import { copyToClipboard as utilCopyToClipboard } from '../../../core/utils/clipboard.util';
import { EventDetailModalComponent } from '../../shared/event-detail-modal/event-detail-modal.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { PaginationControlsComponent } from '../../shared/pagination-controls/pagination-controls.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { SearchInputComponent } from '../../shared/search-input/search-input.component';
import { FilterActionsComponent } from '../../shared/filter-actions/filter-actions.component';
import { CustomSelectComponent } from '../../shared/custom-select/custom-select.component';
import { ListService } from '../../../core/services/list.service';
import { IEventRepository } from '../../../core/domain/repositories/event.repository';
import { EventSubjectItem } from '../../../core/domain/entities/event.models';

@Component({
  selector: 'app-eventos',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, EventDetailModalComponent, EmptyStateComponent, PaginationControlsComponent, PageHeaderComponent, SearchInputComponent, FilterActionsComponent, CustomSelectComponent],
  templateUrl: './eventos.html',
  styleUrl: './eventos.css'
})
export class Eventos implements OnInit, OnDestroy, AfterViewInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private eventService = inject(EventService);
  private eventRepository = inject(IEventRepository);
  private cameraService = inject(CameraService);
  private listService = inject(ListService);
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

  // Búsqueda interna del dropdown de cámaras
  readonly cameraSearch = signal<string>('');

  readonly filteredCamarasOptions = computed(() => {
    const q = this.cameraSearch().trim().toLowerCase();
    const systemCameras = this.cameraService.cameras().map((c: any) => c.name).filter(Boolean);
    const eventCameras = this.filterOptions().camaras || [];
    const tempCameras = this.tempFilters()?.camaras || [];
    const all = Array.from(new Set([...systemCameras, ...eventCameras, ...tempCameras])).filter(Boolean).sort();
    return q ? all.filter((c: string) => c.toLowerCase().includes(q)) : all;
  });

  // Búsqueda interna del dropdown de listas de control
  readonly listaSearch = signal<string>('');

  private isFaceList(listType: string): boolean {
    const t = (listType || '').toLowerCase().trim();
    return t === 'face_recognition' || t === 'rf' || t.includes('face') || t.includes('facial') || t.includes('rostro');
  }

  private isPlateList(listType: string): boolean {
    const t = (listType || '').toLowerCase().trim();
    return t === 'plate_recognition' || t === 'lpr' || t.includes('plate') || t.includes('placa') || t.includes('vehic');
  }

  private isFaceAnalytic(analytic: string): boolean {
    const a = (analytic || '').toLowerCase().trim();
    return a.includes('facial') || a.includes('rostro') || a.includes('face') || a.includes('rf');
  }

  private isPlateAnalytic(analytic: string): boolean {
    const a = (analytic || '').toLowerCase().trim();
    return a.includes('placa') || a.includes('plate') || a.includes('lpr') || a.includes('vehic');
  }

  private getListTypeMap(): Map<string, 'face' | 'plate' | 'unknown'> {
    const map = new Map<string, 'face' | 'plate' | 'unknown'>();

    // 1. De las listas registradas en backend (ListService)
    for (const l of this.listService.lists()) {
      if (l.name) {
        const lowerName = l.name.trim().toLowerCase();
        if (this.isFaceList(l.list_type)) {
          map.set(lowerName, 'face');
        } else if (this.isPlateList(l.list_type)) {
          map.set(lowerName, 'plate');
        } else {
          map.set(lowerName, 'unknown');
        }
      }
    }

    // 2. Inferir de los registros en memoria para listas no registradas en ListService
    for (const r of this.records()) {
      const listName = r.matchDetail?.listName || r.grupoLista;
      if (listName) {
        const lowerName = listName.trim().toLowerCase();
        if (!map.has(lowerName) || map.get(lowerName) === 'unknown') {
          if (this.isFaceAnalytic(r.analitica)) {
            map.set(lowerName, 'face');
          } else if (this.isPlateAnalytic(r.analitica)) {
            map.set(lowerName, 'plate');
          }
        }
      }
    }

    return map;
  }

  private getAllowedListNames(selectedAnalytics: string[]): Set<string> | null {
    if (!selectedAnalytics || selectedAnalytics.length === 0) {
      return null;
    }

    const hasFace = selectedAnalytics.some(a => this.isFaceAnalytic(a));
    const hasPlate = selectedAnalytics.some(a => this.isPlateAnalytic(a));

    if (!hasFace && !hasPlate) {
      return new Set<string>();
    }

    const listTypeMap = this.getListTypeMap();
    const allowed = new Set<string>();

    for (const [nameLower, type] of listTypeMap.entries()) {
      if (hasFace && hasPlate) {
        if (type === 'face' || type === 'plate') {
          allowed.add(nameLower);
        }
      } else if (hasFace) {
        if (type === 'face') {
          allowed.add(nameLower);
        }
      } else if (hasPlate) {
        if (type === 'plate') {
          allowed.add(nameLower);
        }
      }
    }

    return allowed;
  }

  readonly filteredListasOptions = computed(() => {
    const q = this.listaSearch().trim().toLowerCase();
    const selectedAnalytics = this.tempFilters()?.analiticas || [];

    const hasFaceAnalytic = selectedAnalytics.some(a => this.isFaceAnalytic(a));
    const hasPlateAnalytic = selectedAnalytics.some(a => this.isPlateAnalytic(a));
    const hasAnyAnalytic = selectedAnalytics.length > 0;

    const listTypeMap = this.getListTypeMap();

    // Colección de todas las listas disponibles
    const allListNames = Array.from(new Set([
      ...this.listService.lists().map(l => l.name),
      ...(this.filterOptions().listas || []),
      ...this.records().map(r => r.matchDetail?.listName || r.grupoLista).filter(Boolean) as string[],
      ...(this.tempFilters()?.listas || [])
    ])).filter(Boolean);

    let matchedLists: string[];

    if (!hasAnyAnalytic) {
      // Sin filtro de analítica: mostrar todas las listas
      matchedLists = allListNames;
    } else if (hasFaceAnalytic && hasPlateAnalytic) {
      // Filtrar listas que correspondan a rostro o placas
      matchedLists = allListNames.filter(name => {
        const type = listTypeMap.get(name.trim().toLowerCase());
        return type === 'face' || type === 'plate' || type === undefined;
      });
    } else if (hasFaceAnalytic) {
      // Sólo listas de reconocimiento facial
      matchedLists = allListNames.filter(name => {
        const type = listTypeMap.get(name.trim().toLowerCase());
        return type === 'face';
      });
    } else if (hasPlateAnalytic) {
      // Sólo listas de reconocimiento de placas
      matchedLists = allListNames.filter(name => {
        const type = listTypeMap.get(name.trim().toLowerCase());
        return type === 'plate';
      });
    } else {
      // Analítica seleccionada no opera con listas de control
      matchedLists = [];
    }

    const sorted = Array.from(new Set(matchedLists)).sort();
    return q ? sorted.filter(l => l.toLowerCase().includes(q)) : sorted;
  });

  // Búsqueda interna del dropdown de sujetos (listas detalle)
  readonly sujetoSearch = signal<string>('');
  readonly registeredSubjects = signal<EventSubjectItem[]>([]);

  readonly filteredSujetosOptions = computed(() => {
    const q = this.sujetoSearch().trim().toLowerCase();
    const selectedLists = this.tempFilters()?.listas || [];
    const selectedAnalytics = this.tempFilters()?.analiticas || [];
    const systemSubjects = this.registeredSubjects();

    // Extraer también de los eventos cargados en memoria
    const fromRecords: EventSubjectItem[] = [];
    for (const r of this.records()) {
      const listName = r.matchDetail?.listName || r.grupoLista || '';
      const placaMatch = r.detalleEvento?.match(/placa\s+([A-Z0-9]+)/i);
      const nameMatch = r.detalleEvento?.match(/se ha identificado a\s+([^,]+?)(?:\s+que pertenece|\s+en|\s*$)/i);
      const name = placaMatch ? placaMatch[1].trim() : (nameMatch ? nameMatch[1].trim() : (r.matchDetail ? r.objeto : ''));
      if (name && !['persona', 'auto', 'moto', 'rostro', 'con_casco'].includes(name.toLowerCase())) {
        fromRecords.push({
          name,
          listName,
          detailId: r.matchDetail?.detailId
        });
      }
    }

    // Combinar sujetos registrados con eventos y los de los registros
    const allSubjects = [...systemSubjects, ...fromRecords];

    // 1. Filtrar por listas de control seleccionadas o por tipo de analítica
    const hasAnyAnalytic = selectedAnalytics.length > 0;
    let filteredByContext = allSubjects;

    if (selectedLists.length > 0) {
      filteredByContext = allSubjects.filter(s => {
        if (!s.listName) return false;
        return selectedLists.some(l => l.trim().toLowerCase() === s.listName!.trim().toLowerCase());
      });
    } else if (hasAnyAnalytic) {
      const allowedLists = this.getAllowedListNames(selectedAnalytics);
      if (allowedLists !== null) {
        filteredByContext = allSubjects.filter(s => {
          if (!s.listName) return false;
          return allowedLists.has(s.listName.trim().toLowerCase());
        });
      }
    }

    // 2. Extraer nombres únicos
    const uniqueNames = Array.from(new Set(filteredByContext.map(s => s.name).filter(Boolean))).sort();

    // 3. Filtrar por búsqueda en tiempo real
    return q ? uniqueNames.filter(name => name.toLowerCase().includes(q)) : uniqueNames;
  });

  // Opciones limpias para el filtro de objetos (excluye nombres de personas y nombres de listas)
  readonly filteredObjetosOptions = computed(() => {
    const raw = this.filterOptions().objetos || [];
    const systemLists = this.listService.lists().map((l: any) => (l.name || '').toLowerCase());
    
    return raw.filter(item => {
      if (!item) return false;
      const lower = item.trim().toLowerCase();
      // Descartar si coincide con una lista conocida
      if (systemLists.includes(lower)) return false;
      // Descartar si es un nombre propio (3 o más palabras)
      const words = item.trim().split(/\s+/);
      if (words.length >= 3 && !lower.includes('objeto') && !lower.includes('persona')) {
        return false;
      }
      return true;
    }).sort();
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

  readonly activeHoverRecord = computed<EventRecord | null>(() => {
    const id = this.activeHoverCardId();
    if (!id) return null;
    return this.records().find(r => String(r.id) === String(id)) || null;
  });

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
  readonly activeDatePreset = signal<'today' | '24h' | '7d' | null>(null);

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
        camaras: [...(f.camaras || [])],
        analiticas: [...(f.analiticas || [])],
        objetos: [...(f.objetos || [])],
        listas: [...(f.listas || [])],
        sujetos: [...(f.sujetos || [])],
        direcciones: [...(f.direcciones || [])],
        timestampDesde: f.timestampDesde ? new Date(f.timestampDesde) : null,
        timestampHasta: f.timestampHasta ? new Date(f.timestampHasta) : null
      });
      const targetSearch = f.search || '';
      if (this.searchControl.value !== targetSearch) {
        this.searchControl.setValue(targetSearch, { emitEvent: false });
      }
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
  }

  ngOnInit(): void {
    this.eventService.isViewActive.set(true);
    this.cameraService.getAllCameras().subscribe();
    this.listService.loadLists().subscribe();
    this.eventRepository.getAvailableSubjects().subscribe({
      next: (subjects) => {
        if (subjects && subjects.length > 0) {
          this.registeredSubjects.set(subjects);
        }
      },
      error: (err) => console.warn('Error cargando sujetos para filtro:', err)
    });
    this.eventService.loadCurrentPage();
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
        if (width > 0) {
          const realCols = Math.max(1, Math.floor((width + 24) / (335 + 24)));
          const correctSize = realCols * 10;
          this.columns.set(realCols);
          if (this.eventService.pageSize() !== correctSize) {
            this.eventService.setPageSize(correctSize);
          }
        }
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

  onLimitValueChange(val: any): void {
    const newLimit = parseInt(val, 10);
    if (!isNaN(newLimit)) {
      this.eventService.setPageSize(newLimit);
      this.eventService.setPage(1);
    }
  }

  private parseFiltersFromParams(params: any): EventFilters {
    const camaras = params['camaras'] ? params['camaras'].split(',') : [];
    const analiticas = params['analiticas'] ? params['analiticas'].split(',') : [];
    const objetos = params['objetos'] ? params['objetos'].split(',') : [];
    const listas = params['listas'] ? params['listas'].split(',') : [];
    const sujetos = params['sujetos'] ? params['sujetos'].split(',') : [];
    const direcciones = params['direcciones'] ? params['direcciones'].split(',') : [];
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
      listas,
      sujetos,
      direcciones,
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

  toggleDropdown(dropdownName: string, event?: Event): void {
    if (event) event.stopPropagation();
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
    this.searchControl.setValue('', { emitEvent: false });
    this.tempFilters.set(defaultEventFilters());
    this.dateDesdeStr.set('');
    this.timeDesdeStr.set('00:00');
    this.dateHastaStr.set('');
    this.timeHastaStr.set('23:59');
    this.activeDatePreset.set(null);
    this.cameraSearch.set('');
    this.listaSearch.set('');
    this.sujetoSearch.set('');
    this.eventService.resetFilters();
  }

  onApplyFilters(): void {
    this.eventService.updateFilters(this.tempFilters());
  }

  toggleMultiSelectFilter(field: 'camaras' | 'analiticas' | 'objetos' | 'listas' | 'sujetos' | 'direcciones', value: string): void {
    const currentList = (this.tempFilters()[field] as string[]) || [];
    const newList = currentList.includes(value)
      ? currentList.filter(item => item !== value)
      : [...currentList, value];

    this.tempFilters.update(f => {
      const updated = { ...f, [field]: newList };

      // Si se altera el filtro de analíticas, depurar listas seleccionadas incompatibles
      if (field === 'analiticas') {
        const allowedLists = this.getAllowedListNames(newList);
        if (allowedLists !== null) {
          updated.listas = (f.listas || []).filter(name => allowedLists.has(name.trim().toLowerCase()));
        }
      }

      return updated;
    });
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
    this.activeDatePreset.set(null);
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
    this.activeDatePreset.set(null);
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
    this.activeDatePreset.set(null);
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
      const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      this.dateDesdeStr.set(toDateStr(todayStart));
      this.timeDesdeStr.set('00:00');
      this.dateHastaStr.set(toDateStr(todayEnd));
      this.timeHastaStr.set('23:59');
      this.tempFilters.update(f => ({ ...f, timestampDesde: todayStart, timestampHasta: todayEnd }));
      this.activeDatePreset.set('today');
    } else if (preset === '24h') {
      const past24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      this.dateDesdeStr.set(toDateStr(past24h));
      this.timeDesdeStr.set(toTimeStr(past24h));
      this.dateHastaStr.set(toDateStr(now));
      this.timeHastaStr.set(toTimeStr(now));
      this.tempFilters.update(f => ({ ...f, timestampDesde: past24h, timestampHasta: now }));
      this.activeDatePreset.set('24h');
    } else if (preset === '7d') {
      const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      this.dateDesdeStr.set(toDateStr(past7d));
      this.timeDesdeStr.set(toTimeStr(past7d));
      this.dateHastaStr.set(toDateStr(now));
      this.timeHastaStr.set(toTimeStr(now));
      this.tempFilters.update(f => ({ ...f, timestampDesde: past7d, timestampHasta: now }));
      this.activeDatePreset.set('7d');
    } else if (preset === 'clear') {
      this.dateDesdeStr.set('');
      this.timeDesdeStr.set('00:00');
      this.dateHastaStr.set('');
      this.timeHastaStr.set('23:59');
      this.tempFilters.update(f => ({ ...f, timestampDesde: null, timestampHasta: null }));
      this.activeDatePreset.set(null);
    }
  }

  onDateRangeChange(range: { desde: Date | null; hasta: Date | null }): void {
    this.tempFilters.update(f => ({
      ...f,
      timestampDesde: range.desde,
      timestampHasta: range.hasta
    }));
  }

  // --- Active State computations ---
  readonly hasActiveFilters = computed<boolean>(() => {
    const f = this.filters();
    return (f.camaras?.length || 0) > 0 ||
           (f.analiticas?.length || 0) > 0 ||
           (f.objetos?.length || 0) > 0 ||
           (f.listas?.length || 0) > 0 ||
           (f.sujetos?.length || 0) > 0 ||
           (f.direcciones?.length || 0) > 0 ||
           f.timestampDesde !== null ||
           f.timestampHasta !== null ||
           Boolean(f.search && f.search.trim().length > 0);
  });

  readonly hasActiveTempFilters = computed<boolean>(() => {
    const f = this.tempFilters();
    return (f.camaras?.length || 0) > 0 ||
           (f.analiticas?.length || 0) > 0 ||
           (f.objetos?.length || 0) > 0 ||
           (f.listas?.length || 0) > 0 ||
           (f.sujetos?.length || 0) > 0 ||
           (f.direcciones?.length || 0) > 0 ||
           f.timestampDesde !== null ||
           f.timestampHasta !== null ||
           Boolean(f.search && f.search.trim().length > 0);
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

    return !arraysEqual([...(t.camaras || [])].sort(), [...(a.camaras || [])].sort()) ||
           !arraysEqual([...(t.analiticas || [])].sort(), [...(a.analiticas || [])].sort()) ||
           !arraysEqual([...(t.objetos || [])].sort(), [...(a.objetos || [])].sort()) ||
           !arraysEqual([...(t.listas || [])].sort(), [...(a.listas || [])].sort()) ||
           !arraysEqual([...(t.sujetos || [])].sort(), [...(a.sujetos || [])].sort()) ||
           !arraysEqual([...(t.direcciones || [])].sort(), [...(a.direcciones || [])].sort()) ||
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
    
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const tooltipWidth = 360;
    const tooltipHeight = 220;
    const margin = 20;
    const verticalMargin = 85;
    
    let posX = event.clientX + 15;
    let posY = event.clientY + 15;

    if (event.clientX + tooltipWidth + 15 > viewportWidth - margin) {
      posX = event.clientX - tooltipWidth - 15;
    }

    if (event.clientY + tooltipHeight + 15 > viewportHeight - verticalMargin) {
      posY = event.clientY - tooltipHeight - 15;
    }
    
    this.mouseX.set(posX);
    this.mouseY.set(posY);
  }

  onCardMouseEnter(event: MouseEvent): void {
    const card = event.currentTarget as HTMLElement | null;
    if (!card) return;

    const headerBlock = card.querySelector('.card-header-camera') as HTMLElement | null;
    if (!headerBlock) return;

    const titleEl = headerBlock.querySelector('.card-title') as HTMLElement | null;
    if (!titleEl) return;

    // Al hacer hover en la tarjeta, colapsamos el timestamp y expandimos el título
    headerBlock.classList.add('camera-title-expand-space');

    // Ancho útil disponible (todo el ancho del encabezado sin el timestamp)
    const availableFullWidth = headerBlock.clientWidth;

    if (titleEl.scrollWidth > availableFullWidth) {
      // Si el nombre de la cámara desborda el espacio completo -> marquee exacto
      // Offset de 24px para que la última letra pase completamente el gradiente de fade-out
      const fadeOffset = 24;
      const shift = Math.ceil(titleEl.scrollWidth - availableFullWidth) + fadeOffset;
      titleEl.style.setProperty('--marquee-shift', `-${shift}px`);
      headerBlock.classList.add('camera-title-needs-marquee');
    } else {
      // Si entra completo estático en el ancho disponible -> sin marquee
      titleEl.style.removeProperty('--marquee-shift');
      headerBlock.classList.remove('camera-title-needs-marquee');
    }
  }

  onCardMouseLeave(event?: MouseEvent): void {
    this.activeHoverCardId.set(null);
    if (event?.currentTarget) {
      const card = event.currentTarget as HTMLElement;
      const headerBlock = card.querySelector('.card-header-camera') as HTMLElement | null;
      if (headerBlock) {
        headerBlock.classList.remove('camera-title-expand-space', 'camera-title-needs-marquee');
        const titleEl = headerBlock.querySelector('.card-title') as HTMLElement | null;
        if (titleEl) {
          titleEl.style.removeProperty('--marquee-shift');
        }
      }
    }
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

  onImageError(event: Event): void {
    const target = event.target as HTMLElement;
    if (target) {
      target.style.display = 'none';
    }
  }

  isMatchingAnalytic(analitica: string): boolean {
    if (!analitica) return false;
    const lower = analitica.toLowerCase();
    return lower.includes('facial') || lower.includes('rostro') || lower.includes('face') ||
           lower.includes('placa') || lower.includes('plate') || lower.includes('lpr');
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
}
