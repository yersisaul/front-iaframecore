import { Observable } from 'rxjs';
import { User } from '../entities/user.entity';

export interface IUserRepository {
  getAll(): Observable<User[]>;
  getById(id: string): Observable<User>;
  create(user: Omit<User, 'id'>): Observable<User>;
  update(id: string, user: Partial<User>): Observable<User>;
  delete(id: string): Observable<void>;
}
