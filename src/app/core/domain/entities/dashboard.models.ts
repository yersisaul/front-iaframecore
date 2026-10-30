export interface DashboardItem {
  id: string;
  nombre: string;
  name?: string;
  url: string;
  descripcion?: string;
  description?: string;
  img_minio_object_name?: string | null;
  url_img?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface DashboardResponse {
  dashboard_id: string;
  name: string;
  url: string;
  description?: string | null;
  img_minio_object_name?: string | null;
  // Campos de compatibilidad hacia atrás
  nombre?: string;
  url_dashboard?: string;
  descripcion?: string | null;
  url_img?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface DashboardCreateRequest {
  dashboard_id?: string;
  name: string;
  url: string;
  description?: string | null;
  img_minio_object_name?: string | null;
  file?: File | null;
  // Campos de compatibilidad
  nombre?: string;
  descripcion?: string | null;
  url_img?: string | null;
}

export interface DashboardUpdateRequest {
  dashboard_id?: string;
  name: string;
  url: string;
  description?: string | null;
  img_minio_object_name?: string | null;
  file?: File | null;
  // Campos de compatibilidad
  nombre?: string;
  descripcion?: string | null;
  url_img?: string | null;
}

export class DashboardMapper {
  static toDomain(dto: DashboardResponse | any): DashboardItem {
    const id = dto.dashboard_id || dto.id || '';
    const name = dto.name || dto.nombre || 'Sin título';
    const description = dto.description ?? dto.descripcion ?? '';
    const imgObjectName = dto.img_minio_object_name ?? dto.url_img ?? null;

    return {
      id,
      nombre: name,
      name,
      url: dto.url || dto.url_dashboard || '',
      descripcion: description,
      description,
      img_minio_object_name: imgObjectName,
      url_img: imgObjectName,
      createdAt: dto.created_at || dto.createdAt,
      updatedAt: dto.updated_at || dto.updatedAt
    };
  }

  static toCreateDto(domain: {
    nombre?: string;
    name?: string;
    url: string;
    descripcion?: string | null;
    description?: string | null;
    img_minio_object_name?: string | null;
    url_img?: string | null;
    id?: string;
    dashboard_id?: string;
    file?: File | null;
  }): DashboardCreateRequest {
    const name = (domain.name || domain.nombre || '').trim();
    const desc = domain.description !== undefined
      ? (domain.description?.trim() || '')
      : (domain.descripcion !== undefined ? (domain.descripcion?.trim() || '') : '');
    const imgObjectName = domain.img_minio_object_name !== undefined
      ? domain.img_minio_object_name
      : (domain.url_img || null);

    const generatedId = domain.dashboard_id || domain.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : undefined);

    return {
      ...(generatedId ? { dashboard_id: generatedId } : {}),
      name,
      nombre: name,
      url: domain.url.trim(),
      description: desc,
      descripcion: desc,
      img_minio_object_name: imgObjectName,
      url_img: imgObjectName,
      file: domain.file || null
    };
  }

  static toUpdateDto(domain: {
    nombre?: string;
    name?: string;
    url: string;
    descripcion?: string | null;
    description?: string | null;
    img_minio_object_name?: string | null;
    url_img?: string | null;
    id?: string;
    dashboard_id?: string;
    file?: File | null;
  }): DashboardUpdateRequest {
    const name = (domain.name || domain.nombre || '').trim();
    const desc = domain.description !== undefined
      ? (domain.description?.trim() || '')
      : (domain.descripcion !== undefined ? (domain.descripcion?.trim() || '') : '');
    const imgObjectName = domain.img_minio_object_name !== undefined
      ? domain.img_minio_object_name
      : (domain.url_img || null);

    const id = domain.dashboard_id || domain.id;

    return {
      ...(id ? { dashboard_id: id } : {}),
      name,
      nombre: name,
      url: domain.url.trim(),
      description: desc,
      descripcion: desc,
      img_minio_object_name: imgObjectName,
      url_img: imgObjectName,
      file: domain.file || null
    };
  }

  static toPatchDto(partial: Partial<{
    nombre: string;
    name: string;
    url: string;
    descripcion?: string | null;
    description?: string | null;
    img_minio_object_name?: string | null;
    url_img?: string | null;
    id?: string;
    dashboard_id?: string;
    file?: File | null;
  }>): Partial<DashboardCreateRequest> {
    const result: any = {};

    if (partial.dashboard_id !== undefined || partial.id !== undefined) {
      result.dashboard_id = partial.dashboard_id || partial.id;
    }

    if (partial.name !== undefined || partial.nombre !== undefined) {
      const name = (partial.name || partial.nombre || '').trim();
      result.name = name;
      result.nombre = name;
    }

    if (partial.url !== undefined) {
      result.url = partial.url.trim();
    }

    if (partial.description !== undefined || partial.descripcion !== undefined) {
      const desc = partial.description !== undefined
        ? (partial.description?.trim() || '')
        : (partial.descripcion?.trim() || '');
      result.description = desc;
      result.descripcion = desc;
    }

    if (partial.img_minio_object_name !== undefined || partial.url_img !== undefined) {
      const img = partial.img_minio_object_name !== undefined ? partial.img_minio_object_name : partial.url_img;
      result.img_minio_object_name = img;
      result.url_img = img;
    }

    if (partial.file !== undefined) {
      result.file = partial.file;
    }

    return result;
  }

  /**
   * Genera el objeto FormData requerido por el backend FastAPI (multipart/form-data)
   * para POST /frontend/dashboards/ y PUT /frontend/dashboards/{id}
   */
  static toFormData(data: DashboardCreateRequest | DashboardUpdateRequest | {
    name?: string;
    nombre?: string;
    url?: string;
    description?: string | null;
    descripcion?: string | null;
    file?: File | null;
  }): FormData {
    const formData = new FormData();
    const name = (data.name || data.nombre || '').trim();
    const url = (data.url || '').trim();
    const description = (data.description !== undefined && data.description !== null)
      ? data.description.trim()
      : ((data.descripcion !== undefined && data.descripcion !== null) ? data.descripcion.trim() : '');

    if (name) {
      formData.append('name', name);
    }
    if (url) {
      formData.append('url', url);
    }
    // FastAPI exige 'description' como string obligatorio
    formData.append('description', description);

    if (data.file instanceof File) {
      formData.append('file', data.file);
    }

    return formData;
  }

  /**
   * Genera el objeto FormData para actualización parcial PATCH /frontend/dashboards/{id}
   */
  static toPatchFormData(partial: Partial<DashboardCreateRequest> & { file?: File | null }): FormData {
    const formData = new FormData();
    if (partial.name !== undefined || partial.nombre !== undefined) {
      const name = (partial.name || partial.nombre || '').trim();
      formData.append('name', name);
    }
    if (partial.url !== undefined) {
      formData.append('url', partial.url.trim());
    }
    if (partial.description !== undefined || partial.descripcion !== undefined) {
      const desc = partial.description !== undefined
        ? (partial.description?.trim() || '')
        : (partial.descripcion?.trim() || '');
      formData.append('description', desc);
    }
    if (partial.file instanceof File) {
      formData.append('file', partial.file);
    }
    return formData;
  }
}
