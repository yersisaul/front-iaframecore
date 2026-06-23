import { Injectable, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { map, tap, catchError } from 'rxjs/operators';
import { Schedule } from '../domain/entities/schedule.models';
import { IScheduleRepository } from '../domain/repositories/schedule.repository';

@Injectable({
  providedIn: 'root'
})
export class ScheduleService {
  readonly schedules = signal<Schedule[]>([]);
  readonly isLoading = signal(false);

  constructor(private scheduleRepository: IScheduleRepository) { }

  /**
   * Fetches ALL schedules from the backend and optionally filters by hostFingerprint
   * on the client side.
   */
  getSchedulesByHost(hostFingerprint: string): Observable<Schedule[]> {
    this.isLoading.set(true);
    return this.scheduleRepository.getAll().pipe(
      map(all => {
        // Filter client-side by the host fingerprint
        return all.filter(s => s.hostFingerprint === hostFingerprint);
      }),
      tap(schedules => {
        this.schedules.set(schedules);
        this.isLoading.set(false);
      }),
      catchError(() => {
        this.schedules.set([]);
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  /**
   * Fetches ALL schedules without filtering. Used by the Horarios view.
   */
  getAllSchedules(): Observable<Schedule[]> {
    this.isLoading.set(true);
    return this.scheduleRepository.getAll().pipe(
      tap(schedules => {
        this.schedules.set(schedules);
        this.isLoading.set(false);
      }),
      catchError(() => {
        this.schedules.set([]);
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  registerSchedule(dto: any): Observable<any> {
    return this.scheduleRepository.register(dto);
  }

  updateSchedule(scheduleId: string, dto: any): Observable<any> {
    return this.scheduleRepository.update(scheduleId, dto);
  }

  updateScheduleState(scheduleId: string, status: 'activo' | 'inactivo'): Observable<any> {
    return this.scheduleRepository.updateState(scheduleId, status);
  }

  deleteSchedule(scheduleId: string): Observable<any> {
    return this.scheduleRepository.delete(scheduleId);
  }
}