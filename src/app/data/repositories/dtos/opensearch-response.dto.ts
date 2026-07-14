export interface OsHit<T> {
  _id: string;
  _score: number;
  _source: T;
}

export interface OsResponseTotal {
  value: number;
  relation: string;
}

export interface OsResponseHits<T> {
  total: OsResponseTotal | number;
  max_score: number | null;
  hits: OsHit<T>[];
}

export interface OsResponse<T> {
  hits: OsResponseHits<T>;
  aggregations?: any;
}

export interface CatIndexResponse {
  health: string;
  status: string;
  index: string;
  uuid: string;
  pri: string;
  rep: string;
  'docs.count': string;
  'docs.deleted': string;
  'store.size': string;
  'pri.store.size': string;
}

// Source DTO definitions
export interface OsColorDto {
  color_text: string;
  r: number;
  g: number;
  b: number;
  porcentaje: number;
}

export interface OsPosturaDto {
  postura: string;
  conteo: number;
}

export interface OsBaseDocDto {
  camara: string;
  camara_id?: string;
  timestamp: string;
  confiabilidad: number;
  ruta_imagen_remota: string;
  embedding?: number[];
}

export interface OsPersonaDto extends OsBaseDocDto {
  tipo_objeto: string;
  edad: string;
  genero: string;
  colores: OsColorDto[];
  posturas: OsPosturaDto[];
}

export interface OsVehiculoDto extends OsBaseDocDto {
  tipo_objeto: string;
  colores: OsColorDto[];
  reconocimiento: string;
}

export interface OsRostroDto extends OsBaseDocDto {
  edad: string;
  genero: string;
  colores: OsColorDto[];
  reconocimiento: string;
}

export interface OsOtroDto extends OsBaseDocDto {
  tipo_objeto: string;
  colores: OsColorDto[];
}

export type OsDocDto = OsPersonaDto | OsVehiculoDto | OsRostroDto | OsOtroDto;
