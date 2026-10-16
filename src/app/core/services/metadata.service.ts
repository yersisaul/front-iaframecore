import { Injectable, signal } from '@angular/core';
import { Observable, of, Subscription, share } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { MetaIndexName, MetaRecord, MetaIndexInfo, MetaRostro } from '../domain/entities/metadata.models';
import { MetaFilterState, MetaFilterOptions, defaultFilterState, defaultFilterOptions } from '../domain/entities/metadata.filters.models';
import { IMetadataRepository } from '../domain/repositories/metadata.repository';
import { SearchMetadataUseCase } from '../domain/use-cases/search-metadata.use-case';
import { parseUtcDate } from '../utils/date-utils';

function getRecordTimestampMs(item: { timestamp?: any }): number {
  if (!item || !item.timestamp) return 0;
  if (item.timestamp instanceof Date) return item.timestamp.getTime();
  if (typeof item.timestamp === 'number') return item.timestamp;
  return parseUtcDate(item.timestamp).getTime();
}

function sortByTimestampDesc<T extends { timestamp?: any }>(items: T[]): T[] {
  return [...items].sort((a, b) => getRecordTimestampMs(b) - getRecordTimestampMs(a));
}

const DEFAULT_INDICES: MetaIndexInfo[] = [
  { name: 'personas', count: 0 },
  { name: 'vehiculos', count: 0 },
  { name: 'rostros', count: 0 },
  { name: 'otros', count: 0 }
];

const INDICES_CACHE_KEY = 'ia_available_indices_cache';

