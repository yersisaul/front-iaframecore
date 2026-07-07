import { Observable } from 'rxjs';
import { Analytic } from '../entities/analytic.models';

export abstract class IAnalyticRepository {
  abstract getAll(): Observable<Analytic[]>;
  abstract getByHost(hostFingerprint: string): Observable<Analytic[]>;
  abstract updateStatus(analyticId: string, status: 'active' | 'inactive'): Observable<any>;
  abstract delete(analyticId: string): Observable<any>;
}
