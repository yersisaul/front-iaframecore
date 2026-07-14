import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, of, forkJoin } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { IListRepository } from '../../core/domain/repositories/list.repository';
import { List, ListDetail } from '../../core/domain/entities/list.models';
import { AppEnvironment } from '../../core/config/app-environment';
import { parseUtcDate } from '../../core/utils/date-utils';
import { MetadataMapper } from '../mappers/metadata.mapper';

@Injectable({
  providedIn: 'root'
})
export class ListHttpRepository implements IListRepository {
  private readonly listsUrl = `${AppEnvironment.apiUrl}/frontend/lists`;
  private readonly detailsUrl = `${AppEnvironment.apiUrl}/frontend/list_details`;

  constructor(private http: HttpClient) {}

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
    // En producción, el listado de sujetos está separado en dos endpoints específicos:
    // /frontend/list_details/faces/ y /frontend/list_details/plates/
    // Realizamos una consulta en paralelo y unificamos los resultados para filtrarlos por list_id.
    const faces$ = this.http.get<ListDetail[]>(`${this.detailsUrl}/faces/`).pipe(
      catchError(err => {
        console.warn('[ListRepo] Failed to fetch faces details, recovering with empty list.', err);
        return of([]);
      })
    );

    const plates$ = this.http.get<ListDetail[]>(`${this.detailsUrl}/plates/`).pipe(
      catchError(err => {
        console.warn('[ListRepo] Failed to fetch plates details, recovering with empty list.', err);
        return of([]);
      })
    );

