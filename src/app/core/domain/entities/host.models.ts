export interface HostHardwareInfo {
  machineId: string;
  mac: string;
  system: string;
  release: string;
  arch: string;
}

export interface HostGpuInfo {
  gpu: string;
  model: string;
  totalMemory: string;
  computeCapability: string;
}

export interface Host {
  id: string;
  hostname: string;
  ipAddress: string;
  version: string;
  status: string;
  hwInfo: HostHardwareInfo | null;
  gpuInfo: HostGpuInfo | null;
}

export interface HostDTO {
  host_id: string;
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
  } | null;
  gpu_info: {
    GPU: string;
    model: string;
    total_memory: string;
    compute_capability: string;
  } | null;
}

export interface PaginatedHostsResponse {
  items: HostDTO[];
  total: number;
}

export class HostMapper {
  static toDomain(dto: HostDTO): Host {
    return {
      id: dto.host_id,
      hostname: dto.hostname,
      ipAddress: dto.ip_address,
      version: dto.version,
      status: dto.status,
      hwInfo: dto.hw_info ? {
        machineId: dto.hw_info.machine_id,
        mac: dto.hw_info.mac,
        system: dto.hw_info.system,
        release: dto.hw_info.release,
        arch: dto.hw_info.arch
      } : null,
      gpuInfo: dto.gpu_info ? {
        gpu: dto.gpu_info.GPU,
        model: dto.gpu_info.model,
        totalMemory: dto.gpu_info.total_memory,
        computeCapability: dto.gpu_info.compute_capability
      } : null
    };
  }
}
