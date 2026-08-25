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
import { ListService } from '../../../core/services/list.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { copyToClipboard } from '../../../core/utils/clipboard.util';
import { getCameraEffectiveStatus, getCameraStatusCssClass, getCameraStatusFilterLabel } from '../../../core/utils/camera-status.utils';
import { Schedule } from '../../../core/domain/entities/schedule.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { Camera } from '../../../core/domain/entities/camera.models';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { ConfirmDeleteModalComponent } from '../../shared/confirm-delete-modal/confirm-delete-modal.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { PaginationControlsComponent } from '../../shared/pagination-controls/pagination-controls.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { SearchInputComponent } from '../../shared/search-input/search-input.component';
import { ViewModeToggleComponent } from '../../shared/view-mode-toggle/view-mode-toggle.component';
import { CameraDetailDrawerComponent } from '../../shared/camera-detail-drawer/camera-detail-drawer.component';
import { FilterActionsComponent } from '../../shared/filter-actions/filter-actions.component';
import { CustomSelectComponent } from '../../shared/custom-select/custom-select.component';
import { exportToCsv, exportToXlsx, ExportColumn } from '../../../core/utils/export-utils';

@Component({
  selector: 'app-camaras',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, ReactiveFormsModule, ConfirmDeleteModalComponent, EmptyStateComponent, PaginationControlsComponent, PageHeaderComponent, SearchInputComponent, ViewModeToggleComponent, CameraDetailDrawerComponent, FilterActionsComponent, CustomSelectComponent],
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
  private listService = inject(ListService);
  public permissionsService = inject(PermissionsService);

  @ViewChild('camerasContainer', { static: false }) camerasContainer!: ElementRef<HTMLDivElement>;

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
  readonly sortBy = signal<'name' | 'host'>('name');
  readonly sortDirection = signal<'asc' | 'desc'>('asc');

  toggleSortDirection(): void {
    this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
  }

  setSortBy(column: 'name' | 'host'): void {
    if (this.sortBy() === column) {
      this.toggleSortDirection();
    } else {
      this.sortBy.set(column);
      this.sortDirection.set('asc');
    }
  }

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

  readonly isFingerprintCopied = signal<boolean>(false);

  copyFingerprint(): void {
    const fingerprint = this.hostId();
    if (fingerprint) {
      copyToClipboard(fingerprint)
        .then(() => {
          this.isFingerprintCopied.set(true);
          setTimeout(() => this.isFingerprintCopied.set(false), 2000);
        })
        .catch(err => console.error('Error copying to clipboard', err));
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
  // ── Advanced Filters state (Multi-select) ──
  readonly filterStatus = signal<string[]>([]);
  readonly filterHost = signal<string[]>([]);
  readonly filterStreamType = signal<string[]>([]);
  readonly filterDecoder = signal<string[]>([]);
  readonly filterAnalyticType = signal<string[]>([]);

  // Temp copies shown in the pills (committed on "Aplicar")
  readonly tempFilterStatus = signal<string[]>([]);
  readonly tempFilterHost = signal<string[]>([]);
  readonly tempFilterStreamType = signal<string[]>([]);
  readonly tempFilterDecoder = signal<string[]>([]);
  readonly tempFilterAnalyticType = signal<string[]>([]);

  private _arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, index) => val === sortedB[index]);
  }

  readonly hasPendingFilterChanges = computed<boolean>(() => {
    return !this._arraysEqual(this.tempFilterStatus(), this.filterStatus()) ||
      !this._arraysEqual(this.tempFilterHost(), this.filterHost()) ||
      !this._arraysEqual(this.tempFilterStreamType(), this.filterStreamType()) ||
      !this._arraysEqual(this.tempFilterDecoder(), this.filterDecoder()) ||
      !this._arraysEqual(this.tempFilterAnalyticType(), this.filterAnalyticType());
  });

  readonly showFilterPanel = signal<boolean>(false);
  readonly activeDropdown = signal<string | null>(null);
  readonly showExportDropdown = signal<boolean>(false);
  readonly hostSearch = signal<string>('');

  // ── Control de Visibilidad de Columnas de Tabla ──────────────────────────
  readonly columnVisibility = signal<{ stream: boolean; decoder: boolean; coords: boolean }>({
    stream: true,
    decoder: true,
    coords: true
  });

  isColumnVisible(column: 'stream' | 'decoder' | 'coords'): boolean {
    return this.columnVisibility()[column];
  }

  readonly hasHiddenColumns = computed<boolean>(() => {
    const v = this.columnVisibility();
    return !v.stream || !v.decoder || !v.coords;
  });

  readonly hiddenColumnsList = computed<{ key: 'stream' | 'decoder' | 'coords'; label: string }[]>(() => {
    const v = this.columnVisibility();
    const list: { key: 'stream' | 'decoder' | 'coords'; label: string }[] = [];
    if (!v.stream) list.push({ key: 'stream', label: 'Stream' });
    if (!v.decoder) list.push({ key: 'decoder', label: 'Decodificador' });
    if (!v.coords) list.push({ key: 'coords', label: 'Coordenadas' });
    return list;
  });

  hideColumn(column: 'stream' | 'decoder' | 'coords', event?: Event): void {
    event?.stopPropagation();
    this.columnVisibility.update(v => ({ ...v, [column]: false }));
    this.saveColumnVisibilityToStorage();
  }

  showColumn(column: 'stream' | 'decoder' | 'coords', event?: Event): void {
    event?.stopPropagation();
    this.columnVisibility.update(v => ({ ...v, [column]: true }));
    this.saveColumnVisibilityToStorage();
    if (this.hiddenColumnsList().length === 0) {
      this.activeDropdown.set(null);
    }
  }

  showAllColumns(event?: Event): void {
    event?.stopPropagation();
    this.columnVisibility.set({ stream: true, decoder: true, coords: true });
    this.saveColumnVisibilityToStorage();
    this.activeDropdown.set(null);
  }

  private loadColumnVisibilityFromStorage(): void {
    try {
      const saved = localStorage.getItem('camaras_table_columns');
      if (saved) {
        const parsed = JSON.parse(saved);
        this.columnVisibility.set({
          stream: parsed.stream !== false,
          decoder: parsed.decoder !== false,
          coords: parsed.coords !== false
        });
      }
    } catch {
      // Ignore storage read error
    }
  }

  private saveColumnVisibilityToStorage(): void {
    try {
      localStorage.setItem('camaras_table_columns', JSON.stringify(this.columnVisibility()));
    } catch {
      // Ignore storage write error
    }
  }

  readonly filteredHostOptions = computed(() => {
    const query = this.hostSearch().trim().toLowerCase();
    const allHosts = this.filterOptions().hosts;
    if (!query) return allHosts;
    return allHosts.filter(h =>
      h.name.toLowerCase().includes(query) ||
      h.fingerprint.toLowerCase().includes(query)
    );
  });

  // Opciones de filtro dinámicas (construidas a partir de las cámaras y analíticas cargadas)
  readonly filterOptions = computed(() => {
    const list = this.hostId()
      ? this.cameras().filter(c => c.hostFingerprint === this.hostId())
      : this.cameras();
    const hosts = this.hostService.allHosts();
    const statuses = new Set<string>();
    const streams = new Set<string>();
    const decoders = new Set<string>();
    const hostsSet = new Set<string>();

    const statusCounts: Record<string, number> = {};
    list.forEach(c => {
      const effStatus = getCameraEffectiveStatus(c, hosts);
      statuses.add(effStatus);
      statusCounts[effStatus] = (statusCounts[effStatus] || 0) + 1;
      if (c.streamType) streams.add(c.streamType);
      if (c.decoder) decoders.add(c.decoder);
      if (c.hostFingerprint) hostsSet.add(c.hostFingerprint);
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

    const hostOptions = Array.from(hostsSet).map(fp => ({
      fingerprint: fp,
      name: this.getHostName(fp)
    })).sort((a, b) => a.name.localeCompare(b.name));

    const statusOrder = ['Online', 'Degraded', 'Recovering', 'Pending', 'Offline'];
    const sortedStatuses = Array.from(statuses).sort((a, b) => {
      const idxA = statusOrder.indexOf(a);
      const idxB = statusOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    return {
      status: sortedStatuses,
      statusCounts: statusCounts,
      totalCount: list.length,
      hosts: hostOptions,
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
    const hFp = this.filterHost();
    const stream = this.filterStreamType();
    const dec = this.filterDecoder();
    const analyticType = this.filterAnalyticType();

    const filtered = list.filter(c => {
      if (this.hostId() && c.hostFingerprint !== this.hostId()) return false;
      if (!this.hostId() && hFp.length > 0 && !hFp.includes(c.hostFingerprint)) return false;

      // Search by camera name (1st priority), camera ID (2nd priority), and NX ID (3rd priority)
      if (term) {
        const matchesName = c.name.toLowerCase().includes(term);
        const matchesId = c.id.toLowerCase().includes(term);
        const matchesNxId = !!(c.nxId && c.nxId.toLowerCase().includes(term));
        if (!matchesName && !matchesId && !matchesNxId) return false;
      }

      // Filter by status (Basado exclusivamente en el estado efectivo visual de la cámara)
      if (st.length > 0) {
        const effStatus = getCameraEffectiveStatus(c, this.hostService.allHosts());
        const effLower = effStatus.toLowerCase();
        const matchesStatus = st.some(s => {
          const sLower = s.toLowerCase();
          if (sLower === 'active' || sLower === 'online') return effLower === 'online';
          if (sLower === 'inactive' || sLower === 'offline') return effLower === 'offline';
          return effLower === sLower;
        });
        if (!matchesStatus) return false;
      }

      // Filter by stream type
      if (stream.length > 0) {
        if (!stream.some(s => s.toLowerCase() === c.streamType.toLowerCase())) return false;
      }

      // Filter by decoder type
      if (dec.length > 0) {
        if (!dec.some(d => d.toLowerCase() === c.decoder.toLowerCase())) return false;
      }

      // Filter by analytic type
      if (analyticType.length > 0) {
        const cameraAnalytics = this.getAnalyticsForCamera(c.id);
        const hasAnyAnalytic = cameraAnalytics.some(a =>
          analyticType.some(at => this.normalizeAnalyticType(a.type) === this.normalizeAnalyticType(at))
        );
        if (!hasAnyAnalytic) return false;
      }

      return true;
    });

    const dir = this.sortDirection();
    const activeSortBy = this.viewMode() === 'cards' ? 'name' : this.sortBy();

    // Ordenamiento por Nombre de cámara o Nodo (ascendente o descendente)
    // Se excluye la ordenación por estado para evitar que las cámaras salten de posición al reconectarse/desconectarse
    return filtered.sort((a, b) => {
      if (term) {
        const getSearchPriority = (cam: Camera): number => {
          if (cam.name.toLowerCase().includes(term)) return 3; // 1ra prioridad: Nombre
          if (cam.id.toLowerCase().includes(term)) return 2;   // 2da prioridad: ID Cámara
          if (cam.nxId && cam.nxId.toLowerCase().includes(term)) return 1; // 3ra prioridad: NX ID
          return 0;
        };

        const prioA = getSearchPriority(a);
        const prioB = getSearchPriority(b);
        if (prioB !== prioA) {
          return prioB - prioA;
        }
      }

      if (activeSortBy === 'host') {
        const hostA = this.getHostName(a.hostFingerprint);
        const hostB = this.getHostName(b.hostFingerprint);
        const cmpHost = hostA.localeCompare(hostB, undefined, { numeric: true, sensitivity: 'base' });
        if (cmpHost !== 0) {
          return dir === 'asc' ? cmpHost : -cmpHost;
        }
        // Desempate por nombre de cámara
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      }

      const cmp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      return dir === 'asc' ? cmp : -cmp;
    });
  });

  // Total de analíticas filtradas reactivamente acorde a las cámaras visibles y los filtros de analítica
  readonly filteredAnalyticsCount = computed<number>(() => {
    const cameras = this.filteredCameras();
    const cameraIds = new Set(cameras.map(c => c.id));
    const analyticTypeFilter = this.filterAnalyticType();

    const filtered = this.analytics().filter(a => {
      if (this.hostId() && a.hostFingerprint !== this.hostId()) return false;
      const targetsFilteredCamera = (a.targetCameraIds || []).some(id => cameraIds.has(id));
      if (!targetsFilteredCamera) return false;

      if (analyticTypeFilter.length > 0) {
        const normalizedType = this.normalizeAnalyticType(a.type);
        const matches = analyticTypeFilter.some(at => this.normalizeAnalyticType(at) === normalizedType);
        if (!matches) {
          return false;
        }
      }
      return true;
    });

    return filtered.length;
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

  readonly totalRecords = computed(() => this.filteredCameras().length);

  readonly totalPages = computed(() => {
    const total = this.totalRecords();
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



  constructor() {
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
  }

  // ── Advanced Filters Drawer Controls ──
  hasActiveFilters(): boolean {
    return this.searchTerm().trim() !== '' ||
      this.filterStatus().length > 0 ||
      this.filterHost().length > 0 ||
      this.filterStreamType().length > 0 ||
      this.filterDecoder().length > 0 ||
      this.filterAnalyticType().length > 0;
  }

  toggleFilterPanel(): void {
    if (!this.showFilterPanel()) {
      // Sync temp copies to active values when opening
      this.tempFilterStatus.set([...this.filterStatus()]);
      this.tempFilterHost.set([...this.filterHost()]);
      this.tempFilterStreamType.set([...this.filterStreamType()]);
      this.tempFilterDecoder.set([...this.filterDecoder()]);
      this.tempFilterAnalyticType.set([...this.filterAnalyticType()]);
    }
    this.showFilterPanel.update(v => !v);
  }

  applyFilters(): void {
    this.filterStatus.set([...this.tempFilterStatus()]);
    this.filterHost.set([...this.tempFilterHost()]);
    this.filterStreamType.set([...this.tempFilterStreamType()]);
    this.filterDecoder.set([...this.tempFilterDecoder()]);
    this.filterAnalyticType.set([...this.tempFilterAnalyticType()]);
    this.currentPage.set(1);
  }

  resetFilters(): void {
    this.searchControl.setValue('');
    this.searchTerm.set('');
    this.filterStatus.set([]); this.tempFilterStatus.set([]);
    this.filterHost.set([]); this.tempFilterHost.set([]);
    this.filterStreamType.set([]); this.tempFilterStreamType.set([]);
    this.filterDecoder.set([]); this.tempFilterDecoder.set([]);
    this.filterAnalyticType.set([]); this.tempFilterAnalyticType.set([]);
    this.currentPage.set(1);
    this.activeDropdown.set(null);
  }

  toggleDropdown(dropdown: string, event: Event): void {
    event.stopPropagation();
    if (this.activeDropdown() === dropdown) {
      this.activeDropdown.set(null);
    } else {
      if (dropdown === 'host') {
        this.hostSearch.set('');
      }
      this.activeDropdown.set(dropdown);
    }
  }

  toggleFilterValue(filterName: string, value: string, event?: Event): void {
    if (event) event.stopPropagation();
    const toggleInSig = (sig: import('@angular/core').WritableSignal<string[]>) => {
      const current = sig();
      if (current.includes(value)) {
        sig.set(current.filter(v => v !== value));
      } else {
        sig.set([...current, value]);
      }
    };

    if (filterName === 'status') toggleInSig(this.tempFilterStatus);
    if (filterName === 'host') toggleInSig(this.tempFilterHost);
    if (filterName === 'streamType') toggleInSig(this.tempFilterStreamType);
    if (filterName === 'decoder') toggleInSig(this.tempFilterDecoder);
    if (filterName === 'analyticType') toggleInSig(this.tempFilterAnalyticType);
  }

  getStatusCountSummary(): number {
    const selected = this.tempFilterStatus();
    if (selected.length === 0) return this.filterOptions().totalCount;
    return selected.reduce((sum, st) => sum + (this.filterOptions().statusCounts[st] || 0), 0);
  }

  toggleExportDropdown(event: Event): void {
    event.stopPropagation();
    this.showExportDropdown.update(v => !v);
  }

  @HostListener('document:click')
  closeAllDropdowns(): void {
    this.activeDropdown.set(null);
    this.showExportDropdown.set(false);
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
    this.listService.isViewActive.set(true);

    const savedMode = localStorage.getItem('camaras_view_mode') as 'cards' | 'list';
    if (savedMode) this.viewMode.set(savedMode);

    this.loadColumnVisibilityFromStorage();

    const fingerprint = this.route.snapshot.paramMap.get('hostId');
    this.hostId.set(fingerprint);

    // Cargar la lista global de hosts para obtener la licencia
    this.hostService.loadAllHosts().subscribe();

    // Cargar listas de control globales para resolución inmediata de nombres en analíticas
    this.listService.loadLists().subscribe();

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

    // Reloj para actualizar la señal de tiempo actual cada segundo
    this.timerId = setInterval(() => {
      this.currentTime.set(new Date());
    }, 1000);
  }

  ngAfterViewInit(): void {
    this.resizeSubscription = this.resizeSubject.pipe(
      debounceTime(150)
    ).subscribe(width => {
      this.adjustColumnsAndLimit(width);
    });

    if (typeof ResizeObserver !== 'undefined' && this.camerasContainer) {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          this.resizeSubject.next(entry.contentRect.width);
        }
      });
      this.resizeObserver.observe(this.camerasContainer.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.cameraService.isViewActive.set(false);
    this.analyticService.isViewActive.set(false);
    this.scheduleService.isViewActive.set(false);
    this.hostService.isViewActive.set(false);
    this.listService.isViewActive.set(false);

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
      const currentLimit = this.limit();
      let multiplier = Math.round(currentLimit / oldCols);
      if (multiplier !== 10 && multiplier !== 20 && multiplier !== 30) {
        multiplier = 10;
      }
      this.columns.set(newCols);
      this.limit.set(newCols * multiplier);
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

  onLimitValueChange(val: any): void {
    const newLimit = parseInt(val, 10);
    if (!isNaN(newLimit)) {
      this.limit.set(newLimit);
      this.currentPage.set(1);
    }
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
    if (!fingerprint) return 'SIN NODO';
    const fpLower = fingerprint.trim().toLowerCase();
    const hosts = this.hostService.allHosts();
    const host = hosts.find(h =>
      (h.fingerprint && h.fingerprint.trim().toLowerCase() === fpLower) ||
      (h.id && h.id.trim().toLowerCase() === fpLower) ||
      (h.hostname && h.hostname.trim().toLowerCase() === fpLower)
    );
    if (host && host.hostname && host.hostname.trim() !== '') {
      return host.hostname;
    }
    if (hosts.length === 1 && hosts[0].hostname && hosts[0].hostname.trim() !== '') {
      return hosts[0].hostname;
    }
    return 'SIN NODO';
  }

  getHostIp(fingerprint: string): string {
    if (!fingerprint) return '-';
    const fpLower = fingerprint.trim().toLowerCase();
    const hosts = this.hostService.allHosts();
    const host = hosts.find(h =>
      (h.fingerprint && h.fingerprint.trim().toLowerCase() === fpLower) ||
      (h.id && h.id.trim().toLowerCase() === fpLower) ||
      (h.hostname && h.hostname.trim().toLowerCase() === fpLower)
    );
    if (host && host.ipAddress && host.ipAddress.trim() !== '') {
      return host.ipAddress;
    }
    if (hosts.length === 1 && hosts[0].ipAddress && hosts[0].ipAddress.trim() !== '') {
      return hosts[0].ipAddress;
    }
    return '-';
  }

  isCameraOnline(camera: Camera | null | undefined): boolean {
    const status = getCameraEffectiveStatus(camera, this.hostService.allHosts());
    return status === 'Online';
  }

  getCameraStatusClass(camera: Camera | null | undefined): string {
    const status = getCameraEffectiveStatus(camera, this.hostService.allHosts());
    return getCameraStatusCssClass(status);
  }

  getCameraStatusLabel(camera: Camera | null | undefined): string {
    return getCameraEffectiveStatus(camera, this.hostService.allHosts());
  }

  getStatusFilterLabel(status: string): string {
    return getCameraStatusFilterLabel(status);
  }

  getStatusCssClass(status: string): string {
    const stLower = status.trim().toLowerCase();
    if (stLower === 'online' || stLower === 'active' || stLower === 'activo') return 'online';
    if (stLower === 'degraded' || stLower === 'degradado') return 'degraded';
    if (stLower === 'recovering' || stLower === 'recuperando') return 'recovering';
    if (stLower === 'pending' || stLower === 'pendiente') return 'pending';
    return 'offline';
  }

  isStatusSelected(tempStatus: string, statusOpt: string): boolean {
    if (tempStatus === statusOpt) return true;
    const tempLower = tempStatus.toLowerCase();
    const optLower = statusOpt.toLowerCase();
    if ((tempLower === 'active' || tempLower === 'online') && (optLower === 'active' || optLower === 'online')) return true;
    if ((tempLower === 'inactive' || tempLower === 'offline') && (optLower === 'inactive' || optLower === 'offline')) return true;
    return tempLower === optLower;
  }

  /** Retorna la cantidad de cámaras correspondientes al estado dado */
  getStatusCount(status: string): number {
    const opts = this.filterOptions();
    if (!status || status === 'all') {
      return opts.totalCount || 0;
    }
    const counts = opts.statusCounts || {};
    if (counts[status] !== undefined) {
      return counts[status];
    }
    const stLower = status.toLowerCase();
    for (const [key, val] of Object.entries(counts)) {
      const keyLower = key.toLowerCase();
      if (this.isStatusSelected(stLower, keyLower)) {
        return val;
      }
    }
    return 0;
  }

  // ── Analíticas ──────────────────────────────────────────────────────────────

  /** Retorna las analíticas de IA asignadas a una cámara específica */
  getAnalyticsForCamera(cameraId: string): Analytic[] {
    return this.analytics().filter(a => (!this.hostId() || a.hostFingerprint === this.hostId()) && a.targetCameraIds.includes(cameraId));
  }

  /** Retorna el texto formateado de clases o nombre de lista de control de la analítica */
  getAnalyticClassesLabel(analytic: Analytic): string | null {
    if (!analytic) return null;

    if (analytic.detectionClasses && analytic.detectionClasses.length > 0) {
      return analytic.detectionClasses.join(', ');
    }

    // Fallback retrocompatible para analíticas antiguas con list_id en parameters
    const params = analytic.parameters || {};
    const listId = params['list_id'] || params['listId'] || params['id_lista'] || params['lista_id'];
    if (listId) {
      const allLists = this.listService.lists();
      const foundList = allLists.find(l => String(l.list_id) === String(listId));
      if (foundList && foundList.name) {
        return foundList.name;
      }
    }

    const directName = params['list_name'] || params['listName'] || params['nombre_lista'];
    if (directName && String(directName).trim()) {
      return String(directName).trim();
    }

    return null;
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

    // El backend espera el formato DD/MM/YYYY HH:mm en hora local del servidor
    const formatPayloadDate = (d: Date): string => {
      const pad = (num: number) => num.toString().padStart(2, '0');
      const day = pad(d.getDate());
      const month = pad(d.getMonth() + 1);
      const year = d.getFullYear();
      const hours = pad(d.getHours());
      const minutes = pad(d.getMinutes());
      return `${day}/${month}/${year} ${hours}:${minutes}`;
    };

    const payload = {
      nombre: schedule.name,
      fingerprint_host: schedule.hostFingerprint || '',
      analytics_ids: newAnalyticIds.map(id => ({ id_analytic: id })),
      timestamp_inicio: formatPayloadDate(schedule.start),
      timestamp_fin: formatPayloadDate(schedule.end),
      frecuencia: schedule.frequency,
      estado: schedule.status
    };

    this.scheduleService.updateSchedule(schedule.id, payload).subscribe({
      next: () => {
        // Sincronizar localmente en memoria de inmediato para asegurar respuesta instantánea
        const updatedSchedule: Schedule = {
          ...schedule,
          analyticIds: newAnalyticIds
        };
        this.scheduleService.addOrUpdateScheduleLocal(updatedSchedule);
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
    return this.scheduleService.isScheduleActive(schedule, this.currentTime());
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

  // ── Exportación a Excel (XLSX) y CSV ──────────────────────────────────────────
  exportCamarasXlsx(): void {
    const columns: ExportColumn[] = [
      { header: 'Estado', key: 'status' },
      { header: 'Nombre de Cámara', key: 'name' },
      { header: 'ID Cámara', key: 'id' },
      { header: 'NX ID', key: 'nxId' },
      { header: 'Nodo', key: 'hostName' },
      { header: 'IP del Nodo', key: 'hostIp' },
      { header: 'Fingerprint Nodo', key: 'hostFingerprint' },
      { header: 'Tipo Stream', key: 'streamType' },
      { header: 'Decodificador', key: 'decoder' },
      { header: 'Latitud', key: 'lat' },
      { header: 'Longitud', key: 'lon' },
      { header: 'Analíticas Activas', key: 'analytics' }
    ];

    const data = this.filteredCameras().map(c => {
      const isOnline = this.isCameraOnline(c);
      const analytics = this.getAnalyticsForCamera(c.id).map(a => this.getAnalyticLabel(a.type)).join(', ');
      const isNxCodec = (c.decoder || '').toLowerCase().includes('nx') || (c.streamType || '').toLowerCase().includes('nx');
      return {
        status: isOnline ? 'Online' : 'Offline',
        name: c.name,
        id: c.id,
        nxId: (c.nxId && isNxCodec) ? c.nxId : 'N/A',
        hostName: this.getHostName(c.hostFingerprint),
        hostIp: this.getHostIp(c.hostFingerprint),
        hostFingerprint: c.hostFingerprint,
        streamType: c.streamType.toUpperCase(),
        decoder: c.decoder.toUpperCase(),
        lat: c.location.lat,
        lon: c.location.lon,
        analytics: analytics || 'Ninguna'
      };
    });

    const hostName = this.currentHost()?.hostname || 'nodo';
    const filename = this.hostId() ? `reporte_camaras_${hostName}.xlsx` : 'reporte_todas_las_camaras.xlsx';
    exportToXlsx(filename, 'Cámaras', columns, data);
  }

  exportCamarasCsv(): void {
    const columns: ExportColumn[] = [
      { header: 'Estado', key: 'status' },
      { header: 'Nombre de Cámara', key: 'name' },
      { header: 'ID Cámara', key: 'id' },
      { header: 'NX ID', key: 'nxId' },
      { header: 'Nodo', key: 'hostName' },
      { header: 'IP del Nodo', key: 'hostIp' },
      { header: 'Fingerprint Nodo', key: 'hostFingerprint' },
      { header: 'Tipo Stream', key: 'streamType' },
      { header: 'Decodificador', key: 'decoder' },
      { header: 'Latitud', key: 'lat' },
      { header: 'Longitud', key: 'lon' },
      { header: 'Analíticas Activas', key: 'analytics' }
    ];

    const data = this.filteredCameras().map(c => {
      const isOnline = this.isCameraOnline(c);
      const analytics = this.getAnalyticsForCamera(c.id).map(a => this.getAnalyticLabel(a.type)).join(', ');
      const isNxCodec = (c.decoder || '').toLowerCase().includes('nx') || (c.streamType || '').toLowerCase().includes('nx');
      return {
        status: isOnline ? 'Online' : 'Offline',
        name: c.name,
        id: c.id,
        nxId: (c.nxId && isNxCodec) ? c.nxId : 'N/A',
        hostName: this.getHostName(c.hostFingerprint),
        hostIp: this.getHostIp(c.hostFingerprint),
        hostFingerprint: c.hostFingerprint,
        streamType: c.streamType.toUpperCase(),
        decoder: c.decoder.toUpperCase(),
        lat: c.location.lat,
        lon: c.location.lon,
        analytics: analytics || 'Ninguna'
      };
    });

    const hostName = this.currentHost()?.hostname || 'nodo';
    const filename = this.hostId() ? `reporte_camaras_${hostName}.csv` : 'reporte_todas_las_camaras.csv';
    exportToCsv(filename, columns, data);
  }
}
