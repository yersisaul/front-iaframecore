export interface EventRecord {
  id: string;
  timestamp: Date;
  hora: number;
  diaSemana: string;
  diaMes: number;
  mes: string;
  nombreCamara: string;
  idCamara: string;
  analitica: string;
  location: { lat: number; lon: number } | null;
  objeto: string;
  detalleEvento: string;
  urlImg: string;
  conteoAforo: number | null;
  tiempoPermanencia: number | null;
  objetosEnArea: number | null;
  espaciosLibres: number | null;
  direccion: string | null;
  idReportType: string | null;
}

export interface EventFilters {
  search: string;
  camaras: string[];
  analiticas: string[];
  objetos: string[];
  timestampDesde: Date | null;
  timestampHasta: Date | null;
}

export interface EventFilterOptions {
  camaras: string[];
  analiticas: string[];
  objetos: string[];
}

export function defaultEventFilters(): EventFilters {
  return {
    search: '',
    camaras: [],
    analiticas: [],
    objetos: [],
    timestampDesde: null,
    timestampHasta: null
  };
}

export function defaultEventFilterOptions(): EventFilterOptions {
  return {
    camaras: [],
    analiticas: [],
    objetos: []
  };
}
