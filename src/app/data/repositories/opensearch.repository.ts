import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, forkJoin } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { MetaFilterState, MetaFilterOptions, defaultFilterOptions } from '../../core/domain/entities/metadata.filters.models';
import { MetaIndexName, MetaRecord, MetaIndexInfo, MetaRostro } from '../../core/domain/entities/metadata.models';
import { IMetadataRepository, MetadataSearchResult } from '../../core/domain/repositories/metadata.repository';
import { MetadataMapper } from '../mappers/metadata.mapper';
import { OsResponse, CatIndexResponse } from './dtos/opensearch-response.dto';
import { AppEnvironment } from '../../core/config/app-environment';
import { parseUtcDate } from '../../core/utils/date-utils';

@Injectable({
  providedIn: 'root'
})
export class OpenSearchRepository implements IMetadataRepository {
  constructor(private http: HttpClient) {}

  getAvailableIndices(): Observable<MetaIndexInfo[]> {
    return this.http.get<CatIndexResponse[]>(`${AppEnvironment.openSearchBaseUrl}/_cat/indices?format=json`).pipe(
      switchMap(indices => {
        const validNames: MetaIndexName[] = ['personas', 'vehiculos', 'rostros', 'otros'];
        const activeNames = indices
          .map(i => i.index as MetaIndexName)
          .filter(name => validNames.includes(name));

        // If any of the valid names are missing, add them so we always display all 4
        validNames.forEach(name => {
          if (!activeNames.includes(name)) {
            activeNames.push(name);
          }
        });

        // For each active index, call its _count endpoint to get the real count of parent documents
        const countObservables = activeNames.map(name =>
          this.http.get<{ count: number }>(`${AppEnvironment.openSearchBaseUrl}/${name}/_count`).pipe(
            map(res => ({ name, count: res.count })),
            catchError(() => of({ name, count: 0 }))
          )
        );

        return forkJoin(countObservables);
      }),
      map(mapped => {
        // Sort descending by count
        return mapped.sort((a, b) => b.count - a.count);
      }),
      catchError(() => {
        console.warn('Failed to fetch indices or counts from OpenSearch. Using default list.');
        return of<MetaIndexInfo[]>([
          { name: 'personas', count: 0 },
          { name: 'vehiculos', count: 0 },
          { name: 'rostros', count: 0 },
          { name: 'otros', count: 0 }
        ]);
      })
    );
  }