function getInitialIndices(): MetaIndexInfo[] {
  try {
    const cached = localStorage.getItem(INDICES_CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    // Ignorar errores de acceso a storage
  }
  return DEFAULT_INDICES;
}

@Injectable({
  providedIn: 'root'
})
export class MetadataService {
  readonly availableIndices = signal<MetaIndexInfo[]>(getInitialIndices());
  readonly activeIndex = signal<MetaIndexName | null>(null);
  readonly isViewActive = signal<boolean>(false);
  readonly records = signal<MetaRecord[]>([]);
  readonly totalRecords = signal<number>(0);
  readonly filters = signal<MetaFilterState>(defaultFilterState());
  readonly filterOptions = signal<MetaFilterOptions>(defaultFilterOptions());
  readonly isLoading = signal<boolean>(false);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(60);
  readonly newRecordIds = signal<Set<string>>(new Set());
  readonly bufferedEvents = signal<MetaRecord[]>([]);
  readonly allImageSearchResults = signal<MetaRostro[]>([]);

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
           (f.edad && f.edad.length > 0) ||
           (f.genero && f.genero.length > 0) ||
           (f.reconocimiento && f.reconocimiento.length > 0) ||
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

  incorporateRecordIntoFilterOptions(record: MetaRecord): void {
    if (!record) return;
    this.filterOptions.update(opts => {
      const current = { ...opts };
      let changed = false;

      if (record.camara && !current.camaras.includes(record.camara)) {
        current.camaras = [...current.camaras, record.camara].sort();
        changed = true;
      }

      if ('tipoObjeto' in record && (record as any).tipoObjeto && !current.tipoObjeto.includes((record as any).tipoObjeto)) {
        current.tipoObjeto = [...current.tipoObjeto, (record as any).tipoObjeto].sort();
        changed = true;
      }

      if ('edad' in record && (record as any).edad && !current.edades.includes((record as any).edad)) {
        current.edades = [...current.edades, (record as any).edad].sort();
        changed = true;
      }

      if ('genero' in record && (record as any).genero && !current.generos.includes((record as any).genero)) {
        current.generos = [...current.generos, (record as any).genero].sort();
        changed = true;
      }

      if ('reconocimiento' in record && (record as any).reconocimiento && !current.reconocimientos.includes((record as any).reconocimiento)) {
        current.reconocimientos = [...current.reconocimientos, (record as any).reconocimiento].sort();
        changed = true;
      }

      if (record.colores && Array.isArray(record.colores)) {
        record.colores.forEach(c => {
          if (c.colorText && !current.colores.includes(c.colorText)) {
            current.colores = [...current.colores, c.colorText].sort();
            changed = true;
          }
        });
      }

      if ('posturas' in record && (record as any).posturas && Array.isArray((record as any).posturas)) {
        (record as any).posturas.forEach((p: any) => {
          if (p.postura && !current.posturas.includes(p.postura)) {
            current.posturas = [...current.posturas, p.postura].sort();
            changed = true;
          }
        });
      }

      return changed ? current : opts;
    });
  }

  addNewRecord(newRecord: MetaRecord): void {
    this.incorporateRecordIntoFilterOptions(newRecord);

    const f = this.filters();
    const activeFiltersExist = this.hasActiveFilters(f);
    const isPaginating = this.currentPage() > 1;
    const isQueryLoading = this.isLoading();
    const shouldBuffer = activeFiltersExist || isPaginating || isQueryLoading;

    if (shouldBuffer) {
      this.bufferedEvents.update(prev => {
        if (prev.some(r => r.id === newRecord.id) || this.records().some(r => r.id === newRecord.id)) {
          return prev;
        }
        return sortByTimestampDesc([newRecord, ...prev]);
      });
    } else {
      // Si está en la página 1, sin filtros activos y NO está cargando, insertar directamente arriba
      this.records.update(list => {
        if (list.some(r => r.id === newRecord.id)) return list;
        const limit = this.pageSize();
        const updated = sortByTimestampDesc([newRecord, ...list]);
        return updated.slice(0, limit);
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
        return sortByTimestampDesc(unique).slice(0, limit);
      });
      this.totalRecords.update(t => t + buffer.length);
      buffer.forEach(e => this.markAsNew(e.id));
    } else {
      // 🌐 NAVEGACIÓN (Página > 1 a Página 1): Carga los registros reales de la Página 1
      this.currentPage.set(1);
      this.loadCurrentPage(buffer);
    }
  }

  constructor(
    private repository: IMetadataRepository,
    private searchMetadataUseCase: SearchMetadataUseCase
  ) {}

  loadAvailableIndices(): Observable<MetaIndexInfo[]> {
    return this.repository.getAvailableIndices().pipe(
      tap(indices => {
        if (indices && indices.length > 0) {
          this.availableIndices.set(indices);
          try {
            localStorage.setItem(INDICES_CACHE_KEY, JSON.stringify(indices));
          } catch (e) {
            // Ignorar
          }
        }
      }),
      catchError(err => {
        console.error('Error loading available indices:', err);
        return of(this.availableIndices());
      })
    );
  }

  incrementIndexCount(indexName: MetaIndexName): void {
    this.availableIndices.update(list => {
      const nextList = list.map(item => {
        if (item.name === indexName) {
          return { ...item, count: item.count + 1 };
        }
        return item;
      });
      try {
        localStorage.setItem(INDICES_CACHE_KEY, JSON.stringify(nextList));
      } catch (e) {
        // Ignorar
      }
      return nextList;
    });
  }

  syncIndexCount(indexName: MetaIndexName, count: number): void {
    this.availableIndices.update(list => {
      const nextList = list.map(item => {
        if (item.name === indexName) {
          return { ...item, count };
        }
        return item;
      });
      try {
        localStorage.setItem(INDICES_CACHE_KEY, JSON.stringify(nextList));
      } catch (e) {
        // Ignorar
      }
      return nextList;
    });
  }

  setActiveIndex(index: MetaIndexName): void {
    this.bufferedEvents.set([]);
    this.allImageSearchResults.set([]);
    this.activeIndex.set(index);
    this.currentPage.set(1);
    this.resetFilters();
  }

  updateFilters(newFilters: Partial<MetaFilterState>): void {
    this.bufferedEvents.set([]);
    if (newFilters.imageFile === null || (newFilters.imageFile === undefined && !this.filters().imageFile)) {
      this.allImageSearchResults.set([]);
    }
    this.filters.update(current => ({
      ...current,
      ...newFilters
    }));
    this.currentPage.set(1);
    this.loadCurrentPage();
  }

  resetFilters(): void {
    this.bufferedEvents.set([]);
    this.allImageSearchResults.set([]);
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
      this.filterOptions.set(defaultFilterOptions());
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

  private applyImagePagination(bufferPrefix?: MetaRecord[]): void {
    const all = this.allImageSearchResults();
    const page = this.currentPage();
    const pageSize = this.pageSize();
    const total = all.length;
    this.totalRecords.set(total);

    const from = (page - 1) * pageSize;
    const to = from + pageSize;
    let pageRecords = all.slice(from, to);

    if (bufferPrefix && bufferPrefix.length > 0) {
      const combined = [...bufferPrefix, ...pageRecords];
      const unique = (combined as MetaRostro[]).filter((item, index, self) =>
        index === self.findIndex(t => t.id === item.id)
      );
      pageRecords = sortByTimestampDesc(unique).slice(0, pageSize);
      bufferPrefix.forEach(r => this.markAsNew(r.id));
    }

    // Deduplicación contra el buffer
    const pageIds = new Set(pageRecords.map(r => r.id));
    this.bufferedEvents.update(buf => buf.filter(b => !pageIds.has(b.id)));

    this.records.set(pageRecords);
    if (this.activeIndex()) {
      this.syncIndexCount(this.activeIndex()!, total);
    }
  }

  loadCurrentPage(bufferPrefix?: MetaRecord[]): void {
    const idx = this.activeIndex();
    if (!idx) return;

    if (this.activeSubscription) {
      this.activeSubscription.unsubscribe();
    }

    const filters = this.filters();
    if (idx === 'rostros' && filters.imageFile) {
      if (this.allImageSearchResults().length > 0) {
        this.applyImagePagination(bufferPrefix);
        return;
      }

      this.isLoading.set(true);
      this.activeSubscription = this.repository.searchFacesByImage(filters.imageFile, 100).subscribe({
        next: records => {
          this.allImageSearchResults.set(records);
          this.applyImagePagination(bufferPrefix);
          this.isLoading.set(false);
        },
        error: err => {
          console.error('Error searching faces by image in loadCurrentPage:', err);
          this.allImageSearchResults.set([]);
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
          const uniquePrefix = combined.filter((item, index, self) =>
            index === self.findIndex(t => t.id === item.id)
          );
          finalRecords = sortByTimestampDesc(uniquePrefix).slice(0, this.pageSize());
          bufferPrefix.forEach(r => this.markAsNew(r.id));
        }

        // Deduplicación contra el buffer:
        // Si llegaron metadatos al buffer durante la carga de OpenSearch que YA vinieron en res.records,
        // eliminarlos del buffer para no tener duplicados.
        const resIds = new Set(finalRecords.map(r => r.id));
        const remainingBuffer = this.bufferedEvents().filter(b => !resIds.has(b.id));

        // En la página 1 y SIN filtros activos, incorporar el buffer AUTOMÁTICAMENTE al inicio del grid ordenado por timestamp
        const activeFiltersExist = this.hasActiveFilters(this.filters());
        const isPage1 = this.currentPage() === 1;

        if (isPage1 && !activeFiltersExist && remainingBuffer.length > 0) {
          const combined = [...remainingBuffer, ...finalRecords];
          const deduplicated = combined.filter((item, index, self) =>
            index === self.findIndex(t => t.id === item.id)
          );
          finalRecords = sortByTimestampDesc(deduplicated).slice(0, this.pageSize());

          remainingBuffer.forEach(e => this.markAsNew(e.id));
          this.bufferedEvents.set([]); // Limpiar buffer para que no quede botón pendiente
        } else {
          this.bufferedEvents.set(remainingBuffer);
        }

        const finalCount = Math.max(res.total, finalRecords.length);
        this.records.set(finalRecords);
        this.totalRecords.set(finalCount);
        this.filterOptions.update(prev => {
          const incoming = res.filterOptions;
          if (!incoming) return prev;
          return {
            tipoObjeto: incoming.tipoObjeto && incoming.tipoObjeto.length > 0 ? incoming.tipoObjeto : prev.tipoObjeto,
            edades: incoming.edades && incoming.edades.length > 0 ? incoming.edades : prev.edades,
            generos: incoming.generos && incoming.generos.length > 0 ? incoming.generos : prev.generos,
            camaras: incoming.camaras && incoming.camaras.length > 0 ? incoming.camaras : prev.camaras,
            reconocimientos: incoming.reconocimientos && incoming.reconocimientos.length > 0 ? incoming.reconocimientos : prev.reconocimientos,
            colores: incoming.colores && incoming.colores.length > 0 ? incoming.colores : prev.colores,
            posturas: incoming.posturas && incoming.posturas.length > 0 ? incoming.posturas : prev.posturas,
            confiabilidadStats: incoming.confiabilidadStats || prev.confiabilidadStats
          };
        });
        this.syncIndexCount(idx, finalCount);
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

    if (this.activeSubscription) {
      this.activeSubscription.unsubscribe();
    }

    const searchObs = this.repository.searchFacesByImage(file, 100).pipe(
      tap(records => {
        this.allImageSearchResults.set(records);
        this.applyImagePagination();
        this.isLoading.set(false);
      }),
      catchError(err => {
        console.error('Error searching faces by image in service:', err);
        this.allImageSearchResults.set([]);
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
    if (!arraysEqual(a.edad, b.edad)) return false;
    if (!arraysEqual(a.genero, b.genero)) return false;
    if (!arraysEqual(a.reconocimiento, b.reconocimiento)) return false;
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
