import { Component, inject, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Sidebar } from '../../shared/sidebar/sidebar';
import { SidebarService } from '../../../core/services/sidebar.service';
import { MonitoringPipComponent } from '../../shared/monitoring-pip/monitoring-pip.component';
import { ReliabilityAlertWidgetComponent } from '../../shared/reliability-alert-widget/reliability-alert-widget.component';
import { ReliabilityAlertsModalComponent } from '../../shared/reliability-alerts-modal/reliability-alerts-modal.component';
import { ReliabilityAlertService } from '../../../core/services/reliability-alert.service';
import { HostService } from '../../../core/services/host.service';

@Component({
  selector: 'app-dashboard-layout',
  imports: [
    RouterOutlet,
    Sidebar,
    MonitoringPipComponent,
    ReliabilityAlertWidgetComponent,
    ReliabilityAlertsModalComponent
  ],
  templateUrl: './dashboard-layout.html',
  styleUrl: './dashboard-layout.css',
})
export class DashboardLayout implements OnInit {
  private sidebarService = inject(SidebarService);
  private reliabilityAlertService = inject(ReliabilityAlertService);
  private hostService = inject(HostService);

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  ngOnInit(): void {
    // Carga inicial global de alertas de fiabilidad y hosts del sistema
    this.reliabilityAlertService.loadGlobalAlerts();
    this.hostService.loadAllHosts().subscribe();
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }
}

