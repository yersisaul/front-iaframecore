import { Observable } from 'rxjs';
import { User } from '../entities/user.entity';

export abstract class IUserRepository {
  abstract getAll(): Observable<User[]>;
  abstract getById(id: string): Observable<User>;
  abstract create(user: Omit<User, 'id'>): Observable<User>;
  abstract update(id: string, user: Partial<User>): Observable<User>;
  abstract delete(id: string): Observable<void>;
}
