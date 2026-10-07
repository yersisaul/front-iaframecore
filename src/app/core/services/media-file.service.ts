import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, timer } from 'rxjs';
import { map, shareReplay, catchError, retry } from 'rxjs/operators';
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
   * Implementa reintentos progresivos con backoff para absorber la latencia de
   * escritura cuando los eventos llegan en tiempo real por WebSocket.
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

    // Petición al endpoint GET /frontend/extra/{object_name} con reintentos automáticos
    const request$ = this.http.get<ExtraFileResponse>(`${AppEnvironment.apiUrl}/frontend/extra/${cleanName}`).pipe(
      map(res => {
        const rawUrl = res?.url || res?.download_url || res?.presigned_url || (typeof res === 'string' ? res : '');
        if (!rawUrl || !rawUrl.trim()) {
          throw new Error(`[MediaFileService] Respuesta vacía de URL para objeto "${cleanName}"`);
        }
        return rawUrl;
      }),
      // Reintentar hasta 3 veces con retardo incremental (400ms, 800ms, 1200ms)
      retry({
        count: 3,
        delay: (error, retryCount) => {
          return timer(retryCount * 400);
        }
      }),
      catchError(err => {
        console.warn(`[MediaFileService] Error persistente al resolver URL para objeto "${cleanName}":`, err);
        this.cache.delete(cleanName);
        return of('');
      }),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.cache.set(cleanName, request$);
    return request$;
  }

  /**
   * Precarga de forma proactiva la URL de un objeto en la caché en memoria.
   * Muy útil al recibir eventos o metadatos nuevos por WebSocket para
   * que la imagen esté lista de inmediato al renderizar en el DOM.
   */
  prefetchFileUrl(objectName: string | null | undefined): void {
    if (!objectName || !objectName.trim()) return;
    this.getFileUrl(objectName).subscribe({
      error: () => {}
    });
  }

  /**
   * Invalida la caché de un objeto específico o limpia toda la memoria
   */
  invalidate(objectName: string): void {
    if (objectName) {
      const cleanName = objectName.trim().replace(/^\/+/, '');
      this.cache.delete(cleanName);
    }
  }

  /**
   * Limpia la caché en memoria de URLs
   */
  clearCache(): void {
    this.cache.clear();
  }
}
