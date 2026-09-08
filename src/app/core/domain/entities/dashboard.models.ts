export interface DashboardItem {
  id: string;
  nombre: string;
  url: string;
  descripcion?: string;
  url_img?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface DashboardResponse {
  dashboard_id: string;
  nombre?: string;
  name?: string;
  url?: string;
  url_dashboard?: string;
  descripcion?: string | null;
  description?: string | null;
  url_img?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardCreateRequest {
  nombre: string;
  url: string;
  descripcion?: string | null;
  name?: string;
  description?: string | null;
  url_img?: string | null;
}

export class DashboardMapper {
  static toDomain(dto: DashboardResponse | any): DashboardItem {
    return {
      id: dto.dashboard_id || dto.id || '',
      nombre: dto.nombre || dto.name || 'Sin título',
      url: dto.url || dto.url_dashboard || '',
      descripcion: dto.descripcion ?? dto.description ?? '',
      url_img: dto.url_img || null,
      createdAt: dto.created_at || dto.createdAt,
      updatedAt: dto.updated_at || dto.updatedAt
    };
  }

  static toCreateDto(domain: { nombre: string; url: string; descripcion?: string | null; url_img?: string | null }): DashboardCreateRequest {
    const desc = domain.descripcion?.trim() || null;
    return {
      nombre: domain.nombre.trim(),
      name: domain.nombre.trim(),
      url: domain.url.trim(),
      descripcion: desc,
      description: desc,
      url_img: domain.url_img || null
    };
  }

  static toPatchDto(partial: Partial<{ nombre: string; url: string; descripcion?: string | null; url_img?: string | null }>): Partial<DashboardCreateRequest> {
    const result: any = {};
    if (partial.nombre !== undefined) {
      result.nombre = partial.nombre.trim();
      result.name = partial.nombre.trim();
    }
    if (partial.url !== undefined) {
      result.url = partial.url.trim();
    }
    if (partial.descripcion !== undefined) {
      const desc = partial.descripcion?.trim() || null;
      result.descripcion = desc;
      result.description = desc;
    }
    if (partial.url_img !== undefined) {
      result.url_img = partial.url_img;
    }
    return result;
  }
}
