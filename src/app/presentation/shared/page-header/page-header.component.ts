import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SidebarService } from '../../../core/services/sidebar.service';

@Component({
  selector: 'app-page-header',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './page-header.component.html',
  styleUrl: './page-header.component.css'
})
export class PageHeaderComponent {
  private sidebarService = inject(SidebarService);

  @Input() title: string = '';
  @Input() subtitle: string = '';
  @Input() showSidebarToggle: boolean = true;

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }
}
