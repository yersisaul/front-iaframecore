import { Injectable, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
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
  readonly records = signal<MetaRecord[]>([]);
  readonly totalRecords = signal<number>(0);
  readonly filters = signal<MetaFilterState>(defaultFilterState());
  readonly filterOptions = signal<MetaFilterOptions>(defaultFilterOptions());
  readonly isLoading = signal<boolean>(false);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(24);
  readonly newRecordIds = signal<Set<string>>(new Set());

  markAsNew(id: string): void {
    this.newRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 900);
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
    this.activeIndex.set(index);
    this.currentPage.set(1);
    this.resetFilters();
  }

  updateFilters(newFilters: Partial<MetaFilterState>): void {
    this.filters.update(current => ({
      ...current,
      ...newFilters
    }));
    this.currentPage.set(1);
    this.loadCurrentPage();
  }

  resetFilters(): void {
    this.filters.set(defaultFilterState());
    this.currentPage.set(1);
    this.loadCurrentPage();
  }

  setPage(page: number): void {
    this.currentPage.set(page);
    this.loadCurrentPage();
  }

  setPageSize(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
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

  loadCurrentPage(): void {
    const idx = this.activeIndex();
    if (!idx) return;

    const filters = this.filters();
    if (idx === 'rostros' && filters.imageFile) {
      this.isLoading.set(true);
      this.repository.searchFacesByImage(filters.imageFile, this.pageSize()).subscribe({
        next: records => {
          this.records.set(records);
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
    this.searchMetadataUseCase.execute(
      idx,
      filters,
      this.currentPage(),
      this.pageSize()
    ).subscribe({
      next: res => {
        this.records.set(res.records);
        this.totalRecords.set(res.total);
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
    return this.repository.searchFacesByImage(file, size).pipe(
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
      })
    );
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

    // Compare arrays
    const arraysEqual = (x?: string[], y?: string[]) => {
      const arrX = x || [];
      const arrY = y || [];
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
