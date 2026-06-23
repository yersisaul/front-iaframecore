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
  if (mem === null || mem === undefined) return null;
  let val = 0;
  if (typeof mem === 'number') {
    val = mem / (1024 * 1024 * 1024);
  } else {
    const match = mem.match(/(\d+(?:\.\d+)?)\s*(GB|MB|KB|B)?/i);
    if (!match) return mem;
    const rawVal = parseFloat(match[1]);
    const unit = (match[2] || 'GB').toUpperCase();
    if (unit === 'GB') val = rawVal;
    else if (unit === 'MB') val = rawVal / 1024;
    else if (unit === 'KB') val = rawVal / (1024 * 1024);
    else if (unit === 'B') val = rawVal / (1024 * 1024 * 1024);
    else val = rawVal;
  }
  return `${Math.round(val)} GB`;
}

export class HostMapper {
  static toDomain(dto: HostDTO): Host {
    return {
      id: dto.host_id,
      fingerprint: dto.fingerprint || '',
      hostname: dto.hostname,
      ipAddress: dto.ip_address,
      version: dto.version,
      status: dto.status || 'online',
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
