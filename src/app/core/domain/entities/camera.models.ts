import { parseUtcDate } from '../../utils/date-utils';

export interface CameraLocation {
  lat: number;
  lon: number;
}

export interface Camera {
  id: string;
  name: string;
  hostFingerprint: string;
  streamType: string;
  status: string;
  decoder: string;
  location: CameraLocation;
  createdAt: Date | null;
}

export interface CameraDTO {
  camera_id: string;
  camera_name: string;
  fingerprint_host: string;
  stream_type: string;
  status: string;
  decoder: string;
  location: {
    lat: number;
    lon: number;
  };
  created_at?: string | null;
}

export class CameraMapper {
  static toDomain(dto: CameraDTO): Camera {
    return {
      id: dto.camera_id,
      name: dto.camera_name,
      hostFingerprint: dto.fingerprint_host,
      streamType: dto.stream_type,
      status: dto.status,
      decoder: dto.decoder,
      location: dto.location,
      createdAt: dto.created_at ? parseUtcDate(dto.created_at) : null
    };
  }
}
