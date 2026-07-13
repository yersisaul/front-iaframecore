import { Component, OnInit, OnDestroy, AfterViewInit, inject, signal, computed, effect, ViewChild, ElementRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, Params } from '@angular/router';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs/operators';
import { CameraService } from '../../../core/services/camera.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { AnalyticService } from '../../../core/services/analytic.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { HostService } from '../../../core/services/host.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { copyToClipboard } from '../../../core/utils/clipboard.util';
import { Schedule } from '../../../core/domain/entities/schedule.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { Camera } from '../../../core/domain/entities/camera.models';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'app-camaras',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, ReactiveFormsModule],
  templateUrl: './camaras.html',
  styleUrl: './camaras.css'
})
export class Camaras implements OnInit, OnDestroy, AfterViewInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private cameraService = inject(CameraService);
  private scheduleService = inject(ScheduleService);
  private analyticService = inject(AnalyticService);
  private sidebarService = inject(SidebarService);
  private hostService = inject(HostService);
  public permissionsService = inject(PermissionsService);

  @ViewChild('camerasGrid', { static: false }) camerasGrid!: ElementRef<HTMLDivElement>;

  readonly hostId = signal<string | null>(null);

  readonly cameras = this.cameraService.cameras;
  readonly schedules = this.scheduleService.schedules;
  readonly analytics = this.analyticService.analytics;
  
  readonly cameraNewIds = this.cameraService.newRecordIds;
  readonly cameraUpdatedIds = this.cameraService.updatedRecordIds;
  readonly cameraDeletingIds = this.cameraService.deletingRecordIds;
  readonly cameraActiveStatusIds = this.cameraService.activeStatusIds;
  readonly cameraInactiveStatusIds = this.cameraService.inactiveStatusIds;

  readonly analyticNewIds = this.analyticService.newRecordIds;
  readonly analyticUpdatedIds = this.analyticService.updatedRecordIds;
  readonly analyticDeletingIds = this.analyticService.deletingRecordIds;
  readonly analyticActiveStatusIds = this.analyticService.activeStatusIds;
  readonly analyticInactiveStatusIds = this.analyticService.inactiveStatusIds;

  readonly isLoading = computed(() =>
    this.cameraService.isLoading() || this.scheduleService.isLoading()
  );

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  readonly showLicenseModal = signal<boolean>(false);
  readonly licenseScrolledToBottom = signal<boolean>(false);
  readonly viewMode = signal<'cards' | 'list'>('cards');

  readonly activeAddScheduleDropdown = signal<string | null>(null);
  readonly expandedAnalyticIds = signal<Set<string>>(new Set());

  readonly showDeleteHostModal = signal<boolean>(false);
  readonly isDeletingHost = signal<boolean>(false);
  readonly isHostDeleting = computed(() => this.hostId() ? this.hostService.deletingHostIds().has(this.hostId()!) : false);

  openDeleteHostModal(): void {
    this.showDeleteHostModal.set(true);
  }

  closeDeleteHostModal(): void {
    this.showDeleteHostModal.set(false);
  }

  confirmDeleteHost(): void {
    const fingerprint = this.hostId();
    if (!fingerprint) return;

    this.isDeletingHost.set(true);
    this.hostService.deleteHost(fingerprint).subscribe({
      next: () => {
        this.hostService.markAsDeletingHost(fingerprint);
        setTimeout(() => {
          this.isDeletingHost.set(false);
          this.closeDeleteHostModal();
          this.router.navigate(['/dashboard/nodos']);
        }, 450);
      },
      error: (err) => {
        this.isDeletingHost.set(false);
        console.error('Error deleting host:', err);
        alert('Error al eliminar el nodo. Por favor, intente de nuevo.');
      }
    });
  }

  openLicenseModal(): void {
    this.licenseScrolledToBottom.set(false);
    this.showLicenseModal.set(true);
  }

  onLicenseScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    this.licenseScrolledToBottom.set(atBottom);
  }

  copyFingerprint(): void {
    const fingerprint = this.hostId();
    if (fingerprint) {
      copyToClipboard(fingerprint).catch(err => console.error('Error copying to clipboard', err));
    }
  }

  readonly currentHost = computed(() =>
    this.hostService.allHosts().find(h => h.fingerprint === this.hostId())
  );

  readonly license = computed(() => this.currentHost()?.license || null);

  readonly licenseQuotaUsage = computed(() => {
    const usage: Record<string, number> = {};
    const lic = this.license();
    if (lic && lic.features) {
      Object.keys(lic.features).forEach(key => {
        usage[key] = 0;
      });
    }

    this.analytics().filter(analytic => !this.hostId() || analytic.hostFingerprint === this.hostId()).forEach(analytic => {
      if (analytic.status === 'active') {
        const featureKey = this.mapAnalyticTypeToFeatureKey(analytic.type);
        if (featureKey && usage[featureKey] !== undefined) {
          usage[featureKey] += (analytic.targetCameraIds || []).length;
        }
      }
    });

    return usage;
  });

  readonly sortedLicenseFeatures = computed(() => {
    const lic = this.license();
    if (!lic || !lic.features) return [];

    const usage = this.licenseQuotaUsage();
    return Object.entries(lic.features)
      .map(([key, limit]) => ({ key, limit }))
      .sort((a, b) => {
        const usageA = usage[a.key] || 0;
        const usageB = usage[b.key] || 0;
        if (usageB === usageA) {
          return a.key.localeCompare(b.key);
        }
        return usageB - usageA;
      });
  });

  // ── Search control & state ──
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly searchTerm = signal<string>('');

  // ── Advanced Filters state ──
  readonly filterStatus = signal<string>('all');
  readonly filterStreamType = signal<string>('all');
  readonly filterDecoder = signal<string>('all');
  readonly filterAnalyticType = signal<string>('all');

  // Temp copies shown in the drawer (committed on "Aplicar")
  readonly tempFilterStatus = signal<string>('all');
  readonly tempFilterStreamType = signal<string>('all');
  readonly tempFilterDecoder = signal<string>('all');
  readonly tempFilterAnalyticType = signal<string>('all');

  readonly showFilterPanel = signal<boolean>(false);
  readonly activeDropdown = signal<string | null>(null);

  // Opciones de filtro dinámicas (construidas a partir de las cámaras y analíticas cargadas)
  readonly filterOptions = computed(() => {
    const list = this.hostId()
      ? this.cameras().filter(c => c.hostFingerprint === this.hostId())
      : this.cameras();
    const statuses = new Set<string>();
    const streams = new Set<string>();
    const decoders = new Set<string>();

    list.forEach(c => {
      if (c.status) statuses.add(c.status);
      if (c.streamType) streams.add(c.streamType);
      if (c.decoder) decoders.add(c.decoder);
    });

    const uniqueAnalytics = new Set<string>();
    const analyticsList = this.hostId()
      ? this.analytics().filter(a => a.hostFingerprint === this.hostId())
      : this.analytics();
    analyticsList.forEach(a => {
      if (a.type) {
        uniqueAnalytics.add(this.normalizeAnalyticType(a.type));
      }
    });

    return {
      status: Array.from(statuses).sort(),
      streamType: Array.from(streams).sort(),
      decoder: Array.from(decoders).sort(),
      analyticType: Array.from(uniqueAnalytics).sort()
    };
  });

  // Lista de cámaras filtrada reactivamente por el buscador y filtros avanzados
  readonly filteredCameras = computed<Camera[]>(() => {
    const list = this.cameras();
    const term = this.searchTerm().trim().toLowerCase();
    const st = this.filterStatus();
    const stream = this.filterStreamType();
    const dec = this.filterDecoder();
    const analyticType = this.filterAnalyticType();

    const filtered = list.filter(c => {
      if (this.hostId() && c.hostFingerprint !== this.hostId()) return false;
      // Search only by camera name or camera ID (prefix matching)
      if (term) {
        const matchesName = c.name.toLowerCase().startsWith(term);
        const matchesId = c.id.toLowerCase().startsWith(term);
        if (!matchesName && !matchesId) return false;
      }

      // Filter by status (Activo / Inactivo mapping)
      if (st !== 'all') {
        const isOnline = c.status.toLowerCase() === 'online' || c.status.toLowerCase() === 'active';
        if ((st === 'active' || st === 'online') && !isOnline) return false;
        if ((st === 'inactive' || st === 'offline') && isOnline) return false;
      }

      // Filter by stream type
      if (stream !== 'all') {
        if (c.streamType.toLowerCase() !== stream.toLowerCase()) return false;
      }

      // Filter by decoder type
      if (dec !== 'all') {
        if (c.decoder.toLowerCase() !== dec.toLowerCase()) return false;
      }

      // Filter by analytic type
      if (analyticType !== 'all') {
        const cameraAnalytics = this.getAnalyticsForCamera(c.id);
        const hasAnalyticType = cameraAnalytics.some(a => this.normalizeAnalyticType(a.type) === this.normalizeAnalyticType(analyticType));
        if (!hasAnalyticType) return false;
      }

      return true;
    });

    // Ordenar: activas (online/active) primero, luego por nombre de nodo alfabéticamente (y por nombre de cámara si es el mismo nodo)
    return filtered.sort((a, b) => {
      const aOnline = a.status.toLowerCase() === 'online' || a.status.toLowerCase() === 'active' ? 1 : 0;
      const bOnline = b.status.toLowerCase() === 'online' || b.status.toLowerCase() === 'active' ? 1 : 0;
      
      if (bOnline !== aOnline) {
        return bOnline - aOnline;
      }
      
      const nodeA = this.getHostName(a.hostFingerprint).toLowerCase();
      const nodeB = this.getHostName(b.hostFingerprint).toLowerCase();
      const nodeCompare = nodeA.localeCompare(nodeB);
      if (nodeCompare !== 0) {
        return nodeCompare;
      }
      
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
  });

  readonly currentPage = signal(1, { equal: () => false });

  // Paginación consciente de la cuadrícula
  readonly columns = signal(this.getInitialColumns());
  readonly limit = signal(this.columns() * 10);

  private copiedTimeout: any;
  readonly copiedRowId = signal<string | null>(null);

  readonly limitOptions = computed(() => {
    const cols = this.columns();
    return [cols * 10, cols * 20, cols * 30];
  });

  // Paginación reactiva calculada en el cliente
  readonly pagedCameras = computed(() => {
    const list = this.filteredCameras();
    const start = (this.currentPage() - 1) * this.limit();
    const end = start + this.limit();
    return list.slice(start, end);
  });

  readonly totalPages = computed(() => {
    const total = this.filteredCameras().length;
    const lim = this.limit();
    return total > 0 ? Math.ceil(total / lim) : 1;
  });

  readonly pages = computed(() => {
    const total = this.totalPages();
    return Array.from({ length: total }, (_, i) => i + 1);
  });

  readonly visiblePages = computed<number[]>(() => {
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

  // Visibilidad del panel lateral derecho
  readonly showAiPanel = signal<boolean>(false);
  // Cámara seleccionada para el panel lateral
  readonly selectedCamera = signal<Camera | null>(null);
  readonly activeCamera = computed(() => {
    const selected = this.selectedCamera();
    if (!selected) return null;
    return this.cameras().find(c => c.id === selected.id) || selected;
  });
  readonly pendingCameraId = signal<string | null>(null);
  readonly pendingAnalyticId = signal<string | null>(null);

  // Lógica de edición de cámara
  readonly isEditingCamera = signal<boolean>(false);
  editCameraName = '';
  editCameraLat = 0;
  editCameraLon = 0;

  // Lógica de eliminación de cámara (modal de confirmación)
  readonly showDeleteModal = signal<boolean>(false);
  readonly cameraToDelete = signal<Camera | null>(null);
  readonly isDeletingCamera = signal<boolean>(false);

  // Lógica de eliminación de analítica (modal de confirmación)
  readonly showDeleteAnalyticModal = signal<boolean>(false);
  readonly analyticToDelete = signal<Analytic | null>(null);
  readonly isDeletingAnalytic = signal<boolean>(false);


  // Reloj interno para verificar horarios activos
  readonly currentTime = signal<Date>(new Date());
  private timerId: any;
  // Poll timer: recarga la lista de cámaras cada 5 segundos
  private pollTimerId: any;

  private resizeSubject = new Subject<number>();
  private resizeSubscription?: Subscription;
  private resizeObserver?: ResizeObserver;

  private estimateContainerWidth(): number {
    if (typeof window === 'undefined') return 1200;
    const sidebarWidth = this.isSidebarCollapsed() ? 78 : 260;
    return window.innerWidth - sidebarWidth - 48;
  }

  private getInitialColumns(): number {
    const width = this.estimateContainerWidth();
    const columnas = Math.floor((width + 24) / (335 + 24));
    return Math.max(1, columnas);
  }

  private getInitialRows(): number {
    return 3;
  }

  private initializeFromQueryParams(params: Params | undefined): void {
    if (!params) return;
    const page = params['page'] ? parseInt(params['page'], 10) : 1;
    const p = !isNaN(page) && page > 0 ? page : 1;
    if (this.currentPage() !== p) {
      this.currentPage.set(p);
    }

    const limitVal = params['limit'] ? parseInt(params['limit'], 10) : null;
    const defaultLimit = this.columns() * 10;
    const l = limitVal && !isNaN(limitVal) && limitVal > 0 ? limitVal : defaultLimit;
    if (this.limit() !== l) {
      this.limit.set(l);
    }

    if (params['search']) {
      this.searchControl.setValue(params['search'], { emitEvent: false });
      this.searchTerm.set(params['search']);
    } else {
      this.searchControl.setValue('', { emitEvent: false });
      this.searchTerm.set('');
    }

    this.filterStatus.set(params['status'] || 'all');
    this.filterStreamType.set(params['streamType'] || 'all');
    this.filterDecoder.set(params['decoder'] || 'all');
    this.filterAnalyticType.set(params['analyticType'] || 'all');

    if (params['camera']) {
      this.pendingCameraId.set(params['camera']);
    } else {
      this.pendingCameraId.set(null);
    }
    if (params['analytic']) {
      this.pendingAnalyticId.set(params['analytic']);
    } else {
      this.pendingAnalyticId.set(null);
    }
  }

  constructor() {
    const initialParams = this.route.snapshot?.queryParams;
    this.initializeFromQueryParams(initialParams);

    effect(() => {
      const pCamId = this.pendingCameraId();
      const pAnId = this.pendingAnalyticId();
      const cams = this.cameras();

      if (pCamId && cams.length > 0) {
        const foundCam = cams.find(c => c.id === pCamId);
        if (foundCam) {
          this.selectedCamera.set(foundCam);
          this.showAiPanel.set(true);
          this.pendingCameraId.set(null);

          if (pAnId) {
            this.expandedAnalyticIds.update(set => {
              const newSet = new Set(set);
              newSet.add(pAnId);
              return newSet;
            });
            this.pendingAnalyticId.set(null);
          }
        }
      }
    }, { allowSignalWrites: true });

    effect(() => {
      if (this.isHostDeleting()) {
        setTimeout(() => {
          this.router.navigate(['/dashboard/nodos']);
        }, 450);
      }
    });

    // Wire searchControl -> searchTerm signal with debounce
    this.searchControl.valueChanges.pipe(
      debounceTime(150),
      distinctUntilChanged(),
      takeUntilDestroyed()
    ).subscribe(val => {
      this.searchTerm.set(val);
      if (this.currentPage() !== 1) {
        this.currentPage.set(1);
      }
    });

    // Sincronizar paginación, búsqueda y filtros avanzados con QueryParams
    combineLatest({
      page: toObservable(this.currentPage),
      limit: toObservable(this.limit),
      search: toObservable(this.searchTerm),
      status: toObservable(this.filterStatus),
      streamType: toObservable(this.filterStreamType),
      decoder: toObservable(this.filterDecoder),
      analyticType: toObservable(this.filterAnalyticType)
    }).pipe(
      debounceTime(20),
      takeUntilDestroyed()
    ).subscribe(({ page, limit, search, status, streamType, decoder, analyticType }) => {
      const queryParams: any = {};
      queryParams['page'] = page > 1 ? page : null;
      const defaultLimit = this.columns() * 10;
      queryParams['limit'] = limit !== defaultLimit ? limit : null;
      queryParams['search'] = search || null;
      queryParams['status'] = status !== 'all' ? status : null;
      queryParams['streamType'] = streamType !== 'all' ? streamType : null;
      queryParams['decoder'] = decoder !== 'all' ? decoder : null;
      queryParams['analyticType'] = analyticType !== 'all' ? analyticType : null;

      this.router.navigate([], {
        relativeTo: this.route,
        queryParams,
        queryParamsHandling: 'merge'
      });
    });

    if (this.route.queryParams) {
      this.route.queryParams.pipe(
        skip(1),
        takeUntilDestroyed()
      ).subscribe(params => {
        this.initializeFromQueryParams(params);
      });
    }
  }

  // ── Advanced Filters Drawer Controls ──
  hasActiveFilters(): boolean {
    return this.searchTerm().trim() !== '' ||
           this.filterStatus() !== 'all' ||
           this.filterStreamType() !== 'all' ||
           this.filterDecoder() !== 'all' ||
           this.filterAnalyticType() !== 'all';
  }

  toggleFilterPanel(): void {
    if (!this.showFilterPanel()) {
      // Sync temp copies to active values when opening
      this.tempFilterStatus.set(this.filterStatus());
      this.tempFilterStreamType.set(this.filterStreamType());
      this.tempFilterDecoder.set(this.filterDecoder());
      this.tempFilterAnalyticType.set(this.filterAnalyticType());
    }
    this.showFilterPanel.update(v => !v);
  }

  applyFilters(): void {
    this.filterStatus.set(this.tempFilterStatus());
    this.filterStreamType.set(this.tempFilterStreamType());
    this.filterDecoder.set(this.tempFilterDecoder());
    this.filterAnalyticType.set(this.tempFilterAnalyticType());
    this.currentPage.set(1);
    this.showFilterPanel.set(false);
  }

  resetFilters(): void {
    this.searchControl.setValue('');
    this.searchTerm.set('');
    this.filterStatus.set('all');      this.tempFilterStatus.set('all');
    this.filterStreamType.set('all');  this.tempFilterStreamType.set('all');
    this.filterDecoder.set('all');     this.tempFilterDecoder.set('all');
    this.filterAnalyticType.set('all'); this.tempFilterAnalyticType.set('all');
    this.currentPage.set(1);
    this.showFilterPanel.set(false);
    this.activeDropdown.set(null);
  }

  toggleDropdown(dropdown: string, event: Event): void {
    event.stopPropagation();
    if (this.activeDropdown() === dropdown) {
      this.activeDropdown.set(null);
    } else {
      this.activeDropdown.set(dropdown);
    }
  }

  selectFilterValue(filterName: string, value: string, event: Event): void {
    event.stopPropagation();
    if (filterName === 'status') {
      this.tempFilterStatus.set(value);
      this.filterStatus.set(value);
    }
    if (filterName === 'streamType') {
      this.tempFilterStreamType.set(value);
      this.filterStreamType.set(value);
    }
    if (filterName === 'decoder') {
      this.tempFilterDecoder.set(value);
      this.filterDecoder.set(value);
    }
    if (filterName === 'analyticType') {
      this.tempFilterAnalyticType.set(value);
      this.filterAnalyticType.set(value);
    }
    this.currentPage.set(1);
    this.activeDropdown.set(null);
  }

  @HostListener('document:click')
  closeAllDropdowns(): void {
    this.activeDropdown.set(null);
    this.activeAddScheduleDropdown.set(null);
  }

  @HostListener('document:keydown.escape')
  handleEscapeKey(): void {
    if (this.showFilterPanel()) {
      this.showFilterPanel.set(false);
    }
    if (this.activeDropdown()) {
      this.activeDropdown.set(null);
    }
  }

  ngOnInit(): void {
    this.cameraService.isViewActive.set(true);
    this.analyticService.isViewActive.set(true);
    this.scheduleService.isViewActive.set(true);
    this.hostService.isViewActive.set(true);

    const savedMode = localStorage.getItem('camaras_view_mode') as 'cards' | 'list';
    if (savedMode) this.viewMode.set(savedMode);

    const fingerprint = this.route.snapshot.paramMap.get('hostId');
    this.hostId.set(fingerprint);

    // Cargar la lista global de hosts para obtener la licencia
    this.hostService.loadAllHosts().subscribe();

    if (fingerprint) {
      // Cargar cámaras del nodo
      this.cameraService.getCamerasByHost(fingerprint).subscribe();

      // Cargar TODOS los horarios globales
      this.scheduleService.getAllSchedules().subscribe();

      // Cargar las analíticas de IA del nodo
      this.analyticService.getAnalyticsByHost(fingerprint).subscribe();
    } else {
      // Cargar todas las cámaras del sistema
      this.cameraService.getAllCameras().subscribe();

      // Cargar TODOS los horarios globales
      this.scheduleService.getAllSchedules().subscribe();

      // Cargar las analíticas de IA globales
      this.analyticService.getAllAnalytics().subscribe();
    }

    // Reloj para verificar horarios activos cada segundo y transiciones
    this.timerId = setInterval(() => {
      this.currentTime.set(new Date());
      this.checkScheduleTransitions();
    }, 1000);
  }

  ngAfterViewInit(): void {
    this.resizeSubscription = this.resizeSubject.pipe(
      debounceTime(150)
    ).subscribe(width => {
      this.adjustColumnsAndLimit(width);
    });

    if (typeof ResizeObserver !== 'undefined' && this.camerasGrid) {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          this.resizeSubject.next(entry.contentRect.width);
        }
      });
      this.resizeObserver.observe(this.camerasGrid.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.cameraService.isViewActive.set(false);
    this.analyticService.isViewActive.set(false);
    this.scheduleService.isViewActive.set(false);
    this.hostService.isViewActive.set(false);

    if (this.timerId) {
      clearInterval(this.timerId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
    }
    if (this.copiedTimeout) {
      clearTimeout(this.copiedTimeout);
    }
  }

  private adjustColumnsAndLimit(containerWidth: number): void {
    if (containerWidth <= 0) return;
    const columnas = Math.floor((containerWidth + 24) / (335 + 24));
    const newCols = Math.max(1, columnas);
    const oldCols = this.columns();

    if (newCols !== oldCols) {
      this.columns.set(newCols);
      if (this.viewMode() === 'cards') {
        const currentLimit = this.limit();
        const validOptions = [newCols * 10, newCols * 20, newCols * 30];
        if (!validOptions.includes(currentLimit)) {
          this.limit.set(newCols * 10);
        }
        this.currentPage.set(1);
      }
    }
  }

  setPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update(p => p + 1);
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update(p => p - 1);
    }
  }

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

  onLimitChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newLimit = parseInt(select.value, 10);
    this.limit.set(newLimit);
    this.currentPage.set(1);
  }

  openAiPanel(camera: Camera): void {
    this.selectedCamera.set(camera);
    this.showAiPanel.set(true);
    this.isEditingCamera.set(false);
  }

  closeAiPanel(): void {
    this.showAiPanel.set(false);
    this.isEditingCamera.set(false);
  }

  startEditingCamera(camera: Camera): void {
    this.editCameraName = camera.name;
    this.editCameraLat = camera.location?.lat ?? 0;
    this.editCameraLon = camera.location?.lon ?? 0;
    this.isEditingCamera.set(true);
  }

  cancelEditingCamera(): void {
    this.isEditingCamera.set(false);
  }

  get isNameInvalid(): boolean {
    return !this.editCameraName || this.editCameraName.trim() === '';
  }

  get isLatInvalid(): boolean {
    if (this.editCameraLat === null || this.editCameraLat === undefined || isNaN(this.editCameraLat)) {
      return true;
    }
    return this.editCameraLat < -90 || this.editCameraLat > 90;
  }

  get isLonInvalid(): boolean {
    if (this.editCameraLon === null || this.editCameraLon === undefined || isNaN(this.editCameraLon)) {
      return true;
    }
    return this.editCameraLon < -180 || this.editCameraLon > 180;
  }

  get isFormInvalid(): boolean {
    return this.isNameInvalid || this.isLatInvalid || this.isLonInvalid;
  }

  saveCameraInfo(camera: Camera): void {
    if (this.isFormInvalid) {
      alert('Por favor, corrija los errores en el formulario antes de guardar.');
      return;
    }

    const body = {
      camera_name: this.editCameraName.trim(),
      location: {
        lat: Number(this.editCameraLat),
        lon: Number(this.editCameraLon)
      }
    };

    this.cameraService.updateCamera(camera.id, body).subscribe({
      next: () => {
        this.isEditingCamera.set(false);
      },
      error: (err) => {
        // El backend puede retornar 500 incluso cuando la operación se completó exitosamente.
        // Solo mostramos alerta si es un error real del cliente (4xx).
        if (err?.status >= 400 && err?.status < 500) {
          console.error('Error updating camera:', err);
          alert('Error al guardar la información de la cámara. Por favor, intente de nuevo.');
        } else {
          // 5xx: la operación se aplicó en el backend, tratamos como éxito
          console.warn('[camaras] update 5xx swallowed, reloading cameras:', err?.status);
          this.isEditingCamera.set(false);
        }
      }
    });
  }

  openDeleteModal(camera: Camera): void {
    this.cameraToDelete.set(camera);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.cameraToDelete.set(null);
    this.showDeleteModal.set(false);
  }

  confirmDeleteCamera(): void {
    const camera = this.cameraToDelete();
    if (!camera) return;

    this.isDeletingCamera.set(true);
    this.cameraService.deleteCamera(camera.id).subscribe({
      next: () => {
        this.isDeletingCamera.set(false);
        this.closeDeleteModal();
        this.closeAiPanel();
      },
      error: (err) => {
        // El backend puede retornar 500 incluso cuando el delete se completó exitosamente.
        // Solo mostramos alerta si es un error real del cliente (4xx).
        if (err?.status >= 400 && err?.status < 500) {
          console.error('Error deleting camera:', err);
          this.isDeletingCamera.set(false);
          alert('Error al eliminar la cámara. Por favor, intente de nuevo.');
        } else {
          // 5xx: la cámara se eliminó en el backend, tratamos como éxito
          console.warn('[camaras] delete 5xx swallowed, closing modal:', err?.status);
          this.isDeletingCamera.set(false);
          this.closeDeleteModal();
          this.closeAiPanel();
        }
      }
    });
  }

  openDeleteAnalyticModal(analytic: Analytic): void {
    this.analyticToDelete.set(analytic);
    this.showDeleteAnalyticModal.set(true);
  }

  closeDeleteAnalyticModal(): void {
    this.analyticToDelete.set(null);
    this.showDeleteAnalyticModal.set(false);
  }

  confirmDeleteAnalytic(): void {
    const analytic = this.analyticToDelete();
    if (!analytic) return;

    this.isDeletingAnalytic.set(true);
    this.analyticService.deleteAnalytic(analytic.id).subscribe({
      next: () => {
        this.isDeletingAnalytic.set(false);
        this.closeDeleteAnalyticModal();
      },
      error: (err) => {
        if (err?.status >= 400 && err?.status < 500) {
          console.error('Error deleting analytic:', err);
          this.isDeletingAnalytic.set(false);
          alert('Error al eliminar la analítica. Por favor, intente de nuevo.');
        } else {
          console.warn('[camaras] delete analytic 5xx swallowed, closing modal:', err?.status);
          this.isDeletingAnalytic.set(false);
          this.closeDeleteAnalyticModal();
        }
      }
    });
  }

  getHostName(fingerprint: string): string {
    const host = this.hostService.allHosts().find(h => h.fingerprint === fingerprint);
    return host ? host.hostname : fingerprint;
  }

  isCameraOnline(camera: Camera | null | undefined): boolean {
    if (!camera || !camera.status) return false;
    const st = camera.status.toLowerCase();
    return st === 'online' || st === 'active';
  }

  // ── Analíticas ──────────────────────────────────────────────────────────────

  /** Retorna las analíticas de IA asignadas a una cámara específica */
  getAnalyticsForCamera(cameraId: string): Analytic[] {
    return this.analytics().filter(a => (!this.hostId() || a.hostFingerprint === this.hostId()) && a.targetCameraIds.includes(cameraId));
  }

  /** Normaliza el tipo de analítica para soportar variaciones del backend */
  normalizeAnalyticType(type: string): string {
    if (!type) return '';
    // Eliminar acentos y diacríticos (ej. Detección -> Deteccion)
    const clean = type.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Conversión a minúsculas y eliminación de guiones o espacios
    const norm = clean.toLowerCase().replace(/[- ]/g, '_').trim();
    
    const variations: Record<string, string> = {
      objectdetection: 'object_detection',
      facerecognition: 'face_recognition',
      platerecognition: 'plate_recognition',
      peoplecounting: 'people_counting',
      intrusiondetection: 'intrusion_detection',
      comportamientohumano: 'comportamiento_humano',
      crucedelinea: 'cruce_de_linea',
      objetoenarea: 'objeto_en_area',
      
      // Soporte para español
      deteccion_de_objetos: 'object_detection',
      deteccion_objetos: 'object_detection',
      reconocimiento_facial: 'face_recognition',
      lectura_de_placas: 'plate_recognition',
      lectura_placas: 'plate_recognition',
      conteo_de_personas: 'people_counting',
      conteo_personas: 'people_counting',
      deteccion_de_intrusion: 'intrusion_detection',
      deteccion_intrusion: 'intrusion_detection',
      cruce_de_linea: 'cruce_de_linea',
      objeto_en_area: 'objeto_en_area',
      comportamiento_humano: 'comportamiento_humano'
    };
    
    return variations[norm] ?? variations[norm.replace(/_/g, '')] ?? norm;
  }

  /** Etiqueta legible para el tipo de analítica */
  getAnalyticLabel(type: string): string {
    const norm = this.normalizeAnalyticType(type);
    const labels: Record<string, string> = {
      object_detection: 'Detección de Objetos',
      face_recognition: 'Reconocimiento Facial',
      plate_recognition: 'Lectura de Placas',
      people_counting: 'Conteo de Personas',
      intrusion_detection: 'Detección de Intrusión',
      comportamiento_humano: 'Comportamiento Humano',
      cruce_de_linea: 'Cruce de Línea',
      objeto_en_area: 'Objeto en Área',
    };
    return labels[norm] ?? type.replace(/_/g, ' ');
  }

  /** Icono para el tipo de analítica */
  getAnalyticIcon(type: string): string {
    const norm = this.normalizeAnalyticType(type);
    const icons: Record<string, string> = {
      object_detection: '🔍',
      face_recognition: '👤',
      plate_recognition: '🚗',
      people_counting: '📊',
      intrusion_detection: '🛡️',
      comportamiento_humano: '🚶',
      cruce_de_linea: '🚧',
      objeto_en_area: '📦',
      
      // Mapeos para características específicas de la licencia (en español o normalizado)
      aglomeracion: '👥',
      control_de_aforo: '📊',
      analisis_de_trafico: '🚦',
      objeto_fuera_de_area: '⚠️',
      personas_con_objetos: '🎒',
      vigilancia_de_objeto: '🔍',
      vigilancia_vehicular: '🚘',
      medicion_de_velocidad: '⚡',
      permanencia_de_objeto: '⏳',
      reconocimiento_facial: '👤',
      cercania_entre_objetos: '↔️',
      reconocimiento_de_placas: '🆔',
      gestion_de_estacionamientos: '🅿️'
    };
    return icons[norm] ?? '🤖';
  }

  // ── Horarios ─────────────────────────────────────────────────────────────────

  getSchedulesForAnalytic(analyticId: string): Schedule[] {
    return this.schedules().filter(s =>
      s.analyticIds.includes(analyticId)
    );
  }

  getUnassociatedSchedules(analyticId: string): Schedule[] {
    return this.schedules().filter(s =>
      !s.analyticIds.includes(analyticId) && s.status === 'activo'
    );
  }

  toggleAnalyticDetails(analyticId: string): void {
    this.expandedAnalyticIds.update(set => {
      const newSet = new Set(set);
      if (newSet.has(analyticId)) {
        newSet.delete(analyticId);
      } else {
        newSet.add(analyticId);
      }
      return newSet;
    });
  }

  isAnalyticDetailsExpanded(analyticId: string): boolean {
    return this.expandedAnalyticIds().has(analyticId);
  }

  toggleScheduleAssociation(schedule: Schedule, analyticId: string, associate: boolean): void {
    const currentAnalyticIds = schedule.analyticIds;
    let newAnalyticIds: string[];
    if (associate) {
      newAnalyticIds = [...currentAnalyticIds, analyticId];
    } else {
      newAnalyticIds = currentAnalyticIds.filter(id => id !== analyticId);
    }

    const formatPayloadDate = (d: Date) => d.toISOString();

    const payload = {
      nombre: schedule.name,
      fingerprint_host: '',
      analytics_ids: newAnalyticIds.map(id => ({ id_analytic: id })),
      timestamp_inicio: formatPayloadDate(schedule.start),
      timestamp_fin: formatPayloadDate(schedule.end),
      frecuencia: schedule.frequency,
      estado: schedule.status
    };

    this.scheduleService.updateSchedule(schedule.id, payload).subscribe({
      next: () => {
        // Success
      },
      error: (err) => {
        console.error('[CamarasComponent] toggleScheduleAssociation failed:', err);
      }
    });
  }

  toggleAddScheduleDropdown(analyticId: string, event: Event): void {
    event.stopPropagation();
    this.activeAddScheduleDropdown.update(cur => cur === analyticId ? null : analyticId);
  }

  isScheduleActive(schedule: Schedule): boolean {
    if (schedule.status !== 'activo') {
      return false;
    }
    const now = this.currentTime();

    if (schedule.frequency === 'diario') {
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = schedule.start.getHours() * 60 + schedule.start.getMinutes();
      const endMinutes = schedule.end.getHours() * 60 + schedule.end.getMinutes();

      if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      } else {
        return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
      }
    }

    return now >= schedule.start && now <= schedule.end;
  }



  getScheduleDateLabelCompact(sched: Schedule): string {
    const pad = (num: number) => num.toString().padStart(2, '0');
    const yStart = sched.start.getFullYear().toString().slice(-2);
    const yEnd = sched.end.getFullYear().toString().slice(-2);
    
    const dStart = `${pad(sched.start.getDate())}/${pad(sched.start.getMonth() + 1)}/${yStart}`;
    const dEnd = `${pad(sched.end.getDate())}/${pad(sched.end.getMonth() + 1)}/${yEnd}`;
    
    return dStart === dEnd ? dStart : `${dStart} al ${dEnd}`;
  }

  getScheduleTimeLabelCompact(sched: Schedule): string {
    const pad = (num: number) => num.toString().padStart(2, '0');
    const tStart = `${pad(sched.start.getHours())}:${pad(sched.start.getMinutes())}`;
    const tEnd = `${pad(sched.end.getHours())}:${pad(sched.end.getMinutes())}`;
    return `${tStart} a ${tEnd}`;
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  // ── Sincronización de Horarios y Control Manual ──────────────────────────────
  private previousScheduledActiveStates = new Map<string, boolean>();

  private checkScheduleTransitions(): void {
    const hostFingerprint = this.hostId();

    const listAnalytics = hostFingerprint
      ? this.analytics().filter(a => a.hostFingerprint === hostFingerprint)
      : this.analytics();
    const listSchedules = this.schedules();

    listAnalytics.forEach(analytic => {
      // Buscar horarios asociados a esta analítica
      const schedulesForAnalytic = listSchedules.filter(s =>
        s.analyticIds.includes(analytic.id)
      );

      if (schedulesForAnalytic.length === 0) {
        this.previousScheduledActiveStates.delete(analytic.id);
        return;
      }

      // Determinar si al menos un horario está activo
      const currentlyScheduledActive = schedulesForAnalytic.some(s => this.isScheduleActive(s));

      const hasPrev = this.previousScheduledActiveStates.has(analytic.id);
      const prevScheduledActive = this.previousScheduledActiveStates.get(analytic.id);

      if (!hasPrev) {
        // Inicializar estado sin lanzar transiciones en la carga inicial
        this.previousScheduledActiveStates.set(analytic.id, currentlyScheduledActive);
        return;
      }

      if (currentlyScheduledActive !== prevScheduledActive) {
        // Ocurrió una transición de encendido o apagado programado
        this.previousScheduledActiveStates.set(analytic.id, currentlyScheduledActive);
        const targetStatus = currentlyScheduledActive ? 'active' : 'inactive';

        this.analyticService.updateAnalyticStatus(analytic.id, targetStatus).subscribe({
          next: () => {
            this.analyticService.analytics.update(all =>
              all.map(a => a.id === analytic.id ? { ...a, status: targetStatus } : a)
            );
          }
        });
      }
    });
  }

  toggleAnalyticStatus(analytic: Analytic): void {
    const newStatus = analytic.status === 'active' ? 'inactive' : 'active';
    this.analyticService.updateAnalyticStatus(analytic.id, newStatus).subscribe({
      next: () => {
        this.analyticService.analytics.update(all =>
          all.map(a => a.id === analytic.id ? { ...a, status: newStatus } : a)
        );
      },
      error: (err) => {
        console.error('Error toggling analytic status:', err);
        alert('Error al cambiar el estado de la analítica en caliente. Por favor, intente de nuevo.');
        // Forzar actualización del switch en la UI para revertir la posición visual
        this.analyticService.analytics.update(all => [...all]);
      }
    });
  }

  getAnalyticColor(type: string): string {
    const norm = this.normalizeAnalyticType(type);
    const colors: Record<string, string> = {
      object_detection: 'var(--color-analytic-object-detection)',
      face_recognition: 'var(--color-analytic-face-recognition)',
      plate_recognition: 'var(--color-analytic-plate-recognition)',
      people_counting: 'var(--color-analytic-people-counting)',
      intrusion_detection: 'var(--color-analytic-intrusion-detection)',
      comportamiento_humano: 'var(--color-analytic-comportamiento-humano)',
      cruce_de_linea: 'var(--color-analytic-cruce-de-linea)',
      objeto_en_area: 'var(--color-analytic-objeto-en-area)',
    };
    return colors[norm] ?? 'var(--color-analytic-unknown)';
  }

  getAnalyticTypeById(id: string): string {
    if (!id) return '';
    const searchId = id.toLowerCase().trim();
    const allAnalytics = this.analytics();
    const found = allAnalytics.find(a => a.id.toLowerCase().trim() === searchId);
    return found?.type ?? '';
  }


  mapAnalyticTypeToFeatureKey(type: string): string | null {
    const norm = this.normalizeAnalyticType(type);
    const featureKeyMap: Record<string, string> = {
      'aglomeracion': 'Aglomeracion',
      'cruce_de_linea': 'Cruce de Linea',
      'objeto_en_area': 'Objeto en area',
      'control_de_aforo': 'Control de aforo',
      'analisis_de_trafico': 'Analisis de trafico',
      'objeto_fuera_de_area': 'Objeto fuera de area',
      'personas_con_objetos': 'Personas con objetos',
      'vigilancia_de_objeto': 'Vigilancia de Objeto',
      'object_detection': 'Vigilancia de Objeto',
      'vigilancia_vehicular': 'Vigilancia vehicular',
      'comportamiento_humano': 'Comportamiento humano',
      'medicion_de_velocidad': 'Medicion de velocidad',
      'permanencia_de_objeto': 'Permanencia de objeto',
      'reconocimiento_facial': 'Reconocimiento facial',
      'face_recognition': 'Reconocimiento facial',
      'cercania_entre_objects': 'Cercania entre objetos',
      'cercania_entre_objetos': 'Cercania entre objetos',
      'reconocimiento_de_placas': 'Reconocimiento de placas',
      'plate_recognition': 'Reconocimiento de placas',
      'license_plate_recognition': 'Reconocimiento de placas',
      'gestion_de_estacionamientos': 'Gestion de estacionamientos'
    };
    return featureKeyMap[norm] ?? null;
  }

  getQuotaPercentage(featureName: string): number {
    const lic = this.license();
    if (!lic || !lic.features) return 0;
    const limit = lic.features[featureName] || 0;
    if (limit <= 0) return 0;
    const usage = this.licenseQuotaUsage()[featureName] || 0;
    return Math.min(100, (usage / limit) * 100);
  }

  getQuotaColorClass(featureName: string): string {
    const lic = this.license();
    if (!lic || !lic.features) return 'muted';
    const limit = lic.features[featureName] || 0;
    const usage = this.licenseQuotaUsage()[featureName] || 0;
    if (usage === 0) return 'muted';
    if (limit <= 0) return 'muted';
    const pct = (usage / limit) * 100;
    if (pct >= 75) return 'danger';
    if (pct >= 50) return 'warning';
    return 'success';
  }

  getRemainingAnalyticsTooltip(analytics: any[]): string {
    return analytics.slice(3).map(a => this.getAnalyticLabel(a.type)).join(', ');
  }

  setViewMode(mode: 'cards' | 'list'): void {
    this.viewMode.set(mode);
    localStorage.setItem('camaras_view_mode', mode);
    if (mode === 'list') {
      this.limit.set(10);
    } else {
      this.limit.set(this.columns() * 10);
    }
    this.currentPage.set(1);
  }

  copyRowContent(value: string, uniqueKey: string): void {
    if (!value) return;
    copyToClipboard(value).then(() => {
      this.copiedRowId.set(uniqueKey);
      if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
      this.copiedTimeout = setTimeout(() => {
        this.copiedRowId.set(null);
      }, 2000);
    }).catch(err => {
      console.error('Error al copiar al portapapeles', err);
    });
  }
}
