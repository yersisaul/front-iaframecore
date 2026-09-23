import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of, forkJoin, EMPTY } from 'rxjs';
import { catchError, map, switchMap, expand, reduce } from 'rxjs/operators';
import { IListRepository } from '../../core/domain/repositories/list.repository';
import { List, ListDetail } from '../../core/domain/entities/list.models';
import { AppEnvironment } from '../../core/config/app-environment';
import { parseUtcDate } from '../../core/utils/date-utils';
import { MediaFileService } from '../../core/services/media-file.service';

@Injectable({
  providedIn: 'root'
})
export class ListHttpRepository implements IListRepository {
  private readonly listsUrl = `${AppEnvironment.apiUrl}/frontend/lists`;
  private readonly detailsUrl = `${AppEnvironment.apiUrl}/frontend/list_details`;

  constructor(private http: HttpClient, private mediaFileService: MediaFileService) {}

  getLists(): Observable<List[]> {
    return this.http.get<any[]>(`${this.listsUrl}/`).pipe(
      map(items => (items || []).map(item => ({
        list_id: item.list_id,
        name: item.name,
        description: item.description,
        list_type: item.list_type === 'RF' ? 'face_recognition' : (item.list_type === 'LPR' ? 'plate_recognition' : item.list_type)
      }))),
      catchError(err => {
        console.warn('Failed to fetch lists from backend. Returning empty array.', err);
        return of([]);
      })
    );
  }

  getListById(listId: string): Observable<List> {
    return this.http.get<any>(`${this.listsUrl}/${listId}`).pipe(
      map(item => ({
        list_id: item.list_id,
        name: item.name,
        description: item.description,
        list_type: item.list_type === 'RF' ? 'face_recognition' : (item.list_type === 'LPR' ? 'plate_recognition' : item.list_type)
      }))
    );
  }

  registerList(list: Partial<List>): Observable<List> {
    const payload: any = {
      list_id: list.list_id !== undefined ? list.list_id : null,
      name: list.name || '',
      list_type: list.list_type === 'face_recognition' ? 'RF' : (list.list_type === 'plate_recognition' ? 'LPR' : list.list_type),
      description: list.description !== undefined ? list.description : null
    };
    return this.http.post<any>(`${this.listsUrl}/`, payload).pipe(
      map(item => ({
        list_id: item.list_id,
        name: item.name,
        description: item.description,
        list_type: item.list_type === 'RF' ? 'face_recognition' : (item.list_type === 'LPR' ? 'plate_recognition' : item.list_type)
      }))
    );
  }

  deleteList(listId: string): Observable<void> {
    return this.http.delete<void>(`${this.listsUrl}/${listId}`).pipe(
      catchError(err => {
        if (AppEnvironment.enableBackendWorkarounds && err.status === 500) {
          console.warn('[BACKEND-WORKAROUND] deleteList returned status 500. Assuming operation succeeded as per workaround.', err);
          return of(undefined);
        }
        throw err;
      })
    );
  }

  getListDetails(listId: string): Observable<ListDetail[]> {
    // Consulta masiva directa a OpenSearch (índice detalle_listas), igual que en Eventos y Metadatos,
    // garantizando la obtención de todos los registros (800+, 10k+, millones) sin límites de backend REST.
    return this.fetchDetailsFromOpenSearch(listId).pipe(
      catchError(err => {
        console.warn('[ListRepo] Consulta a OpenSearch (detalle_listas) falló, usando endpoint REST como respaldo...', err);
        return this.fetchDetailsFromRest(listId);
      })
    );
  }

  /**
   * Consulta exhaustiva a OpenSearch sobre el índice `detalle_listas` usando `search_after`
   * para traer la totalidad de los sujetos asociados a la lista de control sin límite artificial.
   */
  private fetchDetailsFromOpenSearch(listId: string): Observable<ListDetail[]> {
    const fetchChunkSize = 5000;

    return this.searchOpenSearchDetailsPage(listId, fetchChunkSize, null).pipe(
      expand(prev => {
        if (!prev.items || prev.items.length === 0 || prev.accumulated.length >= prev.total || !prev.lastSort) {
          return EMPTY;
        }
        return this.searchOpenSearchDetailsPage(listId, fetchChunkSize, prev.lastSort).pipe(
          map(next => ({
            accumulated: [...prev.accumulated, ...next.items],
            items: next.items,
            total: next.total,
            lastSort: next.lastSort
          }))
        );
      }),
      reduce((_, current) => current),
      map(final => {
        console.log(`[ListRepo] 🚀 OpenSearch (detalle_listas): ${final.accumulated.length} registros recuperados exitosamente para list_id: ${listId || 'TODAS'}`);
        return this.sanitizeDetails(final.accumulated);
      })
    );
  }

