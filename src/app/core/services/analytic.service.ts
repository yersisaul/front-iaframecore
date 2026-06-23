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

  constructor(private analyticRepository: IAnalyticRepository) { }

  getAnalyticsByHost(hostFingerprint: string): Observable<Analytic[]> {
    this.isLoading.set(true);
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

  updateAnalyticStatus(analyticId: string, status: 'active' | 'inactive'): Observable<any> {
    return this.analyticRepository.updateStatus(analyticId, status);
  }

  deleteAnalytic(analyticId: string): Observable<any> {
    return this.analyticRepository.delete(analyticId);
  }
}