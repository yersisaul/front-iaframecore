import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
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
      map(dtos => (dtos || []).map(UserMapper.toDomain)),
      catchError(err => {
        if (!AppEnvironment.production) {
          console.warn('Backend /users endpoint not found. Using fallback mock users.', err);
          return of([
            {
              id: 'e4b10fa0-7988-466d-a111-c917b2b73bc5',
              username: 'admin',
              name: 'Administrador del Sistema',
              role: 'administrador',
              createdAt: new Date('2026-01-01T08:00:00Z')
            },
            {
              id: '67a7a5cc-98a9-4672-9cc9-5b7d0a68d712',
              username: 'operador',
              name: 'Operador de Control',
              role: 'operador',
              createdAt: new Date('2026-02-15T12:30:00Z')
            }
          ]);
        }
        console.error('Error fetching users from API in production:', err);
        throw err;
      })
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