  /**
   * Ejecuta una página de búsqueda en OpenSearch para `detalle_listas`.
   */
  private searchOpenSearchDetailsPage(
    listId: string,
    size: number,
    searchAfter: any[] | null
  ): Observable<{ accumulated: ListDetail[]; items: ListDetail[]; total: number; lastSort: any[] | null }> {
    const queryBody: any = {
      size: size,
      track_total_hits: true,
      sort: [
        { "_id": { "order": "asc" } }
      ]
    };

    if (listId) {
      queryBody.query = {
        bool: {
          should: [
            { term: { "list_id": listId } },
            { term: { "list_id.keyword": listId } },
            { match: { "list_id": listId } }
          ],
          minimum_should_match: 1
        }
      };
    } else {
      queryBody.query = { match_all: {} };
    }

    if (searchAfter && searchAfter.length > 0) {
      queryBody.search_after = searchAfter;
    }

    return this.http.post<any>(`${AppEnvironment.openSearchBaseUrl}/detalle_listas/_search`, queryBody).pipe(
      map(res => {
        const hits = res.hits?.hits || [];
        const total = typeof res.hits?.total === 'number' ? res.hits.total : (res.hits?.total?.value || hits.length);
        const lastSort = hits.length > 0 ? (hits[hits.length - 1].sort || null) : null;

        const items: ListDetail[] = hits.map((h: any) => {
          const src = h._source || {};
          const objName = src.metadata?.img_minio_object_name || src.img_minio_object_name || '';
          return {
            detail_id: src.detail_id || h._id,
            list_id: src.list_id || listId || '',
            nombre_asociado: src.nombre_asociado || '',
            fingerprint_host: src.fingerprint_host || '',
            embedding: src.embedding || [],
            img_minio_object_name: objName,
            metadata: {
              text_placa: src.metadata?.text_placa || src.text_placa,
              img_minio_object_name: objName
            }
          } as ListDetail;
        });

        return {
          accumulated: items,
          items: items,
          total: total,
          lastSort: lastSort
        };
      })
    );
  }

  /**
   * Respaldo REST por si OpenSearch no estuviera disponible.
   */
  private fetchDetailsFromRest(listId: string): Observable<ListDetail[]> {
    const faces$ = this.fetchAllPages(`${this.detailsUrl}/faces/`, listId).pipe(
      catchError(() => of([] as ListDetail[]))
    );

    const plates$ = this.fetchAllPages(`${this.detailsUrl}/plates/`, listId).pipe(
      catchError(() => of([] as ListDetail[]))
    );

    return forkJoin([faces$, plates$]).pipe(
      map(([faces, plates]) => {
        const allDetails = [...(faces || []), ...(plates || [])];
        const filtered = allDetails.filter(d => !listId || d.list_id === listId);
        return this.sanitizeDetails(filtered);
      }),
      catchError(err => {
        console.error('[ListRepo] REST list details endpoints failed:', err);
        return of([]);
      })
    );
  }

  private fetchAllPages(baseUrl: string, listId?: string): Observable<ListDetail[]> {
    const PAGE_LIMIT = 100;
    const seenIds = new Set<string>();

    return this.fetchPage(baseUrl, 1, PAGE_LIMIT, listId).pipe(
      expand(result => {
        if (!result.pageItems || result.pageItems.length === 0) {
          return EMPTY;
        }

        let newItemsCount = 0;
        for (const item of result.pageItems) {
          const id = item.detail_id || JSON.stringify(item);
          if (!seenIds.has(id)) {
            seenIds.add(id);
            newItemsCount++;
          }
        }

        if (newItemsCount === 0 || result.pageItems.length < PAGE_LIMIT) {
          return EMPTY;
        }

        return this.fetchPage(baseUrl, result.nextPage, PAGE_LIMIT, listId).pipe(
          map(next => {
            const uniqueNew = next.pageItems.filter(item => {
              const id = item.detail_id || JSON.stringify(item);
              return !seenIds.has(id);
            });
            return {
              accumulated: [...result.accumulated, ...uniqueNew],
              pageItems: next.pageItems,
              nextPage: next.nextPage
            };
          })
        );
      }),
      reduce((_, current) => current),
      map(result => result.accumulated),
      catchError(() => of([]))
    );
  }

