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
    
    // Si la URL es pública (Unsplash, Picsum, RandomUser, etc.), no la saneamos
    if (
      url.includes('unsplash.com') ||
      url.includes('picsum.photos') ||
      url.includes('randomuser.me')
    ) {
      return url;
    }

    // Reemplaza cualquier esquema y host/puerto (ej. http://backend-api:8000) por /api
    let sanitized = url.replace(/^https?:\/\/[^\/]+/, '/api');
    
    // Si es una ruta relativa de almacenamiento, le antepone /api
    if (!sanitized.startsWith('/api') && !sanitized.startsWith('http')) {
      if (
        sanitized.startsWith('storage') || sanitized.startsWith('/storage') ||
        sanitized.startsWith('static') || sanitized.startsWith('/static') ||
        sanitized.startsWith('media') || sanitized.startsWith('/media')
      ) {
        if (sanitized.startsWith('/')) {
          sanitized = '/api' + sanitized;
        } else {
          sanitized = '/api/' + sanitized;
        }
      }
    }
    return sanitized;
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

  static toDomainPersona(hit: OsHit<OsPersonaDto>): MetaPersona {
    const src = hit._source;
    const score = (hit._score !== undefined && hit._score !== null && hit._score !== 1.0)
      ? hit._score
      : (typeof src.confiabilidad === 'number' ? src.confiabilidad : 0);
    return {
      id: hit._id,
      camara: src.camara || '',
      timestamp: parseUtcDate(src.timestamp),
      confiabilidad: score,
      imagenRemota: MetadataMapper.sanitizeImageUrl(src.ruta_imagen_remota),
      tipoObjeto: src.tipo_objeto || '',
      edad: src.edad || '',
      genero: src.genero || '',
      colores: Array.isArray(src.colores) ? src.colores.map(MetadataMapper.toDomainColor) : [],
      posturas: Array.isArray(src.posturas) ? src.posturas.map(MetadataMapper.toDomainPostura) : [],
      embedding: src.embedding
    };
  }

  static toDomainVehiculo(hit: OsHit<OsVehiculoDto>): MetaVehiculo {
    const src = hit._source;
    const score = (hit._score !== undefined && hit._score !== null && hit._score !== 1.0)
      ? hit._score
      : (typeof src.confiabilidad === 'number' ? src.confiabilidad : 0);
    return {
      id: hit._id,
      camara: src.camara || '',
      timestamp: parseUtcDate(src.timestamp),
      confiabilidad: score,
      imagenRemota: MetadataMapper.sanitizeImageUrl(src.ruta_imagen_remota),
      tipoObjeto: src.tipo_objeto || '',
      colores: Array.isArray(src.colores) ? src.colores.map(MetadataMapper.toDomainColor) : [],
      reconocimiento: src.reconocimiento || '',
      embedding: src.embedding
    };
  }

  static toDomainRostro(hit: OsHit<OsRostroDto>): MetaRostro {
    const src = hit._source;
    const score = (hit._score !== undefined && hit._score !== null && hit._score !== 1.0)
      ? hit._score
      : (typeof src.confiabilidad === 'number' ? src.confiabilidad : 0);
    return {
      id: hit._id,
      camara: src.camara || '',
      timestamp: parseUtcDate(src.timestamp),
      confiabilidad: score,
      imagenRemota: MetadataMapper.sanitizeImageUrl(src.ruta_imagen_remota),
      edad: src.edad || '',
      genero: src.genero || '',
      colores: Array.isArray(src.colores) ? src.colores.map(MetadataMapper.toDomainColor) : [],
      reconocimiento: src.reconocimiento || '',
      embedding: src.embedding
    };
  }

  static toDomainOtro(hit: OsHit<OsOtroDto>): MetaOtro {
    const src = hit._source;
    const score = (hit._score !== undefined && hit._score !== null && hit._score !== 1.0)
      ? hit._score
      : (typeof src.confiabilidad === 'number' ? src.confiabilidad : 0);
    return {
      id: hit._id,
      camara: src.camara || '',
      timestamp: parseUtcDate(src.timestamp),
      confiabilidad: score,
      imagenRemota: MetadataMapper.sanitizeImageUrl(src.ruta_imagen_remota),
      tipoObjeto: src.tipo_objeto || '',
      colores: Array.isArray(src.colores) ? src.colores.map(MetadataMapper.toDomainColor) : [],
      embedding: src.embedding
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
