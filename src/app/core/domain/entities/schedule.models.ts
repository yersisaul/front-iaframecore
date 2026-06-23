import { parseUtcDate } from '../../utils/date-utils';

export interface ScheduleAnalytic {
  id_analytic: string;
}

export interface Schedule {
  id: string;
  name: string;
  hostFingerprint: string;
  analyticIds: string[]; // Extracted from analytics_ids
  start: Date;           // Parsed from timestamp_inicio
  end: Date;             // Parsed from timestamp_fin
  frequency: string;
  status: string;        // 'activo' | 'inactivo' etc.
}

export interface ScheduleDTO {
  schedule_id: string;
  nombre: string;
  fingerprint_host: string;
  analytics_ids: ScheduleAnalytic[];
  timestamp_inicio: string;
  timestamp_fin: string;
  frecuencia: string;
  estado: string;
}

export class ScheduleMapper {
  static toDomain(dto: ScheduleDTO): Schedule {
    return {
      id: dto.schedule_id,
      name: dto.nombre,
      hostFingerprint: dto.fingerprint_host,
      analyticIds: (dto.analytics_ids || []).map(a => a.id_analytic),
      start: parseUtcDate(dto.timestamp_inicio),
      end: parseUtcDate(dto.timestamp_fin),
      frequency: dto.frecuencia ? dto.frecuencia.trim().toLowerCase() : '',
      status: dto.estado
    };
  }
}
