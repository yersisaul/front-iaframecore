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
import { copyToClipboard } from '../../../core/utils/clipboard.util';
import { PaginationControlsComponent } from '../../shared/pagination-controls/pagination-controls.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { SearchInputComponent } from '../../shared/search-input/search-input.component';
import { ViewModeToggleComponent } from '../../shared/view-mode-toggle/view-mode-toggle.component';

@Component({
  selector: 'app-nodos',
  imports: [CommonModule, ReactiveFormsModule, PaginationControlsComponent, PageHeaderComponent, SearchInputComponent, ViewModeToggleComponent],
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

  // ── Pagination ──────────────────────────────────────────────────────────────
  readonly columns = signal(this.getInitialColumns());
  readonly limit = signal(this.columns() * 10);
  readonly currentPage = signal(1, { equal: () => false });

  readonly limitOptions = computed(() => {
    const cols = this.columns();
    return [cols * 10, cols * 20, cols * 30];
  });

  // ── Search & filter state ────────────────────────────────────────────────────
  readonly searchControl = new FormControl('', { nonNullable: true });
  readonly searchTerm = signal<string>('');

  readonly filterStatus  = signal<string>('all');
  readonly filterOS      = signal<string>('all');
  readonly filterArch    = signal<string>('all');
  readonly filterGPU     = signal<string>('all');
  readonly filterVram    = signal<string>('all');
  readonly filterVersion = signal<string>('all');

  // Temp copies shown in the drawer (committed on "Aplicar")
  readonly tempFilterStatus  = signal<string>('all');
  readonly tempFilterOS      = signal<string>('all');
  readonly tempFilterArch    = signal<string>('all');
  readonly tempFilterGPU     = signal<string>('all');
  readonly tempFilterVram    = signal<string>('all');
  readonly tempFilterVersion = signal<string>('all');

  readonly showFilterPanel = signal<boolean>(false);
  readonly activeDropdown  = signal<string | null>(null);

  readonly isLoading = signal<boolean>(false);
  readonly viewMode = signal<'cards' | 'list'>('cards');

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
  readonly filterOptions = signal<HostFilterOptions | null>(null);

  // ── Client-side filtered list ────────────────────────────────────────────────
  readonly filteredHosts = computed<Host[]>(() => {
    const all  = this.hostService.allHosts();
    const term = this.searchTerm().trim().toLowerCase();
    const st   = this.filterStatus();
    const os   = this.filterOS();
    const arch = this.filterArch();
    const gpu  = this.filterGPU();
    const vram = this.filterVram();
    const ver  = this.filterVersion();

    const filtered = all.filter(h => {
      // Search by hostname, IP or fingerprint (substring matching)
      if (term) {
        const matchesHostname = h.hostname.toLowerCase().includes(term);
        const matchesIp       = h.ipAddress.toLowerCase().includes(term);
        const matchesFp       = h.fingerprint.toLowerCase().includes(term);
        if (!matchesHostname && !matchesIp && !matchesFp) return false;
      }
      // Status filter — backend uses 'online'/'offline' but also 'active'/'inactive'
      if (st !== 'all') {
        const isOnline = h.status === 'online' || h.status === 'active';
        if (st === 'active' && !isOnline) return false;
        if (st === 'inactive' && isOnline) return false;
      }
      // Hardware filters
      if (os   !== 'all' && h.hwInfo?.system !== os)          return false;
      if (arch !== 'all' && h.hwInfo?.arch   !== arch)        return false;
      if (gpu  !== 'all' && h.gpuInfo?.model !== gpu)         return false;
      if (vram !== 'all' && h.gpuInfo?.totalMemory !== vram)  return false;
      if (ver  !== 'all' && h.version !== ver)                return false;
      return true;
    });

    // Ordenar: activos (online/active) primero, luego por hostname alfabéticamente
    return filtered.sort((a, b) => {
      const aOnline = a.status === 'online' || a.status === 'active' ? 1 : 0;
      const bOnline = b.status === 'online' || b.status === 'active' ? 1 : 0;
      
      if (bOnline !== aOnline) {
        return bOnline - aOnline;
      }
      
      return a.hostname.toLowerCase().localeCompare(b.hostname.toLowerCase());
    });
  });

  // ── Client-side pagination over filtered results ─────────────────────────────
  readonly pagedHosts = computed<Host[]>(() => {
    const list  = this.filteredHosts();
    const start = (this.currentPage() - 1) * this.limit();
    return list.slice(start, start + this.limit());
  });

  readonly totalPages = computed<number>(() => {
    const total = this.filteredHosts().length;
    const lim   = this.limit();
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
  private resizeSubject      = new Subject<number>();
  private resizeSubscription?: Subscription;
  private resizeObserver?:    ResizeObserver;

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
      if (savedMode === 'list') {
        this.limit.set(10);
      }
    }

    const qp = this.route.snapshot.queryParams;
    if (qp['search'])  { this.searchControl.setValue(qp['search']); this.searchTerm.set(qp['search']); }
    if (qp['status'])  this.filterStatus.set(qp['status']);
    if (qp['os'])      this.filterOS.set(qp['os']);
    if (qp['arch'])    this.filterArch.set(qp['arch']);
    if (qp['gpu'])     this.filterGPU.set(qp['gpu']);
    if (qp['vram'])    this.filterVram.set(qp['vram']);
    if (qp['version']) this.filterVersion.set(qp['version']);
    if (qp['page'])    this.currentPage.set(Math.max(1, parseInt(qp['page'], 10) || 1));
    if (qp['limit'])   this.limit.set(parseInt(qp['limit'], 10) || this.limit());

    // Wire searchControl → searchTerm signal with debounce
    this.searchControl.valueChanges.pipe(
      debounceTime(250),
      distinctUntilChanged(),
      takeUntilDestroyed()
    ).subscribe(val => {
      this.searchTerm.set(val);
      // Reset to page 1 when search changes
      if (this.currentPage() !== 1) this.currentPage.set(1);
      this.syncUrl();
    });
  }

  ngOnInit(): void {
    this.hostService.isViewActive.set(true);
    this.isLoading.set(true);
    this.hostService.loadAllHosts().subscribe(() => {
      this.isLoading.set(false);
      // Build filter options from the now-loaded data
      this.filterOptions.set(this.hostService.buildFilterOptions());
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
  }

  ngOnDestroy(): void {
    this.hostService.isViewActive.set(false);
    this.resizeObserver?.disconnect();
    this.resizeSubscription?.unsubscribe();
    if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
  }

  // ── URL sync ──────────────────────────────────────────────────────────────────
  private syncUrl(): void {
    const defaultLimit = this.columns() * 10;
    const qp: Record<string, any> = {
      page:    this.currentPage() > 1       ? this.currentPage()  : null,
      limit:   this.limit() !== defaultLimit ? this.limit()        : null,
      search:  this.searchTerm() || null,
      status:  this.filterStatus()  !== 'all' ? this.filterStatus()  : null,
      os:      this.filterOS()      !== 'all' ? this.filterOS()      : null,
      arch:    this.filterArch()    !== 'all' ? this.filterArch()    : null,
      gpu:     this.filterGPU()     !== 'all' ? this.filterGPU()     : null,
      vram:    this.filterVram()    !== 'all' ? this.filterVram()    : null,
      version: this.filterVersion() !== 'all' ? this.filterVersion() : null,
    };
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: qp,
      queryParamsHandling: 'merge'
    });
  }

  // ── Resize handling ───────────────────────────────────────────────────────────
  private adjustColumnsAndLimit(containerWidth: number): void {
    if (containerWidth <= 0) return;
    const newCols = Math.max(1, Math.floor((containerWidth + 24) / (335 + 24)));
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
      this.syncUrl();
    }
  }

  // ── Pagination controls ───────────────────────────────────────────────────────
  setPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
      this.syncUrl();
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update(p => p + 1);
      this.syncUrl();
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update(p => p - 1);
      this.syncUrl();
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
    this.syncUrl();
  }



  // Parse total memory string or number (bytes), fallback to 16 GB if null/invalid
  parseMemoryGB(mem: string | number | null | undefined): number {
    if (mem === null || mem === undefined) return 16;
    let val = 0;
    if (typeof mem === 'number') {
      val = mem / (1024 * 1024 * 1024);
    } else {
      const match = mem.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)?/i);
      if (!match) return 16;
      const rawVal = parseFloat(match[1]);
      const unit = (match[2] || 'GB').toUpperCase();
      if (unit === 'GB') val = rawVal;
      else if (unit === 'MB') val = rawVal / 1024;
      else if (unit === 'KB') val = rawVal / (1024 * 1024);
      else if (unit === 'B') val = rawVal / (1024 * 1024 * 1024);
      else val = rawVal;
    }
    return Math.round(val);
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
           this.filterStatus()  !== 'all' ||
           this.filterOS()      !== 'all' ||
           this.filterArch()    !== 'all' ||
           this.filterGPU()     !== 'all' ||
           this.filterVram()    !== 'all' ||
           this.filterVersion() !== 'all';
  }

  toggleFilterPanel(): void {
    if (!this.showFilterPanel()) {
      // Sync temp copies to active values when opening
      this.tempFilterStatus.set(this.filterStatus());
      this.tempFilterOS.set(this.filterOS());
      this.tempFilterArch.set(this.filterArch());
      this.tempFilterGPU.set(this.filterGPU());
      this.tempFilterVram.set(this.filterVram());
      this.tempFilterVersion.set(this.filterVersion());
    }
    this.showFilterPanel.update(v => !v);
  }

  applyFilters(): void {
    this.filterStatus.set(this.tempFilterStatus());
    this.filterOS.set(this.tempFilterOS());
    this.filterArch.set(this.tempFilterArch());
    this.filterGPU.set(this.tempFilterGPU());
    this.filterVram.set(this.tempFilterVram());
    this.filterVersion.set(this.tempFilterVersion());
    this.currentPage.set(1);
    this.syncUrl();
  }

  resetFilters(): void {
    this.searchControl.setValue('');
    this.searchTerm.set('');
    this.filterStatus.set('all');  this.tempFilterStatus.set('all');
    this.filterOS.set('all');      this.tempFilterOS.set('all');
    this.filterArch.set('all');    this.tempFilterArch.set('all');
    this.filterGPU.set('all');     this.tempFilterGPU.set('all');
    this.filterVram.set('all');    this.tempFilterVram.set('all');
    this.filterVersion.set('all'); this.tempFilterVersion.set('all');
    this.currentPage.set(1);
    this.activeDropdown.set(null);
    this.syncUrl();
  }

  readonly hasPendingFilterChanges = computed<boolean>(() => {
    return this.tempFilterStatus()  !== this.filterStatus()  ||
           this.tempFilterOS()      !== this.filterOS()      ||
           this.tempFilterArch()    !== this.filterArch()    ||
           this.tempFilterGPU()     !== this.filterGPU()     ||
           this.tempFilterVram()    !== this.filterVram()    ||
           this.tempFilterVersion() !== this.filterVersion();
  });

  // Dropdown helpers
  toggleDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.activeDropdown.update(cur => cur === name ? null : name);
  }

  selectFilterValue(filterName: string, value: string, event?: Event): void {
    if (event) event.stopPropagation();
    switch (filterName) {
      case 'status':  this.tempFilterStatus.set(value);  break;
      case 'os':      this.tempFilterOS.set(value);      break;
      case 'arch':    this.tempFilterArch.set(value);    break;
      case 'gpu':     this.tempFilterGPU.set(value);     break;
      case 'vram':    this.tempFilterVram.set(value);    break;
      case 'version': this.tempFilterVersion.set(value); break;
    }
    this.activeDropdown.set(null);
  }

  @HostListener('document:click')
  closeAllDropdowns(): void {
    this.activeDropdown.set(null);
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
    this.currentPage.set(1);
    this.syncUrl();
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
}
