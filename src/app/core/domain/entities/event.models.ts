export interface EventMatchDetail {
  detailId: string;
  confianza: number;
  listName: string;
  listId: string;
  subjectName?: string;
}

export interface EventSubjectItem {
  name: string;
  listName?: string;
  detailId?: string;
}

export interface EventRecord {
  id: string;
  eventId?: string;
  timestamp: Date;
  timestampMs?: number;
  hora: number;
  diaSemana: string;
  diaMes: number;
  mes: string;
  nombreCamara: string;
  idCamara: string;
  analitica: string;
  location: { lat: number; lon: number } | null;
  objeto: string;
  sujeto?: string | null;
  detalleEvento: string;
  urlImg: string;
  urlVideo?: string | null;
  conteoAforo: number | null;
  tiempoPermanencia: number | null;
  objetosEnArea: number | null;
  espaciosLibres: number | null;
  direccion: string | null;
  idReportType: string | null;
  matchDetail?: EventMatchDetail | null;
  urlImgMatch?: string | null;
  porcentajeSimilitud?: number | null;
  grupoLista?: string | null;
  confiabilidad?: number | null;
}

export interface EventFilters {
  search: string;
  camaras: string[];
  analiticas: string[];
  objetos: string[];
  listas?: string[];
  sujetos?: string[];
  direcciones?: string[];
  timestampDesde: Date | null;
  timestampHasta: Date | null;
}

export interface EventFilterOptions {
  camaras: string[];
  analiticas: string[];
  objetos: string[];
  listas?: string[];
  sujetos?: string[];
  direcciones?: string[];
}

export function defaultEventFilters(): EventFilters {
  return {
    search: '',
    camaras: [],
    analiticas: [],
    objetos: [],
    listas: [],
    sujetos: [],
    direcciones: [],
    timestampDesde: null,
    timestampHasta: null
  };
}

export function defaultEventFilterOptions(): EventFilterOptions {
  return {
    camaras: [],
    analiticas: [],
    objetos: [],
    listas: [],
    sujetos: [],
    direcciones: []
  };
}
