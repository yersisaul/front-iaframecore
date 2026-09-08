import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { DashboardItem, DashboardCreateRequest, DashboardResponse, DashboardMapper } from '../../core/domain/entities/dashboard.models';
import { IDashboardRepository } from '../../core/domain/repositories/dashboard.repository';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class DashboardHttpRepository implements IDashboardRepository {
  private http = inject(HttpClient);
  private readonly baseUrl = `${AppEnvironment.apiUrl}/frontend/dashboards`;

  getAll(): Observable<DashboardItem[]> {
    return this.http.get<DashboardResponse[]>(`${this.baseUrl}/`).pipe(
      map(items => (items || []).map(DashboardMapper.toDomain))
    );
  }

  getById(id: string): Observable<DashboardItem> {
    return this.http.get<DashboardResponse>(`${this.baseUrl}/${id}`).pipe(
      map(DashboardMapper.toDomain)
    );
  }

  create(data: DashboardCreateRequest): Observable<DashboardItem> {
    return this.http.post<DashboardResponse>(`${this.baseUrl}/`, data).pipe(
      map(DashboardMapper.toDomain)
    );
  }

  patch(id: string, data: Partial<DashboardCreateRequest>): Observable<DashboardItem> {
    return this.http.patch<DashboardResponse>(`${this.baseUrl}/${id}`, data).pipe(
      map(DashboardMapper.toDomain)
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }
}
