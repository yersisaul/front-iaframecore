import { Injectable, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { EventRecord, EventFilters, EventFilterOptions, defaultEventFilters, defaultEventFilterOptions } from '../domain/entities/event.models';
import { SearchEventsUseCase } from '../domain/use-cases/search-events.use-case';

@Injectable({
  providedIn: 'root'
})
export class EventService {
  readonly records = signal<EventRecord[]>([]);
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

  addNewEvent(newEvent: EventRecord): void {
    const f = this.filters();
    const hasActiveFilters = f.camaras.length > 0 ||
                             f.analiticas.length > 0 ||
                             f.objetos.length > 0 ||
                             f.timestampDesde !== null ||
                             f.timestampHasta !== null ||
                             (f.search && f.search.trim().length > 0);

    // Si el usuario está paginando (pág > 1) o tiene filtros activos, acumulamos en buffer
    const shouldBuffer = this.currentPage() > 1 || hasActiveFilters;

    if (shouldBuffer) {
      this.bufferedEvents.update(prev => [newEvent, ...prev]);
    } else {
      this.records.update(r => {
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
    if (buffer.length === 0) return;

    this.records.update(r => {
      const limit = this.pageSize();
      const updated = [...buffer, ...r];
      return updated.slice(0, limit);
    });
    this.totalRecords.update(t => t + buffer.length);
    buffer.forEach(e => this.markAsNew(e.id));
    this.bufferedEvents.set([]);
  }

  constructor(private searchEventsUseCase: SearchEventsUseCase) {}

  updateFilters(newFilters: Partial<EventFilters>): void {
    this.filters.update(current => ({
      ...current,
      ...newFilters
    }));
    this.currentPage.set(1);
    this.loadCurrentPage();
  }

  resetFilters(): void {
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

  loadCurrentPage(): void {
    this.isLoading.set(true);
    this.searchEventsUseCase.execute(
      this.filters(),
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
        console.error('Error loading events page:', err);
        this.records.set([]);
        this.totalRecords.set(0);
        this.isLoading.set(false);
      }
    });
  }
}
