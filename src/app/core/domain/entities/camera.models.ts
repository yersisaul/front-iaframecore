import { parseUtcDate } from '../../utils/date-utils';

export interface CameraLocation {
  lat: number | string;
  lon: number | string;
}

export type StreamType = 'Onvif' | 'rtsp' | 'rtmp' | 'nx' | 'Archivo';
export type DecoderType = 'opencv' | 'ffmpeg';
export type PtzMode = 'auto' | 'completa' | 'solo_zoom' | 'desactivado';
export type ProveedorDetecciones = 'servidor' | 'camara';
export type ProbeType = 'nx_list_cameras' | 'onvif_profiles' | 'validate_stream' | 'validate_file';

export interface OnvifProfileInfo {
  codec: string;
  fps: number;
  legible: boolean;
  resolucion: string;
}

export interface OnvifProfilesProbeData {
  fabricante?: string;
  perfiles?: OnvifProfileInfo[];
  tokens?: string[];
  [key: string]: any;
}

export interface NxCameraInfo {
  id: string;
  name: string;
  ipAddress?: string;
  [key: string]: any;
}

export interface CameraProbeRequest {
  fingerprint_host: string;
  probe_type: ProbeType;
  params: Record<string, any>;
}

export interface CameraProbeResponse<T = any> {
  request_id?: string;
  fingerprint_host?: string;
  probe_type?: ProbeType;
  data: T;
}

export interface Camera {
  id: string;
  name: string;
  hostFingerprint: string;
  streamType: StreamType | string;
  status: string;
  decoder: DecoderType | string;
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
  streams?: string[] | null;
  selectedStream?: number;
  selectedProfileToken?: string;
  ptzMode?: PtzMode;
  proveedorDetecciones?: ProveedorDetecciones;
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
  streams?: string[] | null;
  selected_stream?: number;
  selected_profile_token?: string;
  ptz_mode?: string;
  proveedor_detecciones?: string;
}

export interface CameraFrontendCreateRequest {
  camera_id?: string | null;
  camera_name: string;
  fingerprint_host: string;
  stream_type: StreamType;
  decoder?: DecoderType | null;
  location: {
    lat: string;
    lon: string;
  };
  stream_url?: string | null;
  nx_id?: string | null;
  forced_resolution?: string | null;
  forced_fps?: number | null;
  compatibility_mode?: boolean;
  ip_address?: string | null;
  user?: string | null;
  password?: string | null;
  http_port?: number | null;
  streams?: string[] | null;
  selected_stream?: number | null;
  selected_profile_token?: string | null;
  ptz_mode?: PtzMode | null;
  proveedor_detecciones?: ProveedorDetecciones | null;
}

// Retrocompatibilidad con código existente
export type CameraRegisterRequest = CameraFrontendCreateRequest;

export interface CameraFrontendUpdateRequest {
  camera_name?: string | null;
  fingerprint_host?: string | null;
  stream_type?: StreamType | null;
  decoder?: DecoderType | null;
  location?: {
    lat: string;
    lon: string;
  } | null;
  stream_url?: string | null;
  nx_id?: string | null;
  forced_resolution?: string | null;
  forced_fps?: number | null;
  compatibility_mode?: boolean | null;
  ip_address?: string | null;
  user?: string | null;
  password?: string | null;
  http_port?: number | null;
  streams?: string[] | null;
  selected_stream?: number | null;
  selected_profile_token?: string | null;
  ptz_mode?: PtzMode | null;
  proveedor_detecciones?: ProveedorDetecciones | null;
}

// Retrocompatibilidad con código existente
export type CameraUpdateRequest = CameraFrontendUpdateRequest;

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
      streams: Array.isArray(dto.streams)
        ? dto.streams.map((s: any) => (typeof s === 'string' ? s : (s.stream_index !== undefined ? `stream_${s.stream_index}` : JSON.stringify(s))))
        : (dto.streams || undefined),
      selectedStream: dto.selected_stream !== undefined ? dto.selected_stream : dto.selectedStream,
      selectedProfileToken: dto.selected_profile_token || dto.selectedProfileToken || undefined,
      ptzMode: dto.ptz_mode || dto.ptzMode || undefined,
      proveedorDetecciones: dto.proveedor_detecciones || dto.proveedorDetecciones || undefined
    };
  }
}

export interface PtzPreset {
  name: string;
  token: string;
}

export interface PtzPresetsResponse {
  request_id?: string;
  camera_id: string;
  fingerprint_host?: string;
  clase_ptz?: string;
  presets: PtzPreset[];
}

export interface DigitalOutput {
  token: string;
  modo?: string;
  retardo?: string;
  reposo?: string;
}

export interface DigitalOutputsResponse {
  request_id?: string;
  camera_id: string;
  fingerprint_host?: string;
  outputs: DigitalOutput[];
}
