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
        document.documentElement.setAttribute('data-bs-theme', isDark ? 'dark' : 'light');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
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
      if (typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
    }
    return false;
  }
}
