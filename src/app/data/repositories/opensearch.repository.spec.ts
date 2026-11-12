import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { OpenSearchRepository } from './opensearch.repository';
import { defaultFilterState } from '../../core/domain/entities/metadata.filters.models';
import { AppEnvironment } from '../../core/config/app-environment';

describe('OpenSearchRepository (Snapshot query options)', () => {
  let repository: OpenSearchRepository;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        OpenSearchRepository
      ]
    });

    repository = TestBed.inject(OpenSearchRepository);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('should apply snapshotHasta and excludeIds without altering user filters', () => {
    const snapshotHasta = new Date('2026-11-12T10:00:00.000Z');
    const filters = {
      ...defaultFilterState(),
      timestampDesde: new Date('2026-11-12T08:00:00.000Z'),
      timestampHasta: new Date('2026-11-12T23:59:59.000Z')
    };

    let result: any;
    repository.search('personas', filters, 2, 60, {
      snapshotHasta,
      excludeIds: ['buf-1', 'buf-2']
    }).subscribe(res => {
      result = res;
    });

    const req = httpMock.expectOne(`${AppEnvironment.openSearchBaseUrl}/personas/_search`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.from).toBe(60);
    expect(req.request.body.size).toBe(60);

    const filterClauses = req.request.body.query.bool.filter;
    expect(filterClauses).toContainEqual({
      range: {
        timestamp: {
          gte: '2026-11-12T08:00:00.000Z',
          lte: '2026-11-12T10:00:00.000Z'
        }
      }
    });
    expect(filterClauses).toContainEqual({
      bool: {
        must_not: [
          { ids: { values: ['buf-1', 'buf-2'] } }
        ]
      }
    });

    req.flush({ hits: { total: { value: 0 }, hits: [] }, aggregations: {} });
    expect(result.total).toBe(0);
  });

  it('should preserve user timestampHasta when it is earlier than snapshotHasta', () => {
    const filters = {
      ...defaultFilterState(),
      timestampHasta: new Date('2026-11-10T12:00:00.000Z')
    };

    repository.search('personas', filters, 1, 60, {
      snapshotHasta: new Date('2026-11-12T10:00:00.000Z'),
      excludeIds: []
    }).subscribe();

    const req = httpMock.expectOne(`${AppEnvironment.openSearchBaseUrl}/personas/_search`);
    const filterClauses = req.request.body.query.bool.filter;
    expect(filterClauses).toContainEqual({
      range: {
        timestamp: {
          lte: '2026-11-10T12:00:00.000Z'
        }
      }
    });

    req.flush({ hits: { total: { value: 0 }, hits: [] }, aggregations: {} });
  });
});

