import { Injectable, signal, effect } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  readonly darkMode = signal(this.getInitialTheme());

  constructor() {
    effect(() => {
      const isDark = this.darkMode();
      if (typeof window !== 'undefined') {
        const theme = isDark ? 'dark' : 'light';
        document.documentElement.setAttribute('data-bs-theme', theme);
        if (document.body) {
          document.body.setAttribute('data-bs-theme', theme);
        }

        if (isDark) {
          document.documentElement.classList.add('dark');
          document.body?.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
          document.body?.classList.remove('dark');
        }
        localStorage.setItem('theme', theme);
      }
    });
  }

  toggleTheme(): void {
    this.darkMode.update(dark => !dark);
  }

  private getInitialTheme(): boolean {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) {
        return saved === 'dark';
      }
    }
    return true; // Tema oscuro por defecto para toda la plataforma y login
  }
}
