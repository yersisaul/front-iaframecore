import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, forkJoin, EMPTY } from 'rxjs';
import { map, catchError, switchMap, expand, reduce } from 'rxjs/operators';
import { MetaFilterState, MetaFilterOptions, defaultFilterOptions } from '../../core/domain/entities/metadata.filters.models';
import { MetaIndexName, MetaRecord, MetaIndexInfo, MetaRostro } from '../../core/domain/entities/metadata.models';
import { IMetadataRepository, MetadataSearchResult } from '../../core/domain/repositories/metadata.repository';
import { MetadataMapper } from '../mappers/metadata.mapper';
import { OsResponse, CatIndexResponse } from './dtos/opensearch-response.dto';
import { AppEnvironment } from '../../core/config/app-environment';
import { parseUtcDate } from '../../core/utils/date-utils';

interface InternalMetadataSearchResult extends MetadataSearchResult {
  lastSort?: any[];
}

@Injectable({
  providedIn: 'root'
})
export class OpenSearchRepository implements IMetadataRepository {
  constructor(private http: HttpClient) {}

  getAvailableIndices(): Observable<MetaIndexInfo[]> {
    const validNames: MetaIndexName[] = ['personas', 'vehiculos', 'rostros', 'otros'];
    const countRequests = validNames.map(name =>
      this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/${name}/_search`, {
        track_total_hits: true,
        size: 0
      }).pipe(
        map(res => {
          let count = 0;
          if (res.hits?.total) {
            count = typeof res.hits.total === 'number' ? res.hits.total : (res.hits.total.value || 0);
          }
          return { name, count };
        }),
        catchError(err => {
          console.warn(`[OpenSearchRepository] No se pudo consultar _search para índice "${name}":`, err);
          return of({ name, count: 0 });
        })
      )
    );

    return forkJoin(countRequests);
  }

  search(
    index: MetaIndexName,
    filters: MetaFilterState,
    page: number,
    pageSize: number
  ): Observable<MetadataSearchResult> {
    if (pageSize >= 10000 || pageSize <= 0) {
      return this.fetchAllMetadataInRange(index, filters);
    }
    return this.searchPage(index, filters, page, pageSize);
  }

  private fetchAllMetadataInRange(
    index: MetaIndexName,
    filters: MetaFilterState
  ): Observable<MetadataSearchResult> {
    const fetchChunkSize = 5000;

    return this.searchPageWithSearchAfter(index, filters, fetchChunkSize, null).pipe(
      expand(prevResult => {
        const currentCount = prevResult.records.length;
        if (currentCount === 0 || currentCount >= prevResult.total || !prevResult.lastSort) {
          return EMPTY;
        }
        return this.searchPageWithSearchAfter(index, filters, fetchChunkSize, prevResult.lastSort).pipe(
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
    index: MetaIndexName,
    filters: MetaFilterState,
    pageSize: number,
    searchAfter: any[] | null
  ): Observable<InternalMetadataSearchResult> {
    const mustFilters = this.buildMustFilters(index, filters);
    const aggs = this.buildAggs(index);

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

    return this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/${index}/_search`, queryBody).pipe(
      map(res => {
        const hits = res.hits?.hits || [];
        const records = hits.map((h: any) => MetadataMapper.toDomain(index, h));
        let total = 0;
        if (res.hits?.total) {
          total = typeof res.hits.total === 'number' ? res.hits.total : res.hits.total.value;
        }
        const lastHit = hits[hits.length - 1];
        const lastSort = lastHit ? lastHit.sort : undefined;

        return {
          records,
          total,
          filterOptions: this.parseFilterOptions(res.aggregations),
          lastSort
        };
      }),
      catchError(err => {
        console.error(`Error fetching metadata chunk from index "${index}":`, err);
        return of({
          records: [],
          total: 0,
          filterOptions: defaultFilterOptions()
        });
      })
    );
  }

  private ensureMaxResultWindow(): Observable<any> {
    return this.http.put(`${AppEnvironment.openSearchBaseUrl}/_all/_settings`, {
      'index.max_result_window': 2147483647
    }).pipe(
      catchError(err => {
        console.warn('[OpenSearch] No se pudo actualizar max_result_window:', err);
        return of(null);
      })
    );
  }

