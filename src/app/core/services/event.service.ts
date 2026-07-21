import { Injectable, signal } from '@angular/core';
import { Observable, of, Subscription } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { EventRecord, EventFilters, EventFilterOptions, defaultEventFilters, defaultEventFilterOptions } from '../domain/entities/event.models';
import { SearchEventsUseCase } from '../domain/use-cases/search-events.use-case';
import { parseUtcDate } from '../utils/date-utils';

@Injectable({
  providedIn: 'root'
})
export class EventService {
  readonly records = signal<EventRecord[]>([]);
  readonly isViewActive = signal<boolean>(false);
  readonly totalRecords = signal<number>(0);
  readonly filters = signal<EventFilters>(defaultEventFilters());
  readonly filterOptions = signal<EventFilterOptions>(defaultEventFilterOptions());
  readonly isLoading = signal<boolean>(false);
  readonly currentPage = signal<number>(1);
  readonly pageSize = signal<number>(24);
  readonly newRecordIds = signal<Set<string>>(new Set());
  readonly bufferedEvents = signal<EventRecord[]>([]);

  markAsNew(id: string): void {
    this.newRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 900);
  }

  hasActiveFilters(f: EventFilters): boolean {
    if (!f) return false;
    return (f.camaras && f.camaras.length > 0) ||
           (f.analiticas && f.analiticas.length > 0) ||
           (f.objetos && f.objetos.length > 0) ||
           f.timestampDesde !== null ||
           f.timestampHasta !== null ||
           !!(f.search && f.search.trim().length > 0);
  }

  matchesEventFilters(record: EventRecord, filters: EventFilters): boolean {
    if (!record || !filters) return true;

    // 1. Camaras
    if (filters.camaras && filters.camaras.length > 0) {
      const matchCam = filters.camaras.some(
        c => c.toLowerCase() === (record.nombreCamara || '').toLowerCase() ||
             c.toLowerCase() === (record.idCamara || '').toLowerCase()
      );
      if (!matchCam) return false;
    }

    // 2. Analiticas
    if (filters.analiticas && filters.analiticas.length > 0) {
      const matchAna = filters.analiticas.some(
        a => a.toLowerCase() === (record.analitica || '').toLowerCase()
      );
      if (!matchAna) return false;
    }

    // 3. Objetos
    if (filters.objetos && filters.objetos.length > 0) {
      const matchObj = filters.objetos.some(
        o => o.toLowerCase() === (record.objeto || '').toLowerCase()
      );
      if (!matchObj) return false;
    }

    // 4. Rango de Fechas
    if (record.timestamp) {
      const d = parseUtcDate(record.timestamp);
      if (filters.timestampDesde && d.getTime() < filters.timestampDesde.getTime()) {
        return false;
      }
      if (filters.timestampHasta && d.getTime() > filters.timestampHasta.getTime()) {
        return false;
      }
    }

    // 5. Búsqueda de texto libre
    if (filters.search && filters.search.trim().length > 0) {
      const q = filters.search.trim().toLowerCase();
      const text = [
        record.nombreCamara,
        record.idCamara,
        record.analitica,
        record.objeto,
        record.detalleEvento,
        record.direccion
      ].filter(Boolean).join(' ').toLowerCase();

      if (!text.includes(q)) return false;
    }

    return true;
  }

  addNewEvent(newEvent: EventRecord): void {
    const f = this.filters();

    // 1. Validar primero si el nuevo evento cumple con TODOS los filtros activos en pantalla
    if (!this.matchesEventFilters(newEvent, f)) {
      console.log(`[EventService] Evento ${newEvent.id} descartado porque no coincide con los filtros activos.`);
      return;
    }

    // 2. Si el usuario tiene filtros activos O está en página > 1, acumulamos en el buffer y mostramos el indicador
    const activeFiltersExist = this.hasActiveFilters(f);
    const isPaginating = this.currentPage() > 1;
    const shouldBuffer = activeFiltersExist || isPaginating;

    if (shouldBuffer) {
      this.bufferedEvents.update(prev => {
        if (prev.some(e => e.id === newEvent.id)) return prev;
        return [newEvent, ...prev];
      });
    } else {
      // Si está en la página 1 y SIN filtros activos, insertar directamente arriba
      this.records.update(r => {
        if (r.some(e => e.id === newEvent.id)) return r;
        const limit = this.pageSize();
        const updated = [newEvent, ...r];
        return updated.slice(0, limit);
      });
      this.totalRecords.update(t => t + 1);
      this.markAsNew(newEvent.id);
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

  constructor(private searchEventsUseCase: SearchEventsUseCase) {}

  updateFilters(newFilters: Partial<EventFilters>): void {
    this.bufferedEvents.set([]); // Limpiar buffer de filtros anteriores
    this.filters.update(current => ({
      ...current,
      ...newFilters
    }));
    this.currentPage.set(1);
    this.loadCurrentPage();
  }

  resetFilters(): void {
    this.bufferedEvents.set([]); // Limpiar buffer
    this.filters.set(defaultEventFilters());
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

  private activeSubscription?: Subscription;

  loadCurrentPage(bufferPrefix?: EventRecord[]): void {
    if (this.activeSubscription) {
      this.activeSubscription.unsubscribe();
    }

    this.isLoading.set(true);
    this.activeSubscription = this.searchEventsUseCase.execute(
      this.filters(),
      this.currentPage(),
      this.pageSize()
    ).subscribe({
      next: res => {
        let finalRecords = res.records;
        if (bufferPrefix && bufferPrefix.length > 0) {
          const combined = [...bufferPrefix, ...res.records];
          finalRecords = combined.filter((item, index, self) =>
            index === self.findIndex(t => t.id === item.id)
          ).slice(0, this.pageSize());
          bufferPrefix.forEach(e => this.markAsNew(e.id));
        }

        this.records.set(finalRecords);
        this.totalRecords.set(Math.max(res.total, finalRecords.length));
        this.filterOptions.set(res.filterOptions);
        this.isLoading.set(false);
      },
      error: err => {
        console.error('Error loading events page:', err);
        this.records.set([]);
        this.totalRecords.set(0);
        this.isLoading.set(false);
      }
    });
  }
}
