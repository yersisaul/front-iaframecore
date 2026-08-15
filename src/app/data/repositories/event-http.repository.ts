import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, EMPTY } from 'rxjs';
import { map, catchError, expand, reduce, switchMap } from 'rxjs/operators';
import { AppEnvironment } from '../../core/config/app-environment';
import { EventFilters, EventFilterOptions, defaultEventFilterOptions, EventRecord } from '../../core/domain/entities/event.models';
import { IEventRepository, EventSearchResult } from '../../core/domain/repositories/event.repository';
import { EventMapper } from '../mappers/event.mapper';
import { OsResponse } from './dtos/opensearch-response.dto';

interface InternalEventSearchResult extends EventSearchResult {
  lastSort?: any[];
}

@Injectable({
  providedIn: 'root'
})
export class EventHttpRepository implements IEventRepository {
  constructor(private http: HttpClient) {}

  private ensureMaxResultWindow(): Observable<any> {
    return this.http.put(`${AppEnvironment.openSearchBaseUrl}/_all/_settings`, {
      'index.max_result_window': 2147483647
    }).pipe(
      catchError(err => of(null))
    );
  }

  search(
    filters: EventFilters,
    page: number,
    pageSize: number
  ): Observable<EventSearchResult> {
    // pageSize >= 10000 o <= 0: fetch masivo completo con search_after encadenado
    if (pageSize >= 10000 || pageSize <= 0) {
      return this.fetchAllEventsInRange(filters);
    }
    return this.searchPage(filters, page, pageSize);
  }

  private fetchAllEventsInRange(filters: EventFilters): Observable<EventSearchResult> {
    const fetchChunkSize = 5000;

    return this.searchPageWithSearchAfter(filters, fetchChunkSize, null).pipe(
      expand(prevResult => {
        const currentCount = prevResult.records.length;
        if (currentCount === 0 || currentCount >= prevResult.total || !prevResult.lastSort) {
          return EMPTY;
        }
        return this.searchPageWithSearchAfter(filters, fetchChunkSize, prevResult.lastSort).pipe(
          map(nextResult => ({
            records: [...prevResult.records, ...nextResult.records],
            total: nextResult.total,
            filterOptions: nextResult.filterOptions,
            lastSort: nextResult.lastSort
          }))
        );
      }),
      reduce((acc, current) => current)
    );
  }

