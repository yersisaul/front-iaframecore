import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { IUserRepository } from '../../core/domain/repositories/user.repository';
import { User } from '../../core/domain/entities/user.entity';
import { UserDTO } from './dtos/user-dto';
import { UserMapper } from '../mappers/user.mapper';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class UserHttpRepository implements IUserRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/users`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<User[]> {
    return this.http.get<UserDTO[]>(this.apiUrl).pipe(
      map(dtos => dtos.map(UserMapper.toDomain))
    );
  }

  getById(id: string): Observable<User> {
    return this.http.get<UserDTO>(`${this.apiUrl}/${id}`).pipe(
      map(UserMapper.toDomain)
    );
  }

  create(user: Omit<User, 'id'>): Observable<User> {
    const userToCreate: User = { id: '', ...user };
    const dto = UserMapper.toDTO(userToCreate);
    return this.http.post<UserDTO>(this.apiUrl, dto).pipe(
      map(UserMapper.toDomain)
    );
  }

  update(id: string, user: Partial<User>): Observable<User> {
    const dto = UserMapper.toPartialDTO(user);
    return this.http.patch<UserDTO>(`${this.apiUrl}/${id}`, dto).pipe(
      map(UserMapper.toDomain)
    );
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
