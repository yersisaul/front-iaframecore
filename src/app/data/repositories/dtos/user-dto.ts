export interface UserDTO {
  user_id: string;
  email: string;
  nombres: string;
  apellidos: string;
  rol_id: string;   // UUID del rol — el backend retorna rol_id, no el nombre del rol
  password?: string;
  created_at: string;
}
