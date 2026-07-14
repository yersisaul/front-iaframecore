import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { IAuthRepository, AuthResult } from '../../core/domain/repositories/auth.repository';
import { AuthResponseDTO } from './dtos/auth-response.dto';
import { UserMapper } from '../mappers/user.mapper';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class AuthHttpRepository implements IAuthRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/auth`;

  constructor(private http: HttpClient) {}

  login(email: string, password: string): Observable<AuthResult> {
    const body = {
      email,
      password
    };

    return this.http.post<AuthResponseDTO>(`${this.apiUrl}/login`, body).pipe(
      map(response => {
        const user = UserMapper.fromAuthResponse(response);
        return {
          user,
          accessToken: response.access_token
        };
      })
    );
  }
}
