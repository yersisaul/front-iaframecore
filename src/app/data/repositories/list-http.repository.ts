import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
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

  registerList(list: Partial<List>): Observable<List> {
    const payload: any = {
      list_id: list.list_id !== undefined ? list.list_id : null,
      name: list.name || '',
      list_type: list.list_type === 'face_recognition' ? 'RF' : (list.list_type === 'plate_recognition' ? 'LPR' : list.list_type),
      description: list.description !== undefined ? list.description : null
    };
    return this.http.post<any>(`${this.listsUrl}/register`, payload).pipe(
      map(item => ({
        list_id: item.list_id,
        name: item.name,
        description: item.description,
        list_type: item.list_type === 'RF' ? 'face_recognition' : (item.list_type === 'LPR' ? 'plate_recognition' : item.list_type)
      }))
    );
  }

  deleteList(listId: string): Observable<void> {
    return this.http.delete<void>(`${this.listsUrl}/delete/${listId}`).pipe(
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
    // Query list details directly using list_id parameter. If the backend is repaired/mocked,
    // this handles filtering server-side. For backward compatibility, we also filter client-side.
    return this.http.get<ListDetail[]>(`${this.detailsUrl}/`, { params: { list_id: listId } }).pipe(
      map(items => this.sanitizeDetails((items || []).filter(d => d.list_id === listId))),
      catchError(err => {
        console.warn(`Failed to fetch list details directly via /list_details/?list_id=${listId}. Trying fallback.`, err);
        // Fallback: Try fetching via list endpoint if the backend is very old
        return this.http.get<any>(`${this.listsUrl}/${listId}`).pipe(
          map(res => {
            let details: ListDetail[] = [];
            if (Array.isArray(res)) details = res as ListDetail[];
            else if (res && Array.isArray(res.details)) details = res.details as ListDetail[];
            else if (res && Array.isArray(res.list_details)) details = res.list_details as ListDetail[];
            return this.sanitizeDetails(details);
          }),
          catchError(err2 => {
            console.error(`[ListRepo] Both getListDetails methods failed:`, err2);
            return of([]);
          })
        );
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
    return this.http.delete<void>(`${this.detailsUrl}/delete/${detailId}`).pipe(
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
    return this.http.post<any>(`${this.listsUrl}/update`, payload).pipe(
      map(item => ({
        list_id: item.list_id,
        name: item.name,
        description: item.description,
        list_type: item.list_type === 'RF' ? 'face_recognition' : (item.list_type === 'LPR' ? 'plate_recognition' : item.list_type)
      }))
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
