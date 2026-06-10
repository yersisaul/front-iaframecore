import { Component, inject, signal, OnInit, HostListener, ViewChild, ElementRef, AfterViewInit, OnDestroy, computed } from '@angular/core';
import { toObservable, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute, Params } from '@angular/router';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { combineLatest, Subject, Subscription } from 'rxjs';
import { startWith, debounceTime, distinctUntilChanged, switchMap, tap, skip } from 'rxjs/operators';
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

  readonly hosts = this.hostService.hosts;
  readonly totalItems = this.hostService.totalItems;
  readonly filteredHosts = this.hosts;

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  readonly currentPage = signal(1, { equal: () => false });

  // Paginación consciente de la cuadrícula
  readonly columns = signal(this.getInitialColumns());
  readonly rows = signal(this.getInitialRows());
  readonly limit = signal(this.columns() * this.rows());

  readonly limitOptions = computed(() => {
    const base = this.columns() * this.rows();
    return [base, base * 2, base * 3, base * 4];
  });

  // Control para el search bar predictivo unificado
  readonly searchControl = new FormControl('', { nonNullable: true });

  // Estados de los filtros activos (enviados al backend)
  readonly filterStatus = signal<string>('all');
  readonly filterOS = signal<string>('all');
  readonly filterArch = signal<string>('all');
  readonly filterGPU = signal<string>('all');
  readonly filterVram = signal<string>('all');
  readonly filterVersion = signal<string>('all');
  readonly showFilterPanel = signal<boolean>(false);

  // Estados de los filtros temporales (editables en el drawer superior)
  readonly tempFilterStatus = signal<string>('all');
  readonly tempFilterOS = signal<string>('all');
  readonly tempFilterArch = signal<string>('all');
  readonly tempFilterGPU = signal<string>('all');
  readonly tempFilterVram = signal<string>('all');
  readonly tempFilterVersion = signal<string>('all');

  readonly activeDropdown = signal<string | null>(null);

  // Opciones dinámicas para los dropdowns
  readonly filterOptions = signal<HostFilterOptions | null>(null);

  private resizeSubject = new Subject<number>();
  private resizeSubscription?: Subscription;
  private resizeObserver?: ResizeObserver;

  private estimateContainerWidth(): number {
    if (typeof window === 'undefined') return 1200;
    const sidebarWidth = this.isSidebarCollapsed() ? 78 : 260;
    const estimatedWidth = window.innerWidth - sidebarWidth - 48;
    return estimatedWidth;
  }

  private getInitialColumns(): number {
    const width = this.estimateContainerWidth();
    const columnas = Math.floor((width + 24) / (420 + 24));
    return Math.max(1, columnas);
  }

  private getInitialRows(): number {
    if (typeof window === 'undefined') return 3;
    return Math.max(3, Math.floor((window.innerHeight - 320) / 280));
  }

  private initializeFromQueryParams(params: Params): void {
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

    const searchVal = params['search'] || '';
    if (this.searchControl.value !== searchVal) {
      this.searchControl.setValue(searchVal, { emitEvent: false });
    }

    const statusVal = params['status'] || 'all';
    if (this.filterStatus() !== statusVal) {
      this.filterStatus.set(statusVal);
    }
    if (this.tempFilterStatus() !== statusVal) {
      this.tempFilterStatus.set(statusVal);
    }

    const osVal = params['os'] || 'all';
    if (this.filterOS() !== osVal) {
      this.filterOS.set(osVal);
    }
    if (this.tempFilterOS() !== osVal) {
      this.tempFilterOS.set(osVal);
    }

    const archVal = params['arch'] || 'all';
    if (this.filterArch() !== archVal) {
      this.filterArch.set(archVal);
    }
    if (this.tempFilterArch() !== archVal) {
      this.tempFilterArch.set(archVal);
    }

    const gpuVal = params['gpu'] || 'all';
    if (this.filterGPU() !== gpuVal) {
      this.filterGPU.set(gpuVal);
    }
    if (this.tempFilterGPU() !== gpuVal) {
      this.tempFilterGPU.set(gpuVal);
    }

    const vramVal = params['vram'] || 'all';
    if (this.filterVram() !== vramVal) {
      this.filterVram.set(vramVal);
    }
    if (this.tempFilterVram() !== vramVal) {
      this.tempFilterVram.set(vramVal);
    }

    const versionVal = params['version'] || 'all';
    if (this.filterVersion() !== versionVal) {
      this.filterVersion.set(versionVal);
    }
    if (this.tempFilterVersion() !== versionVal) {
      this.tempFilterVersion.set(versionVal);
    }
  }

  constructor() {
    // Inicialización síncrona desde ActivatedRoute.snapshot.queryParams
    const initialParams = this.route.snapshot.queryParams;
    this.initializeFromQueryParams(initialParams);

    let isFirstLoad = true;

    // 1. Debounce aislado únicamente para el input de texto de búsqueda
    const debouncedSearch$ = this.searchControl.valueChanges.pipe(
      debounceTime(300),
      startWith(this.searchControl.value),
      distinctUntilChanged()
    );

    // 2. Combinación de búsqueda y filtros activos. Cualquier cambio reseteará a la página 1.
    const filters$ = combineLatest({
      search: debouncedSearch$,
      status: toObservable(this.filterStatus),
      os: toObservable(this.filterOS),
      arch: toObservable(this.filterArch),
      gpu: toObservable(this.filterGPU),
      vram: toObservable(this.filterVram),
      version: toObservable(this.filterVersion)
    }).pipe(
      tap(() => {
        if (isFirstLoad) {
          return;
        }
        if (this.currentPage() !== 1) {
          this.currentPage.set(1);
        }
      })
    );

    // 3. Estado combinado para disparar consultas al servidor (con coalescencia de 20ms)
    combineLatest({
      filters: filters$,
      page: toObservable(this.currentPage),
      limit: toObservable(this.limit)
    }).pipe(
      debounceTime(20),
      tap(({ filters, page, limit }) => {
        const queryParams: any = {};
        
        queryParams['page'] = page > 1 ? page : null;
        queryParams['limit'] = limit !== this.columns() * 3 ? limit : null;
        queryParams['search'] = filters.search || null;
        queryParams['status'] = filters.status !== 'all' ? filters.status : null;
        queryParams['os'] = filters.os !== 'all' ? filters.os : null;
        queryParams['arch'] = filters.arch !== 'all' ? filters.arch : null;
        queryParams['gpu'] = filters.gpu !== 'all' ? filters.gpu : null;
        queryParams['vram'] = filters.vram !== 'all' ? filters.vram : null;
        queryParams['version'] = filters.version !== 'all' ? filters.version : null;

        const currentRouteParams = this.route.snapshot.queryParams;
        const oldSearch = currentRouteParams['search'] || '';
        const searchChanged = oldSearch !== (filters.search || '');

        this.router.navigate([], {
          relativeTo: this.route,
          queryParams,
          queryParamsHandling: 'merge',
          replaceUrl: searchChanged
        });

        isFirstLoad = false;
      }),
      switchMap(({ filters, page, limit }) => {
        return this.hostService.getHosts(page, limit, filters);
      }),
      takeUntilDestroyed()
    ).subscribe();

    // Suscribirse a cambios en los parámetros de consulta de la URL (Back/Forward)
    this.route.queryParams.pipe(
      skip(1),
      takeUntilDestroyed()
    ).subscribe(params => {
      this.initializeFromQueryParams(params);
    });
  }

  ngAfterViewInit(): void {
    // Suscribir al Subject con un debounce de 150ms para evitar spam de peticiones HTTP
    this.resizeSubscription = this.resizeSubject.pipe(
      debounceTime(150)
    ).subscribe(width => {
      this.adjustColumnsAndLimit(width);
    });

    if (typeof ResizeObserver !== 'undefined' && this.hostsGrid) {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          this.resizeSubject.next(entry.contentRect.width);
        }
      });
      this.resizeObserver.observe(this.hostsGrid.nativeElement);
    }
  }

  ngOnDestroy(): void {
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
    const newRows = Math.max(3, Math.floor((window.innerHeight - 320) / 280));
    const oldCols = this.columns();
    const oldRows = this.rows();

    if (newCols !== oldCols || newRows !== oldRows) {
      const oldBase = oldCols * oldRows;
      const currentLimit = this.limit();
      const screens = Math.max(1, Math.min(4, Math.round(currentLimit / oldBase)));
      
      this.columns.set(newCols);
      this.rows.set(newRows);
      
      const newBase = newCols * newRows;
      this.limit.set(newBase * screens);
      this.currentPage.set(1);
    }
  }

  ngOnInit(): void {
    // Carga de opciones de filtrado dinámicas desde el backend
    this.hostService.getHostFilterOptions().subscribe({
      next: (options) => {
        this.filterOptions.set(options);
      }
    });
  }

  get totalPages(): number {
    const total = this.totalItems();
    const lim = this.limit();
    return total > 0 ? Math.ceil(total / lim) : 1;
  }

  get pages(): number[] {
    const total = this.totalPages;
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  setPage(page: number): void {
    if (page >= 1 && page <= this.totalPages) {
      this.currentPage.set(page);
    }
  }

  nextPage(): void {
    if (this.currentPage() < this.totalPages) {
      this.currentPage.update(p => p + 1);
    }
  }

  prevPage(): void {
    if (this.currentPage() > 1) {
      this.currentPage.update(p => p - 1);
    }
  }

  onLimitChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newLimit = parseInt(select.value, 10);
    this.limit.set(newLimit);
    this.currentPage.set(1);
  }

  goToCameras(hostId: string): void {
    this.router.navigate(['/dashboard/nodos', hostId, 'camaras']);
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  hasActiveFilters(): boolean {
    return this.searchControl.value.trim() !== '' ||
           this.filterStatus() !== 'all' ||
           this.filterOS() !== 'all' ||
           this.filterArch() !== 'all' ||
           this.filterGPU() !== 'all' ||
           this.filterVram() !== 'all' ||
           this.filterVersion() !== 'all';
  }

  toggleFilterPanel(): void {
    if (!this.showFilterPanel()) {
      // Sincronizar estados temporales con los activos al abrir el panel
      this.tempFilterStatus.set(this.filterStatus());
      this.tempFilterOS.set(this.filterOS());
      this.tempFilterArch.set(this.filterArch());
      this.tempFilterGPU.set(this.filterGPU());
      this.tempFilterVram.set(this.filterVram());
      this.tempFilterVersion.set(this.filterVersion());
    }
    this.showFilterPanel.update(show => !show);
  }

  onFilterStatusChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.tempFilterStatus.set(select.value);
  }

  onFilterOSChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.tempFilterOS.set(select.value);
  }

  onFilterArchChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.tempFilterArch.set(select.value);
  }

  onFilterGPUChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.tempFilterGPU.set(select.value);
  }

  onFilterVramChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.tempFilterVram.set(select.value);
  }

  onFilterVersionChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.tempFilterVersion.set(select.value);
  }

  applyFilters(): void {
    // Aplicar los filtros temporales a las señales activas para detonar la búsqueda
    this.filterStatus.set(this.tempFilterStatus());
    this.filterOS.set(this.tempFilterOS());
    this.filterArch.set(this.tempFilterArch());
    this.filterGPU.set(this.tempFilterGPU());
    this.filterVram.set(this.tempFilterVram());
    this.filterVersion.set(this.tempFilterVersion());
    this.showFilterPanel.set(false);
  }

  resetFilters(): void {
    this.searchControl.setValue('', { emitEvent: true });
    
    this.tempFilterStatus.set('all');
    this.tempFilterOS.set('all');
    this.tempFilterArch.set('all');
    this.tempFilterGPU.set('all');
    this.tempFilterVram.set('all');
    this.tempFilterVersion.set('all');

    this.filterStatus.set('all');
    this.filterOS.set('all');
    this.filterArch.set('all');
    this.filterGPU.set('all');
    this.filterVram.set('all');
    this.filterVersion.set('all');
    
    this.showFilterPanel.set(false);
    this.activeDropdown.set(null);
  }

  toggleDropdown(dropdownName: string, event: Event): void {
    event.stopPropagation();
    if (this.activeDropdown() === dropdownName) {
      this.activeDropdown.set(null);
    } else {
      this.activeDropdown.set(dropdownName);
    }
  }

  selectFilterValue(filterName: string, value: string, event: Event): void {
    event.stopPropagation();
    if (filterName === 'status') this.tempFilterStatus.set(value);
    else if (filterName === 'os') this.tempFilterOS.set(value);
    else if (filterName === 'arch') this.tempFilterArch.set(value);
    else if (filterName === 'gpu') this.tempFilterGPU.set(value);
    else if (filterName === 'vram') this.tempFilterVram.set(value);
    else if (filterName === 'version') this.tempFilterVersion.set(value);
    this.activeDropdown.set(null);
  }

  @HostListener('document:click')
  closeAllDropdowns(): void {
    this.activeDropdown.set(null);
  }
}
