import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import {
  ReliabilityCommand,
  ReliabilityCommandDTO,
  ReliabilityCommandMapper,
  ReliabilityCommandQueryParams
} from '../../core/domain/entities/reliability-command.models';
import { IReliabilityCommandRepository } from '../../core/domain/repositories/reliability-command.repository';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class ReliabilityCommandHttpRepository implements IReliabilityCommandRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/frontend/reliability/commands`;

  constructor(private http: HttpClient) {}

  getCommands(params?: ReliabilityCommandQueryParams): Observable<ReliabilityCommand[]> {
    let httpParams = new HttpParams();

    if (params) {
      if (params.analytic_id) {
        httpParams = httpParams.set('analytic_id', params.analytic_id);
      }
      if (params.fingerprint_host) {
        httpParams = httpParams.set('fingerprint_host', params.fingerprint_host);
      }
      if (params.schedule_id) {
        httpParams = httpParams.set('schedule_id', params.schedule_id);
      }
      if (params.correlation_id) {
        httpParams = httpParams.set('correlation_id', params.correlation_id);
      }
      if (params.status) {
        httpParams = httpParams.set('status', params.status);
      }
      if (params.since) {
        httpParams = httpParams.set('since', params.since);
      }
      if (params.until) {
        httpParams = httpParams.set('until', params.until);
      }
      if (params.limit !== undefined && params.limit !== null) {
        httpParams = httpParams.set('limit', String(params.limit));
      }
    }

    return this.http.get<any>(this.apiUrl, { params: httpParams }).pipe(
      map(res => {
        const items: ReliabilityCommandDTO[] = Array.isArray(res)
          ? res
          : (res && typeof res === 'object' && Array.isArray(res.items) ? res.items : []);
        return items.map(ReliabilityCommandMapper.toDomain);
      }),
      catchError(err => {
        console.error('Error in ReliabilityCommandHttpRepository.getCommands:', err);
        return of([]);
      })
    );
  }
}
