import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { OpenSearchRepository } from './opensearch.repository';
import { MetadataMapper } from '../mappers/metadata.mapper';
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

  it('should map img_plate_crop_minio_object_name on vehicle records when present and default to empty string', () => {
    const withPlate = MetadataMapper.toDomainVehiculo({
      _id: 'veh-1',
      _score: 0.95,
      _source: {
        camara: 'Entrada',
        timestamp: '2026-11-17T10:00:00Z',
        confiabilidad: 0.95,
        img_minio_object_name: 'vehicles/veh-1.jpg',
        img_plate_crop_minio_object_name: 'plates/plate-1.jpg',
        tipo_objeto: 'automovil',
        colores: [],
        reconocimiento: 'ABC123'
      }
    });
    expect(withPlate.imgMinioObjectName).toBe('vehicles/veh-1.jpg');
    expect(withPlate.imgPlateCropMinioObjectName).toBe('plates/plate-1.jpg');

    const withoutPlate = MetadataMapper.toDomainVehiculo({
      _id: 'veh-2',
      _score: 0.9,
      _source: {
        camara: 'Entrada',
        timestamp: '2026-11-17T10:01:00Z',
        confiabilidad: 0.9,
        img_minio_object_name: 'vehicles/veh-2.jpg',
        tipo_objeto: 'camioneta',
        colores: [],
        reconocimiento: ''
      }
    });
    expect(withoutPlate.imgMinioObjectName).toBe('vehicles/veh-2.jpg');
    expect(withoutPlate.imgPlateCropMinioObjectName).toBe('');
  });
});