    return forkJoin([faces$, plates$]).pipe(
      map(([faces, plates]) => {
        const allDetails = [...(faces || []), ...(plates || [])];
        const filtered = allDetails.filter(d => d.list_id === listId);
        return this.sanitizeDetails(filtered);
      }),
      catchError(err => {
        console.error('[ListRepo] Both list details endpoints failed:', err);
        return of([]);
      })
    );
  }

  getListDetailById(detailId: string): Observable<ListDetail> {
    return this.http.get<any>(`${this.detailsUrl}/${detailId}`).pipe(
      map(res => {
        const mapped = {
          detail_id: res.detail_id,
          list_id: res.list_id,
          nombre_asociado: res.nombre_asociado || '',
          fingerprint_host: res.fingerprint_host || '',
          embedding: res.embedding || [],
          metadata: {
            text_placa: res.metadata?.text_placa,
            url_img: res.metadata?.url_img ? MetadataMapper.sanitizeImageUrl(res.metadata.url_img) : undefined
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
      // Plates: plain JSON body
      const payload = {
        list_id: detail.list_id,
        plate_text: detail.metadata?.text_placa || '',
        nombre_asociado: detail.nombre_asociado || null
      };
      request$ = this.http.post<any>(url, payload);
    } else {
      // Faces: multipart/form-data
      if (!file) {
        if (detail.metadata?.url_img) {
          // Fetch the file from url_img first!
          return this.http.get(detail.metadata.url_img, { responseType: 'blob' }).pipe(
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
        return {
          detail_id: res.detail_id,
          list_id: detail.list_id || '',
          nombre_asociado: detail.nombre_asociado || '',
          fingerprint_host: detail.fingerprint_host || '',
          embedding: detail.embedding || [],
          metadata: {
            ...detail.metadata,
            url_img: (res.url_img || detail.metadata?.url_img) ? MetadataMapper.sanitizeImageUrl(res.url_img || detail.metadata?.url_img) : undefined
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

  querySubjectDetections(subjectName: string, type: 'face' | 'plate', documentId?: string): Observable<any[]> {
    const trimmedName = subjectName ? subjectName.trim() : '';
    if (!trimmedName && !documentId) {
      return of([]);
    }

    const index = type === 'face' ? 'rostros' : 'vehiculos';
    
    let queryBody: any;
    if (trimmedName && documentId) {
      queryBody = {
        bool: {
          should: [
            {
              match_phrase: {
                "reconocimiento": trimmedName
              }
            },
            {
              ids: {
                values: [documentId]
              }
            }
          ],
          minimum_should_match: 1
        }
      };
    } else if (documentId) {
      queryBody = {
        ids: {
          values: [documentId]
        }
      };
    } else {
      queryBody = {
        match_phrase: {
          "reconocimiento": trimmedName
        }
      };
    }

    const query = {
      size: 50,
      query: queryBody,
      sort: [
        { "timestamp": { "order": "desc" } }
      ]
    };

    return this.http.post<any>(`${AppEnvironment.openSearchBaseUrl}/${index}/_search`, query).pipe(
      map(res => {
        const hits = res.hits?.hits || [];
        return hits.map((h: any) => ({
          id: h._id,
          camara: h._source.camara,
          timestamp: parseUtcDate(h._source.timestamp),
          confiabilidad: h._source.confiabilidad || 1.0,
          imagen: MetadataMapper.sanitizeImageUrl(h._source.ruta_imagen_remota),
          tipoObjeto: h._source.tipoObjeto || h._source.tipo_objeto,
          edad: h._source.edad,
          genero: h._source.genero,
          reconocimiento: h._source.reconocimiento,
          posturas: h._source.posturas || [],
          colores: h._source.colores || []
        }));
      }),
      catchError(err => {
        console.error(`[ListRepo] Error fetching past ${type} detections from OpenSearch:`, err);
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

  updateFaceImg(detailId: string, file: File): Observable<ListDetail> {
    const formData = new FormData();
    formData.append('file', file, file.name);

    return this.http.put<any>(`${this.detailsUrl}/update_face_img/${detailId}`, formData).pipe(
      map(res => ({
        detail_id: res.detail_id || detailId,
        list_id: res.list_id || '',
        nombre_asociado: res.nombre_asociado || '',
        fingerprint_host: res.fingerprint_host || '',
        embedding: res.embedding || [],
        metadata: {
          url_img: res.url_img ? MetadataMapper.sanitizeImageUrl(res.url_img) : undefined
        }
      } as ListDetail))
    );
  }

  updateFaceDetail(detailId: string, listId: string, payload: { nombre_asociado: string }): Observable<ListDetail> {
    const body = new HttpParams()
      .set('list_id', listId)
      .set('nombre_asociado', payload.nombre_asociado);
    return this.http.put<any>(`${this.detailsUrl}/update_face_detail/${detailId}`, body.toString(), {
      headers: new HttpHeaders().set('Content-Type', 'application/x-www-form-urlencoded')
    }).pipe(
      map(res => ({
        detail_id: res.detail_id || detailId,
        list_id: res.list_id || listId || '',
        nombre_asociado: res.nombre_asociado || payload.nombre_asociado,
        fingerprint_host: res.fingerprint_host || '',
        embedding: res.embedding || [],
        metadata: {
          url_img: res.url_img ? MetadataMapper.sanitizeImageUrl(res.url_img) : undefined
        }
      } as ListDetail))
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
      map(res => ({
        detail_id: res.detail_id || detailId,
        list_id: res.list_id || listId || '',
        nombre_asociado: res.nombre_asociado || payload.nombre_asociado || '',
        fingerprint_host: res.fingerprint_host || '',
        embedding: res.embedding || [],
        metadata: {
          text_placa: res.metadata?.text_placa || payload.plate_text,
          url_img: res.metadata?.url_img ? MetadataMapper.sanitizeImageUrl(res.metadata.url_img) : undefined
        }
      } as ListDetail))
    );
  }

  private sanitizeDetails(details: ListDetail[]): ListDetail[] {
    return (details || []).map(d => {
      if (d && d.metadata && d.metadata.url_img) {
        return {
          ...d,
          metadata: {
            ...d.metadata,
            url_img: MetadataMapper.sanitizeImageUrl(d.metadata.url_img)
          }
        };
      }
      return d;
    });
  }
}
