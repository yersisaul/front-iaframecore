import { Injectable, signal } from '@angular/core';
import { Observable, of, Subscription, share } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { MetaIndexName, MetaRecord, MetaIndexInfo, MetaRostro } from '../domain/entities/metadata.models';
import { MetaFilterState, MetaFilterOptions, defaultFilterState, defaultFilterOptions } from '../domain/entities/metadata.filters.models';
import { IMetadataRepository } from '../domain/repositories/metadata.repository';
import { SearchMetadataUseCase } from '../domain/use-cases/search-metadata.use-case';

@Injectable({
  providedIn: 'root'
})
export class MetadataService {
  readonly availableIndices = signal<MetaIndexInfo[]>([]);
  readonly activeIndex = signal<MetaIndexName | null>(null);
  readonly isViewActive = signal<boolean>(false);
  readonly records = signal<MetaRecord[]>([]);
  readonly totalRecords = signal<number>(0);
  readonly filters = signal<MetaFilterState>(defaultFilterState());
  readonly filterOptions = signal<MetaFilterOptions>(defaultFilterOptions());
  readonly isLoading = signal<boolean>(false);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(24);
  readonly newRecordIds = signal<Set<string>>(new Set());
  readonly bufferedEvents = signal<MetaRecord[]>([]);

