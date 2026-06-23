import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { User } from '../entities/user.entity';
import { IUserRepository } from '../repositories/user.repository';

@Injectable({
  providedIn: 'root'
})
export class GetUsersUseCase {
  constructor(private userRepository: IUserRepository) {}

  execute(): Observable<User[]> {
    return this.userRepository.getAll();
  }
}
