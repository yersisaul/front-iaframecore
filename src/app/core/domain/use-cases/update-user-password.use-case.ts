import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { User } from '../entities/user.entity';
import { IUserRepository } from '../repositories/user.repository';

@Injectable({
  providedIn: 'root'
})
export class UpdateUserPasswordUseCase {
  constructor(private userRepository: IUserRepository) {}

  execute(userId: string, oldPassword: string, newPassword: string): Observable<User> {
    return this.userRepository.updatePassword(userId, oldPassword, newPassword);
  }
}