  markAsNew(id: string): void {
    this.newRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 900);
  }

  hasActiveFilters(f: MetaFilterState): boolean {
    if (!f) return false;
    return (f.camaras && f.camaras.length > 0) ||
           (f.tipoObjeto && f.tipoObjeto.length > 0) ||
           !!f.edad ||
           !!f.genero ||
           !!(f.reconocimiento && f.reconocimiento.trim()) ||
           (f.colores && f.colores.length > 0) ||
           (f.posturas && f.posturas.length > 0) ||
           (f.confiabilidadMin > 0) ||
           (f.confiabilidadMax < 1) ||
           f.timestampDesde !== null ||
           f.timestampHasta !== null ||
           f.coincidenciaFiltro !== 'all' ||
           !!(f.search && f.search.trim()) ||
           !!f.imageSearchUrl ||
           !!f.imageEmbedding;
  }

  addNewRecord(newRecord: MetaRecord): void {
    const f = this.filters();
    const activeFiltersExist = this.hasActiveFilters(f);
    const isPaginating = this.currentPage() > 1;
    const shouldBuffer = activeFiltersExist || isPaginating;

    if (shouldBuffer) {
      this.bufferedEvents.update(prev => {
        if (prev.some(r => r.id === newRecord.id)) return prev;
        return [newRecord, ...prev];
      });
    } else {
      // Si está en la página 1 y sin filtros activos, insertar directamente arriba
      this.records.update(list => {
        if (list.some(r => r.id === newRecord.id)) return list;
        const nextList = [newRecord, ...list];
        return nextList.slice(0, this.pageSize());
      });
      this.totalRecords.update(n => n + 1);
      this.markAsNew(newRecord.id);
    }
  }

  applyBufferedEvents(): void {
    const buffer = this.bufferedEvents();
    this.bufferedEvents.set([]);
    if (buffer.length === 0) return;

    if (this.currentPage() === 1) {
      // ⚡ INSTANTÁNEO (0ms de red): Ya estamos en la página 1, insertamos localmente
      this.records.update(r => {
        const limit = this.pageSize();
        const updated = [...buffer, ...r];
        const unique = updated.filter((item, index, self) =>
          index === self.findIndex(t => t.id === item.id)
        );
        return unique.slice(0, limit);
      });
      this.totalRecords.update(t => t + buffer.length);
      buffer.forEach(e => this.markAsNew(e.id));
    } else {
      // 🌐 NAVEGACIÓN (Página > 1 a Página 1): Carga los 24 registros reales de la Página 1
      this.currentPage.set(1);
      this.loadCurrentPage(buffer);
    }
  }

  constructor(
    private repository: IMetadataRepository,
    private searchMetadataUseCase: SearchMetadataUseCase
  ) {}

  loadAvailableIndices(): Observable<MetaIndexInfo[]> {
    this.isLoading.set(true);
    return this.repository.getAvailableIndices().pipe(
      tap(indices => {
        this.availableIndices.set(indices);
        this.isLoading.set(false);
      }),
      catchError(err => {
        console.error('Error loading available indices:', err);
        const fallback: MetaIndexInfo[] = [
          { name: 'personas', count: 0 },
          { name: 'vehiculos', count: 0 },
          { name: 'rostros', count: 0 },
          { name: 'otros', count: 0 }
        ];
        this.availableIndices.set(fallback);
        this.isLoading.set(false);
        return of(fallback);
      })
    );
  }

  incrementIndexCount(indexName: MetaIndexName): void {
    this.availableIndices.update(list => {
      return list.map(item => {
        if (item.name === indexName) {
          return { ...item, count: item.count + 1 };
        }
        return item;
      });
    });
  }

  setActiveIndex(index: MetaIndexName): void {
    this.bufferedEvents.set([]);
    this.activeIndex.set(index);
    this.currentPage.set(1);
    this.resetFilters();
  }

  updateFilters(newFilters: Partial<MetaFilterState>): void {
    this.bufferedEvents.set([]);
    this.filters.update(current => ({
      ...current,
      ...newFilters
    }));
    this.currentPage.set(1);
    this.loadCurrentPage();
  }

  resetFilters(): void {
    this.bufferedEvents.set([]);
    this.filters.set(defaultFilterState());
    this.currentPage.set(1);
    this.loadCurrentPage();
  }

  setPage(page: number): void {
    this.currentPage.set(page);
    this.loadCurrentPage();
  }

  setPageSize(size: number): void {
    if (this.pageSize() === size) return;
    this.pageSize.set(size);
    const total = this.totalRecords();
    const maxPage = total > 0 ? Math.ceil(total / size) : 1;
    if (this.currentPage() > maxPage) {
      this.currentPage.set(maxPage);
    }
    this.loadCurrentPage();
  }

  initializeIndexAndState(index: MetaIndexName, page: number, pageSize: number, filters: MetaFilterState): void {
    let changed = false;
    let indexChanged = false;

    if (this.activeIndex() !== index) {
      this.activeIndex.set(index);
      changed = true;
      indexChanged = true;
    }
    if (this.currentPage() !== page) {
      this.currentPage.set(page);
      changed = true;
    }
    if (this.pageSize() !== pageSize) {
      this.pageSize.set(pageSize);
      changed = true;
    }
    const currentFilters = this.filters();
    const mergedFilters = indexChanged ? {
      ...filters,
      imageEmbedding: null,
      imageSearchUrl: null,
      imageFile: null
    } : {
      ...filters,
      imageEmbedding: currentFilters.imageEmbedding,
      imageSearchUrl: currentFilters.imageSearchUrl,
      imageFile: currentFilters.imageFile
    };
    if (!this.areFiltersEqual(currentFilters, mergedFilters)) {
      this.filters.set(mergedFilters);
      changed = true;
    }

    if (changed || this.records().length === 0) {
      this.loadCurrentPage();
    }
  }

  private activeSubscription?: Subscription;

  loadCurrentPage(bufferPrefix?: MetaRecord[]): void {
    const idx = this.activeIndex();
    if (!idx) return;

    if (this.activeSubscription) {
      this.activeSubscription.unsubscribe();
    }

    const filters = this.filters();
    if (idx === 'rostros' && filters.imageFile) {
      this.isLoading.set(true);
      this.activeSubscription = this.repository.searchFacesByImage(filters.imageFile, this.pageSize()).subscribe({
        next: records => {
          let finalRecords = records;
          if (bufferPrefix && bufferPrefix.length > 0) {
            const combined = [...bufferPrefix, ...records];
            finalRecords = (combined as MetaRostro[]).filter((item, index, self) =>
              index === self.findIndex(t => t.id === item.id)
            ).slice(0, this.pageSize());
            bufferPrefix.forEach(r => this.markAsNew(r.id));
          }
          this.records.set(finalRecords);
          this.totalRecords.set(records.length);
          this.isLoading.set(false);
        },
        error: err => {
          console.error('Error searching faces by image in loadCurrentPage:', err);
          this.records.set([]);
          this.totalRecords.set(0);
          this.isLoading.set(false);
        }
      });
      return;
    }

    this.isLoading.set(true);
    this.activeSubscription = this.searchMetadataUseCase.execute(
      idx,
      filters,
      this.currentPage(),
      this.pageSize()
    ).subscribe({
      next: res => {
        const totalPages = res.total > 0 ? Math.ceil(res.total / this.pageSize()) : 1;
        if (this.currentPage() > totalPages && res.total > 0) {
          this.currentPage.set(totalPages);
          this.loadCurrentPage(bufferPrefix);
          return;
        }

        let finalRecords = res.records;
        if (bufferPrefix && bufferPrefix.length > 0) {
          const combined = [...bufferPrefix, ...res.records];
          finalRecords = combined.filter((item, index, self) =>
            index === self.findIndex(t => t.id === item.id)
          ).slice(0, this.pageSize());
          bufferPrefix.forEach(r => this.markAsNew(r.id));
        }

        this.records.set(finalRecords);
        this.totalRecords.set(Math.max(res.total, finalRecords.length));
        this.filterOptions.set(res.filterOptions);
        this.isLoading.set(false);
      },
      error: err => {
        console.error('Error loading metadata page:', err);
        this.records.set([]);
        this.totalRecords.set(0);
        this.isLoading.set(false);
      }
    });
  }

  searchFacesByImage(file: File, searchUrl?: string): Observable<MetaRostro[]> {
    this.filters.update(current => ({
      ...current,
      imageFile: file,
      imageSearchUrl: searchUrl || current.imageSearchUrl
    }));
    this.currentPage.set(1);

    this.isLoading.set(true);
    const size = this.pageSize();

    if (this.activeSubscription) {
      this.activeSubscription.unsubscribe();
    }

    const searchObs = this.repository.searchFacesByImage(file, size).pipe(
      tap(records => {
        this.records.set(records);
        this.totalRecords.set(records.length);
        this.isLoading.set(false);
      }),
      catchError(err => {
        console.error('Error searching faces by image in service:', err);
        this.records.set([]);
        this.totalRecords.set(0);
        this.isLoading.set(false);
        return of([]);
      }),
      share()
    );

    this.activeSubscription = searchObs.subscribe();
    return searchObs;
  }

  private areFiltersEqual(a: MetaFilterState, b: MetaFilterState): boolean {
    if (a.edad !== b.edad) return false;
    if (a.genero !== b.genero) return false;
    if (a.reconocimiento !== b.reconocimiento) return false;
    if (a.confiabilidadMin !== b.confiabilidadMin) return false;
    if (a.confiabilidadMax !== b.confiabilidadMax) return false;
    if (a.search !== b.search) return false;
    if (a.coincidenciaFiltro !== b.coincidenciaFiltro) return false;
    if (a.imageSearchUrl !== b.imageSearchUrl) return false;
    if (a.imageFile !== b.imageFile) return false;

    // Compare dates
    const dateA = a.timestampDesde ? new Date(a.timestampDesde).getTime() : null;
    const dateB = b.timestampDesde ? new Date(b.timestampDesde).getTime() : null;
    if (dateA !== dateB) return false;

    const dateEndA = a.timestampHasta ? new Date(a.timestampHasta).getTime() : null;
    const dateEndB = b.timestampHasta ? new Date(b.timestampHasta).getTime() : null;
    if (dateEndA !== dateEndB) return false;

    // Compare arrays with sorting
    const arraysEqual = (x?: string[], y?: string[]) => {
      const arrX = [...(x || [])].sort();
      const arrY = [...(y || [])].sort();
      if (arrX.length !== arrY.length) return false;
      return arrX.every((v, i) => v === arrY[i]);
    };

    if (!arraysEqual(a.tipoObjeto, b.tipoObjeto)) return false;
    if (!arraysEqual(a.colores, b.colores)) return false;
    if (!arraysEqual(a.posturas, b.posturas)) return false;
    if (!arraysEqual(a.camaras, b.camaras)) return false;

    // Compare image embeddings
    const embedA = a.imageEmbedding || [];
    const embedB = b.imageEmbedding || [];
    if (embedA.length !== embedB.length) return false;
    if (embedA.some((v, i) => v !== embedB[i])) return false;

    return true;
  }
}
