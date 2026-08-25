import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, forkJoin } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { AppEnvironment } from '../config/app-environment';
import { EventRecord } from '../domain/entities/event.models';
import { MetadataMapper } from '../../data/mappers/metadata.mapper';

export interface FacialMatchInfo {
  personName: string;
  groupName: string;
  matchImgUrl: string | null;
  similarity: number; // Porcentaje entero (ej: 87, 75, 92)
  isMatchConfirmed: boolean;
  isLoading?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class FacialMatchService {
  private http = inject(HttpClient);

  // Caché en memoria para evitar consultas redundantes a OpenSearch
  private readonly matchCache = new Map<string, FacialMatchInfo>();

  /**
   * Determina si el evento corresponde a una analítica de Reconocimiento Facial o Placas
   */
  isComparisonApplicable(event: EventRecord | null | undefined): boolean {
    if (!event || !event.analitica) return false;
    const lower = event.analitica.toLowerCase();
    return lower.includes('facial') || lower.includes('rostro') || lower.includes('face') ||
           lower.includes('placa') || lower.includes('plate') || lower.includes('lpr');
  }

  /**
   * Extrae el nombre del grupo o lista de control a partir del detalle del evento
   */
  extractGroupName(detalleEvento: string): string {
    if (!detalleEvento) return 'Lista de Control';
    const match = detalleEvento.match(/pertenece al grupo\s+([^,]+)/i);
    if (match && match[1]) {
      return match[1].trim();
    }
    return 'Lista de Control Facial';
  }

  /**
   * Obtiene la información de match (foto de referencia en lista de control y porcentaje de similitud)
   */
  getMatchInfo(event: EventRecord): Observable<FacialMatchInfo> {
    if (!event) {
      return of(this.getFallbackMatch(event));
    }

    const cacheKey = `${event.id || ''}_${event.objeto || ''}`;
    if (this.matchCache.has(cacheKey)) {
      return of(this.matchCache.get(cacheKey)!);
    }

    // Si ya viene pre-cargado en el evento
    if (event.urlImgMatch && typeof event.porcentajeSimilitud === 'number') {
      const info: FacialMatchInfo = {
        personName: event.objeto || 'Persona Identificada',
        groupName: event.grupoLista || this.extractGroupName(event.detalleEvento),
        matchImgUrl: event.urlImgMatch,
        similarity: event.porcentajeSimilitud,
        isMatchConfirmed: true
      };
      this.matchCache.set(cacheKey, info);
      return of(info);
    }

    const personName = event.objeto ? event.objeto.trim() : '';
    const groupName = this.extractGroupName(event.detalleEvento);

    if (!personName) {
      const fallback = this.getFallbackMatch(event);
      this.matchCache.set(cacheKey, fallback);
      return of(fallback);
    }

    // 1. Consulta al índice 'detalle_listas' para obtener la foto registrada en la lista
    const queryList = {
      query: {
        bool: {
          should: [
            { term: { 'nombre_asociado.keyword': personName } },
            { match_phrase: { 'nombre_asociado': personName } }
          ],
          minimum_should_match: 1
        }
      },
      size: 1
    };

    const fetchListPhoto$ = this.http.post<any>(`${AppEnvironment.openSearchBaseUrl}/detalle_listas/_search`, queryList).pipe(
      map(res => {
        const hit = res.hits?.hits?.[0]?._source;
        if (hit?.metadata?.url_img) {
          return MetadataMapper.sanitizeImageUrl(hit.metadata.url_img);
        }
        return null;
      }),
      catchError(() => of(null))
    );

    // 2. Consulta al índice 'rostros' para obtener la confiabilidad del match
    const queryRostro = {
      query: {
        bool: {
          should: [
            { term: { 'reconocimiento.keyword': personName } },
            { match_phrase: { 'reconocimiento': personName } }
          ],
          minimum_should_match: 1
        }
      },
      sort: [{ timestamp: { order: 'desc' } }],
      size: 1
    };

    const fetchRostroScore$ = this.http.post<any>(`${AppEnvironment.openSearchBaseUrl}/rostros/_search`, queryRostro).pipe(
      map(res => {
        const hit = res.hits?.hits?.[0]?._source;
        if (hit && typeof hit.confiabilidad === 'number' && hit.confiabilidad > 0) {
          return Math.round(hit.confiabilidad <= 1 ? hit.confiabilidad * 100 : hit.confiabilidad);
        }
        return null;
      }),
      catchError(() => of(null))
    );

    return forkJoin({
      matchImgUrl: fetchListPhoto$,
      score: fetchRostroScore$
    }).pipe(
      map(({ matchImgUrl, score }) => {
        let similarity: number | null = null;
        if (score !== null) {
          similarity = score;
        } else if (typeof event.porcentajeSimilitud === 'number') {
          similarity = event.porcentajeSimilitud;
        } else if (typeof event.confiabilidad === 'number') {
          similarity = Math.round(event.confiabilidad > 1 ? event.confiabilidad : event.confiabilidad * 100);
        }

        const result: FacialMatchInfo = {
          personName,
          groupName,
          matchImgUrl: matchImgUrl || event.urlImgMatch || null,
          similarity: similarity ?? (event.porcentajeSimilitud || 0),
          isMatchConfirmed: true
        };
        this.matchCache.set(cacheKey, result);
        return result;
      }),
      catchError(err => {
        console.warn('[FacialMatchService] Error al resolver coincidencia facial desde OpenSearch:', err);
        const fallback = this.getFallbackMatch(event);
        this.matchCache.set(cacheKey, fallback);
        return of(fallback);
      })
    );
  }

  private getFallbackMatch(event: EventRecord | null | undefined): FacialMatchInfo {
    const sim = typeof event?.porcentajeSimilitud === 'number'
      ? event.porcentajeSimilitud
      : (typeof event?.confiabilidad === 'number' ? Math.round(event.confiabilidad > 1 ? event.confiabilidad : event.confiabilidad * 100) : 0);

    return {
      personName: event?.objeto || 'Sujeto Identificado',
      groupName: event ? this.extractGroupName(event.detalleEvento) : 'Lista de Control',
      matchImgUrl: event?.urlImgMatch || null,
      similarity: sim,
      isMatchConfirmed: true
    };
  }
}
