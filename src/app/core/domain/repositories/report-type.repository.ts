import { Observable } from 'rxjs';
import { ReportType, ReportTypeFormData, ReportTypePage, ReportTypeQueryParams } from '../entities/report-type.models';

/**
 * Report Types de Azor Panel. `proxyBase` identifica el dominio consultado,
 * p. ej. "/azor-proxy/https/panel.com/443" (ver azor-endpoint.util.ts).
 */
export abstract class IReportTypeRepository {
  abstract getReportTypes(proxyBase: string, params?: ReportTypeQueryParams): Observable<ReportTypePage>;
  abstract createReportType(proxyBase: string, data: ReportTypeFormData): Observable<ReportType>;
  abstract updateReportType(proxyBase: string, id: string, data: ReportTypeFormData): Observable<ReportType>;
  // Sin deleteReportType: la eliminación de tipos de reporte no se gestiona desde este frontend
}
