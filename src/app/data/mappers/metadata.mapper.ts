import {
  MetaIndexName,
  MetaRecord,
  MetaPersona,
  MetaVehiculo,
  MetaRostro,
  MetaOtro,
  MetaColor,
  MetaPostura
} from '../../core/domain/entities/metadata.models';
import { parseUtcDate } from '../../core/utils/date-utils';
import {
  OsHit,
  OsPersonaDto,
  OsVehiculoDto,
  OsRostroDto,
  OsOtroDto,
  OsColorDto,
  OsPosturaDto
} from '../repositories/dtos/opensearch-response.dto';

export class MetadataMapper {
  static sanitizeImageUrl(url?: string): string {
    if (!url) return '';
    return url.trim();
  }

  static toDomainColor(dto: OsColorDto): MetaColor {
    return {
      colorText: dto.color_text || '',
      r: typeof dto.r === 'number' ? dto.r : 0,
      g: typeof dto.g === 'number' ? dto.g : 0,
      b: typeof dto.b === 'number' ? dto.b : 0,
      porcentaje: typeof dto.porcentaje === 'number' ? dto.porcentaje : 0
    };
  }

  static toDomainPostura(dto: OsPosturaDto): MetaPostura {
    return {
      postura: dto.postura || '',
      conteo: typeof dto.conteo === 'number' ? dto.conteo : 0
    };
  }

  private static parseLocation(src: any): { lat: number; lon: number } | undefined {
    if (!src) return undefined;
    if (src.location) {
      if (typeof src.location === 'string') {
        const parts = src.location.split(',');
        if (parts.length === 2) {
          const lat = parseFloat(parts[0].trim());
          const lon = parseFloat(parts[1].trim());
          if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
        }
      } else if (Array.isArray(src.location) && src.location.length >= 2) {
        const lon = Number(src.location[0]);
        const lat = Number(src.location[1]);
        if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
      } else if (typeof src.location === 'object') {
        const lat = parseFloat(src.location.lat ?? src.location.latitude);
        const lon = parseFloat(src.location.lon ?? src.location.lng ?? src.location.longitude);
        if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
      }
    }
    if (src.lat !== undefined && src.lon !== undefined) {
      const lat = parseFloat(src.lat);
      const lon = parseFloat(src.lon);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }
    if (src.latitude !== undefined && src.longitude !== undefined) {
      const lat = parseFloat(src.latitude);
      const lon = parseFloat(src.longitude);
      if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    }
    return undefined;
  }

  static toDomainPersona(hit: OsHit<OsPersonaDto>): MetaPersona {
    const src = hit._source;
    const score = (hit._score !== undefined && hit._score !== null && hit._score !== 1.0)
      ? hit._score
      : (typeof src.confiabilidad === 'number' ? src.confiabilidad : 0);
    const imgMinioObjectName = src.img_minio_object_name || '';
    return {
      id: hit._id,
      camara: src.camara || '',
      camara_id: src.camara_id,
      timestamp: parseUtcDate(src.timestamp),
      confiabilidad: score,
      imgMinioObjectName,
      urlImg: imgMinioObjectName,
      tipoObjeto: src.tipo_objeto || '',
      edad: src.edad || '',
      genero: src.genero || '',
      colores: Array.isArray(src.colores) ? src.colores.map(MetadataMapper.toDomainColor) : [],
      posturas: Array.isArray(src.posturas) ? src.posturas.map(MetadataMapper.toDomainPostura) : [],
      embedding: src.embedding,
      location: MetadataMapper.parseLocation(src)
    };
  }

  static toDomainVehiculo(hit: OsHit<OsVehiculoDto>): MetaVehiculo {
    const src = hit._source;
    const score = (hit._score !== undefined && hit._score !== null && hit._score !== 1.0)
      ? hit._score
      : (typeof src.confiabilidad === 'number' ? src.confiabilidad : 0);
    const imgMinioObjectName = src.img_minio_object_name || '';
    return {
      id: hit._id,
      camara: src.camara || '',
      camara_id: src.camara_id,
      timestamp: parseUtcDate(src.timestamp),
      confiabilidad: score,
      imgMinioObjectName,
      urlImg: imgMinioObjectName,
      tipoObjeto: src.tipo_objeto || '',
      colores: Array.isArray(src.colores) ? src.colores.map(MetadataMapper.toDomainColor) : [],
      reconocimiento: src.reconocimiento || '',
      embedding: src.embedding,
      location: MetadataMapper.parseLocation(src)
    };
  }

  static toDomainRostro(hit: OsHit<OsRostroDto>): MetaRostro {
    const src = hit._source;
    const score = (hit._score !== undefined && hit._score !== null && hit._score !== 1.0)
      ? hit._score
      : (typeof src.confiabilidad === 'number' ? src.confiabilidad : 0);
    const imgMinioObjectName = src.img_minio_object_name || '';
    return {
      id: hit._id,
      camara: src.camara || '',
      camara_id: src.camara_id,
      timestamp: parseUtcDate(src.timestamp),
      confiabilidad: score,
      imgMinioObjectName,
      urlImg: imgMinioObjectName,
      edad: src.edad || '',
      genero: src.genero || '',
      colores: Array.isArray(src.colores) ? src.colores.map(MetadataMapper.toDomainColor) : [],
      reconocimiento: src.reconocimiento || '',
      embedding: src.embedding,
      location: MetadataMapper.parseLocation(src)
    };
  }

  static toDomainOtro(hit: OsHit<OsOtroDto>): MetaOtro {
    const src = hit._source;
    const score = (hit._score !== undefined && hit._score !== null && hit._score !== 1.0)
      ? hit._score
      : (typeof src.confiabilidad === 'number' ? src.confiabilidad : 0);
    const imgMinioObjectName = src.img_minio_object_name || '';
    return {
      id: hit._id,
      camara: src.camara || '',
      camara_id: src.camara_id,
      timestamp: parseUtcDate(src.timestamp),
      confiabilidad: score,
      imgMinioObjectName,
      urlImg: imgMinioObjectName,
      tipoObjeto: src.tipo_objeto || '',
      colores: Array.isArray(src.colores) ? src.colores.map(MetadataMapper.toDomainColor) : [],
      embedding: src.embedding,
      location: MetadataMapper.parseLocation(src)
    };
  }

  static toDomain(index: MetaIndexName, hit: OsHit<any>): MetaRecord {
    switch (index) {
      case 'personas':
        return MetadataMapper.toDomainPersona(hit);
      case 'vehiculos':
        return MetadataMapper.toDomainVehiculo(hit);
      case 'rostros':
        return MetadataMapper.toDomainRostro(hit);
      case 'otros':
        return MetadataMapper.toDomainOtro(hit);
      default:
        throw new Error(`Unknown index: ${index}`);
    }
  }
}
