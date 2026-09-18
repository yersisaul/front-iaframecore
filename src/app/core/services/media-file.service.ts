import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, shareReplay, catchError } from 'rxjs/operators';
import { AppEnvironment } from '../config/app-environment';

export interface ExtraFileResponse {
  url?: string;
  download_url?: string;
  presigned_url?: string;
  [key: string]: any;
}

@Injectable({
  providedIn: 'root'
})
export class MediaFileService {
  private http = inject(HttpClient);
  private cache = new Map<string, Observable<string>>();

  /**
   * Obtiene la URL temporal de un objeto en MinIO a través del endpoint
   * GET /frontend/extra/{object_name}.
   * Devuelve directamente la URL original provista por el backend, permitiendo
   * acceso directo y soporte nativo para múltiples servidores MinIO o dominios públicos.
   */
  getFileUrl(objectName: string | null | undefined): Observable<string> {
    if (!objectName || !objectName.trim()) {
      return of('');
    }

    const cleanName = objectName.trim().replace(/^\/+/, '');

    // Si ya es una URI en memoria (data:, blob:) o una URL absoluta directa (http://, https://)
    if (cleanName.startsWith('data:') || cleanName.startsWith('blob:') || /^https?:\/\//i.test(cleanName)) {
      return of(cleanName);
    }

    // Verificar si ya existe en caché en memoria
    const cached$ = this.cache.get(cleanName);
    if (cached$) {
      return cached$;
    }

    // Petición al endpoint GET /frontend/extra/{object_name}
    const request$ = this.http.get<ExtraFileResponse>(`${AppEnvironment.apiUrl}/frontend/extra/${cleanName}`).pipe(
      map(res => {
        const rawUrl = res?.url || res?.download_url || res?.presigned_url || (typeof res === 'string' ? res : '');
        return rawUrl || '';
      }),
      catchError(err => {
        console.warn(`[MediaFileService] Error al resolver URL para objeto "${cleanName}":`, err);
        this.cache.delete(cleanName);
        return of('');
      }),
      shareReplay(1)
    );

    this.cache.set(cleanName, request$);
    return request$;
  }

  /**
   * Limpia la caché en memoria de URLs
   */
  clearCache(): void {
    this.cache.clear();
  }
}
