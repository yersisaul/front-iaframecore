import { EventRecord } from '../../core/domain/entities/event.models';
import { parseUtcDate } from '../../core/utils/date-utils';
import { MetadataMapper } from './metadata.mapper';

export class EventMapper {
  static toDomain(hit: any): EventRecord {
    const src = hit._source;
    
    let lat: number | null = null;
    let lon: number | null = null;
    
    if (src.location) {
      lat = typeof src.location.lat === 'string' ? parseFloat(src.location.lat) : src.location.lat;
      lon = typeof src.location.lon === 'string' ? parseFloat(src.location.lon) : src.location.lon;
    }
    
    return {
      id: hit._id,
      timestamp: parseUtcDate(src.timestamp),
      hora: typeof src.hora === 'number' ? src.hora : 0,
      diaSemana: src.dia_semana || '',
      diaMes: typeof src.dia_mes === 'number' ? src.dia_mes : 0,
      mes: src.mes || '',
      nombreCamara: src.nombre_camara || '',
      idCamara: src.id_camara || '',
      analitica: src.analitica || '',
      location: lat !== null && lon !== null ? { lat, lon } : null,
      objeto: src.objeto || '',
      detalleEvento: src.detalle_evento || '',
      urlImg: MetadataMapper.sanitizeImageUrl(src.url_img),
      conteoAforo: typeof src.conteo_aforo === 'number' ? src.conteo_aforo : null,
      tiempoPermanencia: typeof src.tiempo_permanencia === 'number' ? src.tiempo_permanencia : null,
      objetosEnArea: typeof src.objetos_en_area === 'number' ? src.objetos_en_area : null,
      espaciosLibres: typeof src.espacios_libres === 'number' ? src.espacios_libres : null,
      direccion: src.direccion || null,
      idReportType: src.id_report_type || null
    };
  }
}