  private searchPage(
    index: MetaIndexName,
    filters: MetaFilterState,
    page: number,
    pageSize: number
  ): Observable<MetadataSearchResult> {
    const mustFilters = this.buildMustFilters(index, filters);
    const aggs = this.buildAggs(index);

    let queryBody: any;
    if (filters.imageEmbedding && filters.imageEmbedding.length > 0) {
      queryBody = {
        track_total_hits: true,
        from: (page - 1) * pageSize,
        size: pageSize,
        query: {
          knn: {
            embedding: {
              vector: filters.imageEmbedding,
              k: Math.max(100, (page * pageSize) + pageSize),
              ...(mustFilters.length > 0 ? { filter: { bool: { filter: mustFilters } } } : {})
            }
          }
        },
        aggs: aggs
      };
    } else {
      queryBody = {
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
    }

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

    const parseResult = (res: OsResponse<any>): MetadataSearchResult => {
      const hits = res.hits?.hits || [];
      const records = hits.map((h: any) => MetadataMapper.toDomain(index, h));
      let total = 0;
      if (res.hits?.total) {
        total = typeof res.hits.total === 'number' ? res.hits.total : res.hits.total.value;
      }
      return { records, total, filterOptions: this.parseFilterOptions(res.aggregations) };
    };

    return this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/${index}/_search`, queryBody).pipe(
      map(res => parseResult(res)),
      catchError(err => {
        console.warn(`[OpenSearch] Query falló en índice "${index}" (${err?.status || err?.message}). Ampliando max_result_window y reintentando...`);
        return this.ensureMaxResultWindow().pipe(
          switchMap(() => this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/${index}/_search`, fallbackQuery)),
          map(res => ({ ...parseResult(res), filterOptions: defaultFilterOptions() })),
          catchError(err2 => {
            console.error(`[OpenSearch] Reintento en índice "${index}" falló:`, err2?.error || err2);
            return of<MetadataSearchResult>({ records: [], total: 0, filterOptions: defaultFilterOptions() });
          })
        );
      })
    );
  }


  private buildMustFilters(index: MetaIndexName, filters: MetaFilterState): any[] {
    const mustFilters: any[] = [];

    if (filters.tipoObjeto && filters.tipoObjeto.length > 0) {
      mustFilters.push(this.buildTermsFilter('tipo_objeto', filters.tipoObjeto));
    }

    if (filters.edad && filters.edad.length > 0) {
      mustFilters.push(this.buildTermsFilter('edad', filters.edad));
    }

    if (filters.genero && filters.genero.length > 0) {
      mustFilters.push(this.buildTermsFilter('genero', filters.genero));
    }

    if (filters.reconocimiento && filters.reconocimiento.length > 0) {
      const allVariants = new Set<string>();
      const wildcards: any[] = [];

      filters.reconocimiento.forEach(rawVal => {
        const val = (rawVal || '').trim();
        if (!val) return;
        const valClean = val.replace(/[^A-Za-z0-9]/g, '');
        const variants = [
          val,
          val.toLowerCase(),
          val.toUpperCase(),
          valClean,
          valClean.toLowerCase(),
          valClean.toUpperCase()
        ].filter(Boolean);

        variants.forEach(v => {
          allVariants.add(v);
          wildcards.push({ wildcard: { 'reconocimiento.keyword': { value: `*${v}*`, case_insensitive: true } } });
          wildcards.push({ wildcard: { 'reconocimiento': { value: `*${v}*`, case_insensitive: true } } });
        });
      });

      if (allVariants.size > 0) {
        const variantsArr = Array.from(allVariants);
        const shouldClause: any[] = [
          { terms: { 'reconocimiento': variantsArr } },
          { terms: { 'reconocimiento.keyword': variantsArr } },
          ...wildcards
        ];

        mustFilters.push({
          bool: {
            should: shouldClause,
            minimum_should_match: 1
          }
        });
      }
    }

    if (filters.colores && filters.colores.length > 0) {
      mustFilters.push({
        nested: {
          path: 'colores',
          query: this.buildTermsFilter('colores.color_text', filters.colores)
        }
      });
    }

    if (filters.posturas && filters.posturas.length > 0 && index === 'personas') {
      mustFilters.push({
        nested: {
          path: 'posturas',
          query: this.buildTermsFilter('posturas.postura', filters.posturas)
        }
      });
    }

    if (filters.camaras && filters.camaras.length > 0) {
      mustFilters.push(this.buildTermsFilter('camara', filters.camaras));
    }

    const confiabilidadIsFiltered = filters.confiabilidadMin > 0 || filters.confiabilidadMax < 1;
    if (confiabilidadIsFiltered) {
      mustFilters.push({
        range: {
          confiabilidad: {
            gte: filters.confiabilidadMin,
            lte: filters.confiabilidadMax
          }
        }
      });
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
            { wildcard: { 'camara': { value: `*${q}*`, case_insensitive: true } } },
            { wildcard: { 'camara.keyword': { value: `*${q}*`, case_insensitive: true } } },
            // 2.ª prioridad — reconocimiento (nombre de persona o placa)
            { wildcard: { 'reconocimiento': { value: `*${q}*`, case_insensitive: true } } },
            { wildcard: { 'reconocimiento.keyword': { value: `*${q}*`, case_insensitive: true } } },
            // 3.ª prioridad — tipo de objeto
            { wildcard: { 'tipo_objeto': { value: `*${q}*`, case_insensitive: true } } },
            { wildcard: { 'tipo_objeto.keyword': { value: `*${q}*`, case_insensitive: true } } },

            {
              multi_match: {
                query: q,
                fields: [
                  'camara^3',
                  'camara.keyword^3',
                  'reconocimiento^2',
                  'reconocimiento.keyword^2',
                  'tipo_objeto',
                  'tipo_objeto.keyword'
                ],
                type: 'best_fields',
                fuzziness: 'AUTO'
              }
            },

            {
              query_string: {
                query: `*${escapedQ}*`,
                fields: [
                  'camara^3',
                  'camara.keyword^3',
                  'reconocimiento^2',
                  'reconocimiento.keyword^2',
                  'tipo_objeto',
                  'tipo_objeto.keyword'
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

    if (index === 'rostros' && filters.coincidenciaFiltro && filters.coincidenciaFiltro !== 'all') {
      const nonMatchTerms = [
        '',
        'desconocido', 'Desconocido', 'DESCONOCIDO',
        'pendiente', 'Pendiente', 'PENDIENTE',
        'unknown', 'Unknown', 'UNKNOWN',
        'none', 'None', 'NONE',
        'null', 'NULL',
        'sin coincidencia', 'Sin Coincidencia', 'sin_coincidencia', 'SIN_COINCIDENCIA',
        'no match', 'No Match', 'no_match', 'NO_MATCH',
        'n/a', 'N/A', '-'
      ];

      const nonMatchWildcards = [
        { wildcard: { 'reconocimiento.keyword': { value: '*desconocid*', case_insensitive: true } } },
        { wildcard: { 'reconocimiento.keyword': { value: '*pendient*', case_insensitive: true } } },
        { wildcard: { 'reconocimiento.keyword': { value: '*unknown*', case_insensitive: true } } },
        { wildcard: { 'reconocimiento': { value: '*desconocid*', case_insensitive: true } } },
        { wildcard: { 'reconocimiento': { value: '*pendient*', case_insensitive: true } } }
      ];

      if (filters.coincidenciaFiltro === 'coincidencia') {
        mustFilters.push({
          bool: {
            must: [
              { exists: { field: 'reconocimiento' } }
            ],
            must_not: [
              { terms: { 'reconocimiento.keyword': nonMatchTerms } },
              { terms: { 'reconocimiento': ['desconocido', 'pendiente', 'unknown', 'none', 'null', 'sin_coincidencia', 'no_match'] } },
              ...nonMatchWildcards
            ]
          }
        });
      } else if (filters.coincidenciaFiltro === 'sin_coincidencia') {
        mustFilters.push({
          bool: {
            should: [
              { bool: { must_not: { exists: { field: 'reconocimiento' } } } },
              { terms: { 'reconocimiento.keyword': nonMatchTerms } },
              { terms: { 'reconocimiento': ['desconocido', 'pendiente', 'unknown', 'none', 'null', 'sin_coincidencia', 'no_match'] } },
              ...nonMatchWildcards
            ],
            minimum_should_match: 1
          }
        });
      }
    }

    return mustFilters;
  }

  private buildAggs(index: MetaIndexName): any {
    const aggs: any = {};

    aggs.camara_vals = { terms: { field: 'camara', size: 100 } };
    aggs.confiabilidad_stats = { stats: { field: 'confiabilidad' } };
    aggs.colores_vals = { terms: { field: 'colores.color_text', size: 100 } };

    if (index === 'personas') {
      aggs.tipo_objeto_vals = { terms: { field: 'tipo_objeto', size: 100 } };
      aggs.edad_vals = { terms: { field: 'edad', size: 50 } };
      aggs.genero_vals = { terms: { field: 'genero', size: 10 } };
      aggs.postura_vals = { terms: { field: 'posturas.postura', size: 100 } };
    } else if (index === 'vehiculos') {
      aggs.tipo_objeto_vals = { terms: { field: 'tipo_objeto', size: 100 } };
    } else if (index === 'rostros') {
      aggs.edad_vals = { terms: { field: 'edad', size: 50 } };
      aggs.genero_vals = { terms: { field: 'genero', size: 10 } };
      aggs.reconocimiento_vals = { terms: { field: 'reconocimiento', size: 50 } };
    } else if (index === 'otros') {
      aggs.tipo_objeto_vals = { terms: { field: 'tipo_objeto', size: 100 } };
    }

    return aggs;
  }

  private parseFilterOptions(aggs: any): MetaFilterOptions {
    const options = defaultFilterOptions();
    if (!aggs) return options;

    if (aggs.tipo_objeto_vals && aggs.tipo_objeto_vals.buckets) {
      options.tipoObjeto = aggs.tipo_objeto_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.edad_vals && aggs.edad_vals.buckets) {
      options.edades = aggs.edad_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.genero_vals && aggs.genero_vals.buckets) {
      options.generos = aggs.genero_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.camara_vals && aggs.camara_vals.buckets) {
      options.camaras = aggs.camara_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.reconocimiento_vals && aggs.reconocimiento_vals.buckets) {
      options.reconocimientos = aggs.reconocimiento_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.colores_vals && aggs.colores_vals.buckets) {
      options.colores = aggs.colores_vals.buckets.map((b: any) => b.key);
    } else if (aggs.colores_agg && aggs.colores_agg.color_vals && aggs.colores_agg.color_vals.buckets) {
      options.colores = aggs.colores_agg.color_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.postura_vals && aggs.postura_vals.buckets) {
      options.posturas = aggs.postura_vals.buckets.map((b: any) => b.key);
    } else if (aggs.posturas_agg && aggs.posturas_agg.postura_vals && aggs.posturas_agg.postura_vals.buckets) {
      options.posturas = aggs.posturas_agg.postura_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.confiabilidad_stats) {
      options.confiabilidadStats = {
        min: typeof aggs.confiabilidad_stats.min === 'number' ? aggs.confiabilidad_stats.min : 0,
        max: typeof aggs.confiabilidad_stats.max === 'number' ? aggs.confiabilidad_stats.max : 1
      };
    }

    return options;
  }

  searchFacesByImage(file: File, size: number): Observable<MetaRostro[]> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<any[]>(`${AppEnvironment.apiUrl}/frontend/extra/search_faces_by_img?size=${size}`, formData).pipe(
      map(items => (items || []).map((item, idx) => ({
        id: `face-img-search-${idx}-${Date.now()}`,
        camara: item.camara || '',
        timestamp: parseUtcDate(item.timestamp),
        confiabilidad: typeof item.confiabilidad === 'number' ? item.confiabilidad : 0,
        imagenRemota: MetadataMapper.sanitizeImageUrl(item.url_img),
        edad: item.edad || '',
        genero: item.genero || '',
        colores: [],
        reconocimiento: item.reconocimiento || ''
      } as MetaRostro)))
    );
  }

  getById(index: MetaIndexName, docId: string): Observable<MetaRecord> {
    return this.http.get<any>(`${AppEnvironment.openSearchBaseUrl}/${index}/_doc/${docId}`).pipe(
      map(res => MetadataMapper.toDomain(index, res))
    );
  }

  private buildTermFilter(field: string, value: any): any {
    const strVal = String(value);
    const variants = Array.from(new Set([
      strVal,
      strVal.toLowerCase(),
      strVal.toUpperCase(),
      strVal.charAt(0).toUpperCase() + strVal.slice(1).toLowerCase()
    ]));

    return {
      bool: {
        should: [
          { terms: { [field]: variants } },
          { terms: { [`${field}.keyword`]: variants } },
          { term: { [field]: { value: strVal, case_insensitive: true } } },
          { term: { [`${field}.keyword`]: { value: strVal, case_insensitive: true } } }
        ],
        minimum_should_match: 1
      }
    };
  }

  private buildTermsFilter(field: string, values: any[]): any {
    const rawList = Array.isArray(values) ? values : [values];
    const expandedVariants = new Set<string>();
    rawList.forEach(v => {
      const s = String(v);
      expandedVariants.add(s);
      expandedVariants.add(s.toLowerCase());
      expandedVariants.add(s.toUpperCase());
      expandedVariants.add(s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
    });
    const variantsList = Array.from(expandedVariants);

    return {
      bool: {
        should: [
          { terms: { [field]: variantsList } },
          { terms: { [`${field}.keyword`]: variantsList } }
        ],
        minimum_should_match: 1
      }
    };
  }
}
