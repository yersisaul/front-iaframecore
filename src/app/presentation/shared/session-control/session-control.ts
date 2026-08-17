import { Component, inject, input, signal, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { SidebarService } from '../../../core/services/sidebar.service';

@Component({
  selector: 'app-session-control',
  imports: [],
  templateUrl: './session-control.html',
  styleUrl: './session-control.css'
})
export class SessionControl {
  private authService = inject(AuthService);
  private themeService = inject(ThemeService);
  private sidebarService = inject(SidebarService);
  private router = inject(Router);

  readonly currentUser = this.authService.currentUser;
  readonly isDarkMode = this.themeService.darkMode;
  
  // Propiedad responsiva para colapso del sidebar
  readonly isCollapsed = input<boolean>(false);

  // Estado del menú desplegable cuando está colapsado
  readonly showDropdown = signal<boolean>(false);

  onUserControlClick(event: Event): void {
    if (this.isCollapsed()) {
      event.stopPropagation();
      this.sidebarService.toggleSidebar();
      this.showDropdown.set(false);
    }
  }

  toggleDropdown(event: Event): void {
    event.stopPropagation();
    this.showDropdown.update(v => !v);
  }

  toggleSidebar(event: Event): void {
    event.stopPropagation();
    this.sidebarService.toggleSidebar();
    this.showDropdown.set(false);
  }

  @HostListener('document:click')
  closeDropdown(): void {
    this.showDropdown.set(false);
  }

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
