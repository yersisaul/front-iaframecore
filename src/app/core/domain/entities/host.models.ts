export interface HostHardwareInfo {
  machineId: string;
  mac: string;
  system: string;
  release: string;
  arch: string;
  totalRam?: string | null;
  totalMemory?: number | null;
}

export interface HostGpuInfo {
  gpu: string;
  model: string;
  totalMemory: string;
  computeCapability: string;
}

export interface HostMetrics {
  lastSeen: Date;
  cpu: number;
  gpu: number;
  vram: number;
  memory: number;
  serverTime?: Date;
}

export interface LicenseFeatures {
  [key: string]: number;
}

export interface HostLicense {
  tipo: 'temporal' | 'permanente';
  emision: string;
  features: LicenseFeatures;
  expiracion?: string;
}

export interface Host {
  id: string;
  fingerprint: string;
  hostname: string;
  ipAddress: string;
  version: string;
  status: string;
  hwInfo: HostHardwareInfo | null;
  gpuInfo: HostGpuInfo | null;
  metrics?: HostMetrics | null;
  license?: HostLicense | null;
}

export interface HostDTO {
  host_id: string;
  fingerprint: string;
  hostname: string;
  ip_address: string;
  version: string;
  status: string;
  hw_info: {
    machine_id: string;
    mac: string;
    system: string;
    release: string;
    arch: string;
    total_ram?: string | null;
    total_memory?: number | null;
  } | null;
  gpu_info: {
    GPU: string;
    model: string;
    total_memory: string;
    compute_capability: string;
  } | null;
  license?: {
    tipo: 'temporal' | 'permanente';
    emision: string;
    features: Record<string, number>;
    expiracion?: string;
  } | null;
}

export interface PaginatedHostsResponse {
  items: HostDTO[];
  total: number;
}

export function formatMemoryGB(mem: string | number | null | undefined): string | null {
  if (mem === null || mem === undefined || mem === '') return null;
  let val = 0;
  if (typeof mem === 'number') {
    if (mem <= 0) return null;
    val = mem / (1024 * 1024 * 1024);
  } else {
    const match = mem.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)?/i);
    if (!match) return null;
    const rawVal = parseFloat(match[1]);
    if (isNaN(rawVal) || rawVal <= 0) return null;
    const unit = (match[2] || 'GB').toUpperCase();
    if (unit === 'GB') val = rawVal;
    else if (unit === 'MB') val = rawVal / 1024;
    else if (unit === 'KB') val = rawVal / (1024 * 1024);
    else if (unit === 'B') val = rawVal / (1024 * 1024 * 1024);
    else val = rawVal;
  }
  const rounded = Math.round(val);
  return rounded > 0 ? `${rounded} GB` : null;
}

export class HostMapper {
  static toDomain(dto: any): Host {
    const fp = dto.fingerprint || dto.host_id || dto.id || '';
    const idVal = dto.host_id || dto.id || dto.fingerprint || '';
    return {
      id: idVal,
      fingerprint: fp,
      hostname: dto.hostname || dto.name || fp,
      ipAddress: dto.ip_address || dto.ipAddress || '',
      version: dto.version || '1.0.0',
      status: dto.status || 'offline',
      hwInfo: dto.hw_info ? {
        machineId: dto.hw_info.machine_id,
        mac: dto.hw_info.mac,
        system: dto.hw_info.system,
        release: dto.hw_info.release,
        arch: dto.hw_info.arch,
        totalRam: formatMemoryGB(dto.hw_info.total_ram || dto.hw_info.total_memory),
        totalMemory: dto.hw_info.total_memory ?? null
      } : null,
      gpuInfo: dto.gpu_info ? {
        gpu: dto.gpu_info.GPU,
        model: dto.gpu_info.model,
        totalMemory: formatMemoryGB(dto.gpu_info.total_memory) || '',
        computeCapability: dto.gpu_info.compute_capability
      } : null,
      license: dto.license ? {
        tipo: dto.license.tipo,
        emision: dto.license.emision,
        features: dto.license.features,
        expiracion: dto.license.expiracion
      } : null
    };
  }
}
