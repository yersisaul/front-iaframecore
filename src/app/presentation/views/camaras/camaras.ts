import { Component, OnInit, OnDestroy, AfterViewInit, inject, signal, computed, ViewChild, ElementRef, HostListener } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, Params } from '@angular/router';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, skip } from 'rxjs/operators';
import { CameraService } from '../../../core/services/camera.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { AnalyticService } from '../../../core/services/analytic.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { HostService } from '../../../core/services/host.service';
import { Schedule } from '../../../core/domain/entities/schedule.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { Camera } from '../../../core/domain/entities/camera.models';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';

function getDateString(d: Date): string {
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getTimeString(d: Date): string {
  const pad = (num: number) => num.toString().padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

  @ViewChild('camerasGrid', { static: false }) camerasGrid!: ElementRef<HTMLDivElement>;

  readonly hostId = signal<string | null>(null);

  readonly cameras = this.cameraService.cameras;
  readonly schedules = this.scheduleService.schedules;
  readonly analytics = this.analyticService.analytics;
  readonly isLoading = computed(() =>
    this.cameraService.isLoading() || this.scheduleService.isLoading()
  );

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  readonly showLicenseModal = signal<boolean>(false);
  readonly licenseScrolledToBottom = signal<boolean>(false);

  readonly showSchedulesModal = signal<boolean>(false);
  readonly activeAddScheduleDropdown = signal<string | null>(null);
  readonly expandedAnalyticIds = signal<Set<string>>(new Set());

  openLicenseModal(): void {
    this.licenseScrolledToBottom.set(false);
    this.showLicenseModal.set(true);
  }

  openSchedulesModal(): void {
    this.showSchedulesModal.set(true);
    this.newScheduleName.set('');
    this.newScheduleDateStart.set('');
    this.newScheduleTimeStart.set('');
    this.newScheduleDateEnd.set('');
    this.newScheduleTimeEnd.set('');
    this.newScheduleSelectedAnalyticIds.set([]);
    this.newScheduleFrequency.set('');
    this.showCreateForm.set(false);
    this.editingScheduleId.set(null);
    this.activeCalendarField.set(null);
    this.activeTimeField.set(null);
  }

  closeSchedulesModal(): void {
    this.showSchedulesModal.set(false);
    this.editingScheduleId.set(null);
    this.activeCalendarField.set(null);
    this.activeTimeField.set(null);
  }

  onModalCardClick(event: Event): void {
    event.stopPropagation();
    this.activeCalendarField.set(null);
    this.activeTimeField.set(null);
  }

  onLicenseScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    this.licenseScrolledToBottom.set(atBottom);
  }

  copyFingerprint(): void {
    const fingerprint = this.hostId();
    if (fingerprint) {
      navigator.clipboard.writeText(fingerprint).catch(err => console.error('Error copying to clipboard', err));
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

    this.analytics().forEach(analytic => {
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
    const list = this.cameras();
    const statuses = new Set<string>();
    const streams = new Set<string>();
    const decoders = new Set<string>();

    list.forEach(c => {
      if (c.status) statuses.add(c.status);
      if (c.streamType) streams.add(c.streamType);
      if (c.decoder) decoders.add(c.decoder);
    });

    const uniqueAnalytics = new Set<string>();
    this.analytics().forEach(a => {
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

    return list.filter(c => {
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
  });

  readonly currentPage = signal(1, { equal: () => false });

  // Paginación consciente de la cuadrícula
  readonly columns = signal(this.getInitialColumns());
  readonly rows = signal(this.getInitialRows());
  readonly limit = signal(this.columns() * this.rows() * 2);

  readonly limitOptions = computed(() => {
    const base = this.columns() * this.rows();
    return [base * 2, base * 3, base * 4];
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

  // Lógica de eliminación de horario (modal de confirmación)
  readonly showDeleteScheduleModal = signal<boolean>(false);
  readonly scheduleToDelete = signal<Schedule | null>(null);
  readonly isDeletingSchedule = signal<boolean>(false);

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
    const columnas = Math.floor((width + 24) / (420 + 24));
    return Math.max(1, columnas);
  }

  private getInitialRows(): number {
    if (typeof window === 'undefined') return 3;
    return Math.max(3, Math.floor((window.innerHeight - 300) / 280));
  }

  private initializeFromQueryParams(params: Params | undefined): void {
    if (!params) return;
    const page = params['page'] ? parseInt(params['page'], 10) : 1;
    const p = !isNaN(page) && page > 0 ? page : 1;
    if (this.currentPage() !== p) {
      this.currentPage.set(p);
    }

    const limitVal = params['limit'] ? parseInt(params['limit'], 10) : null;
    const defaultLimit = this.columns() * this.rows();
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
  }

  constructor() {
    const initialParams = this.route.snapshot?.queryParams;
    this.initializeFromQueryParams(initialParams);

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
      const defaultLimit = this.columns() * this.rows();
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
    this.activeCalendarField.set(null);
    this.activeTimeField.set(null);
    this.activeAddScheduleDropdown.set(null);
  }

  ngOnInit(): void {
    const fingerprint = this.route.snapshot.paramMap.get('hostId');
    this.hostId.set(fingerprint);

    // Cargar la lista global de hosts para obtener la licencia
    this.hostService.loadAllHosts().subscribe();

    if (fingerprint) {
      // Cargar cámaras del nodo
      this.cameraService.getCamerasByHost(fingerprint).subscribe();

      // Cargar TODOS los horarios y filtrar client-side por fingerprint
      this.scheduleService.getSchedulesByHost(fingerprint).subscribe();

      // Cargar las analíticas de IA del nodo
      this.analyticService.getAnalyticsByHost(fingerprint).subscribe();
    }

    // Reloj para verificar horarios activos cada segundo y transiciones
    this.timerId = setInterval(() => {
      this.currentTime.set(new Date());
      this.checkScheduleTransitions();
    }, 1000);

    // Auto-recarga de cámaras cada 5 segundos (nuevo desde backend, edición o eliminación)
    if (fingerprint) {
      this.pollTimerId = setInterval(() => {
        this.cameraService.getCamerasByHost(fingerprint).subscribe({
          next: (cameras) => {
            // Si la cámara seleccionada fue eliminada externamente, cerrar panel
            const selected = this.selectedCamera();
            if (selected && !cameras.find(c => c.id === selected.id)) {
              this.closeAiPanel();
            } else if (selected) {
              // Actualizar datos del panel si la cámara fue editada
              const updated = cameras.find(c => c.id === selected.id);
              if (updated) this.selectedCamera.set(updated);
            }
          }
        });
      }, 5000);
    }
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
    if (this.timerId) {
      clearInterval(this.timerId);
    }
    if (this.pollTimerId) {
      clearInterval(this.pollTimerId);
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.resizeSubscription) {
      this.resizeSubscription.unsubscribe();
    }
  }

  private adjustColumnsAndLimit(containerWidth: number): void {
    const columnas = Math.floor((containerWidth + 24) / (420 + 24));
    const newCols = Math.max(1, columnas);
    const newRows = Math.max(3, Math.floor((window.innerHeight - 300) / 280));
    const oldCols = this.columns();
    const oldRows = this.rows();

    if (newCols !== oldCols || newRows !== oldRows) {
      const oldBase = oldCols * oldRows;
      const currentLimit = this.limit();
      const screens = Math.max(2, Math.min(4, Math.round(currentLimit / (oldBase || 1))));

      this.columns.set(newCols);
      this.rows.set(newRows);

      const newBase = newCols * newRows;
      this.limit.set(newBase * screens);
      this.currentPage.set(1);
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
        const hostFingerprint = this.hostId();
        if (hostFingerprint) {
          this.cameraService.getCamerasByHost(hostFingerprint).subscribe({
            next: (updatedCameras) => {
              const updated = updatedCameras.find(c => c.id === camera.id);
              if (updated) {
                this.selectedCamera.set(updated);
              }
            }
          });
        }
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
          const hostFingerprint = this.hostId();
          if (hostFingerprint) {
            this.cameraService.getCamerasByHost(hostFingerprint).subscribe();
          }
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
        const hostFingerprint = this.hostId();
        if (hostFingerprint) {
          this.cameraService.getCamerasByHost(hostFingerprint).subscribe();
        }
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
          const hostFingerprint = this.hostId();
          if (hostFingerprint) {
            this.cameraService.getCamerasByHost(hostFingerprint).subscribe();
          }
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
        const hostFingerprint = this.hostId();
        if (hostFingerprint) {
          this.analyticService.getAnalyticsByHost(hostFingerprint).subscribe();
        }
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
          const hostFingerprint = this.hostId();
          if (hostFingerprint) {
            this.analyticService.getAnalyticsByHost(hostFingerprint).subscribe();
          }
        }
      }
    });
  }

  // ── Analíticas ──────────────────────────────────────────────────────────────

  /** Retorna las analíticas de IA asignadas a una cámara específica */
  getAnalyticsForCamera(cameraId: string): Analytic[] {
    return this.analytics().filter(a => a.targetCameraIds.includes(cameraId));
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
      s.hostFingerprint === this.hostId() && s.analyticIds.includes(analyticId)
    );
  }

  getUnassociatedSchedules(analyticId: string): Schedule[] {
    return this.schedules().filter(s =>
      s.hostFingerprint === this.hostId() && !s.analyticIds.includes(analyticId)
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
      fingerprint_host: schedule.hostFingerprint,
      analytics_ids: newAnalyticIds.map(id => ({ id_analytic: id })),
      timestamp_inicio: formatPayloadDate(schedule.start),
      timestamp_fin: formatPayloadDate(schedule.end),
      frecuencia: schedule.frequency,
      estado: schedule.status
    };

    this.scheduleService.updateSchedule(schedule.id, payload).subscribe({
      next: () => {
        this.scheduleService.getSchedulesByHost(this.hostId()!).subscribe();
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

  getRemainingRepetitions(
    start: Date,
    end: Date,
    frequency: 'diario' | 'semanal' | 'mensual',
    referenceDate: Date = new Date()
  ): number {
    if (start > end) return 0;

    const startHour = start.getHours();
    const startMin = start.getMinutes();
    const endHour = end.getHours();
    const endMin = end.getMinutes();
    const crossesMidnight = (endHour < startHour) || (endHour === startHour && endMin < startMin);

    // Normalize dates to midnight to loop through dates easily
    const getNormalizedDate = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const overallStartDate = getNormalizedDate(start);
    const overallEndDate = getNormalizedDate(end);

    let count = 0;
    let i = 0;
    while (true) {
      let repDate: Date;
      if (frequency === 'diario') {
        repDate = new Date(overallStartDate.getTime() + i * 24 * 60 * 60 * 1000);
      } else if (frequency === 'semanal') {
        repDate = new Date(overallStartDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
      } else { // mensual
        repDate = new Date(overallStartDate.getFullYear(), overallStartDate.getMonth() + i, overallStartDate.getDate());
      }

      // Start time of this repetition
      const repStart = new Date(repDate.getFullYear(), repDate.getMonth(), repDate.getDate(), startHour, startMin, 0, 0);
      if (repStart > end) {
        break; // Out of bounds
      }

      // End time of this repetition
      let repEnd: Date;
      if (crossesMidnight) {
        repEnd = new Date(repDate.getTime() + 24 * 60 * 60 * 1000);
        repEnd.setHours(endHour, endMin, 0, 0);
      } else {
        repEnd = new Date(repStart.getTime());
        repEnd.setHours(endHour, endMin, 0, 0);
      }

      if (referenceDate <= repEnd) {
        count++;
      }

      i++;
      // Safety brake to prevent infinite loops if frequency calculation gets stuck
      if (i > 10000) break;
    }

    return count;
  }

  getScheduleRemainingRepetitions(schedule: Schedule): number {
    return this.getRemainingRepetitions(schedule.start, schedule.end, schedule.frequency as any, this.currentTime());
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

  // ── Sincronización de Horarios y Control Manual ──────────────────────────────
  private previousScheduledActiveStates = new Map<string, boolean>();

  private checkScheduleTransitions(): void {
    const hostFingerprint = this.hostId();
    if (!hostFingerprint) return;

    const listAnalytics = this.analytics();
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

  // ── CRUD de Horarios en Desplegable ──────────────────────────────────────────
  
  // Variables del Formulario de Creación
  readonly newScheduleName = signal('');
  readonly newScheduleDateStart = signal('');
  readonly newScheduleTimeStart = signal('');
  readonly newScheduleDateEnd = signal('');
  readonly newScheduleTimeEnd = signal('');
  readonly newScheduleSelectedAnalyticIds = signal<string[]>([]);
  readonly newScheduleFrequency = signal<'diario' | 'semanal' | 'mensual' | ''>('');
  readonly showCreateForm = signal(false);

  // Variables temporales para el selector de rango de fechas
  readonly tempDateStart = signal<string>('');
  readonly tempDateEnd = signal<string>('');
  readonly isSelectingRange = signal<boolean>(false);

  // Variables de Edición Inline
  readonly editingScheduleId = signal<string | null>(null);
  readonly editingScheduleName = signal('');
  readonly editingScheduleDateStart = signal('');
  readonly editingScheduleTimeStart = signal('');
  readonly editingScheduleDateEnd = signal('');
  readonly editingScheduleTimeEnd = signal('');
  readonly editingScheduleFrequency = signal<'diario' | 'semanal' | 'mensual' | ''>('diario');
  readonly editingScheduleSelectedAnalyticIds = signal<string[]>([]);

  readonly newScheduleRemainingRepetitions = computed(() => {
    const dStart = this.newScheduleDateStart();
    const tStart = this.newScheduleTimeStart();
    const dEnd = this.newScheduleDateEnd();
    const tEnd = this.newScheduleTimeEnd();
    const freq = this.newScheduleFrequency();
    if (!dStart || !tStart || !dEnd || !tEnd || !freq) return 0;
    try {
      const start = new Date(`${dStart}T${tStart}:00`);
      const end = new Date(`${dEnd}T${tEnd}:00`);
      return this.getRemainingRepetitions(start, end, freq, this.currentTime());
    } catch {
      return 0;
    }
  });

  readonly editingScheduleRemainingRepetitions = computed(() => {
    const dStart = this.editingScheduleDateStart();
    const tStart = this.editingScheduleTimeStart();
    const dEnd = this.editingScheduleDateEnd();
    const tEnd = this.editingScheduleTimeEnd();
    const freq = this.editingScheduleFrequency();
    if (!dStart || !tStart || !dEnd || !tEnd || !freq) return 0;
    try {
      const start = new Date(`${dStart}T${tStart}:00`);
      const end = new Date(`${dEnd}T${tEnd}:00`);
      return this.getRemainingRepetitions(start, end, freq, this.currentTime());
    } catch {
      return 0;
    }
  });

  // Control del Calendario Customizado
  readonly activeCalendarField = signal<'newRange' | 'editingRange' | null>(null);
  readonly calendarViewMonth = signal<number>(new Date().getMonth());
  readonly calendarViewYear = signal<number>(new Date().getFullYear());

  // Control del Selector de Hora Customizado
  readonly activeTimeField = signal<'newStart' | 'newEnd' | 'editingStart' | 'editingEnd' | null>(null);
  readonly hoursList = Array.from({ length: 24 }, (_, i) => i);
  readonly minutesList = Array.from({ length: 60 }, (_, i) => i);

  readonly calendarGrid = computed(() => {
    const month = this.calendarViewMonth();
    const year = this.calendarViewYear();
    
    // Primer día del mes
    const firstDay = new Date(year, month, 1);
    const startDayOfWeek = firstDay.getDay(); // 0 = Domingo, 1 = Lunes, etc.
    
    // Total de días en el mes
    const totalDays = new Date(year, month + 1, 0).getDate();
    
    const emptyDays = Array.from({ length: startDayOfWeek }, (_, i) => i);
    const days = Array.from({ length: totalDays }, (_, i) => i + 1);
    
    return { emptyDays, days };
  });

  getMonths(): string[] {
    return [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
  }

  openCalendar(field: 'newRange' | 'editingRange', event: Event): void {
    event.stopPropagation();
    
    // Toggle close if already open
    if (this.activeCalendarField() === field) {
      this.activeCalendarField.set(null);
      return;
    }
    
    let dateStr = '';
    if (field === 'newRange') {
      dateStr = this.newScheduleDateStart();
      this.tempDateStart.set(this.newScheduleDateStart());
      this.tempDateEnd.set(this.newScheduleDateEnd());
    } else if (field === 'editingRange') {
      dateStr = this.editingScheduleDateStart();
      this.tempDateStart.set(this.editingScheduleDateStart());
      this.tempDateEnd.set(this.editingScheduleDateEnd());
    }
    this.isSelectingRange.set(false);

    // Ajustar rango temporal si es inválido para la frecuencia activa al abrir el calendario
    const freq = field === 'editingRange' ? this.editingScheduleFrequency() : this.newScheduleFrequency();
    const tStart = this.tempDateStart();
    const tEnd = this.tempDateEnd();
    if (tStart && tEnd) {
      const startDate = new Date(tStart);
      const endDate = new Date(tEnd);
      const diffTime = endDate.getTime() - startDate.getTime();
      const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
      
      const pad = (num: number) => num.toString().padStart(2, '0');
      const formatDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
      
      if (freq === 'diario' && diffDays !== 1) {
        this.tempDateEnd.set(tStart);
      } else if (freq === 'semanal' && diffDays > 7) {
        const adjustedEnd = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000);
        this.tempDateEnd.set(formatDate(adjustedEnd));
      } else if (freq === 'mensual') {
        const daysInEndMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 0)).getUTCDate();
        if (diffDays > daysInEndMonth) {
          const daysInStartMonth = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0)).getUTCDate();
          const adjustedEnd = new Date(startDate.getTime() + (daysInStartMonth - 1) * 24 * 60 * 60 * 1000);
          this.tempDateEnd.set(formatDate(adjustedEnd));
        }
      }
    }
    
    if (dateStr) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        if (!isNaN(y)) {
          this.calendarViewYear.set(y);
        }
        if (!isNaN(m) && m >= 0 && m <= 11) {
          this.calendarViewMonth.set(m);
        }
      }
    } else {
      this.calendarViewMonth.set(new Date().getMonth());
      this.calendarViewYear.set(new Date().getFullYear());
    }
    
    this.activeCalendarField.set(field);
    this.activeTimeField.set(null); // Cerrar selectores de hora
    this.activeDropdown.set(null); // Cerrar dropdowns de filtros
  }

  getActiveCalendarFrequency(): 'diario' | 'semanal' | 'mensual' {
    const field = this.activeCalendarField();
    const freq = field === 'editingRange' ? this.editingScheduleFrequency() : this.newScheduleFrequency();
    return freq || 'diario';
  }

  isCalendarSelectionValid(): boolean {
    const startStr = this.tempDateStart();
    const endStr = this.tempDateEnd();
    if (!startStr || !endStr) return false;
    
    const freq = this.getActiveCalendarFrequency();
    const dStart = new Date(startStr);
    const dEnd = new Date(endStr);
    
    if (dEnd < dStart) return false;
    
    const diffTime = dEnd.getTime() - dStart.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    if (freq === 'diario') {
      return diffDays === 1;
    } else if (freq === 'semanal') {
      return diffDays <= 7;
    } else if (freq === 'mensual') {
      const daysInEndMonth = new Date(Date.UTC(dEnd.getUTCFullYear(), dEnd.getUTCMonth() + 1, 0)).getUTCDate();
      return diffDays <= daysInEndMonth;
    }
    return true;
  }

  getCalendarValidationWarning(): string {
    const startStr = this.tempDateStart();
    const endStr = this.tempDateEnd();
    if (!startStr || !endStr) return '';
    
    const freq = this.getActiveCalendarFrequency();
    const dStart = new Date(startStr);
    const dEnd = new Date(endStr);
    
    if (dEnd < dStart) return 'La fecha de fin no puede ser anterior a la fecha de inicio.';
    
    const diffTime = dEnd.getTime() - dStart.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    if (freq === 'diario') {
      if (diffDays !== 1) {
        return 'Frecuencia diaria requiere un rango de exactamente 1 día.';
      }
    } else if (freq === 'semanal') {
      if (diffDays > 7) {
        return `Frecuencia semanal permite un rango máximo de 7 días (seleccionado: ${diffDays} días).`;
      }
    } else if (freq === 'mensual') {
      const daysInEndMonth = new Date(Date.UTC(dEnd.getUTCFullYear(), dEnd.getUTCMonth() + 1, 0)).getUTCDate();
      if (diffDays > daysInEndMonth) {
        return `Frecuencia mensual para el mes de ${this.getMonths()[dEnd.getUTCMonth()]} permite un rango máximo de ${daysInEndMonth} días (seleccionado: ${diffDays} días).`;
      }
    }
    return '';
  }

  adjustRangeOnFrequencyChange(type: 'new' | 'editing', freq: 'diario' | 'semanal' | 'mensual'): void {
    const dStart = type === 'new' ? this.newScheduleDateStart() : this.editingScheduleDateStart();
    const dEnd = type === 'new' ? this.newScheduleDateEnd() : this.editingScheduleDateEnd();
    
    if (!dStart || !dEnd) return;
    
    const startDate = new Date(dStart);
    const endDate = new Date(dEnd);
    
    const diffTime = endDate.getTime() - startDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const formatDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    
    if (freq === 'diario') {
      if (diffDays !== 1) {
        if (type === 'new') {
          this.newScheduleDateEnd.set(dStart);
        } else {
          this.editingScheduleDateEnd.set(dStart);
        }
      }
    } else if (freq === 'semanal') {
      if (diffDays > 7) {
        const adjustedEnd = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000);
        if (type === 'new') {
          this.newScheduleDateEnd.set(formatDate(adjustedEnd));
        } else {
          this.editingScheduleDateEnd.set(formatDate(adjustedEnd));
        }
      }
    } else if (freq === 'mensual') {
      const daysInEndMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 0)).getUTCDate();
      if (diffDays > daysInEndMonth) {
        const daysInStartMonth = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0)).getUTCDate();
        const adjustedEnd = new Date(startDate.getTime() + (daysInStartMonth - 1) * 24 * 60 * 60 * 1000);
        if (type === 'new') {
          this.newScheduleDateEnd.set(formatDate(adjustedEnd));
        } else {
          this.editingScheduleDateEnd.set(formatDate(adjustedEnd));
        }
      }
    }
  }

  adjustTempRangeOnFrequencyChange(freq: 'diario' | 'semanal' | 'mensual'): void {
    const tStart = this.tempDateStart();
    const tEnd = this.tempDateEnd();
    if (!tStart || !tEnd) return;
    
    const startDate = new Date(tStart);
    const endDate = new Date(tEnd);
    
    const diffTime = endDate.getTime() - startDate.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const formatDate = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    
    if (freq === 'diario') {
      if (diffDays !== 1) {
        this.tempDateEnd.set(tStart);
        this.isSelectingRange.set(false);
      }
    } else if (freq === 'semanal') {
      if (diffDays > 7) {
        const adjustedEnd = new Date(startDate.getTime() + 6 * 24 * 60 * 60 * 1000);
        this.tempDateEnd.set(formatDate(adjustedEnd));
        this.isSelectingRange.set(false);
      }
    } else if (freq === 'mensual') {
      const daysInEndMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1, 0)).getUTCDate();
      if (diffDays > daysInEndMonth) {
        const daysInStartMonth = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0)).getUTCDate();
        const adjustedEnd = new Date(startDate.getTime() + (daysInStartMonth - 1) * 24 * 60 * 60 * 1000);
        this.tempDateEnd.set(formatDate(adjustedEnd));
        this.isSelectingRange.set(false);
      }
    }
  }

  onNewScheduleFrequencyChange(freq: 'diario' | 'semanal' | 'mensual'): void {
    this.newScheduleFrequency.set(freq);
    this.adjustRangeOnFrequencyChange('new', freq);
    if (this.activeCalendarField() === 'newRange') {
      this.adjustTempRangeOnFrequencyChange(freq);
    }
  }

  onEditingScheduleFrequencyChange(freq: 'diario' | 'semanal' | 'mensual'): void {
    this.editingScheduleFrequency.set(freq);
    this.adjustRangeOnFrequencyChange('editing', freq);
    if (this.activeCalendarField() === 'editingRange') {
      this.adjustTempRangeOnFrequencyChange(freq);
    }
  }

  selectCalendarDay(day: number): void {
    const field = this.activeCalendarField();
    if (!field) return;
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const dateStr = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    const freq = this.getActiveCalendarFrequency();
    
    if (freq === 'diario') {
      this.tempDateStart.set(dateStr);
      this.tempDateEnd.set(dateStr);
      this.isSelectingRange.set(false);
      this.applyCalendarSelection();
      return;
    }
    
    if (!this.isSelectingRange()) {
      this.tempDateStart.set(dateStr);
      this.tempDateEnd.set(dateStr);
      this.isSelectingRange.set(true);
    } else {
      const startVal = this.tempDateStart();
      if (startVal) {
        const startTime = new Date(startVal).getTime();
        const clickedTime = new Date(dateStr).getTime();
        if (clickedTime < startTime) {
          this.tempDateStart.set(dateStr);
          this.tempDateEnd.set(startVal);
        } else {
          this.tempDateEnd.set(dateStr);
        }
      } else {
        this.tempDateStart.set(dateStr);
        this.tempDateEnd.set(dateStr);
      }
      this.isSelectingRange.set(false);
    }
  }

  clearCalendarSelection(): void {
    this.tempDateStart.set('');
    this.tempDateEnd.set('');
    this.isSelectingRange.set(false);
  }

  applyCalendarSelection(): void {
    const field = this.activeCalendarField();
    if (!field) return;
    
    if (field === 'newRange') {
      this.newScheduleDateStart.set(this.tempDateStart());
      this.newScheduleDateEnd.set(this.tempDateEnd());
    } else if (field === 'editingRange') {
      this.editingScheduleDateStart.set(this.tempDateStart());
      this.editingScheduleDateEnd.set(this.tempDateEnd());
    }
    this.activeCalendarField.set(null);
  }

  isPrevCalendarMonthDisabled(): boolean {
    const now = this.currentTime();
    const startOfWeek = this.getStartOfCurrentWeekUTC(now);
    const minYear = startOfWeek.getUTCFullYear();
    const minMonth = startOfWeek.getUTCMonth();
    
    const currentYear = this.calendarViewYear();
    const currentMonth = this.calendarViewMonth();
    
    if (currentYear < minYear) return true;
    if (currentYear === minYear && currentMonth <= minMonth) return true;
    return false;
  }

  prevCalendarMonth(event: Event): void {
    event.stopPropagation();
    if (this.isPrevCalendarMonthDisabled()) {
      return;
    }
    if (this.calendarViewMonth() > 0) {
      this.calendarViewMonth.update(m => m - 1);
    } else {
      this.calendarViewMonth.set(11);
      this.calendarViewYear.update(y => y - 1);
    }
  }

  nextCalendarMonth(event: Event): void {
    event.stopPropagation();
    if (this.calendarViewMonth() < 11) {
      this.calendarViewMonth.update(m => m + 1);
    } else {
      this.calendarViewMonth.set(0);
      this.calendarViewYear.update(y => y + 1);
    }
  }

  isCalendarDateSelected(day: number): boolean {
    const field = this.activeCalendarField();
    if (!field) return false;
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const target = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    
    return this.tempDateStart() === target || this.tempDateEnd() === target;
  }

  isCalendarDateInRange(day: number): boolean {
    const field = this.activeCalendarField();
    if (!field) return false;
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const targetStr = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    const targetTime = new Date(targetStr).getTime();
    
    const startStr = this.tempDateStart();
    const endStr = this.tempDateEnd();
    if (!startStr || !endStr || startStr === endStr) return false;
    const startTime = new Date(startStr).getTime();
    const endTime = new Date(endStr).getTime();
    return targetTime > startTime && targetTime < endTime;
  }

  getStartOfCurrentWeekUTC(referenceDate: Date): Date {
    const today = new Date(Date.UTC(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate()));
    const day = today.getUTCDay(); // 0 = Domingo, 1 = Lunes, etc.
    const daysToSubtract = day === 0 ? 6 : day - 1;
    return new Date(today.getTime() - daysToSubtract * 24 * 60 * 60 * 1000);
  }

  isCalendarDayDisabled(day: number): boolean {
    const field = this.activeCalendarField();
    if (!field) return false;
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const targetStr = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    const dTarget = new Date(targetStr);
    
    // 1. Evitar mostrar/seleccionar fechas anteriores a la semana actual
    const now = this.currentTime();
    const startOfWeek = this.getStartOfCurrentWeekUTC(now);
    if (dTarget < startOfWeek) {
      return true;
    }
    
    // 2. Si ya se comenzó la selección de un rango, limitar las opciones al máximo permitido
    if (this.isSelectingRange()) {
      const startStr = this.tempDateStart();
      if (startStr) {
        const dStart = new Date(startStr);
        if (dTarget < dStart) {
          return true; // No permitir seleccionar hacia atrás
        }
        
        const diffTime = dTarget.getTime() - dStart.getTime();
        const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
        const freq = this.getActiveCalendarFrequency();
        
        if (freq === 'diario') {
          return diffDays > 1;
        } else if (freq === 'semanal') {
          return diffDays > 7;
        } else if (freq === 'mensual') {
          const daysInEndMonth = new Date(Date.UTC(dTarget.getUTCFullYear(), dTarget.getUTCMonth() + 1, 0)).getUTCDate();
          return diffDays > daysInEndMonth;
        }
      }
    }
    
    return false;
  }

  formatDateLabel(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const date = new Date(year, month, day);
    
    const formatter = new Intl.DateTimeFormat('es-ES', {
      weekday: 'short',
      day: 'numeric',
      month: 'long'
    });
    return formatter.format(date);
  }

  // Métodos del Selector de Hora Customizado
  getTimeParts(timeStr: string): { hour: number; minute: number } {
    if (!timeStr) return { hour: 0, minute: 0 };
    const parts = timeStr.split(':');
    if (parts.length < 2) return { hour: 0, minute: 0 };
    return {
      hour: parseInt(parts[0], 10) || 0,
      minute: parseInt(parts[1], 10) || 0
    };
  }

  isTimeHourSelected(h: number): boolean {
    const field = this.activeTimeField();
    if (!field) return false;
    let timeStr = '';
    if (field === 'newStart') timeStr = this.newScheduleTimeStart();
    else if (field === 'newEnd') timeStr = this.newScheduleTimeEnd();
    else if (field === 'editingStart') timeStr = this.editingScheduleTimeStart();
    else if (field === 'editingEnd') timeStr = this.editingScheduleTimeEnd();
    
    return this.getTimeParts(timeStr).hour === h;
  }

  isTimeMinuteSelected(m: number): boolean {
    const field = this.activeTimeField();
    if (!field) return false;
    let timeStr = '';
    if (field === 'newStart') timeStr = this.newScheduleTimeStart();
    else if (field === 'newEnd') timeStr = this.newScheduleTimeEnd();
    else if (field === 'editingStart') timeStr = this.editingScheduleTimeStart();
    else if (field === 'editingEnd') timeStr = this.editingScheduleTimeEnd();
    
    return this.getTimeParts(timeStr).minute === m;
  }

  selectTimeHour(h: number): void {
    const field = this.activeTimeField();
    if (!field) return;
    
    let timeStr = '';
    if (field === 'newStart') timeStr = this.newScheduleTimeStart();
    else if (field === 'newEnd') timeStr = this.newScheduleTimeEnd();
    else if (field === 'editingStart') timeStr = this.editingScheduleTimeStart();
    else if (field === 'editingEnd') timeStr = this.editingScheduleTimeEnd();
    
    const parts = this.getTimeParts(timeStr);
    const pad = (num: number) => num.toString().padStart(2, '0');
    const newTimeStr = `${pad(h)}:${pad(parts.minute)}`;
    
    if (field === 'newStart') this.newScheduleTimeStart.set(newTimeStr);
    else if (field === 'newEnd') this.newScheduleTimeEnd.set(newTimeStr);
    else if (field === 'editingStart') this.editingScheduleTimeStart.set(newTimeStr);
    else if (field === 'editingEnd') this.editingScheduleTimeEnd.set(newTimeStr);
  }

  selectTimeMinute(m: number): void {
    const field = this.activeTimeField();
    if (!field) return;
    
    let timeStr = '';
    if (field === 'newStart') timeStr = this.newScheduleTimeStart();
    else if (field === 'newEnd') timeStr = this.newScheduleTimeEnd();
    else if (field === 'editingStart') timeStr = this.editingScheduleTimeStart();
    else if (field === 'editingEnd') timeStr = this.editingScheduleTimeEnd();
    
    const parts = this.getTimeParts(timeStr);
    const pad = (num: number) => num.toString().padStart(2, '0');
    const newTimeStr = `${pad(parts.hour)}:${pad(m)}`;
    
    if (field === 'newStart') this.newScheduleTimeStart.set(newTimeStr);
    else if (field === 'newEnd') this.newScheduleTimeEnd.set(newTimeStr);
    else if (field === 'editingStart') this.editingScheduleTimeStart.set(newTimeStr);
    else if (field === 'editingEnd') this.editingScheduleTimeEnd.set(newTimeStr);
  }

  openTimePicker(field: 'newStart' | 'newEnd' | 'editingStart' | 'editingEnd', event: Event): void {
    event.stopPropagation();
    
    if (this.activeTimeField() === field) {
      this.activeTimeField.set(null);
      return;
    }
    
    this.activeTimeField.set(field);
    this.activeCalendarField.set(null); // Cerrar calendario
    this.activeDropdown.set(null); // Cerrar dropdowns
  }

  toggleCreateForm(): void {
    this.showCreateForm.update(v => !v);
  }

  toggleNewScheduleAnalytic(analyticId: string): void {
    const current = this.newScheduleSelectedAnalyticIds();
    if (current.includes(analyticId)) {
      this.newScheduleSelectedAnalyticIds.set(current.filter(id => id !== analyticId));
    } else {
      this.newScheduleSelectedAnalyticIds.set([...current, analyticId]);
    }
  }

  toggleEditingScheduleAnalytic(analyticId: string): void {
    const current = this.editingScheduleSelectedAnalyticIds();
    if (current.includes(analyticId)) {
      this.editingScheduleSelectedAnalyticIds.set(current.filter(id => id !== analyticId));
    } else {
      this.editingScheduleSelectedAnalyticIds.set([...current, analyticId]);
    }
  }

  createSchedule(): void {
    if (!this.newScheduleName().trim() || !this.hostId()) return;

    const payload = {
      nombre: this.newScheduleName(),
      fingerprint_host: this.hostId(),
      analytics_ids: this.newScheduleSelectedAnalyticIds().map(id => ({ id_analytic: id })),
      timestamp_inicio: new Date(`${this.newScheduleDateStart()}T${this.newScheduleTimeStart()}:00`).toISOString(),
      timestamp_fin: new Date(`${this.newScheduleDateEnd()}T${this.newScheduleTimeEnd()}:00`).toISOString(),
      frecuencia: this.newScheduleFrequency(),
      estado: 'activo'
    };

    this.scheduleService.registerSchedule(payload).subscribe({
      next: () => {
        this.newScheduleName.set('');
        this.newScheduleDateStart.set('');
        this.newScheduleTimeStart.set('');
        this.newScheduleDateEnd.set('');
        this.newScheduleTimeEnd.set('');
        this.newScheduleSelectedAnalyticIds.set([]);
        this.newScheduleFrequency.set('');
        this.showCreateForm.set(false);
        // Recargar horarios del nodo
        this.scheduleService.getSchedulesByHost(this.hostId()!).subscribe();
      },
      error: (err) => {
        console.error('[CamarasComponent] createSchedule failed:', err);
      }
    });
  }

  openDeleteScheduleModal(schedule: Schedule): void {
    this.scheduleToDelete.set(schedule);
    this.showDeleteScheduleModal.set(true);
  }

  closeDeleteScheduleModal(): void {
    this.scheduleToDelete.set(null);
    this.showDeleteScheduleModal.set(false);
  }

  confirmDeleteSchedule(): void {
    const sched = this.scheduleToDelete();
    if (!sched) return;

    this.isDeletingSchedule.set(true);
    this.scheduleService.deleteSchedule(sched.id).subscribe({
      next: () => {
        this.isDeletingSchedule.set(false);
        this.closeDeleteScheduleModal();
        if (this.hostId()) {
          this.scheduleService.getSchedulesByHost(this.hostId()!).subscribe();
        }
      },
      error: () => {
        this.isDeletingSchedule.set(false);
        this.closeDeleteScheduleModal();
        if (this.hostId()) {
          this.scheduleService.getSchedulesByHost(this.hostId()!).subscribe();
        }
      }
    });
  }

  startEditSchedule(schedule: Schedule): void {
    this.editingScheduleId.set(schedule.id);
    this.editingScheduleName.set(schedule.name);
    this.editingScheduleDateStart.set(getDateString(schedule.start));
    this.editingScheduleTimeStart.set(getTimeString(schedule.start));
    this.editingScheduleDateEnd.set(getDateString(schedule.end));
    this.editingScheduleTimeEnd.set(getTimeString(schedule.end));
    this.editingScheduleFrequency.set(schedule.frequency as any);
    this.editingScheduleSelectedAnalyticIds.set([...schedule.analyticIds]);
  }

  cancelEditSchedule(): void {
    this.editingScheduleId.set(null);
  }

  saveScheduleEdit(): void {
    if (!this.editingScheduleId() || !this.editingScheduleName().trim() || !this.hostId()) return;

    const scheduleId = this.editingScheduleId()!;
    const payload = {
      nombre: this.editingScheduleName(),
      fingerprint_host: this.hostId(),
      analytics_ids: this.editingScheduleSelectedAnalyticIds().map(id => ({ id_analytic: id })),
      timestamp_inicio: new Date(`${this.editingScheduleDateStart()}T${this.editingScheduleTimeStart()}:00`).toISOString(),
      timestamp_fin: new Date(`${this.editingScheduleDateEnd()}T${this.editingScheduleTimeEnd()}:00`).toISOString(),
      frecuencia: this.editingScheduleFrequency(),
      estado: 'activo'
    };

    this.scheduleService.updateSchedule(scheduleId, payload).subscribe({
      next: () => {
        this.editingScheduleId.set(null);
        this.scheduleService.getSchedulesByHost(this.hostId()!).subscribe();
      },
      error: (err) => {
        console.error('[CamarasComponent] saveScheduleEdit failed:', err);
      }
    });
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
}
