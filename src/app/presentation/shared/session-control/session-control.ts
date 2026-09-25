import { Component, inject, input, computed } from '@angular/core';
import { CommonModule, NgStyle } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ThemeService } from '../../../core/services/theme.service';
import { SidebarService } from '../../../core/services/sidebar.service';

@Component({
  selector: 'app-session-control',
  standalone: true,
  imports: [CommonModule, NgStyle],
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

  readonly displayName = computed(() => {
    const user = this.currentUser();
    if (!user) return 'Usuario';
    if (user.firstName && user.firstName.trim().length > 0) {
      return user.firstName.trim();
    }
    if (user.name) {
      // Si el name contiene '@', extraer solo el usuario antes del dominio
      return user.name.includes('@') ? user.name.split('@')[0] : user.name;
    }
    return 'Usuario';
  });

  readonly displayRole = computed(() => {
    return this.currentUser()?.role || 'Usuario';
  });

  readonly roleStyle = computed<Record<string, string>>(() => {
    const role = this.currentUser()?.role || '';
    const upper = (role || '').toUpperCase().trim();
    if (!upper) {
      return {
        '--role-color': '#64748b',
        '--role-bg': 'rgba(100, 116, 139, 0.12)',
        '--role-border': 'rgba(100, 116, 139, 0.2)'
      };
    }

    let hue = 210;
    let saturation = 65;
    let lightness = 50;

    if (upper === 'ADMIN') {
      hue = 211;
      saturation = 100;
      lightness = 50;
    } else if (upper === 'SUPERVISOR') {
      hue = 258;
      saturation = 90;
      lightness = 66;
    } else if (upper === 'OPERADOR') {
      hue = 158;
      saturation = 82;
      lightness = 47;
    } else {
      // Generación determinista para roles personalizados
      let hash = 0;
      for (let i = 0; i < upper.length; i++) {
        hash = upper.charCodeAt(i) + ((hash << 5) - hash);
      }
      hue = Math.abs(hash) % 360;
    }

    return {
      '--role-color': `hsl(${hue}, ${saturation}%, ${lightness}%)`,
      '--role-bg': `hsla(${hue}, ${saturation}%, ${lightness}%, 0.12)`,
      '--role-border': `hsla(${hue}, ${saturation}%, ${lightness}%, 0.2)`
    };
  });

  // Propiedad responsiva para colapso del sidebar
  readonly isCollapsed = input<boolean>(false);

  onUserControlClick(event: Event): void {
    if (this.isCollapsed()) {
      event.stopPropagation();
      this.sidebarService.toggleSidebar();
    }
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