  private fetchPage(
    baseUrl: string,
    page: number,
    limit: number,
    listId?: string
  ): Observable<{ accumulated: ListDetail[]; pageItems: ListDetail[]; nextPage: number }> {
    const skipVal = (page - 1) * limit;

    let params = new HttpParams()
      .set('page', page.toString())
      .set('skip', skipVal.toString())
      .set('offset', skipVal.toString())
      .set('limit', limit.toString())
      .set('size', limit.toString());

    if (listId) {
      params = params.set('list_id', listId);
    }

    return this.http.get<any>(baseUrl, { params }).pipe(
      map(res => {
        const items: ListDetail[] = Array.isArray(res)
          ? res
          : (res && typeof res === 'object' && 'items' in res ? res.items : []);

        return {
          accumulated: items,
          pageItems: items,
          nextPage: page + 1
        };
      })
    );
  }

  getListDetailById(detailId: string): Observable<ListDetail> {
    return this.http.get<any>(`${this.detailsUrl}/${detailId}`).pipe(
      map(res => {
        const objName = res.metadata?.img_minio_object_name || res.img_minio_object_name || '';
        const mapped = {
          detail_id: res.detail_id,
          list_id: res.list_id,
          nombre_asociado: res.nombre_asociado || '',
          fingerprint_host: res.fingerprint_host || '',
          embedding: res.embedding || [],
          img_minio_object_name: objName,
          metadata: {
            text_placa: res.metadata?.text_placa,
            img_minio_object_name: objName
          }
        } as ListDetail;
        return mapped;
      })
    );
  }

