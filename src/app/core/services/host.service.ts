import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Host, PaginatedHostsResponse, HostMapper } from '../domain/entities/host.models';
import { AppEnvironment } from '../config/app-environment';

export interface HostFilterOptions {
  os: string[];
  arch: string[];
  gpu: string[];
  vram: string[];
  version: string[];
}

export interface HostFilterParams {
  search?: string;
  status?: string;
  os?: string;
  arch?: string;
  gpu?: string;
  vram?: string;
  version?: string;
}

@Injectable({
  providedIn: 'root'
})
export class HostService {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/hosts`;

  readonly hosts = signal<Host[]>([]);
  readonly totalItems = signal(0);

  constructor(private http: HttpClient) {}

  getHosts(page: number, limit: number, filters?: HostFilterParams): Observable<Host[]> {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('limit', limit.toString());

    if (filters) {
      if (filters.search) params = params.set('search', filters.search);
      if (filters.status) params = params.set('status', filters.status);
      if (filters.os) params = params.set('os', filters.os);
      if (filters.arch) params = params.set('arch', filters.arch);
      if (filters.gpu) params = params.set('gpu', filters.gpu);
      if (filters.vram) params = params.set('vram', filters.vram);
      if (filters.version) params = params.set('version', filters.version);
    }

    return this.http.get<PaginatedHostsResponse>(this.apiUrl, { params }).pipe(
      tap(res => this.totalItems.set(res.total)),
      map(res => res.items.map(HostMapper.toDomain)),
      tap(items => this.hosts.set(items))
    );
  }

  getHostFilterOptions(): Observable<HostFilterOptions> {
    return this.http.get<HostFilterOptions>(`${this.apiUrl}/filters/options`);
  }
}
