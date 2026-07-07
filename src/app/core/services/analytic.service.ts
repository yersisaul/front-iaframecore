import { Injectable, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Analytic } from '../domain/entities/analytic.models';
import { IAnalyticRepository } from '../domain/repositories/analytic.repository';

@Injectable({
  providedIn: 'root'
})
export class AnalyticService {
  readonly analytics = signal<Analytic[]>([]);
  readonly isLoading = signal(false);
  readonly activeHostFingerprint = signal<string | null>(null);
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

  constructor(private analyticRepository: IAnalyticRepository) { }

  getAnalyticsByHost(hostFingerprint: string): Observable<Analytic[]> {
    this.isLoading.set(true);
    this.activeHostFingerprint.set(hostFingerprint);
    return this.analyticRepository.getByHost(hostFingerprint).pipe(
      tap(analytics => {
        this.analytics.set(analytics);
        this.isLoading.set(false);
      }),
      catchError(() => {
        this.analytics.set([]);
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  getAllAnalytics(): Observable<Analytic[]> {
    this.isLoading.set(true);
    this.activeHostFingerprint.set(null);
    return this.analyticRepository.getAll().pipe(
      tap(analytics => {
        this.analytics.set(analytics);
        this.isLoading.set(false);
      }),
      catchError(() => {
        this.analytics.set([]);
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  updateAnalyticStatus(analyticId: string, status: 'active' | 'inactive'): Observable<any> {
    return this.analyticRepository.updateStatus(analyticId, status);
  }

  deleteAnalytic(analyticId: string): Observable<any> {
    return this.analyticRepository.delete(analyticId);
  }

  updateAnalyticStatusLocal(analyticId: string, status: 'active' | 'inactive'): void {
    this.analytics.update(list => list.map(a => a.id === analyticId ? { ...a, status } : a));
  }

  deleteAnalyticLocal(analyticId: string): void {
    this.analytics.update(list => list.filter(a => a.id !== analyticId));
  }
}