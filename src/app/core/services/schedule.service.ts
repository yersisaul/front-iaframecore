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
  readonly isViewActive = signal<boolean>(false);

  readonly newRecordIds = signal<Set<string>>(new Set());
  readonly updatedRecordIds = signal<Set<string>>(new Set());
  readonly deletingRecordIds = signal<Set<string>>(new Set());

  markAsNew(id: string): void {
    this.newRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  markAsUpdated(id: string): void {
    this.updatedRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.updatedRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  markAsDeleting(id: string): void {
    this.deletingRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.deletingRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

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

  updateScheduleStatusLocal(scheduleId: string, status: 'activo' | 'inactivo'): void {
    this.schedules.update(list => list.map(s => s.id === scheduleId ? { ...s, status } : s));
  }

  deleteScheduleLocal(scheduleId: string): void {
    this.schedules.update(list => list.filter(s => s.id !== scheduleId));
  }
}