  registerListDetail(detail: Partial<ListDetail>, file?: File): Observable<ListDetail> {
    const isPlate = !!detail.metadata?.text_placa;
    const url = isPlate
      ? `${this.detailsUrl}/register_plate`
      : `${this.detailsUrl}/register_face`;

    let request$: Observable<any>;

    if (isPlate) {
      if (!file) {
        const objName = detail.img_minio_object_name || detail.metadata?.img_minio_object_name;
        if (objName) {
          return this.mediaFileService.getFileUrl(objName).pipe(
            switchMap(url => this.http.get(url, { responseType: 'blob' })),
            switchMap((blob: any) => {
              const downloadedFile = new File([blob], 'plate.jpg', { type: 'image/jpeg' });
              return this.registerListDetail(detail, downloadedFile);
            }),
            catchError(downloadErr => {
              console.warn('[ListRepo] Failed to download plate image from MinIO, proceeding without file:', downloadErr);
              const fallbackFormData = new FormData();
              fallbackFormData.append('list_id', detail.list_id || '');
              fallbackFormData.append('plate_text', detail.metadata?.text_placa || '');
              if (detail.nombre_asociado) {
                fallbackFormData.append('nombre_asociado', detail.nombre_asociado);
              }
              return this.http.post<any>(url, fallbackFormData);
            })
          );
        }
      }

      // Plates: multipart/form-data
      const formData = new FormData();
      formData.append('list_id', detail.list_id || '');
      formData.append('plate_text', detail.metadata?.text_placa || '');
      if (detail.nombre_asociado) {
        formData.append('nombre_asociado', detail.nombre_asociado);
      }
      if (file) {
        formData.append('file', file, file.name);
      }
      request$ = this.http.post<any>(url, formData);
    } else {
      // Faces: multipart/form-data
      if (!file) {
        const objName = detail.img_minio_object_name || detail.metadata?.img_minio_object_name;
        if (objName) {
          // Fetch the file from MinIO using MediaFileService first!
          return this.mediaFileService.getFileUrl(objName).pipe(
            switchMap(url => this.http.get(url, { responseType: 'blob' })),
            switchMap((blob: any) => {
              const downloadedFile = new File([blob], 'face.jpg', { type: 'image/jpeg' });
              return this.registerListDetail(detail, downloadedFile);
            }),
            catchError(downloadErr => {
              console.error('[ListRepo] Failed to download subject image for registration:', downloadErr);
              throw new Error('No se pudo descargar la imagen del sujeto detectado para registrarlo.');
            })
          );
        } else {
          throw new Error('Es obligatorio cargar una imagen para registrar un rostro.');
        }
      }

      // Send fields flat according to the frontend (default) schema docs.
      const formData = new FormData();
      formData.append('list_id', detail.list_id || '');
      formData.append('nombre_asociado', detail.nombre_asociado || '');
      formData.append('file', file, file.name);
      request$ = this.http.post<any>(url, formData);
    }

    return request$.pipe(
      map(res => {
        const objName = res.img_minio_object_name || res.metadata?.img_minio_object_name || detail.img_minio_object_name || detail.metadata?.img_minio_object_name || '';
        return {
          detail_id: res.detail_id,
          list_id: detail.list_id || '',
          nombre_asociado: detail.nombre_asociado || '',
          fingerprint_host: detail.fingerprint_host || '',
          embedding: detail.embedding || [],
          img_minio_object_name: objName,
          metadata: {
            ...detail.metadata,
            img_minio_object_name: objName
          }
        } as ListDetail;
      }),
      catchError(err => {
        if (err.status === 422) {
          console.error('[ListRepo] registerListDetail 422 — validation detail:', JSON.stringify(err?.error?.detail));
        }
        if (AppEnvironment.enableBackendWorkarounds && err.status === 500) {
          console.warn('[BACKEND-WORKAROUND] registerListDetail returned status 500. Simulating success with a temporary ID.', err);
          return of({
            detail_id: detail.detail_id || 'temp-id-' + Math.random().toString(36).substring(2, 11),
            list_id: detail.list_id || '',
            nombre_asociado: detail.nombre_asociado || '',
            fingerprint_host: detail.fingerprint_host || '',
            embedding: detail.embedding || [],
            metadata: detail.metadata || {}
          } as ListDetail);
        }
        throw err;
      })
    );
  }

  deleteListDetail(detailId: string): Observable<void> {
    return this.http.delete<void>(`${this.detailsUrl}/${detailId}`).pipe(
      catchError(err => {
        if (AppEnvironment.enableBackendWorkarounds && err.status === 500) {
          console.warn('[BACKEND-WORKAROUND] deleteListDetail returned status 500. Assuming operation succeeded as per workaround.', err);
          return of(undefined);
        }
        throw err;
      })
    );
  }

