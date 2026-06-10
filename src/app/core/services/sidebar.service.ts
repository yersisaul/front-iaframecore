import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SidebarService {
  readonly isCollapsed = signal(false);

  toggleSidebar(): void {
    this.isCollapsed.update(collapsed => !collapsed);
  }
}
