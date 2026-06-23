import { Observable } from 'rxjs';
import { User } from '../entities/user.entity';

export interface AuthResult {
  user: User;
  accessToken: string;
}

export abstract class IAuthRepository {
  abstract login(username: string, contrasena: string): Observable<AuthResult>;
}