  private searchPageWithSearchAfter(
    filters: EventFilters,
    pageSize: number,
    searchAfter: any[] | null
  ): Observable<InternalEventSearchResult> {
    const mustFilters = this.buildMustFilters(filters);

    const aggs = {
      camara_vals: { terms: { field: 'nombre_camara', size: 100 } },
      analitica_vals: { terms: { field: 'analitica', size: 100 } },
      objeto_vals: { terms: { field: 'objeto', size: 100 } }
    };

    const queryBody: any = {
      track_total_hits: true,
      size: pageSize,
      sort: [
        { timestamp: { order: 'desc' } },
        { _id: { order: 'desc' } }
      ],
      query: mustFilters.length > 0 ? { bool: { filter: mustFilters } } : { match_all: {} },
      aggs: aggs
    };

    if (searchAfter) {
      queryBody.search_after = searchAfter;
    }

    return this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/eventos/_search`, queryBody).pipe(
      map(res => {
        const hits = res.hits?.hits || [];
        const records = hits.map(EventMapper.toDomain);

        let total = 0;
        if (res.hits?.total) {
          total = typeof res.hits.total === 'number' ? res.hits.total : res.hits.total.value;
        }

        const lastHit = hits[hits.length - 1];
        const lastSort = lastHit ? lastHit.sort : undefined;

        const filterOptions = this.parseFilterOptions(res.aggregations);

        return {
          records,
          total,
          filterOptions,
          lastSort
        };
      }),
      catchError(err => {
        console.error('Error fetching events chunk from OpenSearch:', err);
        return of({
          records: [],
          total: 0,
          filterOptions: defaultEventFilterOptions()
        });
      })
    );
  }

  private searchPage(
    filters: EventFilters,
    page: number,
    pageSize: number
  ): Observable<EventSearchResult> {
    const mustFilters = this.buildMustFilters(filters);

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
        { timestamp: { order: 'desc' } },
        { _id: { order: 'desc' } }
      ],
      query: mustFilters.length > 0 ? { bool: { filter: mustFilters } } : { match_all: {} },
      aggs: aggs
    };

    const fallbackQuery = {
      track_total_hits: true,
      from: (page - 1) * pageSize,
      size: pageSize,
      sort: [
        { timestamp: { order: 'desc' } },
        { _id: { order: 'desc' } }
      ],
      query: mustFilters.length > 0 ? { bool: { filter: mustFilters } } : { match_all: {} }
    };

    const parseResult = (res: OsResponse<any>): EventSearchResult => {
      const hits = res.hits?.hits || [];
      const records = hits.map(EventMapper.toDomain);
      let total = 0;
      if (res.hits?.total) {
        total = typeof res.hits.total === 'number' ? res.hits.total : res.hits.total.value;
      }
      return { records, total, filterOptions: this.parseFilterOptions(res.aggregations) };
    };

    return this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/eventos/_search`, queryBody).pipe(
      map(res => parseResult(res)),
      catchError(err => {
        console.warn(`[OpenSearch] Eventos query falló (${err?.status || err?.message}). Ampliando max_result_window y reintentando...`);
        return this.ensureMaxResultWindow().pipe(
          switchMap(() => this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/eventos/_search`, fallbackQuery)),
          map(res => ({ ...parseResult(res), filterOptions: defaultEventFilterOptions() })),
          catchError(err2 => {
            console.error('[OpenSearch] Reintento de eventos falló:', err2?.error || err2);
            return of<EventSearchResult>({ records: [], total: 0, filterOptions: defaultEventFilterOptions() });
          })
        );
      })
    );
  }

  private buildMustFilters(filters: EventFilters): any[] {
    const mustFilters: any[] = [];

    if (filters.camaras && filters.camaras.length > 0) {
      mustFilters.push({ terms: { nombre_camara: filters.camaras } });
    }

    if (filters.analiticas && filters.analiticas.length > 0) {
      mustFilters.push({ terms: { analitica: filters.analiticas } });
    }

    if (filters.objetos && filters.objetos.length > 0) {
      mustFilters.push({ terms: { objeto: filters.objetos } });
    }

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

    if (filters.search && filters.search.trim()) {
      const q = filters.search.trim();
      const escapedQ = q.replace(/[-[\]{}()*+?View^$|#\\]/g, '\\$&');

      mustFilters.push({
        bool: {
          should: [
            // 1.ª prioridad — nombre de cámara
            { wildcard: { 'nombre_camara': { value: `*${q}*`, case_insensitive: true } } },
            { wildcard: { 'nombre_camara.keyword': { value: `*${q}*`, case_insensitive: true } } },
            // 2.ª prioridad — tipo de analítica
            { wildcard: { 'analitica': { value: `*${q}*`, case_insensitive: true } } },
            { wildcard: { 'analitica.keyword': { value: `*${q}*`, case_insensitive: true } } },
            // 3.ª prioridad — tipo de objeto
            { wildcard: { 'objeto': { value: `*${q}*`, case_insensitive: true } } },
            { wildcard: { 'objeto.keyword': { value: `*${q}*`, case_insensitive: true } } },

            {
              multi_match: {
                query: q,
                fields: [
                  'nombre_camara^3',
                  'nombre_camara.keyword^3',
                  'analitica^2',
                  'analitica.keyword^2',
                  'objeto',
                  'objeto.keyword'
                ],
                type: 'best_fields',
                fuzziness: 'AUTO'
              }
            },

            {
              query_string: {
                query: `*${escapedQ}*`,
                fields: [
                  'nombre_camara^3',
                  'nombre_camara.keyword^3',
                  'analitica^2',
                  'analitica.keyword^2',
                  'objeto',
                  'objeto.keyword'
                ],
                default_operator: 'OR',
                analyze_wildcard: true
              }
            }
          ],
          minimum_should_match: 1
        }
      });
    }

    return mustFilters;
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