  /**
   * Consulta directa y eficiente al índice `eventos` por `detailIds` y/o `match_detail.list_id`
   * para obtener el conteo de avistamientos y el evento más reciente de cada sujeto por `match_detail.detail_id`.
   */
  queryListEventSummaries(listId: string, detailIds?: string[]): Observable<Record<string, { count: number; latestHit?: any }>> {
    const validDetailIds = (detailIds || []).filter(id => Boolean(id && typeof id === 'string' && id.trim()));
    if (!listId && validDetailIds.length === 0) return of({});

    const shouldQueries: any[] = [];

    if (validDetailIds.length > 0) {
      shouldQueries.push({ terms: { 'match_detail.detail_id': validDetailIds } });
      shouldQueries.push({ terms: { 'match_detail.detail_id.keyword': validDetailIds } });
    }

    if (listId) {
      shouldQueries.push({ term: { 'match_detail.list_id': listId } });
      shouldQueries.push({ term: { 'match_detail.list_id.keyword': listId } });
    }

    const queryBody = {
      size: 5000,
      query: {
        bool: {
          should: shouldQueries,
          minimum_should_match: 1
        }
      },
      sort: [
        { 'timestamp': { 'order': 'desc' } }
      ]
    };

    return this.http.post<any>(`${AppEnvironment.openSearchBaseUrl}/eventos/_search`, queryBody).pipe(
      map(res => {
        const result: Record<string, { count: number; latestHit?: any }> = {};
        const hits = res.hits?.hits || [];

        const extractEventId = (src: any, fallbackId: string): string => {
          if (src.event_id && typeof src.event_id === 'string' && src.event_id.trim()) {
            return src.event_id.trim();
          }
          const url = src.img_minio_object_name || src.video_minio_object_name;
          if (url && typeof url === 'string') {
            const filename = url.split('/').pop()?.split('?')[0] || '';
            const lastDot = filename.lastIndexOf('.');
            const cleanId = lastDot > 0 ? filename.substring(0, lastDot) : filename;
            if (cleanId) return cleanId;
          }
          return fallbackId;
        };

        for (const hit of hits) {
          const src = hit._source || {};
          const detailId = src.match_detail?.detail_id || src.detail_id;
          if (!detailId) continue;

          if (!result[detailId]) {
            const conf = src.match_detail?.confianza ?? src.confiabilidad ?? 1.0;
            const latestHit = {
              id: hit._id,
              eventId: extractEventId(src, hit._id),
              camara: src.nombre_camara || 'Cámara',
              timestamp: parseUtcDate(src.timestamp),
              confiabilidad: typeof conf === 'number' ? (conf > 1 ? conf / 100 : conf) : 1.0,
              imagen: src.img_minio_object_name || '',
              urlVideo: src.video_minio_object_name || null,
              tipoObjeto: src.objeto || '',
              reconocimiento: src.match_detail?.list_name || src.objeto || '',
              detalleEvento: src.detalle_evento || '',
              posturas: [],
              colores: []
            };
            result[detailId] = { count: 1, latestHit };
          } else {
            result[detailId].count++;
          }
        }

        return result;
      }),
      catchError(err => {
        console.warn('[ListRepo] Error al consultar resumen de eventos para la lista:', err);
        return of({});
      })
    );
  }

  /**
   * Consulta directa al índice `eventos` estrictamente por el identificador formal del sujeto (`match_detail.detail_id`).
   */
  querySubjectDetections(detailId: string): Observable<any[]> {
    if (!detailId) {
      return of([]);
    }

    const query = {
      size: 200,
      query: {
        bool: {
          should: [
            { term: { 'match_detail.detail_id': detailId } },
            { term: { 'match_detail.detail_id.keyword': detailId } }
          ],
          minimum_should_match: 1
        }
      },
      sort: [
        { 'timestamp': { 'order': 'desc' } }
      ]
    };

    return this.http.post<any>(`${AppEnvironment.openSearchBaseUrl}/eventos/_search`, query).pipe(
      map(res => {
        const extractEventId = (src: any, fallbackId: string): string => {
          if (src.event_id && typeof src.event_id === 'string' && src.event_id.trim()) {
            return src.event_id.trim();
          }
          const url = src.img_minio_object_name || src.video_minio_object_name;
          if (url && typeof url === 'string') {
            const filename = url.split('/').pop()?.split('?')[0] || '';
            const lastDot = filename.lastIndexOf('.');
            const cleanId = lastDot > 0 ? filename.substring(0, lastDot) : filename;
            if (cleanId) return cleanId;
          }
          return fallbackId;
        };

        const hits = res.hits?.hits || [];
        return hits.map((h: any) => {
          const src = h._source || {};
          const conf = src.match_detail?.confianza ?? src.confiabilidad ?? 1.0;
          return {
            id: h._id,
            eventId: extractEventId(src, h._id),
            camara: src.nombre_camara || 'Cámara',
            timestamp: parseUtcDate(src.timestamp),
            confiabilidad: typeof conf === 'number' ? (conf > 1 ? conf / 100 : conf) : 1.0,
            imagen: src.img_minio_object_name || '',
            urlVideo: src.video_minio_object_name || null,
            tipoObjeto: src.objeto || '',
            reconocimiento: src.match_detail?.list_name || src.objeto || '',
            detalleEvento: src.detalle_evento || '',
            posturas: [],
            colores: []
          };
        });
      }),
      catchError(err => {
        console.error('[ListRepo] Error consultando eventos del sujeto en OpenSearch:', err);
        return of([]);
      })
    );
  }

