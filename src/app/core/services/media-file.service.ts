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
   * Obtiene la URL presignada temporal para un objeto de MinIO a través del endpoint
   * GET /frontend/extra/{object_name}
   */
  getFileUrl(objectName: string | null | undefined): Observable<string> {
    if (!objectName || !objectName.trim()) {
      return of('');
    }

    const cleanName = objectName.trim().replace(/^\/+/, '');

    // Si ya es una URL completa (http://, https:// o data:), retornarla directamente
    if (/^https?:\/\//i.test(cleanName) || cleanName.startsWith('data:')) {
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
        const url = res?.url || res?.download_url || res?.presigned_url || (typeof res === 'string' ? res : '');
        return url;
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
