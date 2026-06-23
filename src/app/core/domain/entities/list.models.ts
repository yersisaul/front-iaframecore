export interface List {
  list_id: string;
  name: string;
  description: string;
  list_type: 'face_recognition' | string;
}

export interface ListDetail {
  detail_id: string;
  list_id: string;
  fingerprint_host?: string;
  nombre_asociado: string;
  embedding: number[];
  metadata?: {
    url_img?: string;
    text_placa?: string;
    [key: string]: any;
  };
}