  updateList(list: List): Observable<List> {
    const payload = {
      list_id: list.list_id,
      name: list.name || '',
      list_type: list.list_type === 'face_recognition' ? 'RF' : (list.list_type === 'plate_recognition' ? 'LPR' : list.list_type),
      description: list.description !== undefined ? list.description : null
    };
    return this.http.put<any>(`${this.listsUrl}/${list.list_id}`, payload).pipe(
      map(item => ({
        list_id: item.list_id,
        name: item.name,
        description: item.description,
        list_type: item.list_type === 'RF' ? 'face_recognition' : (item.list_type === 'LPR' ? 'plate_recognition' : item.list_type)
      }))
    );
  }

  updateDetailImg(detailId: string, file: File): Observable<ListDetail> {
    const formData = new FormData();
    formData.append('file', file, file.name);

    return this.http.put<any>(`${this.detailsUrl}/update_detail_img/${detailId}`, formData).pipe(
      map(res => {
        const objName = res.object_name || res.img_minio_object_name || res.metadata?.img_minio_object_name || '';
        return {
          detail_id: res.detail_id || detailId,
          list_id: res.list_id || '',
          nombre_asociado: res.nombre_asociado || '',
          fingerprint_host: res.fingerprint_host || '',
          embedding: res.embedding || [],
          img_minio_object_name: objName,
          metadata: {
            img_minio_object_name: objName
          }
        } as ListDetail;
      })
    );
  }

  updateFaceImg(detailId: string, file: File): Observable<ListDetail> {
    return this.updateDetailImg(detailId, file);
  }

  updateFaceDetail(detailId: string, listId: string, payload: { nombre_asociado: string }): Observable<ListDetail> {
    const body = new HttpParams()
      .set('list_id', listId)
      .set('nombre_asociado', payload.nombre_asociado);
    return this.http.put<any>(`${this.detailsUrl}/update_face_detail/${detailId}`, body.toString(), {
      headers: new HttpHeaders().set('Content-Type', 'application/x-www-form-urlencoded')
    }).pipe(
      map(res => {
        const objName = res.img_minio_object_name || res.metadata?.img_minio_object_name || '';
        return {
          detail_id: res.detail_id || detailId,
          list_id: res.list_id || listId || '',
          nombre_asociado: res.nombre_asociado || payload.nombre_asociado,
          fingerprint_host: res.fingerprint_host || '',
          embedding: res.embedding || [],
          img_minio_object_name: objName,
          metadata: {
            img_minio_object_name: objName
          }
        } as ListDetail;
      })
    );
  }

  updatePlateDetail(detailId: string, listId: string, payload: { nombre_asociado?: string, plate_text: string }): Observable<ListDetail> {
    let body = new HttpParams()
      .set('list_id', listId)
      .set('plate_text', payload.plate_text);
    if (payload.nombre_asociado !== undefined) {
      body = body.set('nombre_asociado', payload.nombre_asociado);
    }
    return this.http.put<any>(`${this.detailsUrl}/update_plate_detail/${detailId}`, body.toString(), {
      headers: new HttpHeaders().set('Content-Type', 'application/x-www-form-urlencoded')
    }).pipe(
      map(res => {
        const objName = res.img_minio_object_name || res.metadata?.img_minio_object_name || '';
        return {
          detail_id: res.detail_id || detailId,
          list_id: res.list_id || listId || '',
          nombre_asociado: res.nombre_asociado || payload.nombre_asociado || '',
          fingerprint_host: res.fingerprint_host || '',
          embedding: res.embedding || [],
          img_minio_object_name: objName,
          metadata: {
            text_placa: res.metadata?.text_placa || payload.plate_text,
            img_minio_object_name: objName
          }
        } as ListDetail;
      })
    );
  }

  private sanitizeDetails(details: ListDetail[]): ListDetail[] {
    return (details || []).map(d => {
      if (d) {
        const objName = d.img_minio_object_name || d.metadata?.img_minio_object_name || '';
        return {
          ...d,
          img_minio_object_name: objName,
          metadata: {
            ...d.metadata,
            img_minio_object_name: objName
          }
        };
      }
      return d;
    });
  }
}
