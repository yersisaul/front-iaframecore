import { Observable } from 'rxjs';
import { DashboardItem, DashboardCreateRequest, DashboardUpdateRequest } from '../entities/dashboard.models';

export abstract class IDashboardRepository {
  abstract getAll(): Observable<DashboardItem[]>;
  abstract getById(id: string): Observable<DashboardItem>;
  abstract create(data: DashboardCreateRequest): Observable<DashboardItem>;
  abstract update(id: string, data: DashboardUpdateRequest): Observable<DashboardItem>;
  abstract patch(id: string, data: Partial<DashboardCreateRequest>): Observable<DashboardItem>;
  abstract delete(id: string): Observable<void>;
}
