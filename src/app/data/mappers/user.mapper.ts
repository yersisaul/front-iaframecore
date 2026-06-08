import { User } from '../../core/domain/entities/user.entity';
import { UserDTO } from '../repositories/dtos/user-dto';

export class UserMapper {
  static toDomain(dto: UserDTO): User {
    return {
      id: dto.user_id,
      username: dto.usuario,
      name: dto.nombre,
      role: dto.rol,
      createdAt: new Date(dto.created_at),
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
