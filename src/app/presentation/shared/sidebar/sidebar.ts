import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../../core/services/auth.service';
import { AppEnvironment } from '../../../core/config/app-environment';
import { SessionControl } from '../session-control/session-control';
import { SidebarService } from '../../../core/services/sidebar.service';
import { MetadataService } from '../../../core/services/metadata.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';

@Component({
  selector: 'app-sidebar',
  imports: [CommonModule, RouterLink, RouterLinkActive, SessionControl],
  templateUrl: './sidebar.html',
  styleUrl: './sidebar.css',
  host: {
    '[class.collapsed]': 'isCollapsed()'
  }
})
export class Sidebar implements OnInit, OnDestroy {
  private authService = inject(AuthService);
  private sidebarService = inject(SidebarService);
  private metadataService = inject(MetadataService);
  private router = inject(Router);
  readonly permissionsService = inject(PermissionsService);

  readonly currentUser = this.authService.currentUser;
  readonly environment = AppEnvironment;
  readonly isCollapsed = this.sidebarService.isCollapsed;
  readonly availableIndices = this.metadataService.availableIndices;

  readonly isMetadataOpen = signal(false);
  readonly isListasOpen = signal(false);

  private routerSubscription?: Subscription;

  ngOnInit(): void {
    // Carga inicial de índices
    this.metadataService.loadAvailableIndices().subscribe();

    // Refrescar conteos en cada navegación completada
    this.routerSubscription = this.router.events.pipe(
      filter(event => event instanceof NavigationEnd)
    ).subscribe(() => {
      this.metadataService.loadAvailableIndices().subscribe();
    });

    // Auto-open submenu if active route is metadata
    if (this.isMetadataActive()) {
      this.isMetadataOpen.set(true);
    }
    // Auto-open submenu if active route is listas
    if (this.isListasActive()) {
      this.isListasOpen.set(true);
    }
  }

  ngOnDestroy(): void {
    this.routerSubscription?.unsubscribe();
  }

  isMetadataActive(): boolean {
    return this.router.url.includes('/dashboard/metadatos');
  }

  isListasActive(): boolean {
    return this.router.url.includes('/dashboard/listas');
  }

  toggleMetadataSubmenu(event: MouseEvent): void {
    event.stopPropagation();
    if (this.isCollapsed()) {
      this.sidebarService.toggleSidebar();
      this.isMetadataOpen.set(true);
    } else {
      this.isMetadataOpen.update(v => !v);
    }
  }

  toggleListasSubmenu(event: MouseEvent): void {
    event.stopPropagation();
    if (this.isCollapsed()) {
      this.sidebarService.toggleSidebar();
      this.isListasOpen.set(true);
    } else {
      this.isListasOpen.update(v => !v);
    }
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  formatCount(val: number): string {
    if (val >= 1000000) {
      const millions = val / 1000000;
      const formatted = millions % 1 === 0 ? millions.toFixed(0) : millions.toFixed(1);
      return `${formatted}M+`;
    }
    return val.toLocaleString('es-ES');
  }
}
