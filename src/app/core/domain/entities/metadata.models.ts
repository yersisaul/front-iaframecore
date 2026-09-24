export type MetaIndexName = 'personas' | 'vehiculos' | 'rostros' | 'otros';

export interface MetaIndexInfo {
  name: MetaIndexName;
  count: number;
}

export interface MetaColor {
  colorText: string;
  r: number;
  g: number;
  b: number;
  porcentaje: number;
}

export interface MetaPostura {
  postura: string;
  conteo: number;
}

export interface MetaBaseRecord {
  id: string;
  camara: string;
  camara_id?: string;
  timestamp: Date;
  confiabilidad: number;
  imgMinioObjectName?: string;
  videoMinioObjectName?: string;
  urlImg?: string;
  urlVideo?: string;
  embedding?: number[];
}

export interface MetaPersona extends MetaBaseRecord {
  tipoObjeto: string;
  edad: string;
  genero: string;
  colores: MetaColor[];
  posturas: MetaPostura[];
}

export interface MetaVehiculo extends MetaBaseRecord {
  tipoObjeto: string;
  colores: MetaColor[];
  reconocimiento: string;
}

export interface MetaRostro extends MetaBaseRecord {
  edad: string;
  genero: string;
  colores: MetaColor[];
  reconocimiento: string;
}

export interface MetaOtro extends MetaBaseRecord {
  tipoObjeto: string;
  colores: MetaColor[];
}

export type MetaRecord = MetaPersona | MetaVehiculo | MetaRostro | MetaOtro;
