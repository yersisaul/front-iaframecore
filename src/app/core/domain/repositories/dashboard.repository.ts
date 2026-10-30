import { Observable } from 'rxjs';
import { DashboardItem, DashboardCreateRequest, DashboardUpdateRequest } from '../entities/dashboard.models';

export abstract class IDashboardRepository {
  abstract getAll(): Observable<DashboardItem[]>;
  abstract getById(id: string): Observable<DashboardItem>;
  abstract create(data: DashboardCreateRequest | FormData): Observable<DashboardItem>;
  abstract update(id: string, data: DashboardUpdateRequest | FormData): Observable<DashboardItem>;
  abstract patch(id: string, data: Partial<DashboardCreateRequest> | FormData): Observable<DashboardItem>;
  abstract delete(id: string): Observable<void>;
}
