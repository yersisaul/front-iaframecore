import { Injectable, inject, signal, computed } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { ReliabilityAlert, ReliabilityAlertQueryParams } from '../domain/entities/reliability-alert.models';
import { IReliabilityAlertRepository } from '../domain/repositories/reliability-alert.repository';

@Injectable({
  providedIn: 'root'
})
export class ReliabilityAlertService {
  private alertRepository = inject(IReliabilityAlertRepository);

  private readonly _alertReceived = new Subject<ReliabilityAlert>();
  readonly alertReceived$ = this._alertReceived.asObservable();

  // --- Estado Global Reactivo de Alertas ---
  readonly allAlerts = signal<ReliabilityAlert[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);

  // --- Control del Modal Shared ---
  readonly isModalOpen = signal<boolean>(false);
  readonly activeHostFilter = signal<string | null>(null); // null = todos los nodos

  // --- Control de Notificación Emergente (Live Toast) ---
  readonly latestLiveAlert = signal<ReliabilityAlert | null>(null);
  readonly recentAlertIds = signal<Set<string>>(new Set());
  private liveToastTimer: any = null;

  // --- Computeds Globales ---
  readonly alertCounts = computed(() => {
    const alerts = this.allAlerts();
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

  readonly unresolvedCount = computed(() => this.alertCounts().unresolved);
  readonly criticalCount = computed(() => this.alertCounts().critical);
  readonly warningCount = computed(() => this.alertCounts().warning);
  readonly infoCount = computed(() => this.alertCounts().info);

  /**
   * Carga todas las alertas de fiabilidad del sistema vía REST y las combina de manera inteligente.
   */
  loadGlobalAlerts(force: boolean = false): void {
    if (this.isLoading()) return;
    if (!force && this.allAlerts().length > 0) return;

    this.isLoading.set(true);
    this.error.set(null);

    this.alertRepository.getAlerts().subscribe({
      next: (incomingAlerts) => {
        this.allAlerts.update(currentAlerts => {
          const merged: ReliabilityAlert[] = [...incomingAlerts];

          currentAlerts.forEach(existing => {
            const alreadyPresent = merged.some(m =>
              m.id === existing.id || (existing.dedupeKey && m.dedupeKey === existing.dedupeKey)
            );
            if (!alreadyPresent) {
              merged.push(existing);
            }
          });

          return merged.sort((a, b) => {
            const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return timeB - timeA;
          });
        });
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error al cargar alertas globales:', err);
        this.error.set('Ocurrió un error al cargar las alertas. Por favor, intente de nuevo.');
        this.isLoading.set(false);
      }
    });
  }

  /**
   * Abre el modal de alertas de fiabilidad. Si se pasa un fingerprintHost, se preselecciona dicho host.
   */
  openModal(fingerprintHost?: string | null): void {
    this.activeHostFilter.set(fingerprintHost || null);
    this.isModalOpen.set(true);
    if (this.allAlerts().length === 0) {
      this.loadGlobalAlerts();
    }
  }

  /**
   * Cierra el modal de alertas.
   */
  closeModal(): void {
    this.isModalOpen.set(false);
  }

  /**
   * Cambia el filtro de host activo en el modal.
   */
  setHostFilter(fingerprintHost: string | null): void {
    this.activeHostFilter.set(fingerprintHost);
  }

  /**
   * Oculta el toast emergente de alerta en vivo.
   */
  dismissLiveToast(): void {
    this.latestLiveAlert.set(null);
    if (this.liveToastTimer) {
      clearTimeout(this.liveToastTimer);
      this.liveToastTimer = null;
    }
  }

  /**
   * Notifica la llegada de una alerta en tiempo real (vía WebSocket).
   */
  notifyAlert(alert: ReliabilityAlert): void {
    // 1. Actualizar el estado reactivo global
    this.allAlerts.update(alerts => {
      const existingIdx = alerts.findIndex(a =>
        a.id === alert.id || (alert.dedupeKey && a.dedupeKey === alert.dedupeKey)
      );
      if (existingIdx >= 0) {
        const updated = [...alerts];
        updated[existingIdx] = alert;
        return updated;
      }
      return [alert, ...alerts];
    });

    // 2. Marcar como reciente para animación en modal
    this.recentAlertIds.update(set => {
      const next = new Set(set);
      next.add(alert.id);
      return next;
    });
    setTimeout(() => {
      this.recentAlertIds.update(set => {
        if (!set.has(alert.id)) return set;
        const next = new Set(set);
        next.delete(alert.id);
        return next;
      });
    }, 3500);

    // 3. Mostrar banner emergente (Live Toast) y programar su cierre automático a los 5.5 segundos
    this.latestLiveAlert.set(alert);
    if (this.liveToastTimer) {
      clearTimeout(this.liveToastTimer);
    }
    this.liveToastTimer = setTimeout(() => {
      this.latestLiveAlert.set(null);
      this.liveToastTimer = null;
    }, 5500);

    // 4. Emitir en el Subject para componentes suscritos directamente
    this._alertReceived.next(alert);
  }

  getAlerts(params?: ReliabilityAlertQueryParams): Observable<ReliabilityAlert[]> {
    return this.alertRepository.getAlerts(params);
  }

  getAlertsByHost(fingerprintHost: string, limit?: number): Observable<ReliabilityAlert[]> {
    const params: ReliabilityAlertQueryParams = {
      fingerprint_host: fingerprintHost
    };
    if (limit !== undefined && limit !== null) {
      params.limit = limit;
    }
    return this.alertRepository.getAlerts(params);
  }

  getSeverityColor(severity: string): string {
    switch ((severity || '').toLowerCase()) {
      case 'critical':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      case 'info':
      default:
        return '#0ea5e9';
    }
  }

  getSeverityBgColor(severity: string): string {
    switch ((severity || '').toLowerCase()) {
      case 'critical':
        return 'rgba(239, 68, 68, 0.12)';
      case 'warning':
        return 'rgba(245, 158, 11, 0.12)';
      case 'info':
      default:
        return 'rgba(14, 165, 233, 0.12)';
    }
  }

  getSeverityLabel(severity: string): string {
    switch ((severity || '').toLowerCase()) {
      case 'critical':
        return 'Crítica';
      case 'warning':
        return 'Advertencia';
      case 'info':
      default:
        return 'Informativa';
    }
  }
}

