import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from '../../shared/sidebar/sidebar';
import { SidebarService } from '../../../core/services/sidebar.service';

@Component({
  selector: 'app-dashboard-layout',
  imports: [RouterOutlet, Sidebar],
  templateUrl: './dashboard-layout.html',
  styleUrl: './dashboard-layout.css',
})
export class DashboardLayout {
  private sidebarService = inject(SidebarService);

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }
}
