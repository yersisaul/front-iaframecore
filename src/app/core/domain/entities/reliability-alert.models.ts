import { parseUtcDate } from '../../utils/date-utils';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export interface ReliabilityAlertDTO {
  alert_id: string;
  type: string;
  severity: AlertSeverity;
  message: string;
  dedupe_key?: string | null;
  fingerprint_host: string | null;
  analytic_id: string | null;
  schedule_id: string | null;
  command_id: string | null;
  correlation_id: string | null;
  details: Record<string, any>;
  created_at?: string;
  timestamp?: string;
  resolved_at?: string | null;
}

export interface ReliabilityAlert {
  id: string;
  type: string;
  typeLabel: string;
  severity: AlertSeverity;
  message: string;
  dedupeKey?: string | null;
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
    const rawDate = dto.timestamp || dto.created_at;
    const createdAt = rawDate ? parseUtcDate(rawDate) : new Date();
    const resolvedAt = dto.resolved_at ? parseUtcDate(dto.resolved_at) : null;
    const isResolved = resolvedAt !== null && !isNaN(resolvedAt.getTime());

    return {
      id: dto.alert_id,
      type: dto.type,
      typeLabel: ReliabilityAlertMapper.formatTypeLabel(dto.type),
      severity: (dto.severity?.toLowerCase() as AlertSeverity) || 'info',
      message: dto.message || '',
      dedupeKey: dto.dedupe_key || null,
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

/**
 * Determina si una alerta pertenece o afecta a un host dado,
 * verificando tanto fingerprintHost directo como listas de fingerprints en details.
 */
export function alertRelatesToHost(alert: ReliabilityAlert, hostFingerprint: string): boolean {
  if (!hostFingerprint) return true;
  if (alert.fingerprintHost === hostFingerprint) return true;

  const details = alert.details;
  if (details && typeof details === 'object') {
    if (details['fingerprint'] === hostFingerprint) return true;
    if (details['fingerprint_host'] === hostFingerprint) return true;
    if (details['host_fingerprint'] === hostFingerprint) return true;
    if (Array.isArray(details['fingerprints']) && details['fingerprints'].includes(hostFingerprint)) return true;
    if (Array.isArray(details['affected_hosts']) && details['affected_hosts'].includes(hostFingerprint)) return true;
    if (Array.isArray(details['host_fingerprints']) && details['host_fingerprints'].includes(hostFingerprint)) return true;
  }
  return false;
}

/**
 * Extrae todos los fingerprints de hosts relacionados a una alerta (tanto singular como múltiple).
 */
export function getAlertHostFingerprints(alert: ReliabilityAlert): string[] {
  const fps = new Set<string>();
  if (alert.fingerprintHost) {
    fps.add(alert.fingerprintHost);
  }
  const details = alert.details;
  if (details && typeof details === 'object') {
    if (typeof details['fingerprint'] === 'string') fps.add(details['fingerprint']);
    if (typeof details['fingerprint_host'] === 'string') fps.add(details['fingerprint_host']);
    if (typeof details['host_fingerprint'] === 'string') fps.add(details['host_fingerprint']);
    if (Array.isArray(details['fingerprints'])) {
      details['fingerprints'].forEach((fp: unknown) => {
        if (typeof fp === 'string' && fp.trim()) fps.add(fp.trim());
      });
    }
    if (Array.isArray(details['affected_hosts'])) {
      details['affected_hosts'].forEach((fp: unknown) => {
        if (typeof fp === 'string' && fp.trim()) fps.add(fp.trim());
      });
    }
    if (Array.isArray(details['host_fingerprints'])) {
      details['host_fingerprints'].forEach((fp: unknown) => {
        if (typeof fp === 'string' && fp.trim()) fps.add(fp.trim());
      });
    }
  }
  return Array.from(fps);
}
