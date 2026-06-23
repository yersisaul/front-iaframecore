export interface MetaFilterState {
  tipoObjeto: string[];     // Multi-select OR
  edad: string | null;      // Single-select
  genero: string | null;    // Single-select
  reconocimiento: string | null; // Single-select
  colores: string[];        // Multi-select OR (nested)
  posturas: string[];       // Multi-select OR (nested)
  camaras: string[];        // Multi-select OR
  confiabilidadMin: number; // Range min
  confiabilidadMax: number; // Range max
  timestampDesde: Date | null;
  timestampHasta: Date | null;
  search: string;           // Unified text search input
  imageEmbedding?: number[] | null;
  imageSearchUrl?: string | null;
  imageFile?: File | null;
  coincidenciaFiltro?: 'all' | 'coincidencia' | 'sin_coincidencia' | null;
}

export interface MetaFilterOptions {
  tipoObjeto: string[];
  edades: string[];
  generos: string[];
  colores: string[];
  posturas: string[];
  camaras: string[];
  reconocimientos: string[];
  confiabilidadStats: { min: number; max: number; };
}

export function defaultFilterState(): MetaFilterState {
  return {
    tipoObjeto: [],
    edad: null,
    genero: null,
    reconocimiento: null,
    colores: [],
    posturas: [],
    camaras: [],
    confiabilidadMin: 0,
    confiabilidadMax: 1,
    timestampDesde: null,
    timestampHasta: null,
    search: '',
    imageEmbedding: null,
    imageSearchUrl: null,
    imageFile: null,
    coincidenciaFiltro: 'all'
  };
}

export function defaultFilterOptions(): MetaFilterOptions {
  return {
    tipoObjeto: [],
    edades: [],
    generos: [],
    colores: [],
    posturas: [],
    camaras: [],
    reconocimientos: [],
    confiabilidadStats: { min: 0, max: 1 }
  };
}
