import {
  Component, inject, signal, computed,
  OnInit, OnDestroy, AfterViewInit,
  HostListener, ViewChild, ElementRef
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { Subject, Subscription, interval } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
import { HostService, HostFilterOptions } from '../../../core/services/host.service';
import { CameraService } from '../../../core/services/camera.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { Host } from '../../../core/domain/entities/host.models';
import { getCameraStatusFilterLabel } from '../../../core/utils/camera-status.utils';
import { copyToClipboard } from '../../../core/utils/clipboard.util';
import { PaginationControlsComponent } from '../../shared/pagination-controls/pagination-controls.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { SearchInputComponent } from '../../shared/search-input/search-input.component';
import { ViewModeToggleComponent } from '../../shared/view-mode-toggle/view-mode-toggle.component';
import { FilterActionsComponent } from '../../shared/filter-actions/filter-actions.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { CustomSelectComponent } from '../../shared/custom-select/custom-select.component';
import { ConfirmDeleteModalComponent } from '../../shared/confirm-delete-modal/confirm-delete-modal.component';
import { exportToCsv, exportToXlsx, ExportColumn } from '../../../core/utils/export-utils';

@Component({
  selector: 'app-nodos',
  imports: [CommonModule, ReactiveFormsModule, PaginationControlsComponent, PageHeaderComponent, SearchInputComponent, ViewModeToggleComponent, FilterActionsComponent, EmptyStateComponent, CustomSelectComponent, ConfirmDeleteModalComponent],
  templateUrl: './nodos.html',
  styleUrl: './nodos.css',
})
export class Nodos implements OnInit, AfterViewInit, OnDestroy {
  public hostService = inject(HostService);
  public cameraService = inject(CameraService);
  public permissionsService = inject(PermissionsService);
  private sidebarService = inject(SidebarService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  @ViewChild('nodosContainer', { static: false }) nodosContainer!: ElementRef<HTMLDivElement>;

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  // ── Modal de Confirmación: Eliminar Nodo ─────────────────────────────────────
  readonly showDeleteHostModal = signal<boolean>(false);
  readonly hostToDelete = signal<Host | null>(null);
  readonly isDeletingHost = signal<boolean>(false);

  openDeleteHostModal(host: Host, event?: Event): void {
    if (event) event.stopPropagation();
    this.hostToDelete.set(host);
    this.showDeleteHostModal.set(true);
  }

  closeDeleteHostModal(): void {
    this.hostToDelete.set(null);
    this.showDeleteHostModal.set(false);
  }

  confirmDeleteHost(): void {
    const host = this.hostToDelete();
    if (!host) return;

    this.isDeletingHost.set(true);
    this.hostService.deleteHost(host.fingerprint).subscribe({
      next: () => {
        this.isDeletingHost.set(false);
        this.closeDeleteHostModal();
      },
      error: (err) => {
        console.error('Error deleting host:', err);
        this.isDeletingHost.set(false);
        this.closeDeleteHostModal();
      }
    });
  }

  // ── Pagination ──────────────────────────────────────────────────────────────
  readonly columns = signal(this.getInitialColumns());
  readonly limit = signal(this.columns() * 10);
  readonly currentPage = signal(1, { equal: () => false });

  readonly limitOptions = computed(() => {
    const cols = this.columns();
    return [cols * 10, cols * 20, cols * 30];
  });

  // ── Search & filter state (Multi-select) ──
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly searchTerm = signal<string>('');

  readonly filterStatus = signal<string[]>([]);
  readonly filterOS = signal<string[]>([]);
  readonly filterArch = signal<string[]>([]);
  readonly filterGPU = signal<string[]>([]);
  readonly filterVram = signal<string[]>([]);
  readonly filterVersion = signal<string[]>([]);

  // Temp copies shown in the drawer (committed on "Aplicar")
  readonly tempFilterStatus = signal<string[]>([]);
  readonly tempFilterOS = signal<string[]>([]);
  readonly tempFilterArch = signal<string[]>([]);
  readonly tempFilterGPU = signal<string[]>([]);
  readonly tempFilterVram = signal<string[]>([]);
  readonly tempFilterVersion = signal<string[]>([]);

  private _arraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sortedA = [...a].sort();
    const sortedB = [...b].sort();
    return sortedA.every((val, index) => val === sortedB[index]);
  }

  readonly showFilterPanel = signal<boolean>(true);
  readonly activeDropdown = signal<string | null>(null);
  readonly showExportDropdown = signal<boolean>(false);

  readonly isLoading = signal<boolean>(false);
  readonly viewMode = signal<'cards' | 'list'>('cards');
  readonly sortDirection = signal<'asc' | 'desc'>('asc');

  toggleSortDirection(): void {
    this.sortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
  }

  private copiedTimeout: any;
  readonly copiedRowId = signal<string | null>(null);

  // ── Host Migration State ─────────────────────────────────────────────────────
  readonly showMigrateModal = signal<boolean>(false);
  readonly selectedOldFingerprint = signal<string>('');
  readonly selectedNewFingerprint = signal<string>('');
  readonly isMigrating = signal<boolean>(false);
  readonly isOldDropdownOpen = signal<boolean>(false);
  readonly isNewDropdownOpen = signal<boolean>(false);

  // Búsquedas en el modal
  readonly originSearchText = signal<string>('');
  readonly targetSearchText = signal<string>('');

  readonly selectedOldHost = computed(() => {
    const fp = this.selectedOldFingerprint();
    return this.hostService.allHosts().find(h => h.fingerprint === fp);
  });

  readonly selectedNewHost = computed(() => {
    const fp = this.selectedNewFingerprint();
    return this.hostService.allHosts().find(h => h.fingerprint === fp);
  });

  // Lista de origen filtrada reactivamente por nombre, fingerprint o IP
  readonly filteredOriginHosts = computed(() => {
    const term = this.originSearchText().trim().toLowerCase();
    const all = this.hostService.allHosts();
    if (!term) return all;
    return all.filter(h =>
      (h.hostname && h.hostname.toLowerCase().includes(term)) ||
      (h.fingerprint && h.fingerprint.toLowerCase().includes(term)) ||
      (h.ipAddress && h.ipAddress.toLowerCase().includes(term))
    );
  });

  // Lista de destino filtrada reactivamente excluyendo el origen seleccionado por nombre, fingerprint o IP
  readonly compatibleTargetHosts = computed(() => {
    const oldFp = this.selectedOldFingerprint();
    const term = this.targetSearchText().trim().toLowerCase();

    // Si no hay origen seleccionado, mostramos todos los hosts; de lo contrario, excluimos el origen
    const candidates = oldFp
      ? this.hostService.allHosts().filter(h => h.fingerprint !== oldFp)
      : this.hostService.allHosts();

    if (!term) return candidates;
    return candidates.filter(h =>
      (h.hostname && h.hostname.toLowerCase().includes(term)) ||
      (h.fingerprint && h.fingerprint.toLowerCase().includes(term)) ||
      (h.ipAddress && h.ipAddress.toLowerCase().includes(term))
    );
  });
  readonly allHosts = this.hostService.allHosts;

  // ── Camera Count Computation ─────────────────────────────────────────────────
  readonly cameraCountsByHost = computed<Record<string, number>>(() => {
    const cams = this.cameraService.cameras();
    const map: Record<string, number> = {};
    for (const c of cams) {
      if (c.hostFingerprint) {
        map[c.hostFingerprint] = (map[c.hostFingerprint] || 0) + 1;
      }
    }
    return map;
  });

  getCameraCount(fingerprint: string): number {
    return this.cameraCountsByHost()[fingerprint] || 0;
  }

  // ── Dynamic filter option lists (built from loaded data) ────────────────────
  readonly filterOptions = computed<HostFilterOptions>(() => this.hostService.buildFilterOptions());

  // ── Client-side filtered list ────────────────────────────────────────────────
  readonly filteredHosts = computed<Host[]>(() => {
    const all = this.hostService.allHosts();
    const term = this.searchTerm().trim().toLowerCase();
    const st = this.filterStatus();
    const os = this.filterOS();
    const arch = this.filterArch();
    const gpu = this.filterGPU();
    const vram = this.filterVram();
    const ver = this.filterVersion();

    const filtered = all.filter(h => {
      // Search by hostname, IP or fingerprint (substring matching)
      if (term) {
        const matchesHostname = h.hostname.toLowerCase().includes(term);
        const matchesIp = h.ipAddress.toLowerCase().includes(term);
        const matchesFp = h.fingerprint.toLowerCase().includes(term);
        if (!matchesHostname && !matchesIp && !matchesFp) return false;
      }
      // Status filter
      if (st.length > 0) {
        const matchesStatus = st.some(s => {
          const sLower = s.toLowerCase();
          const rawStatus = (h.status || 'offline').trim().toLowerCase();
          let hostStatus = 'offline';
          if (rawStatus === 'online' || rawStatus === 'active' || rawStatus === 'activo') hostStatus = 'online';
          else if (rawStatus === 'degraded' || rawStatus === 'degradado') hostStatus = 'degraded';
          else if (rawStatus === 'recovering' || rawStatus === 'recuperando') hostStatus = 'recovering';
          else if (rawStatus === 'pending' || rawStatus === 'pendiente') hostStatus = 'pending';
          else hostStatus = rawStatus;

          let targetStatus = sLower;
          if (sLower === 'active' || sLower === 'activo') targetStatus = 'online';
          else if (sLower === 'inactive' || sLower === 'inactivo') targetStatus = 'offline';

          return hostStatus === targetStatus;
        });
        if (!matchesStatus) return false;
      }
      // Hardware filters
      if (os.length > 0 && (!h.hwInfo?.system || !os.includes(h.hwInfo.system))) return false;
      if (arch.length > 0 && (!h.hwInfo?.arch || !arch.includes(h.hwInfo.arch))) return false;
      if (gpu.length > 0 && (!h.gpuInfo?.model || !gpu.includes(h.gpuInfo.model))) return false;
      if (vram.length > 0 && (!h.gpuInfo?.totalMemory || !vram.includes(h.gpuInfo.totalMemory))) return false;
      if (ver.length > 0 && (!h.version || !ver.includes(h.version))) return false;
      return true;
    });

    const dir = this.sortDirection();

    // Ordenamiento estricto por Hostname (ascendente o descendente)
    // Se excluye la ordenación por estado para evitar que los nodos salten de posición al reconectarse/desconectarse
    return filtered.sort((a, b) => {
      const cmp = a.hostname.localeCompare(b.hostname, undefined, { numeric: true, sensitivity: 'base' });
      return dir === 'asc' ? cmp : -cmp;
    });
  });

  // ── Client-side pagination over filtered results ─────────────────────────────
  readonly pagedHosts = computed<Host[]>(() => {
    const list = this.filteredHosts();
    const start = (this.currentPage() - 1) * this.limit();
    return list.slice(start, start + this.limit());
  });

  readonly totalRecords = computed<number>(() => this.filteredHosts().length);

  readonly totalPages = computed<number>(() => {
    const total = this.totalRecords();
    const lim = this.limit();
    return total > 0 ? Math.ceil(total / lim) : 1;
  });

  readonly pages = computed<number[]>(() =>
    Array.from({ length: this.totalPages() }, (_, i) => i + 1)
  );

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

  // ── Resize observer ──────────────────────────────────────────────────────────
  private resizeSubject = new Subject<number>();
  private resizeSubscription?: Subscription;
  private resizeObserver?: ResizeObserver;

  // ── Helpers ──────────────────────────────────────────────────────────────────
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

  constructor() {
    // Restore state from URL query params
    const savedMode = localStorage.getItem('nodos_view_mode') as 'cards' | 'list';
    if (savedMode) {
      this.viewMode.set(savedMode);
    }

    // Wire searchControl → searchTerm signal with debounce
    this.searchControl.valueChanges.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      takeUntilDestroyed()
    ).subscribe(val => {
      this.searchTerm.set(val);
      // Reset to page 1 when search changes
      if (this.currentPage() !== 1) this.currentPage.set(1);
    });
  }

  ngOnInit(): void {
    this.hostService.isViewActive.set(true);
    this.isLoading.set(true);
    this.updatePaginationLimit();
    this.hostService.loadAllHosts().subscribe(() => {
      this.isLoading.set(false);
      // Consultar el estado y métricas iniciales una única vez al iniciar
      this.fetchInitialHeartbeats();
    });
    this.cameraService.getAllCameras().subscribe();
  }

  fetchInitialHeartbeats(): void {
    const hosts = this.hostService.allHosts();
    if (hosts.length === 0) return;

    hosts.forEach(host => {
      this.hostService.getHeartbeat(host.fingerprint).subscribe({
        next: (metrics) => {
          const serverTime = metrics.serverTime || new Date();
          const lastSeenDate = new Date(metrics.lastSeen);
          const diffSeconds = (serverTime.getTime() - lastSeenDate.getTime()) / 1000;

          // Si el last_seen es mayor o igual a 10 segundos, se considera inactivo (offline)
          const isOffline = diffSeconds >= 10;
          const status = isOffline ? 'offline' : 'online';

          // Actualizar métricas y estado por heartbeat
          this.hostService.updateHostMetrics(
            host.fingerprint,
            isOffline ? {
              lastSeen: metrics.lastSeen,
              cpu: null as any,
              gpu: null as any,
              vram: null as any,
              memory: null as any
            } : metrics,
            status
          );
        },
        error: (err) => {
          console.warn(`Failed to fetch initial heartbeat for host ${host.hostname}:`, err);
          // Si falla la petición del heartbeat, marcar como inactivo (offline)
          this.hostService.updateHostMetrics(host.fingerprint, null, 'offline');
        }
      });
    });
  }

  ngAfterViewInit(): void {
    this.resizeSubscription = this.resizeSubject.pipe(
      debounceTime(150)
    ).subscribe(width => this.adjustColumnsAndLimit(width));

    if (typeof ResizeObserver !== 'undefined' && this.nodosContainer) {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const e of entries) this.resizeSubject.next(e.contentRect.width);
      });
      this.resizeObserver.observe(this.nodosContainer.nativeElement);
    }

    setTimeout(() => this.updatePaginationLimit(), 50);
  }

  ngOnDestroy(): void {
    this.hostService.isViewActive.set(false);
    this.resizeObserver?.disconnect();
    this.resizeSubscription?.unsubscribe();
    if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    this.updatePaginationLimit();
  }

  private calculateTableRowsCapacity(): number {
    if (typeof window === 'undefined') return 8;

    const winH = window.innerHeight || document.documentElement.clientHeight || 800;

    // Medición dinámica directa en el DOM independiente del estado del panel de filtros
    const container = (this.nodosContainer?.nativeElement || document) as HTMLElement;
    const headerEl = container.querySelector('app-page-header') as HTMLElement;
    const theadEl = container.querySelector('.nm-table thead') as HTMLElement;
    const sampleRow = container.querySelector('.nm-table-tr') as HTMLElement;

    // 1. Determinar el inicio vertical base del cuerpo de la tabla a partir de la cabecera estándar
    const headerBottom = headerEl ? headerEl.getBoundingClientRect().bottom : 180;
    const theadH = theadEl && theadEl.getBoundingClientRect().height > 0
      ? theadEl.getBoundingClientRect().height
      : 44;
    const baseTableBodyTop = headerBottom + theadH + 16;

    // 2. Determinar la zona de seguridad inferior antes del dock flotante de paginación
    // La barra flotante fija tiene bottom: 0.9rem (~15px) + altura de barra (~48px) + sombra y elevación (~35px)
    // + margen de respiración del contenedor (~32px) y borde/tarjeta de tabla (~20px) = 160px de holgura total
    const bottomClearance = 160;

    const targetBottom = winH - bottomClearance;
    const availableHeight = Math.max(120, targetBottom - baseTableBodyTop);

    // 3. Medir la altura real de una fila en el DOM (incluyendo border-bottom)
    const rowHeight = (sampleRow && sampleRow.getBoundingClientRect().height > 0)
      ? sampleRow.getBoundingClientRect().height
      : 61;

    return Math.max(4, Math.floor(availableHeight / rowHeight));
  }

  private updatePaginationLimit(containerWidth?: number): void {
    if (this.viewMode() === 'list') {
      const tableLimit = this.calculateTableRowsCapacity();
      if (this.limit() !== tableLimit) {
        this.limit.set(tableLimit);
      }
    } else {
      const width = containerWidth ?? (this.nodosContainer?.nativeElement?.clientWidth || this.estimateContainerWidth());
      if (width > 0) {
        const newCols = Math.max(1, Math.floor((width + 24) / (335 + 24)));
        const oldCols = this.columns();
        let multiplier = Math.round(this.limit() / (oldCols || 1));
        if (multiplier !== 10 && multiplier !== 20 && multiplier !== 30) {
          multiplier = 10;
        }
        if (newCols !== oldCols) {
          this.columns.set(newCols);
        }
        const newLimit = newCols * multiplier;
        if (this.limit() !== newLimit) {
          this.limit.set(newLimit);
        }
      }
    }
  }

  private adjustColumnsAndLimit(containerWidth: number): void {
    if (containerWidth <= 0) return;
    this.updatePaginationLimit(containerWidth);
  }

  // ── Pagination controls ───────────────────────────────────────────────────────
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
    const newLimit = parseInt((event.target as HTMLSelectElement).value, 10);
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

  // Parse total memory string or number (bytes), returns number in GB or null if invalid/absent
  parseMemoryGB(mem: string | number | null | undefined): number | null {
    if (mem === null || mem === undefined || mem === '') return null;
    let val = 0;
    if (typeof mem === 'number') {
      if (mem <= 0) return null;
      val = mem / (1024 * 1024 * 1024);
    } else {
      const match = mem.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)?/i);
      if (!match) return null;
      const rawVal = parseFloat(match[1]);
      if (isNaN(rawVal) || rawVal <= 0) return null;
      const unit = (match[2] || 'GB').toUpperCase();
      if (unit === 'GB') val = rawVal;
      else if (unit === 'MB') val = rawVal / 1024;
      else if (unit === 'KB') val = rawVal / (1024 * 1024);
      else if (unit === 'B') val = rawVal / (1024 * 1024 * 1024);
      else val = rawVal;
    }
    const rounded = Math.round(val);
    return rounded > 0 ? rounded : null;
  }

  // ── Navigation ────────────────────────────────────────────────────────────────
  goToCameras(fingerprint: string): void {
    this.router.navigate(['/dashboard/nodos', fingerprint, 'camaras']);
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  // ── Filter panel ──────────────────────────────────────────────────────────────
  hasActiveFilters(): boolean {
    return this.searchTerm().trim() !== '' ||
      this.filterStatus().length > 0 ||
      this.filterOS().length > 0 ||
      this.filterArch().length > 0 ||
      this.filterGPU().length > 0 ||
      this.filterVram().length > 0 ||
      this.filterVersion().length > 0;
  }

  toggleFilterPanel(): void {
    if (!this.showFilterPanel()) {
      // Sync temp copies to active values when opening
      this.tempFilterStatus.set([...this.filterStatus()]);
      this.tempFilterOS.set([...this.filterOS()]);
      this.tempFilterArch.set([...this.filterArch()]);
      this.tempFilterGPU.set([...this.filterGPU()]);
      this.tempFilterVram.set([...this.filterVram()]);
      this.tempFilterVersion.set([...this.filterVersion()]);
    }
    this.showFilterPanel.update(v => !v);
  }

  applyFilters(): void {
    this.filterStatus.set([...this.tempFilterStatus()]);
    this.filterOS.set([...this.tempFilterOS()]);
    this.filterArch.set([...this.tempFilterArch()]);
    this.filterGPU.set([...this.tempFilterGPU()]);
    this.filterVram.set([...this.tempFilterVram()]);
    this.filterVersion.set([...this.tempFilterVersion()]);
    this.currentPage.set(1);
  }

  resetFilters(): void {
    this.searchControl.setValue('');
    this.searchTerm.set('');
    this.filterStatus.set([]); this.tempFilterStatus.set([]);
    this.filterOS.set([]); this.tempFilterOS.set([]);
    this.filterArch.set([]); this.tempFilterArch.set([]);
    this.filterGPU.set([]); this.tempFilterGPU.set([]);
    this.filterVram.set([]); this.tempFilterVram.set([]);
    this.filterVersion.set([]); this.tempFilterVersion.set([]);
    this.currentPage.set(1);
    this.activeDropdown.set(null);
  }

  readonly hasPendingFilterChanges = computed<boolean>(() => {
    return !this._arraysEqual(this.tempFilterStatus(), this.filterStatus()) ||
      !this._arraysEqual(this.tempFilterOS(), this.filterOS()) ||
      !this._arraysEqual(this.tempFilterArch(), this.filterArch()) ||
      !this._arraysEqual(this.tempFilterGPU(), this.filterGPU()) ||
      !this._arraysEqual(this.tempFilterVram(), this.filterVram()) ||
      !this._arraysEqual(this.tempFilterVersion(), this.filterVersion());
  });

  // Dropdown helpers
  toggleDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.activeDropdown.update(cur => cur === name ? null : name);
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

    switch (filterName) {
      case 'status': toggleInSig(this.tempFilterStatus); break;
      case 'os': toggleInSig(this.tempFilterOS); break;
      case 'arch': toggleInSig(this.tempFilterArch); break;
      case 'gpu': toggleInSig(this.tempFilterGPU); break;
      case 'vram': toggleInSig(this.tempFilterVram); break;
      case 'version': toggleInSig(this.tempFilterVersion); break;
    }
  }

  toggleExportDropdown(event: Event): void {
    event.stopPropagation();
    this.showExportDropdown.update(v => !v);
  }

  @HostListener('document:click')
  closeAllDropdowns(): void {
    this.activeDropdown.set(null);
    this.showExportDropdown.set(false);
    this.isOldDropdownOpen.set(false);
    this.isNewDropdownOpen.set(false);
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

  // ── Host Migration Methods ───────────────────────────────────────────────────
  toggleOldDropdown(event: any): void {
    event.stopPropagation();
    this.isNewDropdownOpen.set(false);
    this.isOldDropdownOpen.update(v => !v);
  }

  toggleNewDropdown(event: any): void {
    event.stopPropagation();
    this.isOldDropdownOpen.set(false);
    this.isNewDropdownOpen.update(v => !v);
  }

  selectOldHost(fingerprint: string, event: any): void {
    event.stopPropagation();
    this.selectedOldFingerprint.set(fingerprint);
    // Si ya teníamos seleccionado el mismo host en destino, limpiamos el destino
    if (this.selectedNewFingerprint() === fingerprint) {
      this.selectedNewFingerprint.set('');
    }
    this.isOldDropdownOpen.set(false);
  }

  selectNewHost(fingerprint: string, event: any): void {
    event.stopPropagation();
    // No permitir seleccionar el mismo host que el de origen
    if (this.selectedOldFingerprint() === fingerprint) {
      return;
    }
    this.selectedNewFingerprint.set(fingerprint);
    this.isNewDropdownOpen.set(false);
  }

  private backdropMouseDownTarget: EventTarget | null = null;

  onBackdropMouseDown(event: MouseEvent): void {
    if (event.button === 0) {
      this.backdropMouseDownTarget = event.target;
    }
  }

  onBackdropMouseUp(event: MouseEvent): void {
    if (
      event.button === 0 &&
      this.backdropMouseDownTarget === event.currentTarget &&
      event.target === event.currentTarget
    ) {
      this.closeMigrateModal();
    }
    this.backdropMouseDownTarget = null;
  }

  clearOldSelection(event: any): void {
    event.stopPropagation();
    this.selectedOldFingerprint.set('');
    this.selectedNewFingerprint.set('');
    this.originSearchText.set('');
    this.targetSearchText.set('');
    this.isOldDropdownOpen.set(false);
    this.isNewDropdownOpen.set(false);
  }

  clearNewSelection(event: any): void {
    event.stopPropagation();
    this.selectedNewFingerprint.set('');
    this.targetSearchText.set('');
    this.isNewDropdownOpen.set(false);
  }

  openMigrateModal(): void {
    this.selectedOldFingerprint.set('');
    this.selectedNewFingerprint.set('');
    this.originSearchText.set('');
    this.targetSearchText.set('');
    this.isOldDropdownOpen.set(false);
    this.isNewDropdownOpen.set(false);
    this.isMigrating.set(false);
    this.showMigrateModal.set(true);
  }

  closeMigrateModal(): void {
    this.showMigrateModal.set(false);
    this.isOldDropdownOpen.set(false);
    this.isNewDropdownOpen.set(false);
  }

  executeMigration(): void {
    const oldFp = this.selectedOldFingerprint();
    const newFp = this.selectedNewFingerprint();

    if (!oldFp || !newFp) return;

    this.isMigrating.set(true);
    this.hostService.migrateSetup(oldFp, newFp).subscribe({
      next: () => {
        this.isMigrating.set(false);
        this.closeMigrateModal();
        this.cameraService.getAllCameras().subscribe();
        alert('Migración de configuración completada con éxito.');
      },
      error: (err) => {
        console.error('Error migrating host setup:', err);
        this.isMigrating.set(false);
        alert('Error al migrar la configuración del nodo.');
      }
    });
  }

  setViewMode(mode: 'cards' | 'list'): void {
    this.viewMode.set(mode);
    localStorage.setItem('nodos_view_mode', mode);
    this.updatePaginationLimit();
    this.currentPage.set(1);
    setTimeout(() => this.updatePaginationLimit(), 0);
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

  formatLastSeen(date: Date | string | null | undefined): string {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    const pad = (n: number) => n.toString().padStart(2, '0');
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    const seconds = pad(d.getSeconds());
    return `${day}/${month}/${year} ${hours}:${minutes}:${seconds}`;
  }

  // ── 2 Capas Lógicas para Título de GPU en Tarjeta ───────────────────────────
  onGpuMouseEnter(event: MouseEvent): void {
    const panel = event.currentTarget as HTMLElement | null;
    if (!panel) return;

    const nameEl = panel.querySelector('.resource-name') as HTMLElement | null;
    const statsEl = panel.querySelector('.resource-stats') as HTMLElement | null;
    const headerEl = panel.querySelector('.resource-panel-header') as HTMLElement | null;
    const iconEl = panel.querySelector('.resource-icon') as HTMLElement | null;

    if (!nameEl || !statsEl || !headerEl) return;

    // Capa 1: ¿El texto desborda el espacio normal asignado?
    const isOverflowingNormal = nameEl.scrollWidth > (nameEl.clientWidth + 2);

    if (!isOverflowingNormal) {
      // El texto entra completo: no se ocultan métricas ni hay marquee
      panel.classList.remove('gpu-expand-space', 'gpu-needs-marquee');
      return;
    }

    // El texto desborda el espacio normal -> ocultamos métricas de la derecha
    panel.classList.add('gpu-expand-space');

    // Capa 2: ¿Sigue siendo insuficiente el espacio tras colapsar las métricas?
    const iconWidth = iconEl ? iconEl.offsetWidth : 20;
    const availableFullWidth = headerEl.clientWidth - iconWidth - 20;

    if (nameEl.scrollWidth > availableFullWidth) {
      // Incluso con todo el ancho disponible desborda -> calcular desplazamiento exacto hasta el borde derecho
      // Offset de 24px para que la última letra pase completamente el gradiente de fade-out
      const fadeOffset = 24;
      const shift = Math.ceil(nameEl.scrollWidth - availableFullWidth) + fadeOffset;
      nameEl.style.setProperty('--marquee-shift', `-${shift}px`);
      panel.classList.add('gpu-needs-marquee');
    } else {
      // Entra completo en el ancho expandido -> mostrar completo estático sin marquee
      nameEl.style.removeProperty('--marquee-shift');
      panel.classList.remove('gpu-needs-marquee');
    }
  }

  onGpuMouseLeave(event: MouseEvent): void {
    const panel = event.currentTarget as HTMLElement | null;
    if (panel) {
      panel.classList.remove('gpu-expand-space', 'gpu-needs-marquee');
      const nameEl = panel.querySelector('.resource-name') as HTMLElement | null;
      if (nameEl) {
        nameEl.style.removeProperty('--marquee-shift');
      }
    }
  }

  // ── 2 Capas Lógicas para Título del Nodo (Hostname) y Botón Eliminar en Tarjeta ──────
  onHostCardMouseEnter(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;

    const headerBlock = target.classList.contains('host-header-block')
      ? target
      : target.querySelector('.host-header-block') as HTMLElement | null;
    if (!headerBlock) return;

    const titleEl = headerBlock.querySelector('.host-title') as HTMLElement | null;
    const iconEl = headerBlock.querySelector('.os-avatar-icon') as HTMLElement | null;

    if (!titleEl) return;

    // Al hacer hover en la tarjeta, revelamos el botón eliminar y colapsamos los badges
    headerBlock.classList.add('host-title-expand-space');

    // Ancho útil disponible hasta el botón de eliminar (28px ancho + margen de 4px + gaps)
    const iconWidth = iconEl ? iconEl.offsetWidth : 20;
    const deleteBtnWidth = 32;
    const availableFullWidth = headerBlock.clientWidth - iconWidth - deleteBtnWidth - 16;

    if (titleEl.scrollWidth > availableFullWidth) {
      // Si el nombre desborda el espacio hasta el botón -> desplazamiento exacto
      // Offset de 24px para que la última letra pase completamente el gradiente de fade-out
      const fadeOffset = 24;
      const shift = Math.ceil(titleEl.scrollWidth - availableFullWidth) + fadeOffset;
      titleEl.style.setProperty('--marquee-shift', `-${shift}px`);
      headerBlock.classList.add('host-title-needs-marquee');
    } else {
      // Entra completo en el ancho expandido -> mostrar completo estático sin marquee
      titleEl.style.removeProperty('--marquee-shift');
      headerBlock.classList.remove('host-title-needs-marquee');
    }
  }

  onHostCardMouseLeave(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;

    const headerBlock = target.classList.contains('host-header-block')
      ? target
      : target.querySelector('.host-header-block') as HTMLElement | null;
    if (headerBlock) {
      headerBlock.classList.remove('host-title-expand-space', 'host-title-needs-marquee');
      const titleEl = headerBlock.querySelector('.host-title') as HTMLElement | null;
      if (titleEl) {
        titleEl.style.removeProperty('--marquee-shift');
      }
    }
  }

  // Alias para retrocompatibilidad
  onHostTitleMouseEnter(event: MouseEvent): void {
    this.onHostCardMouseEnter(event);
  }

  onHostTitleMouseLeave(event: MouseEvent): void {
    this.onHostCardMouseLeave(event);
  }

  // ── Exportación a Excel (XLSX) y CSV ──────────────────────────────────────────
  exportNodosXlsx(): void {
    const columns: ExportColumn[] = [
      { header: 'Estado', key: 'status' },
      { header: 'Hostname', key: 'hostname' },
      { header: 'Cámaras', key: 'cameraCount' },
      { header: 'Versión', key: 'version' },
      { header: 'Dirección IP', key: 'ipAddress' },
      { header: 'Sistema Operativo', key: 'os' },
      { header: 'Release SO', key: 'release' },
      { header: 'Arquitectura CPU', key: 'arch' },
      { header: 'Uso CPU (%)', key: 'cpu' },
      { header: 'Uso RAM (%)', key: 'ram' },
      { header: 'Total RAM (GB)', key: 'totalRam' },
      { header: 'Modelo GPU', key: 'gpuModel' },
      { header: 'Uso GPU (%)', key: 'gpu' },
      { header: 'Uso VRAM (%)', key: 'vram' },
      { header: 'Total VRAM (GB)', key: 'totalVram' },
      { header: 'Última Vez', key: 'lastSeen' }
    ];

    const data = this.filteredHosts().map(h => {
      const isOnline = h.status === 'active' || h.status === 'online';
      const totalRam = this.parseMemoryGB(h.hwInfo?.totalRam || h.hwInfo?.totalMemory);
      const totalVram = this.parseMemoryGB(h.gpuInfo?.totalMemory);
      return {
        status: isOnline ? 'Online' : 'Offline',
        hostname: h.hostname,
        cameraCount: this.getCameraCount(h.fingerprint),
        version: `v${h.version}`,
        ipAddress: h.ipAddress,
        os: h.hwInfo?.system || '-',
        release: h.hwInfo?.release || '-',
        arch: h.hwInfo?.arch || '-',
        cpu: h.metrics?.cpu ?? 0,
        ram: h.metrics?.memory ?? 0,
        totalRam: totalRam ? `${totalRam} GB` : '-',
        gpuModel: h.gpuInfo?.model || '-',
        gpu: h.metrics?.gpu ?? 0,
        vram: h.metrics?.vram ?? 0,
        totalVram: totalVram ? `${totalVram} GB` : '-',
        lastSeen: this.formatLastSeen(h.metrics?.lastSeen)
      };
    });

    exportToXlsx('reporte_nodos_computo.xlsx', 'Nodos de Cómputo', columns, data);
  }

  exportNodosCsv(): void {
    const columns: ExportColumn[] = [
      { header: 'Estado', key: 'status' },
      { header: 'Hostname', key: 'hostname' },
      { header: 'Cámaras', key: 'cameraCount' },
      { header: 'Versión', key: 'version' },
      { header: 'Dirección IP', key: 'ipAddress' },
      { header: 'Sistema Operativo', key: 'os' },
      { header: 'Release SO', key: 'release' },
      { header: 'Arquitectura CPU', key: 'arch' },
      { header: 'Uso CPU (%)', key: 'cpu' },
      { header: 'Uso RAM (%)', key: 'ram' },
      { header: 'Total RAM (GB)', key: 'totalRam' },
      { header: 'Modelo GPU', key: 'gpuModel' },
      { header: 'Uso GPU (%)', key: 'gpu' },
      { header: 'Uso VRAM (%)', key: 'vram' },
      { header: 'Total VRAM (GB)', key: 'totalVram' },
      { header: 'Última Vez', key: 'lastSeen' }
    ];

    const data = this.filteredHosts().map(h => {
      const isOnline = h.status === 'active' || h.status === 'online';
      const totalRam = this.parseMemoryGB(h.hwInfo?.totalRam || h.hwInfo?.totalMemory);
      const totalVram = this.parseMemoryGB(h.gpuInfo?.totalMemory);
      return {
        status: isOnline ? 'Online' : 'Offline',
        hostname: h.hostname,
        cameraCount: this.getCameraCount(h.fingerprint),
        version: `v${h.version}`,
        ipAddress: h.ipAddress,
        os: h.hwInfo?.system || '-',
        release: h.hwInfo?.release || '-',
        arch: h.hwInfo?.arch || '-',
        cpu: h.metrics?.cpu ?? 0,
        ram: h.metrics?.memory ?? 0,
        totalRam: totalRam ? `${totalRam} GB` : '-',
        gpuModel: h.gpuInfo?.model || '-',
        gpu: h.metrics?.gpu ?? 0,
        vram: h.metrics?.vram ?? 0,
        totalVram: totalVram ? `${totalVram} GB` : '-',
        lastSeen: this.formatLastSeen(h.metrics?.lastSeen)
      };
    });

    exportToCsv('reporte_nodos_computo.csv', columns, data);
  }

  // ── Status Filter Helpers ───────────────────────────────────────────────────
  getStatusCssClass(status: string): string {
    const stLower = (status || '').trim().toLowerCase();
    if (stLower === 'all' || stLower === 'todos') return 'all';
    if (stLower === 'online' || stLower === 'active' || stLower === 'activo') return 'online';
    if (stLower === 'degraded' || stLower === 'degradado') return 'degraded';
    if (stLower === 'recovering' || stLower === 'recuperando') return 'recovering';
    if (stLower === 'pending' || stLower === 'pendiente') return 'pending';
    return 'offline';
  }

  getStatusFilterLabel(status: string): string {
    return getCameraStatusFilterLabel(status);
  }

  getStatusCount(status: string): number {
    const opts = this.filterOptions();
    if (!status || status === 'all') return opts.totalCount || 0;
    const counts = opts.statusCounts || {};
    return counts[status] || counts[status.toLowerCase()] || 0;
  }

  getStatusCountSummary(): string {
    const selected = this.tempFilterStatus();
    if (selected.length === 0) {
      return `${this.filterOptions().totalCount || 0}`;
    }
    const totalSelected = selected.reduce((sum, st) => sum + this.getStatusCount(st), 0);
    return `${totalSelected}`;
  }
}
