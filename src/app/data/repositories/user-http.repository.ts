import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { IUserRepository } from '../../core/domain/repositories/user.repository';
import { User } from '../../core/domain/entities/user.entity';
import { UserDTO } from './dtos/user-dto';
import { UserMapper } from '../mappers/user.mapper';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class UserHttpRepository implements IUserRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/frontend/users`;

  constructor(private http: HttpClient) {}

  getAll(): Observable<User[]> {
    const url = this.apiUrl.endsWith('/') ? this.apiUrl : `${this.apiUrl}/`;
    return this.http.get<UserDTO[]>(url).pipe(
      map(dtos => (dtos || []).map(UserMapper.toDomain))
    );
  }

  getById(id: string): Observable<User> {
    return this.http.get<UserDTO>(`${this.apiUrl}/${id}`).pipe(
      map(UserMapper.toDomain)
    );
  }

  create(user: Omit<User, 'id'>): Observable<User> {
    // POST /frontend/users/ — payload según spec: apellidos, email, nombres, password, rol_id
    const payload = {
      apellidos: user.lastName || '',
      email: user.email,
      nombres: user.firstName || '',
      password: user.password || '',
      rol_id: user.roleId || ''
    };
    const url = this.apiUrl.endsWith('/') ? this.apiUrl : `${this.apiUrl}/`;
    return this.http.post<UserDTO>(url, payload).pipe(
      map(UserMapper.toDomain)
    );
  }

  update(id: string, user: Partial<User>): Observable<User> {
    // PUT /frontend/users/{user_id} — payload según spec: apellidos, email, nombres, rol_id
    const payload = {
      apellidos: user.lastName || '',
      email: user.email || '',
      nombres: user.firstName || '',
      rol_id: user.roleId || ''
    };
    
    return this.http.put<UserDTO>(`${this.apiUrl}/${id}`, payload).pipe(
      map(UserMapper.toDomain)
    );
  }

  updatePassword(userId: string, oldPassword: string, newPassword: string): Observable<User> {
    // PATCH /frontend/users/{user_id} — payload según spec: old_password, new_password
    const payload = {
      old_password: oldPassword,
      new_password: newPassword
    };
    return this.http.patch<UserDTO>(`${this.apiUrl}/${userId}`, payload).pipe(
      map(UserMapper.toDomain)
    );
  }

  delete(id: string): Observable<void> {
    // DELETE /frontend/users/{user_id}
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
