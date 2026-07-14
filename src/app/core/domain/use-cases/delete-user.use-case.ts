import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { IUserRepository } from '../repositories/user.repository';

@Injectable({
  providedIn: 'root'
})
export class DeleteUserUseCase {
  constructor(private userRepository: IUserRepository) {}

  execute(id: string): Observable<void> {
    return this.userRepository.delete(id);
  }
}
