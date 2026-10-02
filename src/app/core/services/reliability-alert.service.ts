import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ReliabilityAlert, ReliabilityAlertQueryParams } from '../domain/entities/reliability-alert.models';
import { IReliabilityAlertRepository } from '../domain/repositories/reliability-alert.repository';

@Injectable({
  providedIn: 'root'
})
export class ReliabilityAlertService {
  private alertRepository = inject(IReliabilityAlertRepository);

  getAlerts(params?: ReliabilityAlertQueryParams): Observable<ReliabilityAlert[]> {
    return this.alertRepository.getAlerts(params);
  }

  getAlertsByHost(fingerprintHost: string, limit: number = 1000): Observable<ReliabilityAlert[]> {
    return this.alertRepository.getAlerts({
      fingerprint_host: fingerprintHost,
      limit
    });
  }

  getSeverityColor(severity: string): string {
    switch ((severity || '').toLowerCase()) {
      case 'critical':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      case 'info':
      default:
        return '#0ea5e9';
    }
  }

  getSeverityBgColor(severity: string): string {
    switch ((severity || '').toLowerCase()) {
      case 'critical':
        return 'rgba(239, 68, 68, 0.12)';
      case 'warning':
        return 'rgba(245, 158, 11, 0.12)';
      case 'info':
      default:
        return 'rgba(14, 165, 233, 0.12)';
    }
  }

  getSeverityLabel(severity: string): string {
    switch ((severity || '').toLowerCase()) {
      case 'critical':
        return 'Crítica';
      case 'warning':
        return 'Advertencia';
      case 'info':
      default:
        return 'Informativa';
    }
  }
}
