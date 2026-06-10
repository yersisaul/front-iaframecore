import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';

@Component({
  selector: 'app-session-control',
  imports: [],
  templateUrl: './session-control.html',
  styleUrl: './session-control.css'
})
export class SessionControl {
  private authService = inject(AuthService);
  private themeService = inject(ThemeService);
  private router = inject(Router);

  readonly currentUser = this.authService.currentUser;
  readonly isDarkMode = this.themeService.darkMode;
  
  // Propiedad responsiva para colapso del sidebar
  readonly isCollapsed = input<boolean>(false);

  onLogout(): void {
    this.authService.logout().subscribe({
      next: () => {
        this.router.navigate(['/login']);
      },
      error: () => {
        this.router.navigate(['/login']);
      }
    });
  }

  toggleTheme(): void {
    this.themeService.toggleTheme();
  }
}
