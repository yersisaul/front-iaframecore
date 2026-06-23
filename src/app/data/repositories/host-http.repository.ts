import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Host, HostDTO, HostMapper, HostMetrics } from '../../core/domain/entities/host.models';
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
        return {
          lastSeen: parseUtcDate(res.last_seen),
          cpu: res.metrics?.cpu ?? 0,
          gpu: res.metrics?.gpu ?? 0,
          vram: res.metrics?.vram ?? 0,
          memory: res.metrics?.memory ?? 0,
          serverTime: serverTime
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
}
