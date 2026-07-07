import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Analytic, AnalyticDTO, AnalyticMapper } from '../../core/domain/entities/analytic.models';
import { IAnalyticRepository } from '../../core/domain/repositories/analytic.repository';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class AnalyticHttpRepository implements IAnalyticRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/frontend/analytics`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<Analytic[]> {
    return this.http.get<AnalyticDTO[]>(`${this.apiUrl}/`).pipe(
      map(dtos => (dtos || []).map(AnalyticMapper.toDomain)),
      catchError(err => {
        console.error('Error in AnalyticHttpRepository.getAll:', err);
        return of([]);
      })
    );
  }

  getByHost(hostFingerprint: string): Observable<Analytic[]> {
    return this.http.get<AnalyticDTO[]>(`${this.apiUrl}/${hostFingerprint}`).pipe(
      map(dtos => (dtos || []).map(AnalyticMapper.toDomain)),
      catchError(err => {
        console.error('Error in AnalyticHttpRepository.getByHost:', err);
        return of([]);
      })
    );
  }

  updateStatus(analyticId: string, status: 'active' | 'inactive'): Observable<any> {
    // PATCH /frontend/analytics/update_status/{analytic_id}
    return this.http.patch(`${this.apiUrl}/update_status/${analyticId}`, {
      status: status
    }).pipe(
      catchError(err => {
        if (AppEnvironment.enableBackendWorkarounds && 
            (err.status === 500 || (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422))) {
          console.warn('[BACKEND-WORKAROUND] updateStatus failed. Swallowing error as per workaround config.', err);
          return of(null);
        }
        throw err;
      })
    );
  }

  delete(analyticId: string): Observable<any> {
    // DELETE /frontend/analytics/{analytic_id}
    return this.http.delete<any>(`${this.apiUrl}/${analyticId}`).pipe(
      catchError(err => {
        if (AppEnvironment.enableBackendWorkarounds && 
            (err.status === 500 || (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422))) {
          console.warn('[BACKEND-WORKAROUND] delete failed. Swallowing error as per workaround config.', err);
          return of(null);
        }
        throw err;
      })
    );
  }
}
