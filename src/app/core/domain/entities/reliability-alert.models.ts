import { parseUtcDate } from '../../utils/date-utils';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface ReliabilityAlertDTO {
  alert_id: string;
  type: string;
  severity: AlertSeverity;
  message: string;
  fingerprint_host: string | null;
  analytic_id: string | null;
  schedule_id: string | null;
  command_id: string | null;
  correlation_id: string | null;
  details: Record<string, any>;
  created_at: string;
  resolved_at: string | null;
}

export interface ReliabilityAlert {
  id: string;
  type: string;
  typeLabel: string;
  severity: AlertSeverity;
  message: string;
  fingerprintHost: string | null;
  analyticId: string | null;
  scheduleId: string | null;
  commandId: string | null;
  correlationId: string | null;
  details: Record<string, any>;
  createdAt: Date;
  resolvedAt: Date | null;
  isResolved: boolean;
}

export interface ReliabilityAlertQueryParams {
  unresolved?: boolean;
  type?: string;
  fingerprint_host?: string;
  limit?: number;
}

export class ReliabilityAlertMapper {
  static toDomain(dto: ReliabilityAlertDTO): ReliabilityAlert {
    const createdAt = parseUtcDate(dto.created_at);
    const resolvedAt = dto.resolved_at ? parseUtcDate(dto.resolved_at) : null;
    const isResolved = resolvedAt !== null && !isNaN(resolvedAt.getTime());

    return {
      id: dto.alert_id,
      type: dto.type,
      typeLabel: ReliabilityAlertMapper.formatTypeLabel(dto.type),
      severity: (dto.severity?.toLowerCase() as AlertSeverity) || 'info',
      message: dto.message || '',
      fingerprintHost: dto.fingerprint_host || null,
      analyticId: dto.analytic_id || null,
      scheduleId: dto.schedule_id || null,
      commandId: dto.command_id || null,
      correlationId: dto.correlation_id || null,
      details: dto.details || {},
      createdAt,
      resolvedAt,
      isResolved
    };
  }

  static formatTypeLabel(type: string): string {
    if (!type) return 'Alerta';
    const typeMap: Record<string, string> = {
      host_disconnected: 'Host Desconectado',
      host_unresponsive: 'Host Sin Respuesta',
      host_recovered: 'Host Recuperado',
      scheduler_leader_elected: 'Líder de Scheduler Electo',
      analytic_state_mismatch: 'Discrepancia en Analítica',
      command_retrying: 'Reintento de Comando',
      camera_offline: 'Cámara Desconectada',
      stream_error: 'Error de Stream',
      service_degraded: 'Servicio Degradado'
    };

    if (typeMap[type]) {
      return typeMap[type];
    }

    return type
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }
}
