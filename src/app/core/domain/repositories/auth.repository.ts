import { Observable } from 'rxjs';
import { User } from '../entities/user.entity';

export interface AuthResult {
  user: User;
  accessToken: string;
}

export abstract class IAuthRepository {
  abstract login(email: string, password: string): Observable<AuthResult>;
}
