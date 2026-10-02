import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ReliabilityCommand, ReliabilityCommandQueryParams } from '../domain/entities/reliability-command.models';
import { IReliabilityCommandRepository } from '../domain/repositories/reliability-command.repository';

@Injectable({
  providedIn: 'root'
})
export class ReliabilityCommandService {
  private commandRepository = inject(IReliabilityCommandRepository);

  getCommands(params?: ReliabilityCommandQueryParams): Observable<ReliabilityCommand[]> {
    return this.commandRepository.getCommands(params);
  }

  getCommandsByAnalytic(analyticId: string, limit: number = 50): Observable<ReliabilityCommand[]> {
    return this.commandRepository.getCommands({
      analytic_id: analyticId,
      limit
    });
  }

  getCommandsByHost(fingerprintHost: string, limit: number = 50): Observable<ReliabilityCommand[]> {
    return this.commandRepository.getCommands({
      fingerprint_host: fingerprintHost,
      limit
    });
  }

  getStatusColor(status: string): string {
    switch ((status || '').toUpperCase()) {
      case 'FAILED':
        return '#ef4444';
      case 'ACKED':
      case 'APPLIED':
      case 'VERIFIED':
        return '#10b981';
      case 'SENT':
      case 'DISPATCHED':
        return '#0ea5e9';
      case 'PENDING':
      default:
        return '#f59e0b';
    }
  }

  getStatusBgColor(status: string): string {
    switch ((status || '').toUpperCase()) {
      case 'FAILED':
        return 'rgba(239, 68, 68, 0.12)';
      case 'ACKED':
      case 'APPLIED':
      case 'VERIFIED':
        return 'rgba(16, 185, 129, 0.12)';
      case 'SENT':
      case 'DISPATCHED':
        return 'rgba(14, 165, 233, 0.12)';
      case 'PENDING':
      default:
        return 'rgba(245, 158, 11, 0.12)';
    }
  }

  getStatusBadgeClass(status: string): string {
    switch ((status || '').toUpperCase()) {
      case 'FAILED':
        return 'badge-cmd-failed';
      case 'ACKED':
      case 'APPLIED':
      case 'VERIFIED':
        return 'badge-cmd-success';
      case 'SENT':
      case 'DISPATCHED':
        return 'badge-cmd-info';
      case 'PENDING':
      default:
        return 'badge-cmd-warning';
    }
  }
}
