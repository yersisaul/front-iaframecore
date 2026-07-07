import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { User } from '../entities/user.entity';
import { IUserRepository } from '../repositories/user.repository';

@Injectable({
  providedIn: 'root'
})
export class CreateUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  execute(user: Omit<User, 'id'>): Observable<User> {
    return this.userRepository.create(user);
  }
}
