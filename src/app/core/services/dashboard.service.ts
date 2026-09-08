import { Injectable, inject, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { DashboardItem } from '../domain/entities/dashboard.models';
import { IDashboardRepository } from '../domain/repositories/dashboard.repository';

@Injectable({
  providedIn: 'root'
})
export class DashboardService {
  private dashboardRepository = inject(IDashboardRepository);

  readonly dashboards = signal<DashboardItem[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly isViewActive = signal<boolean>(false);
  readonly selectedDashboard = signal<DashboardItem | null>(null);

  // Señales reactivas para animaciones en vivo vía WebSocket
  readonly newRecordIds = signal<Set<string>>(new Set());
  readonly updatedRecordIds = signal<Set<string>>(new Set());
  readonly deletingRecordIds = signal<Set<string>>(new Set());

  markAsNew(id: string): void {
    this.newRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRecordIds.update(s => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 2000);
  }

  markAsUpdated(id: string): void {
    this.updatedRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.updatedRecordIds.update(s => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 2000);
  }

  markAsDeleting(id: string): void {
    this.deletingRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.deletingRecordIds.update(s => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 1000);
  }

  loadDashboards(): Observable<DashboardItem[]> {
    this.isLoading.set(true);
    return this.dashboardRepository.getAll().pipe(
      tap({
        next: (items) => {
          this.dashboards.set(items);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
        }
      })
    );
  }

  addOrUpdateDashboardLocal(item: DashboardItem): void {
    this.dashboards.update(list => {
      const index = list.findIndex(d => d.id === item.id);
      if (index >= 0) {
        const updated = [...list];
        updated[index] = { ...list[index], ...item };
        return updated;
      }
      return [item, ...list];
    });

    // Si el tablero actualizado es el que está abierto actualmente en el visor, actualizar su referencia
    if (this.selectedDashboard()?.id === item.id) {
      this.selectedDashboard.set(item);
    }
  }

  deleteDashboardLocal(id: string): void {
    this.dashboards.update(list => list.filter(d => d.id !== id));

    // Si el tablero que se eliminó estaba abierto en pantalla completa o lienzo, deseleccionarlo
    if (this.selectedDashboard()?.id === id) {
      this.selectedDashboard.set(null);
    }
  }
}
