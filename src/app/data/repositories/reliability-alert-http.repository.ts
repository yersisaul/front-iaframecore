import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import {
  ReliabilityAlert,
  ReliabilityAlertDTO,
  ReliabilityAlertMapper,
  ReliabilityAlertQueryParams
} from '../../core/domain/entities/reliability-alert.models';
import { IReliabilityAlertRepository } from '../../core/domain/repositories/reliability-alert.repository';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class ReliabilityAlertHttpRepository implements IReliabilityAlertRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/frontend/reliability/alerts`;

  constructor(private http: HttpClient) {}

  getAlerts(params?: ReliabilityAlertQueryParams): Observable<ReliabilityAlert[]> {
    let httpParams = new HttpParams();

    if (params) {
      if (params.fingerprint_host) {
        httpParams = httpParams.set('fingerprint_host', params.fingerprint_host);
      }
      if (params.unresolved !== undefined && params.unresolved !== null) {
        httpParams = httpParams.set('unresolved', String(params.unresolved));
      }
      if (params.type) {
        httpParams = httpParams.set('type', params.type);
      }
      if (params.limit !== undefined && params.limit !== null) {
        httpParams = httpParams.set('limit', String(params.limit));
      }
    }

    return this.http.get<any>(this.apiUrl, { params: httpParams }).pipe(
      map(res => {
        const items: ReliabilityAlertDTO[] = Array.isArray(res)
          ? res
          : (res && typeof res === 'object' && Array.isArray(res.items) ? res.items : []);
        return items.map(ReliabilityAlertMapper.toDomain);
      }),
      catchError(err => {
        console.error('Error in ReliabilityAlertHttpRepository.getAlerts:', err);
        return of([]);
      })
    );
  }
}
