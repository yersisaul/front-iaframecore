export interface AnalyticTargetCamera {
  camera_id: string;
  camera_name: string;
}

export interface AnalyticDetectionClass {
  class_index: number;
  class_name: string;
}

export interface AnalyticDTO {
  analytic_id: string;
  fingerprint_host: string;
  analytic_type: string;
  analytic_status: string; // 'active' | 'inactive'
  target_cameras: AnalyticTargetCamera[];
  detection_classes: AnalyticDetectionClass[];
  parameters: Record<string, any>;
  geometric_objects: Record<string, any>;
  acciones: Record<string, any>;
}

export interface Analytic {
  id: string;
  hostFingerprint: string;
  type: string;
  status: string; // 'active' | 'inactive'
  targetCameraIds: string[];
  targetCameraNames: string[];
  detectionClasses: string[];
}

export class AnalyticMapper {
  static toDomain(dto: AnalyticDTO): Analytic {
    return {
      id: dto.analytic_id,
      hostFingerprint: dto.fingerprint_host,
      type: dto.analytic_type,
      status: dto.analytic_status,
      targetCameraIds: (dto.target_cameras || []).map(c => c.camera_id),
      targetCameraNames: (dto.target_cameras || []).map(c => c.camera_name),
      detectionClasses: (dto.detection_classes || []).map(d => d.class_name),
    };
  }
}
