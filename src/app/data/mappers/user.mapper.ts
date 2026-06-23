import { User } from '../../core/domain/entities/user.entity';
import { UserDTO } from '../repositories/dtos/user-dto';
import { AuthResponseDTO } from '../repositories/dtos/auth-response.dto';
import { AppRole } from '../../core/domain/entities/role.enum';
import { parseUtcDate } from '../../core/utils/date-utils';

export class UserMapper {
  static fromAuthResponse(dto: AuthResponseDTO): User {
    const roleStr = dto.rol?.toLowerCase();
    const mappedRole = (roleStr === 'admin' || roleStr === 'administrador')
      ? AppRole.ADMIN
      : AppRole.OPERATOR;

    return {
      id: dto.usuario,
      username: dto.usuario,
      name: dto.usuario,
      role: mappedRole,
      createdAt: new Date()
    };
  }

  static toDomain(dto: UserDTO): User {
    return {
      id: dto.user_id,
      username: dto.usuario,
      name: dto.nombre,
      role: dto.rol,
      createdAt: parseUtcDate(dto.created_at),
    };
  }

  static toDTO(user: User): UserDTO {
    return {
      user_id: user.id,
      usuario: user.username,
      nombre: user.name,
      rol: user.role,
      created_at: user.createdAt.toISOString(),
    };
  }

  static toPartialDTO(user: Partial<User>): Partial<UserDTO> {
    const dto: Partial<UserDTO> = {};
    if (user.id !== undefined) dto.user_id = user.id;
    if (user.username !== undefined) dto.usuario = user.username;
    if (user.name !== undefined) dto.nombre = user.name;
    if (user.role !== undefined) dto.rol = user.role;
    if (user.createdAt !== undefined) dto.created_at = user.createdAt.toISOString();
    return dto;
  }
}
