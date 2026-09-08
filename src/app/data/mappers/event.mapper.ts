import { EventRecord, EventMatchDetail } from '../../core/domain/entities/event.models';
import { parseUtcDate } from '../../core/utils/date-utils';
import { MetadataMapper } from './metadata.mapper';

export class EventMapper {
  static toDomain(hit: any): EventRecord {
    const src = hit._source || {};
    
    let lat: number | null = null;
    let lon: number | null = null;
    
    if (src.location) {
      lat = typeof src.location.lat === 'string' ? parseFloat(src.location.lat) : src.location.lat;
      lon = typeof src.location.lon === 'string' ? parseFloat(src.location.lon) : src.location.lon;
    }
    
    const analitica = src.analitica || '';
    const lowerAnalitica = analitica.toLowerCase();
    const isMatch = lowerAnalitica.includes('facial') ||
                    lowerAnalitica.includes('rostro') ||
                    lowerAnalitica.includes('face') ||
                    lowerAnalitica.includes('placa') ||
                    lowerAnalitica.includes('plate') ||
                    lowerAnalitica.includes('lpr');

    // Mapeo formal de match_detail según OpenSearch mapping
    let matchDetail: EventMatchDetail | null = null;
    if (src.match_detail) {
      const md = src.match_detail;
      matchDetail = {
        detailId: md.detail_id || '',
        confianza: typeof md.confianza === 'number' ? md.confianza : 0,
        listName: md.list_name || '',
        listId: md.list_id || ''
      };
    } else {
      // Fallback retrocompatible: si no hay match_detail pero el detalle de evento indica grupo
      const detalle = src.detalle_evento || '';
      const groupMatch = detalle.match(/pertenece al grupo\s+([^,]+)/i);
      const extractedGroup = groupMatch && groupMatch[1] ? groupMatch[1].trim() : (src.grupo_lista || src.lista_nombre || null);
      if (extractedGroup) {
        matchDetail = {
          detailId: '',
          confianza: typeof src.confiabilidad === 'number' ? src.confiabilidad : 0,
          listName: extractedGroup,
          listId: ''
        };
      }
    }

    let porcentajeSimilitud: number | null = null;
    let confiabilidad: number | null = null;

    if (matchDetail && typeof matchDetail.confianza === 'number' && matchDetail.confianza > 0) {
      confiabilidad = matchDetail.confianza;
      porcentajeSimilitud = Math.round(matchDetail.confianza <= 1 ? matchDetail.confianza * 100 : matchDetail.confianza);
    } else {
      if (typeof src.porcentaje_similitud === 'number') {
        porcentajeSimilitud = src.porcentaje_similitud;
      }
      if (typeof src.confiabilidad === 'number') {
        confiabilidad = src.confiabilidad;
      } else if (typeof hit._score === 'number' && hit._score > 0 && hit._score <= 1) {
        confiabilidad = hit._score;
      }

      if (isMatch && porcentajeSimilitud === null && confiabilidad !== null) {
        porcentajeSimilitud = Math.round(confiabilidad > 1 ? confiabilidad : confiabilidad * 100);
      }
    }

    const extractCanonicalEventId = (source: any, fallback: string): string => {
      if (source.event_id && typeof source.event_id === 'string' && source.event_id.trim()) {
        return source.event_id.trim();
      }
      const url = source.url_img || source.url_video;
      if (url && typeof url === 'string') {
        const filename = url.split('/').pop()?.split('?')[0] || '';
        const lastDot = filename.lastIndexOf('.');
        const clean = lastDot > 0 ? filename.substring(0, lastDot) : filename;
        if (clean) return clean;
      }
      return fallback;
    };
    const resolvedId = extractCanonicalEventId(src, hit._id);
    const detalle = src.detalle_evento || '';

    // Extracción de sujeto (Persona o Placa vehicular)
    let sujeto: string | null = null;
    const placaMatch = detalle.match(/placa\s+([A-Z0-9]+)/i);
    if (placaMatch && placaMatch[1]) {
      sujeto = placaMatch[1].trim();
    } else {
      const nameMatch = detalle.match(/se ha identificado a\s+([^,]+?)(?:\s+que pertenece|\s+en|\s*$)/i);
      if (nameMatch && nameMatch[1]) {
        sujeto = nameMatch[1].trim();
      } else if (isMatch && src.objeto && !['persona', 'auto', 'moto', 'rostro', 'con_casco'].includes(src.objeto.toLowerCase())) {
        sujeto = src.objeto.trim();
      } else if (src.match_detail?.subject_name) {
        sujeto = src.match_detail.subject_name;
      }
    }

    let objeto = src.objeto || '';
    // Si es reconocimiento facial y objeto vino como nombre de persona (ej: "Dolores Gutierrez Valeriano"),
    // se normaliza a la clase formal 'Persona'
    if (isMatch && objeto && !['persona', 'rostro', 'placa', 'face', 'plate', 'car', 'auto'].includes(objeto.toLowerCase())) {
      objeto = lowerAnalitica.includes('facial') || lowerAnalitica.includes('rostro') ? 'Persona' : 'Placa';
    }

    if (matchDetail && sujeto && !matchDetail.subjectName) {
      matchDetail.subjectName = sujeto;
    }

    return {
      id: resolvedId,
      eventId: src.event_id || resolvedId,
      timestamp: parseUtcDate(src.timestamp),
      hora: typeof src.hora === 'number' ? src.hora : 0,
      diaSemana: src.dia_semana || '',
      diaMes: typeof src.dia_mes === 'number' ? src.dia_mes : 0,
      mes: src.mes || '',
      nombreCamara: src.nombre_camara || '',
      idCamara: src.id_camara || '',
      analitica,
      location: lat !== null && lon !== null ? { lat, lon } : null,
      objeto,
      sujeto,
      detalleEvento: src.detalle_evento || '',
      urlImg: MetadataMapper.sanitizeImageUrl(src.url_img),
      urlVideo: src.url_video ? MetadataMapper.sanitizeImageUrl(src.url_video) : null,
      conteoAforo: typeof src.conteo_aforo === 'number' ? src.conteo_aforo : null,
      tiempoPermanencia: typeof src.tiempo_permanencia === 'number' ? src.tiempo_permanencia : null,
      objetosEnArea: typeof src.objetos_en_area === 'number' ? src.objetos_en_area : null,
      espaciosLibres: typeof src.espacios_libres === 'number' ? src.espacios_libres : null,
      direccion: src.direccion || null,
      idReportType: src.id_report_type || null,
      matchDetail,
      urlImgMatch: src.url_img_match || src.url_img_referencia ? MetadataMapper.sanitizeImageUrl(src.url_img_match || src.url_img_referencia) : null,
      porcentajeSimilitud,
      grupoLista: matchDetail?.listName || src.grupo_lista || src.lista_nombre || null,
      confiabilidad
    };
  }
}
