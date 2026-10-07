import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Host, HostDTO, HostMapper, HostMetrics, ReliabilityHostStatusDTO } from '../../core/domain/entities/host.models';
import { IHostRepository } from '../../core/domain/repositories/host.repository';
import { AppEnvironment } from '../../core/config/app-environment';
import { parseUtcDate } from '../../core/utils/date-utils';

@Injectable({
  providedIn: 'root'
})
export class HostHttpRepository implements IHostRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/frontend/hosts/`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<Host[]> {
    const params = new HttpParams().set('page', '1').set('limit', '1000');
    return this.http.get<any>(this.apiUrl, { params }).pipe(
      map(res => {
        const items: HostDTO[] = (res && typeof res === 'object' && 'items' in res)
          ? res.items
          : (Array.isArray(res) ? res : []);
        return items.map(HostMapper.toDomain);
      }),
      catchError(err => {
        console.error('Error in HostHttpRepository.getAll:', err);
        return of([]);
      })
    );
  }

  getHeartbeat(fingerprint: string): Observable<HostMetrics> {
    return this.http.get<any>(`${AppEnvironment.apiUrl}/frontend/hosts/heartbeat/${fingerprint}`, { observe: 'response' }).pipe(
      map(response => {
        const res = response.body;
        const serverDateHeader = response.headers.get('Date');
        const serverTime = serverDateHeader ? new Date(serverDateHeader) : new Date();
        const rawGpus = res?.metrics?.gpus_observability;
        const gpusObservability = Array.isArray(rawGpus)
          ? rawGpus.map((g: any) => ({
              gpu_id: Number(g.gpu_id ?? 0),
              alive: Boolean(g.alive),
              fps: Number(g.fps ?? 0),
              latency_ms: Number(g.latency_ms ?? 0),
              queue: Number(g.queue ?? 0),
              queue_max: Number(g.queue_max ?? 0),
              dropped_s: Number(g.dropped_s ?? 0),
              result_dropped_s: Number(g.result_dropped_s ?? 0)
            }))
          : [];

        return {
          lastSeen: parseUtcDate(res.last_seen),
          cpu: res.metrics?.cpu ?? 0,
          gpu: res.metrics?.gpu ?? 0,
          vram: res.metrics?.vram ?? 0,
          memory: res.metrics?.memory ?? 0,
          serverTime: serverTime,
          gpusObservability
        };
      }),
      catchError(err => {
        console.error(`Error in HostHttpRepository.getHeartbeat for ${fingerprint}:`, err);
        return throwError(() => err);
      })
    );
  }

  migrateSetup(oldFingerprint: string, newFingerprint: string): Observable<void> {
    return this.http.post<void>(`${AppEnvironment.apiUrl}/frontend/hosts/migrate_setup`, {
      old_fingerprint: oldFingerprint,
      new_fingerprint: newFingerprint
    });
  }

  getInfoModels(fingerprint: string): Observable<any> {
    return this.http.get<any>(`${AppEnvironment.apiUrl}/frontend/hosts/info_models/${fingerprint}`).pipe(
      catchError(err => {
        console.error(`Error in HostHttpRepository.getInfoModels for ${fingerprint}:`, err);
        return of({});
      })
    );
  }

  allowReenroll(fingerprint: string): Observable<any> {
    return this.http.post<any>(`${AppEnvironment.apiUrl}/frontend/hosts/${fingerprint}/allow_reenroll`, {});
  }

  getReliabilityHosts(): Observable<ReliabilityHostStatusDTO[]> {
    return this.http.get<ReliabilityHostStatusDTO[]>(`${AppEnvironment.apiUrl}/frontend/reliability/hosts`).pipe(
      catchError(err => {
        console.error('Error in HostHttpRepository.getReliabilityHosts:', err);
        return of([]);
      })
    );
  }

  delete(fingerprint: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}${fingerprint}`);
  }
}
