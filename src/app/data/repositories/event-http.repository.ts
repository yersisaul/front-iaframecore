import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { AppEnvironment } from '../../core/config/app-environment';
import { EventFilters, EventFilterOptions, defaultEventFilterOptions, EventRecord } from '../../core/domain/entities/event.models';
import { IEventRepository, EventSearchResult } from '../../core/domain/repositories/event.repository';
import { EventMapper } from '../mappers/event.mapper';
import { OsResponse } from './dtos/opensearch-response.dto';

@Injectable({
  providedIn: 'root'
})
export class EventHttpRepository implements IEventRepository {
  constructor(private http: HttpClient) {}

  search(
    filters: EventFilters,
    page: number,
    pageSize: number
  ): Observable<EventSearchResult> {
    const mustFilters: any[] = [];

    // 1. camaras (nombre_camara)
    if (filters.camaras && filters.camaras.length > 0) {
      mustFilters.push({ terms: { nombre_camara: filters.camaras } });
    }

    // 2. analiticas
    if (filters.analiticas && filters.analiticas.length > 0) {
      mustFilters.push({ terms: { analitica: filters.analiticas } });
    }

    // 3. objetos
    if (filters.objetos && filters.objetos.length > 0) {
      mustFilters.push({ terms: { objeto: filters.objetos } });
    }

    // 4. timestamp range
    const timestampRange: any = {};
    if (filters.timestampDesde) {
      timestampRange.gte = filters.timestampDesde.toISOString();
    }
    if (filters.timestampHasta) {
      timestampRange.lte = filters.timestampHasta.toISOString();
    }
    if (Object.keys(timestampRange).length > 0) {
      mustFilters.push({ range: { timestamp: timestampRange } });
    }

    // 5. search text
    if (filters.search && filters.search.trim()) {
      mustFilters.push({
        multi_match: {
          query: filters.search.trim(),
          fields: ['nombre_camara^2', 'objeto^2', 'detalle_evento^3', 'analitica'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      });
    }

    // Aggregations
    const aggs = {
      camara_vals: { terms: { field: 'nombre_camara', size: 100 } },
      analitica_vals: { terms: { field: 'analitica', size: 100 } },
      objeto_vals: { terms: { field: 'objeto', size: 100 } }
    };

    const queryBody = {
      track_total_hits: true,
      from: (page - 1) * pageSize,
      size: pageSize,
      sort: [
        { timestamp: { order: 'desc' } }
      ],
      query: mustFilters.length > 0 ? { bool: { filter: mustFilters } } : { match_all: {} },
      aggs: aggs
    };

    return this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/eventos/_search`, queryBody).pipe(
      map(res => {
        const hits = res.hits?.hits || [];
        const records = hits.map(EventMapper.toDomain);

        let total = 0;
        if (res.hits?.total) {
          total = typeof res.hits.total === 'number' ? res.hits.total : res.hits.total.value;
        }

        const filterOptions = this.parseFilterOptions(res.aggregations);

        return {
          records,
          total,
          filterOptions
        };
      }),
      catchError(err => {
        console.error('Error fetching events from OpenSearch:', err);
        return of({
          records: [],
          total: 0,
          filterOptions: defaultEventFilterOptions()
        });
      })
    );
  }

  private parseFilterOptions(aggs: any): EventFilterOptions {
    const options = defaultEventFilterOptions();
    if (!aggs) return options;

    if (aggs.camara_vals && aggs.camara_vals.buckets) {
      options.camaras = aggs.camara_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.analitica_vals && aggs.analitica_vals.buckets) {
      options.analiticas = aggs.analitica_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.objeto_vals && aggs.objeto_vals.buckets) {
      options.objetos = aggs.objeto_vals.buckets.map((b: any) => b.key);
    }

    return options;
  }

  getById(docId: string): Observable<EventRecord> {
    return this.http.get<any>(`${AppEnvironment.openSearchBaseUrl}/eventos/_doc/${docId}`).pipe(
      map(res => EventMapper.toDomain(res))
    );
  }
}