  search(
    index: MetaIndexName,
    filters: MetaFilterState,
    page: number,
    pageSize: number
  ): Observable<MetadataSearchResult> {
    const mustFilters: any[] = [];
    const isRostros = index === 'rostros';

    // 1. tipo_objeto (Multi-select OR)
    if (filters.tipoObjeto && filters.tipoObjeto.length > 0) {
      mustFilters.push(this.buildTermsFilter('tipo_objeto', filters.tipoObjeto));
    }

    // 2. edad (Single-select)
    if (filters.edad) {
      mustFilters.push(this.buildTermFilter('edad', filters.edad));
    }

    // 3. genero (Single-select)
    if (filters.genero) {
      mustFilters.push(this.buildTermFilter('genero', filters.genero));
    }

    // 4. reconocimiento (Single-select / Placa / Sujeto - Búsqueda flexible con/sin guion)
    if (filters.reconocimiento && filters.reconocimiento.trim()) {
      const val = filters.reconocimiento.trim();
      const valClean = val.replace(/[^A-Za-z0-9]/g, '');
      const variants = Array.from(new Set([
        val,
        val.toLowerCase(),
        val.toUpperCase(),
        valClean,
        valClean.toLowerCase(),
        valClean.toUpperCase()
      ])).filter(Boolean);

      const shouldClause: any[] = [
        { terms: { 'reconocimiento': variants } },
        { terms: { 'reconocimiento.keyword': variants } }
      ];

      variants.forEach(v => {
        shouldClause.push({ wildcard: { 'reconocimiento.keyword': { value: `*${v}*`, case_insensitive: true } } });
        shouldClause.push({ wildcard: { 'reconocimiento': { value: `*${v}*`, case_insensitive: true } } });
      });

      mustFilters.push({
        bool: {
          should: shouldClause,
          minimum_should_match: 1
        }
      });
    }

    // 5. colores (Multi-select OR - Nested for all indices)
    if (filters.colores && filters.colores.length > 0) {
      mustFilters.push({
        nested: {
          path: 'colores',
          query: this.buildTermsFilter('colores.color_text', filters.colores)
        }
      });
    }

    // 6. posturas (Multi-select OR - Nested - Only for 'personas' if present)
    if (filters.posturas && filters.posturas.length > 0 && index === 'personas') {
      mustFilters.push({
        nested: {
          path: 'posturas',
          query: this.buildTermsFilter('posturas.postura', filters.posturas)
        }
      });
    }

    // 7. camaras (Multi-select OR)
    if (filters.camaras && filters.camaras.length > 0) {
      mustFilters.push(this.buildTermsFilter('camara', filters.camaras));
    }

    // 8. confiabilidad (Range) — solo se aplica si el usuario ajustó el rango (no es 0-100%)
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

    // 9. timestamp (Range)
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

    // 10. search (Text query search across multiple fields)
    if (filters.search && filters.search.trim()) {
      mustFilters.push({
        multi_match: {
          query: filters.search.trim(),
          fields: [
            'id^2',
            'camara',
            'camara.keyword',
            'reconocimiento',
            'reconocimiento.keyword^3',
            'tipo_objeto',
            'tipo_objeto.keyword'
          ],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      });
    }

    // 11. coincidenciaFiltro (Only for 'rostros' index)
    if (index === 'rostros' && filters.coincidenciaFiltro) {
      if (filters.coincidenciaFiltro === 'coincidencia') {
        mustFilters.push({
          bool: {
            must: [
              { exists: { field: 'reconocimiento' } }
            ],
            must_not: [
              { term: { 'reconocimiento.keyword': '' } },
              { term: { 'reconocimiento': '' } }
            ]
          }
        });
      } else if (filters.coincidenciaFiltro === 'sin_coincidencia') {
        mustFilters.push({
          bool: {
            should: [
              { bool: { must_not: { exists: { field: 'reconocimiento' } } } },
              { term: { 'reconocimiento.keyword': '' } },
              { term: { 'reconocimiento': '' } }
            ],
            minimum_should_match: 1
          }
        });
      }
    }

    // Build aggregations based on active index
    const aggs: any = {};

    // Base aggs for all indexes (try both raw and keyword)
    aggs.camara_vals = { terms: { field: 'camara.keyword', size: 100 } };
    aggs.confiabilidad_stats = { stats: { field: 'confiabilidad' } };

    if (isRostros) {
      aggs.colores_agg = {
        nested: { path: 'colores' },
        aggs: {
          color_vals: { terms: { field: 'colores.color_text', size: 100 } }
        }
      };
    } else {
      aggs.colores_vals = { terms: { field: 'colores.color_text.keyword', size: 100 } };
    }

    if (index === 'personas') {
      aggs.tipo_objeto_vals = { terms: { field: 'tipo_objeto.keyword', size: 100 } };
      aggs.edad_vals = { terms: { field: 'edad.keyword', size: 50 } };
      aggs.genero_vals = { terms: { field: 'genero.keyword', size: 10 } };
      aggs.posturas_agg = {
        nested: { path: 'posturas' },
        aggs: {
          postura_vals: { terms: { field: 'posturas.postura', size: 100 } }
        }
      };
    } else if (index === 'vehiculos') {
      aggs.tipo_objeto_vals = { terms: { field: 'tipo_objeto.keyword', size: 100 } };
    } else if (index === 'rostros') {
      aggs.edad_vals = { terms: { field: 'edad', size: 50 } };
      aggs.genero_vals = { terms: { field: 'genero', size: 10 } };
      aggs.reconocimiento_vals = { terms: { field: 'reconocimiento', size: 50 } };
    } else if (index === 'otros') {
      aggs.tipo_objeto_vals = { terms: { field: 'tipo_objeto.keyword', size: 100 } };
    }

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
          { timestamp: { order: 'desc' } }
        ],
        query: mustFilters.length > 0 ? { bool: { filter: mustFilters } } : { match_all: {} },
        aggs: aggs
      };
    }

    // Fallback query sin aggregations (usada si la query principal falla, ej. campos no-nested)
    const fallbackQuery = {
      track_total_hits: true,
      from: (page - 1) * pageSize,
      size: pageSize,
      sort: [{ timestamp: { order: 'desc' } }],
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
        // La query principal falló (probablemente por mappings nested incompatibles).
        // Reintentamos con una query mínima sin aggregations.
        console.warn(`[OpenSearch] Query completa falló en índice "${index}" (${err?.status || err?.message}). Reintentando sin aggregations...`);
        return this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/${index}/_search`, fallbackQuery).pipe(
          map(res => ({ ...parseResult(res), filterOptions: defaultFilterOptions() })),
          catchError(err2 => {
            console.error(`[OpenSearch] Query mínima también falló en índice "${index}":`, err2?.error || err2);
            return of<MetadataSearchResult>({ records: [], total: 0, filterOptions: defaultFilterOptions() });
          })
        );
      })
    );
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
    if (aggs.colores_agg && aggs.colores_agg.color_vals && aggs.colores_agg.color_vals.buckets) {
      options.colores = aggs.colores_agg.color_vals.buckets.map((b: any) => b.key);
    } else if (aggs.colores_vals && aggs.colores_vals.buckets) {
      options.colores = aggs.colores_vals.buckets.map((b: any) => b.key);
    }
    if (aggs.posturas_agg && aggs.posturas_agg.postura_vals && aggs.posturas_agg.postura_vals.buckets) {
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
