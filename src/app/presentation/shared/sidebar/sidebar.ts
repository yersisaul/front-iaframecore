import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AppEnvironment } from '../../../core/config/app-environment';
import { SessionControl } from '../session-control/session-control';
import { SidebarService } from '../../../core/services/sidebar.service';

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive, SessionControl],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
  host: {
    '[class.collapsed]': 'isCollapsed()'
  }
})
export class Sidebar {
  private authService = inject(AuthService);
  private sidebarService = inject(SidebarService);

  readonly isAdmin = this.authService.isAdmin;
  readonly currentUser = this.authService.currentUser;
  readonly environment = AppEnvironment;
  readonly isCollapsed = this.sidebarService.isCollapsed;

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }
}
