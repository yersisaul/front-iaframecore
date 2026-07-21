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

  getById(scheduleId: string): Observable<Schedule> {
    return this.http.get<ScheduleDTO>(`${this.apiUrl}/${scheduleId}`).pipe(
      map(ScheduleMapper.toDomain),
      catchError(err => {
        console.error('Error in ScheduleHttpRepository.getById:', err);
        throw err;
      })
    );
  }

  register(dto: any): Observable<any> {
    // POST /frontend/schedules/
    const mappedDto = this.mapDtoForBackend(dto);
    const url = this.apiUrl.endsWith('/') ? this.apiUrl : `${this.apiUrl}/`;
    console.log('[ScheduleHttpRepository] POST Create Schedule Payload:', mappedDto);
    return this.http.post(url, mappedDto).pipe(
      catchError(err => {
        console.error('[ScheduleHttpRepository] POST Create Schedule failed:', err?.error || err);
        throw err;
      })
    );
  }

  update(scheduleId: string, dto: any): Observable<any> {
    // PUT /frontend/schedules/{schedule_id}
    const mappedDto = this.mapDtoForBackend(dto);
    console.log(`[ScheduleHttpRepository] PUT Update Schedule (${scheduleId}) Payload:`, mappedDto);
    return this.http.put(`${this.apiUrl}/${scheduleId}`, mappedDto).pipe(
      catchError(err => {
        console.error(`[ScheduleHttpRepository] PUT Update Schedule (${scheduleId}) failed:`, err?.error || err);
        throw err;
      })
    );
  }

  updateState(scheduleId: string, status: 'activo' | 'inactivo'): Observable<any> {
    // PATCH /frontend/schedules/update_state/{schedule_id}
    const mappedStatus = status === 'activo' ? 'active' : 'inactive';
    return this.http.patch(`${this.apiUrl}/update_state/${scheduleId}`, { status: mappedStatus }).pipe(
      catchError(err => {
        if (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422) {
          return of(null);
        }
        throw err;
      })
    );
  }

  delete(scheduleId: string): Observable<any> {
    // DELETE /frontend/schedules/{schedule_id}
    return this.http.delete(`${this.apiUrl}/${scheduleId}`).pipe(
      catchError(err => {
        if (err.status !== 400 && err.status !== 401 && err.status !== 403 && err.status !== 404 && err.status !== 422) {
          return of(null);
        }
        throw err;
      })
    );
  }

  private mapDtoForBackend(dto: any): any {
    if (!dto) return dto;
    const mapped = { ...dto };
    
    // Remover campos que no pertenecen al schema HorarioRequest
    delete mapped.fingerprint_host;
    
    // 1. Format dates to "DD/MM/YYYY HH:mm"
    if (mapped.timestamp_inicio) {
      mapped.timestamp_inicio = this.formatDateForBackend(mapped.timestamp_inicio);
    }
    if (mapped.timestamp_fin) {
      mapped.timestamp_fin = this.formatDateForBackend(mapped.timestamp_fin);
    }
    
    // 2. Map status ('activo' -> 'active', 'inactivo' -> 'inactive')
    if (mapped.estado) {
      if (mapped.estado === 'activo') {
        mapped.estado = 'active';
      } else if (mapped.estado === 'inactivo') {
        mapped.estado = 'inactive';
      }
    }

    // 3. Map frecuencia ('diario' -> 'Diario', 'semanal' -> 'Semanal', 'mensual' -> 'Mensual')
    if (mapped.frecuencia) {
      const f = String(mapped.frecuencia).trim().toLowerCase();
      if (f === 'diario') mapped.frecuencia = 'Diario';
      else if (f === 'semanal') mapped.frecuencia = 'Semanal';
      else if (f === 'mensual') mapped.frecuencia = 'Mensual';
    }
    
    return mapped;
  }

  private formatDateForBackend(value: any): string {
    if (!value) return '';
    
    // If string, inspect format first
    if (typeof value === 'string') {
      const str = value.trim();
      
      // Matches YYYY-MM-DDTHH:mm:ss... (ISO format)
      const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (isoMatch) {
        const [_, y, m, d, hh, mm] = isoMatch;
        return `${d}/${m}/${y} ${hh}:${mm}`;
      }
      
      // Matches YYYY-MM-DD HH:mm:ss or YYYY-MM-DD HH:mm
      const spaceMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
      if (spaceMatch) {
        const [_, y, m, d, hh, mm] = spaceMatch;
        return `${d}/${m}/${y} ${hh}:${mm}`;
      }
      
      // If already DD/MM/YYYY HH:mm, keep first 16 chars
      const slashMatch = str.match(/^\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}/);
      if (slashMatch) {
        return str.substring(0, 16);
      }
    }
    
    // Default to Date object parsing (as UTC)
    const dateObj = (value instanceof Date) ? value : new Date(value);
    if (isNaN(dateObj.getTime())) {
      return '';
    }
    
    const pad = (num: number) => num.toString().padStart(2, '0');
    const day = pad(dateObj.getUTCDate());
    const month = pad(dateObj.getUTCMonth() + 1);
    const year = dateObj.getUTCFullYear();
    const hours = pad(dateObj.getUTCHours());
    const minutes = pad(dateObj.getUTCMinutes());
    
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  }
}
