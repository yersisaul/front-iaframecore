import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, forkJoin } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { MetaIndexName, MetaRecord, MetaIndexInfo, MetaRostro } from '../../core/domain/entities/metadata.models';
import { MetaFilterState, MetaFilterOptions, defaultFilterOptions } from '../../core/domain/entities/metadata.filters.models';
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

    // 1. tipo_objeto (Multi-select OR)
    if (filters.tipoObjeto && filters.tipoObjeto.length > 0) {
      mustFilters.push({ terms: { tipo_objeto: filters.tipoObjeto } });
    }

    // 2. edad (Single-select)
    if (filters.edad) {
      mustFilters.push({ term: { edad: filters.edad } });
    }

    // 3. genero (Single-select)
    if (filters.genero) {
      mustFilters.push({ term: { genero: filters.genero } });
    }

    // 4. reconocimiento (Single-select)
    if (filters.reconocimiento) {
      mustFilters.push({ term: { reconocimiento: filters.reconocimiento } });
    }

    // 5. colores (Multi-select OR - Nested)
    if (filters.colores && filters.colores.length > 0) {
      mustFilters.push({
        nested: {
          path: 'colores',
          query: {
            terms: { 'colores.color_text': filters.colores }
          }
        }
      });
    }

    // 6. posturas (Multi-select OR - Nested)
    if (filters.posturas && filters.posturas.length > 0) {
      mustFilters.push({
        nested: {
          path: 'posturas',
          query: {
            terms: { 'posturas.postura': filters.posturas }
          }
        }
      });
    }

    // 7. camaras (Multi-select OR)
    if (filters.camaras && filters.camaras.length > 0) {
      mustFilters.push({ terms: { camara: filters.camaras } });
    }

    // 8. confiabilidad (Range)
    mustFilters.push({
      range: {
        confiabilidad: {
          gte: filters.confiabilidadMin,
          lte: filters.confiabilidadMax
        }
      }
    });

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
          fields: ['id^2', 'camara', 'reconocimiento^3', 'tipo_objeto'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      });
    }

    // 11. coincidenciaFiltro (Only for 'rostros' index)
    if (index === 'rostros' && filters.coincidenciaFiltro) {
      if (filters.coincidenciaFiltro === 'coincidencia') {
        mustFilters.push({ exists: { field: 'reconocimiento' } });
      } else if (filters.coincidenciaFiltro === 'sin_coincidencia') {
        mustFilters.push({ bool: { must_not: { exists: { field: 'reconocimiento' } } } });
      }
    }

    // Build aggregations based on active index
    const aggs: any = {};

    // Base aggs for all indexes
    aggs.camara_vals = { terms: { field: 'camara', size: 100 } };
    aggs.confiabilidad_stats = { stats: { field: 'confiabilidad' } };
    aggs.colores_agg = {
      nested: { path: 'colores' },
      aggs: {
        color_vals: { terms: { field: 'colores.color_text', size: 100 } }
      }
    };

    if (index === 'personas') {
      aggs.tipo_objeto_vals = { terms: { field: 'tipo_objeto', size: 100 } };
      aggs.edad_vals = { terms: { field: 'edad', size: 50 } };
      aggs.genero_vals = { terms: { field: 'genero', size: 10 } };
      aggs.posturas_agg = {
        nested: { path: 'posturas' },
        aggs: {
          postura_vals: { terms: { field: 'posturas.postura', size: 100 } }
        }
      };
    } else if (index === 'vehiculos') {
      aggs.tipo_objeto_vals = { terms: { field: 'tipo_objeto', size: 100 } };
      aggs.reconocimiento_vals = { terms: { field: 'reconocimiento', size: 50 } };
    } else if (index === 'rostros') {
      aggs.edad_vals = { terms: { field: 'edad', size: 50 } };
      aggs.genero_vals = { terms: { field: 'genero', size: 10 } };
      aggs.reconocimiento_vals = { terms: { field: 'reconocimiento', size: 50 } };
    } else if (index === 'otros') {
      aggs.tipo_objeto_vals = { terms: { field: 'tipo_objeto', size: 100 } };
    }

    let queryBody: any;
    if (filters.imageEmbedding && filters.imageEmbedding.length > 0) {
      queryBody = {
        track_total_hits: true,
        from: (page - 1) * pageSize,
        size: pageSize,
        _source: {
          excludes: ['embedding']
        },
        query: {
          knn: {
            embedding: {
              vector: filters.imageEmbedding,
              k: pageSize,
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
        _source: {
          excludes: ['embedding']
        },
        sort: [
          { timestamp: { order: 'desc' } }
        ],
        query: mustFilters.length > 0 ? { bool: { filter: mustFilters } } : { match_all: {} },
        aggs: aggs
      };
    }

    return this.http.post<OsResponse<any>>(`${AppEnvironment.openSearchBaseUrl}/${index}/_search`, queryBody).pipe(
      map(res => {
        const hits = res.hits?.hits || [];
        const records = hits.map(h => MetadataMapper.toDomain(index, h));
        
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
}
