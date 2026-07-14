import { User } from '../../core/domain/entities/user.entity';
import { UserDTO } from '../repositories/dtos/user-dto';
import { AuthResponseDTO } from '../repositories/dtos/auth-response.dto';
import { parseUtcDate } from '../../core/utils/date-utils';

export class UserMapper {
  static fromAuthResponse(dto: AuthResponseDTO): User {
    const emailVal = dto.usuario || '';
    
    // El role se asignará dinámicamente mediante loadUserPermissions() en PermissionsService.
    // Aquí solo guardamos el roleId para que el servicio pueda resolver el nombre real del rol desde el backend.
    return {
      id: emailVal,
      email: emailVal,
      name: emailVal || 'Usuario',
      firstName: '',
      lastName: '',
      role: '', // Placeholder — será sobreescrito por loadUserPermissions()
      createdAt: new Date(),
      roleId: dto.rol_id
    };
  }

  static toDomain(dto: UserDTO): User {
    const fullName = `${dto.nombres || ''} ${dto.apellidos || ''}`.trim();

    return {
      id: dto.user_id,
      email: dto.email,
      name: fullName || dto.email || 'Usuario',
      firstName: dto.nombres || '',
      lastName: dto.apellidos || '',
      role: '', // El nombre del rol se resuelve dinámicamente desde el backend via roleId
      roleId: dto.rol_id,
      createdAt: parseUtcDate(dto.created_at),
    };
  }

  static toDTO(user: User): UserDTO {
    return {
      user_id: user.id,
      email: user.email,
      nombres: user.firstName || '',
      apellidos: user.lastName || '',
      rol_id: user.roleId || '',
      password: user.password,
      created_at: user.createdAt ? user.createdAt.toISOString() : new Date().toISOString(),
    };
  }

  static toPartialDTO(user: Partial<User>): Partial<UserDTO> {
    const dto: Partial<UserDTO> = {};
    if (user.id !== undefined) dto.user_id = user.id;
    if (user.email !== undefined) dto.email = user.email;
    if (user.firstName !== undefined) dto.nombres = user.firstName;
    if (user.lastName !== undefined) dto.apellidos = user.lastName;
    if (user.roleId !== undefined) dto.rol_id = user.roleId;
    if (user.password !== undefined) dto.password = user.password;
    if (user.createdAt !== undefined) dto.created_at = user.createdAt ? user.createdAt.toISOString() : undefined;
    return dto;
  }
}
