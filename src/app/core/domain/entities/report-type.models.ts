// Report Types provenientes del backend externo Azor Analytics (/others/report-types)

/** Campos de metadata enviados siempre al crear/actualizar un Report Type (no editables desde el frontend). */
export const REPORT_TYPE_METADATA_FIELDS: readonly string[] = [
  'idNx',
  'Camara',
  'Objeto',
  'extra_info',
  'id_match_detail',
  'id_iaframe_camara',
  'timestamp_real'
];

export interface ReportTypeClassification {
  id: string;
  label: string;
}

export const REPORT_TYPE_CLASSIFICATION_DETECCION_IA = '039a81df-8b20-4961-913a-87abc3609f8d';
export const REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA = 'e6025d1d-fcff-4409-84e5-4fb9a04f9c0a';

/** Clasificaciones disponibles. "Reconocimiento IA" aplica a reconocimiento facial y de placas. */
export const REPORT_TYPE_CLASSIFICATIONS: readonly ReportTypeClassification[] = [
  { id: REPORT_TYPE_CLASSIFICATION_DETECCION_IA, label: 'Detección IA' },
  { id: REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA, label: 'Reconocimiento IA' }
];

export const DEFAULT_REPORT_TYPE_CLASSIFICATION = REPORT_TYPE_CLASSIFICATION_DETECCION_IA;

/** Solo se muestran Report Types de estas clasificaciones; cualquier otra se descarta. */
export function isSupportedReportTypeClassification(classificationId: string | null | undefined): boolean {
  return !!classificationId && REPORT_TYPE_CLASSIFICATIONS.some(c => c.id === classificationId);
}

export function getReportTypeClassificationLabel(classificationId: string | null | undefined): string {
  if (!classificationId) return 'Sin clasificación';
  return REPORT_TYPE_CLASSIFICATIONS.find(c => c.id === classificationId)?.label || 'Clasificación desconocida';
}

export interface ReportTypeDTO {
  id: string;
  name: string;
  description?: string | null;
  icon?: string | null;
  configCreateMetadata?: Record<string, string> | null;
  classification?: string | null;
}

export interface ReportTypePageDTO {
  page: number;
  totalItems: number;
  totalPages: number;
  limit: number;
  items: ReportTypeDTO[];
}

export interface ReportType {
  id: string;
  name: string;
  description: string;
  classification: string | null;
  configCreateMetadata: Record<string, string>;
}

export interface ReportTypePage {
  page: number;
  totalItems: number;
  totalPages: number;
  limit: number;
  items: ReportType[];
}

export interface ReportTypeQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  name?: string;
  description?: string;
  classification?: string;
  id?: string;
  /** true: solo tipos con al menos 1 reporte registrado. El repositorio envía false por defecto (todos los tipos). */
  hasReports?: boolean;
}

/** Datos editables desde el frontend. metadataFields se agrega siempre en el repositorio; icon se omite. */
export interface ReportTypeFormData {
  name: string;
  description: string;
  classification: string;
}

export interface ReportTypePayload extends ReportTypeFormData {
  metadataFields: string[];
}

/** El dominio respondió, pero no con el formato de Report Types de Azor Panel (p. ej. HTML de otro servidor). */
export class AzorPanelInvalidResponseError extends Error {
  constructor() {
    super('La respuesta no corresponde a un listado de tipos de reporte de Azor Panel.');
    this.name = 'AzorPanelInvalidResponseError';
  }
}

export class ReportTypeMapper {
  static toDomain(dto: ReportTypeDTO): ReportType {
    return {
      id: dto.id,
      name: dto.name || '',
      description: dto.description || '',
      classification: dto.classification || null,
      configCreateMetadata: dto.configCreateMetadata || {}
    };
  }

  static toPayload(data: ReportTypeFormData): ReportTypePayload {
    return {
      name: data.name.trim(),
      description: (data.description || '').trim(),
      classification: data.classification || DEFAULT_REPORT_TYPE_CLASSIFICATION,
      metadataFields: [...REPORT_TYPE_METADATA_FIELDS]
    };
  }
}
