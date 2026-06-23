import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GetUsersUseCase } from '../../../core/domain/use-cases/get-users.use-case';
import { User } from '../../../core/domain/entities/user.entity';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.css',
})
export class Usuarios implements OnInit {
  private getUsersUseCase = inject(GetUsersUseCase);

  readonly users = signal<User[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    this.loadUsers();
  }

  loadUsers(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.getUsersUseCase.execute().subscribe({
      next: (data) => {
        this.users.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading users:', err);
        this.errorMessage.set('No se pudieron cargar los usuarios.');
        this.isLoading.set(false);
      }
    });
  }
}

