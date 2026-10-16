import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import {
  AzorPanelInvalidResponseError,
  ReportType,
  ReportTypeDTO,
  ReportTypeFormData,
  ReportTypeMapper,
  ReportTypePage,
  ReportTypePageDTO,
  ReportTypeQueryParams
} from '../../core/domain/entities/report-type.models';
import { IReportTypeRepository } from '../../core/domain/repositories/report-type.repository';

const REPORT_TYPES_PATH = '/others/report-types';

@Injectable({
  providedIn: 'root'
})
export class ReportTypeHttpRepository implements IReportTypeRepository {
  // La X-API-Key de integración la inyecta el proxy (Nginx / azor-dev-proxy.js)

  constructor(private http: HttpClient) {}

  getReportTypes(proxyBase: string, params?: ReportTypeQueryParams): Observable<ReportTypePage> {
    let httpParams = new HttpParams();

    // hasReports=false por defecto: lista todos los tipos, tengan o no reportes registrados
    const query: ReportTypeQueryParams = { hasReports: false, ...params };
    (Object.keys(query) as (keyof ReportTypeQueryParams)[]).forEach(key => {
      const value = query[key];
      if (value !== undefined && value !== null && String(value).trim() !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    });

    return this.http.get<ReportTypePageDTO | ReportTypeDTO[]>(this.url(proxyBase), { params: httpParams }).pipe(
      map(res => {
        if (Array.isArray(res)) {
          return { page: 1, totalItems: res.length, totalPages: 1, limit: res.length, items: res.map(ReportTypeMapper.toDomain) };
        }
        // Solo cuenta como respuesta válida una página con "items": evita tomar como vacío a otro servidor
        if (!res || typeof res !== 'object' || !Array.isArray(res.items)) {
          throw new AzorPanelInvalidResponseError();
        }
        return {
          page: Number(res.page) || 1,
          totalItems: Number(res.totalItems) || res.items.length,
          totalPages: Number(res.totalPages) || 1,
          limit: Number(res.limit) || res.items.length,
          items: res.items.map(ReportTypeMapper.toDomain)
        };
      })
    );
  }

  createReportType(proxyBase: string, data: ReportTypeFormData): Observable<ReportType> {
    const payload = ReportTypeMapper.toPayload(data);
    return this.http.post<any>(this.url(proxyBase), payload).pipe(
      map(res => ReportTypeMapper.toDomain({ ...payload, ...this.unwrap(res) }))
    );
  }

  updateReportType(proxyBase: string, id: string, data: ReportTypeFormData): Observable<ReportType> {
    const payload = ReportTypeMapper.toPayload(data);
    return this.http.patch<any>(`${this.url(proxyBase)}/${encodeURIComponent(id)}`, payload).pipe(
      map(res => {
        // Si el backend responde sin la entidad, se conserva lo enviado con el ID original
        const body = this.unwrap(res);
        return ReportTypeMapper.toDomain({ ...payload, ...body, id: body.id || id });
      })
    );
  }

  private url(proxyBase: string): string {
    return `${proxyBase.replace(/\/+$/, '')}${REPORT_TYPES_PATH}`;
  }

  /** Soporta respuestas planas ({ id, ... }) o envueltas ({ data: { id, ... } }). */
  private unwrap(res: any): ReportTypeDTO {
    if (res && typeof res === 'object' && res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
      return res.data;
    }
    return res && typeof res === 'object' ? res : ({} as ReportTypeDTO);
  }
}
