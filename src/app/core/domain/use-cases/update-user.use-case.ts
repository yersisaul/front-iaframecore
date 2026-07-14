import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { User } from '../entities/user.entity';
import { IUserRepository } from '../repositories/user.repository';

@Injectable({
  providedIn: 'root'
})
export class UpdateUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  execute(id: string, user: Partial<User>): Observable<User> {
    return this.userRepository.update(id, user);
  }
}
