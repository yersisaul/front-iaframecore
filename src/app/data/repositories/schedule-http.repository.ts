import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { Schedule, ScheduleDTO, ScheduleMapper } from '../../core/domain/entities/schedule.models';
import { IScheduleRepository } from '../../core/domain/repositories/schedule.repository';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class ScheduleHttpRepository implements IScheduleRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/frontend/schedules`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<Schedule[]> {
    return this.http.get<ScheduleDTO[]>(`${this.apiUrl}/`).pipe(
      map(dtos => (dtos || []).map(ScheduleMapper.toDomain)),
      catchError(err => {
        console.error('Error in ScheduleHttpRepository.getAll:', err);
        return of([]);
      })
    );
  }

  register(dto: any): Observable<any> {
    return this.http.post(`${this.apiUrl}/create`, dto).pipe(
      catchError(err => {
        if (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422) {
          return of(null);
        }
        throw err;
      })
    );
  }

  update(scheduleId: string, dto: any): Observable<any> {
    return this.http.put(`${this.apiUrl}/update/${scheduleId}`, dto).pipe(
      catchError(err => {
        if (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422) {
          return of(null);
        }
        throw err;
      })
    );
  }

  updateState(scheduleId: string, status: 'activo' | 'inactivo'): Observable<any> {
    return this.http.post(`${this.apiUrl}/update_state/${scheduleId}`, { status }).pipe(
      catchError(err => {
        if (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422) {
          return of(null);
        }
        throw err;
      })
    );
  }

  delete(scheduleId: string): Observable<any> {
    return this.http.delete(`${this.apiUrl}/delete/${scheduleId}`).pipe(
      catchError(err => {
        if (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422) {
          return of(null);
        }
        throw err;
      })
    );
  }
}
