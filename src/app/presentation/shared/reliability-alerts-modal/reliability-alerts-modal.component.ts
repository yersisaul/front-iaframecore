import {
  Component,
  inject,
  signal,
  computed,
  ChangeDetectionStrategy,
  HostListener
} from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ReliabilityAlertService } from '../../../core/services/reliability-alert.service';
import { HostService } from '../../../core/services/host.service';
import {
  ReliabilityAlert,
  alertRelatesToHost,
  getAlertHostFingerprints
} from '../../../core/domain/entities/reliability-alert.models';
import { copyToClipboard } from '../../../core/utils/clipboard.util';

@Component({
  selector: 'app-reliability-alerts-modal',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './reliability-alerts-modal.component.html',
  styleUrl: './reliability-alerts-modal.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReliabilityAlertsModalComponent {
  readonly alertService = inject(ReliabilityAlertService);
  readonly hostService = inject(HostService);

  // Filtros internos del modal
  readonly alertSeverityFilter = signal<string>('all'); // 'all' | 'critical' | 'warning' | 'info'
  readonly alertStatusFilter = signal<string>('all'); // 'all' | 'unresolved' | 'resolved'
  readonly alertTypeFilter = signal<string>('all');
  readonly activeDropdown = signal<'node' | 'alertType' | null>(null);
  readonly expandedAlertDetails = signal<Set<string>>(new Set());
  readonly copiedAlertId = signal<string | null>(null);

  // Búsqueda interna en el dropdown de nodos
  readonly nodeSearch = signal<string>('');

  // Lista de hosts disponibles para el filtro de nodos
  readonly availableHosts = computed(() => {
    return this.hostService.allHosts();
  });
  readonly allHosts = this.availableHosts;

  readonly filteredNodeOptions = computed(() => {
    const query = this.nodeSearch().trim().toLowerCase();
    const hosts = this.availableHosts();
    if (!query) return hosts;
    return hosts.filter(h =>
      (h.hostname && h.hostname.toLowerCase().includes(query)) ||
      (h.fingerprint && h.fingerprint.toLowerCase().includes(query))
    );
  });

  readonly currentSelectedHost = computed(() => {
    const activeFp = this.alertService.activeHostFilter();
    if (!activeFp) return null;
    return this.availableHosts().find(h => h.fingerprint === activeFp) || null;
  });

  getHostName(fingerprint?: string | null): string {
    if (!fingerprint) return 'Sin asignar';
    const host = this.availableHosts().find(h => h.fingerprint === fingerprint);
    return host?.hostname || fingerprint.substring(0, 12) + '...';
  }

  getSelectedHostLabel(): string {
    const host = this.currentSelectedHost();
    return host ? (host.hostname || host.fingerprint) : 'Todos los nodos';
  }

  selectHost(fingerprint: string | null): void {
    this.alertService.setHostFilter(fingerprint);
    this.activeDropdown.set(null);
    this.nodeSearch.set('');
  }

  // Alertas filtradas por Nodo seleccionado (considerando tanto fingerprintHost como details.fingerprints)
  readonly hostScopedAlerts = computed(() => {
    const alerts = this.alertService.allAlerts();
    const activeFp = this.alertService.activeHostFilter();
    if (!activeFp) return alerts;
    return alerts.filter(a => alertRelatesToHost(a, activeFp));
  });
  readonly scopedAlerts = this.hostScopedAlerts;

  getNodeAlertsCount(fingerprint: string): number {
    return this.alertService.allAlerts().filter(a => alertRelatesToHost(a, fingerprint) && !a.isResolved).length;
  }

  getAlertAffectedFingerprints(alert: ReliabilityAlert): string[] {
    return getAlertHostFingerprints(alert);
  }

  resetFilters(): void {
    this.alertSeverityFilter.set('all');
    this.alertStatusFilter.set('all');
    this.alertTypeFilter.set('all');
  }

  // Tipos de alerta disponibles para el host seleccionado
  readonly availableAlertTypes = computed(() => {
    const alerts = this.hostScopedAlerts();
    const map = new Map<string, string>();
    alerts.forEach(a => {
      if (a.type && !map.has(a.type)) {
        map.set(a.type, a.typeLabel);
      }
    });
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  });

  getSelectedAlertTypeLabel(): string {
    const selected = this.alertTypeFilter();
    if (selected === 'all') return 'Todos los tipos';
    const found = this.availableAlertTypes().find(t => t.value === selected);
    return found ? found.label : selected;
  }

  // Contadores dentro del alcance del host seleccionado
  readonly scopedCounts = computed(() => {
    const alerts = this.hostScopedAlerts();
    let critical = 0;
    let warning = 0;
    let info = 0;
    let unresolved = 0;

    alerts.forEach(a => {
      if (a.severity === 'critical') critical++;
      else if (a.severity === 'warning') warning++;
      else if (a.severity === 'info') info++;

      if (!a.isResolved) unresolved++;
    });

    return {
      total: alerts.length,
      critical,
      warning,
      info,
      unresolved,
      resolved: alerts.length - unresolved
    };
  });

  // Alertas finales filtradas por estado, severidad y tipo
  readonly filteredAlerts = computed(() => {
    let list = this.hostScopedAlerts();
    const severity = this.alertSeverityFilter();
    const status = this.alertStatusFilter();
    const type = this.alertTypeFilter();

    if (severity !== 'all') {
      list = list.filter(a => a.severity === severity);
    }

    if (status === 'unresolved') {
      list = list.filter(a => !a.isResolved);
    } else if (status === 'resolved') {
      list = list.filter(a => a.isResolved);
    }

    if (type !== 'all') {
      list = list.filter(a => a.type === type);
    }

    return list;
  });

  onCardClick(event: MouseEvent): void {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (!target.closest('.filter-dropdown-wrapper')) {
      this.activeDropdown.set(null);
    }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    if (!target.closest('.filter-dropdown-wrapper')) {
      this.activeDropdown.set(null);
    }
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.activeDropdown()) {
      this.activeDropdown.set(null);
    } else {
      this.closeModal();
    }
  }

  closeModal(): void {
    this.alertService.closeModal();
    this.activeDropdown.set(null);
  }

  toggleDropdown(dropdownName: 'node' | 'alertType', event?: Event): void {
    if (event) event.stopPropagation();
    this.activeDropdown.update(cur => cur === dropdownName ? null : dropdownName);
  }

  toggleAlertDetails(alertId: string, event?: Event): void {
    if (event) event.stopPropagation();
    this.expandedAlertDetails.update(set => {
      const next = new Set(set);
      if (next.has(alertId)) {
        next.delete(alertId);
      } else {
        next.add(alertId);
      }
      return next;
    });
  }

  copyAlertId(id: string, event?: Event): void {
    if (event) event.stopPropagation();
    if (!id) return;
    copyToClipboard(id)
      .then(() => {
        this.copiedAlertId.set(id);
        setTimeout(() => {
          if (this.copiedAlertId() === id) {
            this.copiedAlertId.set(null);
          }
        }, 2000);
      })
      .catch((err: unknown) => console.error('Error copying alert ID to clipboard:', err));
  }

  getAlertSeverityLabel(severity: string): string {
    return this.alertService.getSeverityLabel(severity);
  }
}
