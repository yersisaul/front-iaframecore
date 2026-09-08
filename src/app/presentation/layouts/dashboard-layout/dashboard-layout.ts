import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from '../../shared/sidebar/sidebar';
import { SidebarService } from '../../../core/services/sidebar.service';
import { MonitoringPipComponent } from '../../shared/monitoring-pip/monitoring-pip.component';

@Component({
  selector: 'app-dashboard-layout',
  imports: [RouterOutlet, Sidebar, MonitoringPipComponent],
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
