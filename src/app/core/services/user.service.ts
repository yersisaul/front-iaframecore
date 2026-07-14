import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { User } from '../domain/entities/user.entity';
import { GetUsersUseCase } from '../domain/use-cases/get-users.use-case';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private getUsersUseCase = inject(GetUsersUseCase);

  readonly users = signal<User[]>([]);
  readonly isLoading = signal(false);
  readonly isViewActive = signal<boolean>(false);

  readonly newRecordIds = signal<Set<string>>(new Set());
  readonly updatedRecordIds = signal<Set<string>>(new Set());
  readonly deletingRecordIds = signal<Set<string>>(new Set());

  markAsNew(id: string): void {
    this.newRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 2000);
  }

  markAsUpdated(id: string): void {
    this.updatedRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.updatedRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 2000);
  }

  markAsDeleting(id: string): void {
    this.deletingRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.deletingRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  loadUsers(): Observable<User[]> {
    this.isLoading.set(true);
    return this.getUsersUseCase.execute().pipe(
      tap(users => {
        this.users.set(users);
        this.isLoading.set(false);
      })
    );
  }

  addUserLocal(user: User): void {
    this.users.update(list => {
      if (list.some(u => u.id === user.id)) return list;
      return [user, ...list];
    });
  }

  updateUserLocal(id: string, updatedFields: Partial<User>): void {
    this.users.update(list =>
      list.map(u => u.id === id ? { ...u, ...updatedFields } : u)
    );
  }

  deleteUserLocal(id: string): void {
    this.users.update(list => list.filter(u => u.id !== id));
  }
}
