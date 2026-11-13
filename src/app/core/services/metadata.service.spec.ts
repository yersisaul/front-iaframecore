import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { MetadataService } from './metadata.service';
import { IMetadataRepository } from '../domain/repositories/metadata.repository';
import { SearchMetadataUseCase } from '../domain/use-cases/search-metadata.use-case';
import { defaultFilterOptions, defaultFilterState } from '../domain/entities/metadata.filters.models';

describe('MetadataService (Pause & Buffer)', () => {
  let service: MetadataService;
  let mockMetadataRepo: any;

  const makeRecord = (id: string, timestamp: string) => ({
    id,
    camara: 'Cam 1',
    timestamp,
    confiabilidad: 0.95,
    colores: []
  }) as any;

  beforeEach(() => {
    mockMetadataRepo = {
      getAvailableIndices: vi.fn().mockReturnValue(of([])),
      search: vi.fn().mockReturnValue(of({
        records: [],
        total: 0,
        filterOptions: defaultFilterOptions()
      })),
      searchFacesByImage: vi.fn().mockReturnValue(of([])),
      getById: vi.fn().mockReturnValue(of(null))
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        MetadataService,
        SearchMetadataUseCase,
        { provide: IMetadataRepository, useValue: mockMetadataRepo }
      ]
    });

    service = TestBed.inject(MetadataService);
    service.activeIndex.set('personas');
  });

  it('should start paused by default and buffer incoming records on page 1 without filters', () => {
    expect(service.isLivePaused()).toBe(true);

    service.addNewRecord(makeRecord('m-1', '2026-11-12T10:00:00Z'));

    expect(service.records().length).toBe(0);
    expect(service.totalRecords()).toBe(0);
    expect(service.bufferedEvents().map(r => r.id)).toEqual(['m-1']);
  });

  it('should insert records directly in real time when unpaused on page 1 without filters', () => {
    service.setLivePaused(false);

    service.addNewRecord(makeRecord('m-live', '2026-11-12T10:05:00Z'));

    expect(service.bufferedEvents().length).toBe(0);
    expect(service.records().map(r => r.id)).toEqual(['m-live']);
    expect(service.totalRecords()).toBe(1);
  });

  it('should flush buffered records and activate real-time when applyBufferedEvents is called while paused', () => {
    service.records.set([makeRecord('m-old', '2026-11-12T09:00:00Z')]);
    service.totalRecords.set(1);

    service.addNewRecord(makeRecord('m-buf-1', '2026-11-12T10:00:00Z'));
    service.addNewRecord(makeRecord('m-buf-2', '2026-11-12T10:01:00Z'));

    expect(service.isLivePaused()).toBe(true);
    expect(service.bufferedEvents().length).toBe(2);

    service.applyBufferedEvents();

    expect(service.isLivePaused()).toBe(false);
    expect(service.bufferedEvents().length).toBe(0);
    expect(service.records().map(r => r.id)).toEqual(['m-buf-2', 'm-buf-1', 'm-old']);
    expect(service.totalRecords()).toBe(3);
  });

  it('should flush buffer automatically when toggling from paused to active on page 1 without filters', () => {
    service.records.set([makeRecord('m-old', '2026-11-12T09:00:00Z')]);
    service.totalRecords.set(1);

    service.addNewRecord(makeRecord('m-buf-1', '2026-11-12T10:00:00Z'));

    service.toggleLivePause(); // true -> false

    expect(service.isLivePaused()).toBe(false);
    expect(service.bufferedEvents().length).toBe(0);
    expect(service.records().map(r => r.id)).toEqual(['m-buf-1', 'm-old']);
    expect(service.totalRecords()).toBe(2);
  });

  it('should return to page 1 and flush buffer when toggling from En espera to En vivo on page > 1 (with or without buffer)', () => {
    // Subcaso A: página 2 con eventos en buffer
    service.snapshotCutoff.set(new Date('2026-11-12T09:30:00.000Z'));
    service.currentPage.set(2);
    service.addNewRecord(makeRecord('m-page2', '2026-11-12T10:05:00Z'));
    mockMetadataRepo.search.mockReturnValue(of({
      records: [makeRecord('m-p1', '2026-11-12T10:00:00Z')],
      total: 120,
      filterOptions: defaultFilterOptions()
    }));

    service.toggleLivePause(); // true -> false

    expect(service.isLivePaused()).toBe(false);
    expect(service.currentPage()).toBe(1);
    expect(service.bufferedEvents().length).toBe(0);
    expect(service.snapshotCutoff()).toBeNull();
    expect(mockMetadataRepo.search).toHaveBeenLastCalledWith(
      'personas',
      expect.anything(),
      1,
      60,
      undefined
    );
    expect(service.records().map(r => r.id)).toEqual(['m-page2', 'm-p1']);

    // Subcaso B: página 3 con buffer vacío también regresa a página 1 y recarga en vivo
    service.setLivePaused(true);
    service.snapshotCutoff.set(new Date('2026-11-12T10:05:00.000Z'));
    service.currentPage.set(3);
    mockMetadataRepo.search.mockClear();

    service.toggleLivePause(); // true -> false

    expect(service.isLivePaused()).toBe(false);
    expect(service.currentPage()).toBe(1);
    expect(service.snapshotCutoff()).toBeNull();
    expect(mockMetadataRepo.search).toHaveBeenLastCalledWith(
      'personas',
      expect.anything(),
      1,
      60,
      undefined
    );
  });

  it('should NOT auto-flush buffer when resuming on page 1 with active filters', () => {
    service.currentPage.set(1);
    service.filters.set({ ...defaultFilterState(), camaras: ['Cam 1'] });
    service.addNewRecord(makeRecord('m-filt', '2026-11-12T10:00:00Z'));

    service.toggleLivePause(); // true -> false

    expect(service.isLivePaused()).toBe(false);
    expect(service.currentPage()).toBe(1);
    expect(service.bufferedEvents().map(r => r.id)).toEqual(['m-filt']);
  });

  it('should NOT auto-merge remainingBuffer in loadCurrentPage while paused', () => {
    mockMetadataRepo.search.mockReturnValue(of({
      records: [makeRecord('m-server', '2026-11-12T09:00:00Z')],
      total: 1,
      filterOptions: defaultFilterOptions()
    }));

    service.addNewRecord(makeRecord('m-buf', '2026-11-12T10:00:00Z'));
    service.loadCurrentPage();

    expect(service.records().map(r => r.id)).toEqual(['m-server']);
    expect(service.bufferedEvents().map(r => r.id)).toEqual(['m-buf']);
  });

  it('should clear bufferedEvents and previous snapshotCutoff when switching active index via initializeIndexAndState', () => {
    const oldSnapshot = new Date('2026-11-12T08:00:00.000Z');
    service.snapshotCutoff.set(oldSnapshot);
    service.addNewRecord(makeRecord('m-persona', '2026-11-12T10:00:00Z'));
    expect(service.bufferedEvents().length).toBe(1);

    mockMetadataRepo.search.mockReturnValue(of({
      records: [makeRecord('v-1', '2026-11-12T11:30:00Z')],
      total: 1,
      filterOptions: defaultFilterOptions()
    }));

    service.initializeIndexAndState('vehiculos', 1, 60, defaultFilterState());

    expect(service.activeIndex()).toBe('vehiculos');
    expect(service.bufferedEvents().length).toBe(0);
    // La consulta al nuevo índice no debe heredar el snapshot ni el buffer del índice anterior
    expect(mockMetadataRepo.search).toHaveBeenLastCalledWith(
      'vehiculos',
      expect.anything(),
      1,
      60,
      undefined
    );
    // Mientras está pausado, el nuevo índice queda anclado a su propia carga inicial
    expect(service.snapshotCutoff()?.toISOString()).toBe('2026-11-12T11:30:00.000Z');
  });

  it('should anchor snapshotCutoff on initial load when paused and preserve snapshot + buffer across page 1 -> 2 -> 1', () => {
    mockMetadataRepo.search.mockReturnValue(of({
      records: [makeRecord('m-snap', '2026-11-12T10:00:00Z')],
      total: 120,
      filterOptions: defaultFilterOptions()
    }));

    service.loadCurrentPage();
    expect(service.snapshotCutoff()?.toISOString()).toBe('2026-11-12T10:00:00.000Z');

    // Nuevo metadato llega por WebSocket mientras está pausado
    service.addNewRecord(makeRecord('m-buf', '2026-11-12T10:05:00Z'));
    expect(service.bufferedEvents().map(r => r.id)).toEqual(['m-buf']);

    // Cambiar a página 2 y regresar a página 1 debe mantener el mismo snapshotCutoff y excluir m-buf
    service.setPage(2);
    expect(mockMetadataRepo.search).toHaveBeenLastCalledWith(
      'personas',
      expect.anything(),
      2,
      60,
      {
        snapshotHasta: new Date('2026-11-12T10:00:00.000Z'),
        excludeIds: ['m-buf']
      }
    );
    expect(service.bufferedEvents().map(r => r.id)).toEqual(['m-buf']);

    service.setPage(1);
    expect(mockMetadataRepo.search).toHaveBeenLastCalledWith(
      'personas',
      expect.anything(),
      1,
      60,
      {
        snapshotHasta: new Date('2026-11-12T10:00:00.000Z'),
        excludeIds: ['m-buf']
      }
    );
    expect(service.bufferedEvents().map(r => r.id)).toEqual(['m-buf']);
  });

  it('should preserve snapshotCutoff and bufferedEvents when paging with active filters even if live mode is active', () => {
    service.setLivePaused(false);
    mockMetadataRepo.search.mockReturnValue(of({
      records: [makeRecord('m-filt-1', '2026-11-12T10:00:00Z')],
      total: 120,
      filterOptions: defaultFilterOptions()
    }));

    service.updateFilters({ camaras: ['Cam 1'] });
    expect(service.snapshotCutoff()?.toISOString()).toBe('2026-11-12T10:00:00.000Z');

    service.addNewRecord(makeRecord('m-filt-buf', '2026-11-12T10:02:00Z'));
    expect(service.bufferedEvents().map(r => r.id)).toEqual(['m-filt-buf']);

    service.setPage(2);
    service.setPage(1);

    expect(mockMetadataRepo.search).toHaveBeenLastCalledWith(
      'personas',
      expect.objectContaining({ camaras: ['Cam 1'] }),
      1,
      60,
      {
        snapshotHasta: new Date('2026-11-12T10:00:00.000Z'),
        excludeIds: ['m-filt-buf']
      }
    );
    expect(service.bufferedEvents().map(r => r.id)).toEqual(['m-filt-buf']);
  });

  it('should reset snapshotCutoff when applying filters or returning to page 1 in real-time without filters', () => {
    service.setLivePaused(false);
    service.records.set([makeRecord('m-live-1', '2026-11-12T10:00:00Z')]);

    // Al ir a página 2 en tiempo real sin filtros, ancla snapshot para evitar offset drift
    service.setPage(2);
    expect(service.snapshotCutoff()?.toISOString()).toBe('2026-11-12T10:00:00.000Z');

    // Al regresar a página 1 en tiempo real sin filtros, libera el snapshot
    service.setPage(1);
    expect(service.snapshotCutoff()).toBeNull();

    // Aplicar filtros resetea el snapshot previo antes de consultar
    service.snapshotCutoff.set(new Date('2026-11-12T09:00:00.000Z'));
    mockMetadataRepo.search.mockReturnValue(of({
      records: [makeRecord('m-new-filt', '2026-11-12T11:00:00Z')],
      total: 1,
      filterOptions: defaultFilterOptions()
    }));
    service.updateFilters({ camaras: ['Cam 2'] });
    expect(service.snapshotCutoff()?.toISOString()).toBe('2026-11-12T11:00:00.000Z');
  });
});

