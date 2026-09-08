import { Component, input, computed, signal, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Camera } from '../../../core/domain/entities/camera.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { Host } from '../../../core/domain/entities/host.models';
import { getCameraEffectiveStatus, getCameraStatusCssClass, getCameraStatusFilterLabel, CameraStatusType } from '../../../core/utils/camera-status.utils';

export interface DynamicCameraStatusBreakdown {
  statusKey: string;
  label: string;
  cssClass: string;
  count: number;
}

export interface DynamicAnalyticsSummary {
  total: number;
  active: number;
  inactive: number;
}

export interface DynamicAnalyticTypeRow {
  typeKey: string;
  label: string;
  active: number;
  inactive: number;
  total: number;
  isTotal?: boolean;
}

@Component({
  selector: 'app-header-stats-subtitle',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './header-stats-subtitle.component.html',
  styleUrl: './header-stats-subtitle.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderStatsSubtitleComponent {
  // Inputs reactivos Signal Inputs
  readonly cameras = input<Camera[]>([]);
  readonly analytics = input<Analytic[]>([]);
  readonly allHosts = input<Host[]>([]);
  readonly contextSuffix = input<string>('en el sistema.');
  readonly showCameras = input<boolean>(true);
  readonly showAnalytics = input<boolean>(true);

  // Estado del popover activo
  readonly activePopover = signal<'cameras' | 'analytics' | null>(null);

  // Total de cámaras
  readonly totalCamerasCount = computed<number>(() => this.cameras().length);

  // Total de analíticas
  readonly totalAnalyticsCount = computed<number>(() => (this.analytics() || []).length);

  // Estados dinámicos de cámaras calculados reactivamente (utiliza getCameraStatusFilterLabel exacto como en los filtros)
  readonly cameraStatuses = computed<DynamicCameraStatusBreakdown[]>(() => {
    const list = this.cameras() || [];
    const hosts = this.allHosts() || [];

    if (list.length === 0) {
      return [];
    }

    const counts = new Map<string, number>();

    for (const cam of list) {
      const effStatus = getCameraEffectiveStatus(cam, hosts);
      counts.set(effStatus, (counts.get(effStatus) || 0) + 1);
    }

    const statusOrder: CameraStatusType[] = ['Online', 'Offline', 'Degraded', 'Recovering', 'Pending'];

    return Array.from(counts.entries())
      .map(([statusKey, count]) => ({
        statusKey,
        label: getCameraStatusFilterLabel(statusKey),
        cssClass: getCameraStatusCssClass(statusKey as CameraStatusType),
        count
      }))
      .sort((a, b) => {
        const idxA = statusOrder.indexOf(a.statusKey as CameraStatusType);
        const idxB = statusOrder.indexOf(b.statusKey as CameraStatusType);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return b.count - a.count;
      });
  });

  // Estadísticas reactivas de analíticas con 3 columnas (Primera fila: Total, seguido por cada tipo)
  readonly analyticsBreakdown = computed<DynamicAnalyticTypeRow[]>(() => {
    const list = this.analytics() || [];
    if (list.length === 0) {
      return [];
    }

    let totalActive = 0;
    let totalInactive = 0;
    const map = new Map<string, { active: number; inactive: number }>();

    for (const a of list) {
      const st = (a.status || '').toLowerCase().trim();
      const isInactive = st === 'inactive' || st === 'inactivo' || st === 'inactiva' || st === 'disabled' || st === 'offline';

      if (isInactive) {
        totalInactive++;
      } else {
        totalActive++;
      }

      const rawType = a.type || 'otros';
      const normType = this.normalizeAnalyticType(rawType);

      const current = map.get(normType) || { active: 0, inactive: 0 };
      if (isInactive) {
        current.inactive++;
      } else {
        current.active++;
      }
      map.set(normType, current);
    }

    const totalRow: DynamicAnalyticTypeRow = {
      typeKey: 'total',
      label: 'Total',
      active: totalActive,
      inactive: totalInactive,
      total: list.length,
      isTotal: true
    };

    const typeRows = Array.from(map.entries()).map(([normType, counts]) => ({
      typeKey: normType,
      label: this.getAnalyticLabel(normType),
      active: counts.active,
      inactive: counts.inactive,
      total: counts.active + counts.inactive,
      isTotal: false
    })).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

    return [totalRow, ...typeRows];
  });

  // Estadísticas reactivas globales de analíticas (totales rápidos)
  readonly analyticsSummary = computed<DynamicAnalyticsSummary>(() => {
    const list = this.analytics() || [];
    const total = list.length;

    if (total === 0) {
      return {
        total: 0,
        active: 0,
        inactive: 0
      };
    }

    let active = 0;
    let inactive = 0;

    for (const a of list) {
      const st = (a.status || '').toLowerCase().trim();
      if (st === 'inactive' || st === 'inactivo' || st === 'inactiva' || st === 'disabled' || st === 'offline') {
        inactive++;
      } else {
        active++;
      }
    }

    return {
      total,
      active,
      inactive
    };
  });

  private normalizeAnalyticType(type: string): string {
    return (type || '')
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s-]+/g, '_');
  }

  getAnalyticLabel(type: string): string {
    const norm = this.normalizeAnalyticType(type);
    const labels: Record<string, string> = {
      object_detection: 'Detección de Objetos',
      face_recognition: 'Reconocimiento Facial',
      plate_recognition: 'Lectura de Placas',
      people_counting: 'Conteo de Personas',
      intrusion_detection: 'Detección de Intrusión',
      comportamiento_humano: 'Comportamiento Humano',
      cruce_de_linea: 'Cruce de Línea',
      objeto_en_area: 'Objeto en Área',
      aglomeracion: 'Aglomeración',
      control_de_aforo: 'Control de Aforo',
      analisis_de_trafico: 'Análisis de Tráfico',
      objeto_fuera_de_area: 'Objeto Fuera de Área',
      personas_con_objetos: 'Personas con Objetos',
      vigilancia_de_objeto: 'Vigilancia de Objeto',
      vigilancia_vehicular: 'Vigilancia Vehicular',
      medicion_de_velocidad: 'Medición de Velocidad',
      permanencia_de_objeto: 'Permanencia de Objeto',
      reconocimiento_facial: 'Reconocimiento Facial',
      cercania_entre_objetos: 'Cercanía entre Objetos',
      reconocimiento_de_placas: 'Reconocimiento de Placas',
      gestion_de_estacionamientos: 'Gestión de Estacionamientos'
    };
    return labels[norm] ?? (type ? type.replace(/_/g, ' ') : 'General');
  }

  // Métodos de control de popover
  togglePopover(type: 'cameras' | 'analytics', event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    if (this.activePopover() === type) {
      this.activePopover.set(null);
    } else {
      this.activePopover.set(type);
    }
  }

  openPopover(type: 'cameras' | 'analytics'): void {
    this.activePopover.set(type);
  }

  closePopover(): void {
    this.activePopover.set(null);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.activePopover.set(null);
  }
}
