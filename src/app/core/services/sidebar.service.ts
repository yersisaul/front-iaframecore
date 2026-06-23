import { Injectable, signal, Inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

@Injectable({
  providedIn: 'root'
})
export class SidebarService {
  readonly isCollapsed = signal(false);
  private wasBelowThreshold = false;

  constructor(@Inject(PLATFORM_ID) private platformId: Object) {
    if (isPlatformBrowser(this.platformId)) {
      this.checkWidth();
      window.addEventListener('resize', () => this.onResize());
    }
  }

  toggleSidebar(): void {
    this.isCollapsed.update(collapsed => !collapsed);
  }

  private checkWidth(): void {
    const isBelow = window.innerWidth < 750;
    this.wasBelowThreshold = isBelow;
    if (isBelow) {
      this.isCollapsed.set(true);
    }
  }

  private onResize(): void {
    const isBelow = window.innerWidth < 750;
    if (isBelow !== this.wasBelowThreshold) {
      this.wasBelowThreshold = isBelow;
      if (isBelow) {
        this.isCollapsed.set(true);
      } else {
        this.isCollapsed.set(false);
      }
    }
  }
}
