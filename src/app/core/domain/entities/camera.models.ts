import { parseUtcDate } from '../../utils/date-utils';

export interface CameraLocation {
  lat: number | string;
  lon: number | string;
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
  rtspUrl?: string;
  streamUrl?: string;
  url?: string;
  nxId?: string;
  forcedResolution?: string;
  forcedFps?: number;
  compatibilityMode?: boolean;
  ipAddress?: string;
  user?: string;
  password?: string;
  httpPort?: number;
  selectedStream?: number;
}

export interface CameraDTO {
  camera_id: string;
  camera_name: string;
  fingerprint_host: string;
  stream_type: string;
  status: string;
  decoder: string;
  location: {
    lat: number | string;
    lon: number | string;
  };
  created_at?: string | null;
  nx_id?: string;
  stream_url?: string;
  forced_resolution?: string;
  forced_fps?: number;
  compatibility_mode?: boolean;
  ip_address?: string;
  user?: string;
  password?: string;
  http_port?: number;
  selected_stream?: number;
}

export type StreamType = 'Onvif' | 'rtsp' | 'rtmp' | 'nx';
export type DecoderType = 'opencv' | 'ffmpeg';

export interface CameraRegisterRequest {
  camera_id?: string | null;
  camera_name: string;
  fingerprint_host: string;
  stream_type: StreamType;
  decoder?: DecoderType | null;
  location?: {
    lat: string | number;
    lon: string | number;
  } | null;
  stream_url?: string | null;
  nx_id?: string | null;
  forced_resolution?: string | null;
  forced_fps?: number | null;
  compatibility_mode?: boolean;
  ip_address?: string | null;
  user?: string | null;
  password?: string | null;
  http_port?: number | null;
  streams?: Array<Record<string, any>> | null;
  selected_stream?: number | null;
}

export interface CameraUpdateRequest {
  camera_name?: string;
  fingerprint_host?: string;
  stream_type?: StreamType | string;
  decoder?: DecoderType | string | null;
  location?: {
    lat: string | number;
    lon: string | number;
  } | null;
  stream_url?: string | null;
  nx_id?: string | null;
  forced_resolution?: string | null;
  forced_fps?: number | null;
  compatibility_mode?: boolean;
  ip_address?: string | null;
  user?: string | null;
  password?: string | null;
  http_port?: number | null;
  streams?: Array<Record<string, any>> | null;
  selected_stream?: number | null;
}

export class CameraMapper {
  static toDomain(dto: any): Camera {
    return {
      id: dto.camera_id || dto.id || '',
      name: dto.camera_name || dto.name || '',
      hostFingerprint: dto.fingerprint_host || dto.host_fingerprint || dto.fingerprint || dto.host_id || dto.hostId || '',
      streamType: dto.stream_type || dto.streamType || '',
      status: dto.status || 'online',
      decoder: dto.decoder || '',
      location: dto.location || { lat: 0, lon: 0 },
      createdAt: dto.created_at ? parseUtcDate(dto.created_at) : null,
      nxId: dto.nx_id || dto.nxId || undefined,
      streamUrl: dto.stream_url || dto.streamUrl || dto.rtsp_url || dto.rtspUrl || dto.url || undefined,
      rtspUrl: dto.rtsp_url || dto.rtspUrl || dto.stream_url || dto.streamUrl || undefined,
      forcedResolution: dto.forced_resolution || dto.forcedResolution || undefined,
      forcedFps: dto.forced_fps !== undefined ? dto.forced_fps : dto.forcedFps,
      compatibilityMode: dto.compatibility_mode ?? dto.compatibilityMode ?? false,
      ipAddress: dto.ip_address || dto.ipAddress || undefined,
      user: dto.user || undefined,
      password: dto.password || undefined,
      httpPort: dto.http_port !== undefined ? dto.http_port : dto.httpPort,
      selectedStream: dto.selected_stream !== undefined ? dto.selected_stream : dto.selectedStream
    };
  }
}

