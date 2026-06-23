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
import { SidebarService } from '../../../core/services/sidebar.service';
import { Host } from '../../../core/domain/entities/host.models';

@Component({
  selector: 'app-nodos',
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './nodos.html',
  styleUrl: './nodos.css',
})
export class Nodos implements OnInit, AfterViewInit, OnDestroy {
  private hostService = inject(HostService);
  private sidebarService = inject(SidebarService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  @ViewChild('hostsGrid', { static: false }) hostsGrid!: ElementRef<HTMLDivElement>;

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  // ── Pagination ──────────────────────────────────────────────────────────────
  readonly columns = signal(this.getInitialColumns());
  readonly rows = signal(this.getInitialRows());
  readonly limit = signal(this.columns() * this.rows() * 2);
  readonly currentPage = signal(1, { equal: () => false });

  readonly limitOptions = computed(() => {
    const base = this.columns() * this.rows();
    return [base * 2, base * 3, base * 4];
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

  // ── Host Migration State ─────────────────────────────────────────────────────
  readonly showMigrateModal = signal<boolean>(false);
  readonly selectedOldFingerprint = signal<string>('');
  readonly selectedNewFingerprint = signal<string>('');
  readonly isMigrating = signal<boolean>(false);
  readonly isOldDropdownOpen = signal<boolean>(false);
  readonly isNewDropdownOpen = signal<boolean>(false);

  readonly selectedOldHost = computed(() => {
    const fp = this.selectedOldFingerprint();
    return this.hostService.allHosts().find(h => h.fingerprint === fp);
  });

  readonly selectedNewHost = computed(() => {
    const fp = this.selectedNewFingerprint();
    return this.hostService.allHosts().find(h => h.fingerprint === fp);
  });

  readonly compatibleTargetHosts = computed(() => {
    const oldFp = this.selectedOldFingerprint();
    return this.hostService.allHosts().filter(h => h.fingerprint !== oldFp);
  });
  readonly allHosts = this.hostService.allHosts;
  private heartbeatIntervalSubscription?: Subscription;
  private consecutiveFailures = new Map<string, number>();

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

    return all.filter(h => {
      // Search by hostname or IP (strict prefix matching)
      if (term) {
        const matchesHostname = h.hostname.toLowerCase().startsWith(term);
        const matchesIp       = h.ipAddress.toLowerCase().startsWith(term);
        const matchesFp       = h.fingerprint.toLowerCase().startsWith(term);
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
    return Math.max(1, Math.floor((w + 24) / (420 + 24)));
  }

  private getInitialRows(): number {
    if (typeof window === 'undefined') return 3;
    return Math.max(3, Math.floor((window.innerHeight - 320) / 280));
  }

  constructor() {
    // Restore state from URL query params
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
    this.isLoading.set(true);
    this.hostService.loadAllHosts().subscribe(() => {
      this.isLoading.set(false);
      // Build filter options from the now-loaded data
      this.filterOptions.set(this.hostService.buildFilterOptions());
      // Start monitoring polling
      this.startHeartbeatPolling();
    });
  }

  ngAfterViewInit(): void {
    this.resizeSubscription = this.resizeSubject.pipe(
      debounceTime(150)
    ).subscribe(width => this.adjustColumnsAndLimit(width));

    if (typeof ResizeObserver !== 'undefined' && this.hostsGrid) {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const e of entries) this.resizeSubject.next(e.contentRect.width);
      });
      this.resizeObserver.observe(this.hostsGrid.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.stopHeartbeatPolling();
    this.resizeObserver?.disconnect();
    this.resizeSubscription?.unsubscribe();
  }

  // ── URL sync ──────────────────────────────────────────────────────────────────
  private syncUrl(): void {
    const defaultLimit = this.columns() * this.rows();
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
    const newCols = Math.max(1, Math.floor((containerWidth + 24) / (420 + 24)));
    const newRows = Math.max(3, Math.floor((window.innerHeight - 320) / 280));
    const oldCols = this.columns();
    const oldRows = this.rows();
    if (newCols !== oldCols || newRows !== oldRows) {
      const screens = Math.max(2, Math.min(4, Math.round(this.limit() / (oldCols * oldRows || 1))));
      this.columns.set(newCols);
      this.rows.set(newRows);
      this.limit.set(newCols * newRows * screens);
      this.currentPage.set(1);
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

  private heartbeatTimeoutId?: any;

  startHeartbeatPolling(): void {
    this.stopHeartbeatPolling();
    this.fetchVisibleHostsHeartbeat();
    this.scheduleNextHeartbeat();
  }

  stopHeartbeatPolling(): void {
    if (this.heartbeatTimeoutId) {
      clearTimeout(this.heartbeatTimeoutId);
      this.heartbeatTimeoutId = undefined;
    }
  }

  private scheduleNextHeartbeat(): void {
    const now = Date.now();
    const nextBoundary = Math.ceil(now / 5000) * 5000;
    // Aligned to exact clean 5-second boundaries (:00, :05, :10...) plus a 100ms
    // offset to allow backend DB transactions to complete.
    const delay = (nextBoundary - now) + 100;

    this.heartbeatTimeoutId = setTimeout(() => {
      this.fetchVisibleHostsHeartbeat();
      this.scheduleNextHeartbeat();
    }, delay);
  }

  private fetchVisibleHostsHeartbeat(): void {
    const visibleHosts = this.pagedHosts();
    if (visibleHosts.length === 0) return;

    visibleHosts.forEach(host => {
      this.hostService.getHeartbeat(host.fingerprint).subscribe({
        next: (metrics) => {
          const serverTime = metrics.serverTime || new Date();
          // Align server time to clean 5-second boundary in UTC for exact comparison
          const iterationTimeUTC = new Date(Math.floor(serverTime.getTime() / 5000) * 5000);
          const lastSeenDate = new Date(metrics.lastSeen);
          const diffSeconds = (iterationTimeUTC.getTime() - lastSeenDate.getTime()) / 1000;

          if (diffSeconds >= 10) {
            // Si el last_seen no se actualiza en 10s (2 iteraciones), se considera inactivo inmediatamente
            this.consecutiveFailures.set(host.fingerprint, 2);
            this.hostService.updateHostMetrics(host.fingerprint, {
              lastSeen: metrics.lastSeen,
              cpu: null as any,
              gpu: null as any,
              vram: null as any,
              memory: null as any
            }, 'offline');
          } else {
            // Nodo activo
            this.consecutiveFailures.set(host.fingerprint, 0);
            this.hostService.updateHostMetrics(host.fingerprint, metrics, 'online');
          }
        },
        error: (err) => {
          console.warn(`Failed to fetch heartbeat for host ${host.hostname}:`, err);
          const fails = (this.consecutiveFailures.get(host.fingerprint) || 0) + 1;
          this.consecutiveFailures.set(host.fingerprint, fails);

          if (fails >= 2) {
            this.hostService.updateHostMetrics(host.fingerprint, null, 'offline');
          }
        }
      });
    });
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
    this.showFilterPanel.set(false);
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
    this.showFilterPanel.set(false);
    this.activeDropdown.set(null);
    this.syncUrl();
  }

  // Dropdown helpers
  toggleDropdown(name: string, event: Event): void {
    event.stopPropagation();
    this.activeDropdown.update(cur => cur === name ? null : name);
  }

  selectFilterValue(filterName: string, value: string, event: Event): void {
    event.stopPropagation();
    // Update both temp AND active immediately — no "Apply" click needed for dropdowns
    switch (filterName) {
      case 'status':  this.tempFilterStatus.set(value);  this.filterStatus.set(value);  break;
      case 'os':      this.tempFilterOS.set(value);      this.filterOS.set(value);      break;
      case 'arch':    this.tempFilterArch.set(value);    this.filterArch.set(value);    break;
      case 'gpu':     this.tempFilterGPU.set(value);     this.filterGPU.set(value);     break;
      case 'vram':    this.tempFilterVram.set(value);    this.filterVram.set(value);    break;
      case 'version': this.tempFilterVersion.set(value); this.filterVersion.set(value); break;
    }
    this.currentPage.set(1);
    this.activeDropdown.set(null);
    this.syncUrl();
  }

  @HostListener('document:click')
  closeAllDropdowns(): void {
    this.activeDropdown.set(null);
    this.isOldDropdownOpen.set(false);
    this.isNewDropdownOpen.set(false);
  }

  // ── Host Migration Methods ───────────────────────────────────────────────────
  toggleOldDropdown(event: Event): void {
    event.stopPropagation();
    this.isNewDropdownOpen.set(false);
    this.isOldDropdownOpen.update(v => !v);
  }

  toggleNewDropdown(event: Event): void {
    event.stopPropagation();
    this.isOldDropdownOpen.set(false);
    this.isNewDropdownOpen.update(v => !v);
  }

  selectOldHost(fingerprint: string, event: Event): void {
    event.stopPropagation();
    this.selectedOldFingerprint.set(fingerprint);
    this.selectedNewFingerprint.set(''); // reset new host when old host changes
    this.isOldDropdownOpen.set(false);
  }

  selectNewHost(fingerprint: string, event: Event): void {
    event.stopPropagation();
    this.selectedNewFingerprint.set(fingerprint);
    this.isNewDropdownOpen.set(false);
  }

  clearOldSelection(event: Event): void {
    event.stopPropagation();
    this.selectedOldFingerprint.set('');
    this.selectedNewFingerprint.set('');
    this.isOldDropdownOpen.set(false);
    this.isNewDropdownOpen.set(false);
  }

  clearNewSelection(event: Event): void {
    event.stopPropagation();
    this.selectedNewFingerprint.set('');
    this.isNewDropdownOpen.set(false);
  }

  openMigrateModal(): void {
    this.selectedOldFingerprint.set('');
    this.selectedNewFingerprint.set('');
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
        alert('Migración de configuración completada con éxito.');
      },
      error: (err) => {
        console.error('Error migrating host setup:', err);
        this.isMigrating.set(false);
        alert('Error al migrar la configuración del nodo.');
      }
    });
  }
}
