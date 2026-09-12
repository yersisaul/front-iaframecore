import { Component, Input, Output, EventEmitter, signal, HostListener, OnChanges, SimpleChanges, inject, computed, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CameraService } from '../../../../../core/services/camera.service';
import { HostService } from '../../../../../core/services/host.service';
import { AnalyticService } from '../../../../../core/services/analytic.service';
import { Camera } from '../../../../../core/domain/entities/camera.models';
import { Host } from '../../../../../core/domain/entities/host.models';
import { Analytic } from '../../../../../core/domain/entities/analytic.models';
import { getCameraEffectiveStatus, getCameraStatusCssClass } from '../../../../../core/utils/camera-status.utils';

export interface ActionItem {
  idIndex: string; // "0", "1", "2"...
  tipo: string;
  accion: any;
}

@Component({
  selector: 'app-analytic-actions-builder',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './analytic-actions-builder.component.html',
  styleUrls: ['./analytic-actions-builder.component.css']
})
export class AnalyticActionsBuilderComponent implements OnChanges {
  @Input() cameraId: string = '';
  @Input() initialActions: any = null;
  @Input() highlightErrors: boolean = false;

  @Output() actionsChanged = new EventEmitter<any>();

  private cameraService = inject(CameraService);
  private hostService = inject(HostService);
  private analyticService = inject(AnalyticService);
  private elementRef = inject(ElementRef);

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialActions']) {
      this.loadInitialActions(this.initialActions);
    }
  }

  private loadInitialActions(raw: any): void {
    if (!raw || typeof raw !== 'object') {
      this.actionsList.set([]);
      this.emitActions();
      return;
    }

    const items: ActionItem[] = [];
    const processItem = (val: any, idx: number) => {
      if (val && val.tipo) {
        let tipo = val.tipo;
        const accion = { ...(val.accion || {}) };
        if (tipo.includes('Habilitar/Deshabilitar')) {
          const isAct = accion.estado === 'active';
          tipo = isAct ? 'Activar analisis' : 'Desactivar analisis';
          accion.estado = isAct ? 'active' : 'inactive';
        } else if (tipo.startsWith('Activar analisis')) {
          accion.estado = 'active';
        } else if (tipo.startsWith('Desactivar analisis')) {
          accion.estado = 'inactive';
        }
        items.push({
          idIndex: String(idx),
          tipo: tipo,
          accion: accion
        });
      }
    };

    if (Array.isArray(raw)) {
      raw.forEach((item: any, idx: number) => processItem(item, idx));
    } else {
      const keys = Object.keys(raw);
      keys.forEach((k, idx) => processItem(raw[k], idx));
    }

    this.actionsList.set(this.recalculateActionSequence(items));
    this.emitActions();
  }

  readonly actionsList = signal<ActionItem[]>([]);
  readonly isDropdownOpen = signal<boolean>(false);
  readonly dropdownPlacement = signal<'down' | 'up'>('down');
  readonly draggedIndex = signal<number | null>(null);
  readonly previewTargetIndex = signal<number | null>(null);
  readonly draggedCardHeight = signal<number>(0);
  readonly isTransitionDisabled = signal<boolean>(false);

  private isPointerDragging = false;
  private dragProxyEl: HTMLElement | null = null;

  getCardTransform(index: number): string | null {
    const dragged = this.draggedIndex();
    if (dragged === index) {
      return null;
    }

    const target = this.previewTargetIndex();
    if (dragged !== null && target !== null && dragged !== target) {
      const shiftHeight = this.draggedCardHeight() > 0 ? this.draggedCardHeight() + 12 : 120;
      if (dragged < target && index > dragged && index <= target) {
        return `translate3d(0, -${shiftHeight}px, 0)`;
      }
      if (dragged > target && index < dragged && index >= target) {
        return `translate3d(0, ${shiftHeight}px, 0)`;
      }
    }

    return null;
  }

  startPointerDrag(index: number, event: PointerEvent): void {
    if (this.actionsList().length <= 1) return;

    const target = event.target as HTMLElement;
    if (target && target.closest('.remove-action-btn, .btn-media-toggle, .btn-target-selector-trigger, button, input, select, textarea')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const cardElements = Array.from(document.querySelectorAll('.action-rule-card')) as HTMLElement[];
    const targetCardEl = cardElements[index] || (event.currentTarget as HTMLElement);

    if (!targetCardEl) return;

    const rect = targetCardEl.getBoundingClientRect();
    const grabOffsetX = event.clientX - rect.left;
    const grabOffsetY = event.clientY - rect.top;
    const draggedCardHeight = rect.height;

    this.draggedCardHeight.set(draggedCardHeight);

    // Medir puntos medios M_k de cada ranura estática
    const slotMidpoints = cardElements.map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });

    // Calcular umbrales de transición equidistantes entre ranuras adyacentes: Threshold[k] = (M_k + M_{k+1}) / 2
    const thresholds: number[] = [];
    for (let i = 0; i < slotMidpoints.length - 1; i++) {
      thresholds.push((slotMidpoints[i] + slotMidpoints[i + 1]) / 2);
    }

    // Clonar elemento de tarjeta a nivel global document.body para romper el contexto de apilamiento z-index del drawer
    const proxy = targetCardEl.cloneNode(true) as HTMLElement;
    proxy.classList.add('global-drag-proxy-card');
    proxy.style.position = 'fixed';
    proxy.style.top = '0px';
    proxy.style.left = '0px';
    proxy.style.width = `${rect.width}px`;
    proxy.style.height = `${rect.height}px`;
    proxy.style.zIndex = '999999';
    proxy.style.pointerEvents = 'none';
    proxy.style.transform = `translate3d(${event.clientX - grabOffsetX}px, ${event.clientY - grabOffsetY}px, 0)`;

    document.body.appendChild(proxy);
    this.dragProxyEl = proxy;

    this.isPointerDragging = true;
    this.draggedIndex.set(index);
    this.previewTargetIndex.set(index);

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const onPointerMove = (moveEv: PointerEvent) => {
      if (!this.isPointerDragging || !this.dragProxyEl) return;

      const posX = moveEv.clientX - grabOffsetX;
      const posY = moveEv.clientY - grabOffsetY;
      this.dragProxyEl.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;

      // Centro geométrico real de la tarjeta flotante
      const draggedCenterY = posY + draggedCardHeight / 2;

      // Determinar la ranura de destino comparando el centro geométrico contra los umbrales inter-ranuras
      let candidateIndex = 0;
      for (let i = 0; i < thresholds.length; i++) {
        if (draggedCenterY >= thresholds[i]) {
          candidateIndex = i + 1;
        }
      }

      if (this.previewTargetIndex() !== candidateIndex) {
        this.previewTargetIndex.set(candidateIndex);
      }
    };

    const onPointerUp = () => {
      if (!this.isPointerDragging) return;

      if (this.dragProxyEl && this.dragProxyEl.parentNode) {
        this.dragProxyEl.parentNode.removeChild(this.dragProxyEl);
        this.dragProxyEl = null;
      }

      const sourceIdx = this.draggedIndex();
      const targetIdx = this.previewTargetIndex();
      this.isPointerDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      // Congelar transiciones CSS momentáneamente para evitar rebote/parpadeo al soltar
      this.isTransitionDisabled.set(true);

      if (sourceIdx !== null && targetIdx !== null && sourceIdx !== targetIdx) {
        this.actionsList.update(list => {
          const updated = [...list];
          const [movedItem] = updated.splice(sourceIdx, 1);
          updated.splice(targetIdx, 0, movedItem);
          return this.recalculateActionSequence(updated);
        });
        this.emitActions();
      }

      this.draggedIndex.set(null);
      this.previewTargetIndex.set(null);

      // Restaurar transiciones en el siguiente frame tras la actualización del DOM
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.isTransitionDisabled.set(false);
        });
      });
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  toggleDropdown(event: MouseEvent): void {
    event.stopPropagation();
    const willOpen = !this.isDropdownOpen();
    if (willOpen) {
      this.calculateDropdownPlacement();
    }
    this.isDropdownOpen.set(willOpen);
  }

  private calculateDropdownPlacement(): void {
    const triggerEl = this.elementRef.nativeElement.querySelector('.btn-action-add-trigger') as HTMLElement | null;
    if (!triggerEl) {
      this.dropdownPlacement.set('down');
      return;
    }

    const triggerRect = triggerEl.getBoundingClientRect();
    const scrollContainer = this.elementRef.nativeElement.closest('.drawer-scroll-area') as HTMLElement | null;

    // Límites verticales dentro del área de scroll o del viewport
    const boundaryTop = scrollContainer ? scrollContainer.getBoundingClientRect().top : 0;
    const boundaryBottom = scrollContainer ? scrollContainer.getBoundingClientRect().bottom : window.innerHeight;

    const spaceBelow = boundaryBottom - triggerRect.bottom;
    const spaceAbove = triggerRect.top - boundaryTop;

    // Altura aproximada requerida para desplegar las 8 opciones (~280px)
    const requiredSpace = 280;

    // Si el espacio inferior es insuficiente (< 280px) y arriba hay más espacio que abajo, abrir hacia arriba
    if (spaceBelow < requiredSpace && spaceAbove > spaceBelow) {
      this.dropdownPlacement.set('up');
    } else {
      this.dropdownPlacement.set('down');
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.isDropdownOpen()) {
      this.calculateDropdownPlacement();
    }
  }

  @HostListener('document:click')
  closeDropdown(): void {
    this.isDropdownOpen.set(false);
  }

  selectActionType(actionType: string): void {
    this.addAction(actionType);
    this.isDropdownOpen.set(false);
  }

  getVoiceMode(actionItem: ActionItem): 'default' | 'custom' {
    if (actionItem.accion._voiceMode) {
      return actionItem.accion._voiceMode;
    }
    const val = actionItem.accion.contenido;
    if (!val || val === 'Predeterminado por sistema' || val.trim() === '') {
      return 'default';
    }
    return 'custom';
  }

  setVoiceMode(actionItem: ActionItem, mode: 'default' | 'custom'): void {
    actionItem.accion._voiceMode = mode;
    if (mode === 'default') {
      actionItem.accion.contenido = 'Predeterminado por sistema';
    } else {
      if (!actionItem.accion.contenido || actionItem.accion.contenido === 'Predeterminado por sistema') {
        actionItem.accion.contenido = '';
      }
    }
    this.emitActions();
  }

  /**
   * Extrae el nombre base de la acción eliminando sufijos numéricos existentes (-0, -00, -01, etc.)
   */
  getBaseType(tipo: string, estado?: string): string {
    if (!tipo) return '';
    let clean = tipo.replace(/-\d+$/, '').trim();
    if (clean.startsWith('Habilitar/Deshabilitar')) {
      return estado === 'active' ? 'Activar analisis' : 'Desactivar analisis';
    }
    return clean;
  }

  /**
   * Recalcula la secuencia de acciones asignando a cada tipo su sufijo numérico (-00, -01, -02...)
   * En el frontend, 'Activar analisis' y 'Desactivar analisis' tienen conteos independientes.
   */
  recalculateActionSequence(items: ActionItem[]): ActionItem[] {
    const typeCounters: Record<string, number> = {};
    return items.map((item, idx) => {
      const base = this.getBaseType(item.tipo, item.accion?.estado);
      const currentCount = typeCounters[base] || 0;
      typeCounters[base] = currentCount + 1;
      const suffix = String(currentCount).padStart(2, '0');
      return {
        ...item,
        idIndex: String(idx),
        tipo: `${base}-${suffix}`
      };
    });
  }

  readonly actionTypes = [
    { type: 'Activar analisis', label: 'Activar análisis' },
    { type: 'Desactivar analisis', label: 'Desactivar análisis' },
    { type: 'Voz de sistema', label: 'Voz de sistema (TTS)' },
    { type: 'Ventana emergente', label: 'Ventana emergente en vivo' },
    { type: 'Tiempo de espera', label: 'Tiempo de espera (Delay)' },
    { type: 'Enviar a API', label: 'Enviar a API (Webhook POST)' },
    { type: 'Evento a VMS NX', label: 'Evento a VMS NX Witness' },
    { type: 'Grabar video', label: 'Grabar video (Clip Evidencia)' }
  ];

  addAction(actionType: string): void {
    const base = this.getBaseType(actionType);
    let defaultAccion: any = {};

    if (base.startsWith('Activar analisis')) {
      defaultAccion = { analitica: '', estado: 'active' };
    } else if (base.startsWith('Desactivar analisis')) {
      defaultAccion = { analitica: '', estado: 'inactive' };
    } else if (base.startsWith('Voz de sistema')) {
      defaultAccion = { contenido: 'Predeterminado por sistema', _voiceMode: 'default' };
    } else if (base.startsWith('Ventana emergente') || base.startsWith('Grabar video')) {
      defaultAccion = { id_cam: this.cameraId || '' };
    } else if (base.startsWith('Tiempo de espera')) {
      defaultAccion = { tiempo: '30' };
    } else if (base.startsWith('Enviar a API')) {
      defaultAccion = { endpoint: 'https://api.mi-sistema.com/alertas', id_report_type: 'rep-001' };
    } else if (base.startsWith('Evento a VMS NX')) {
      defaultAccion = {
        id_cam: this.cameraId || '',
        caption: 'Evento de IA',
        usuario: 'conexion',
        password: 'password123',
        ip_server_nx: '192.168.1.100'
      };
    }

    const newItem: ActionItem = {
      idIndex: String(this.actionsList().length),
      tipo: base,
      accion: defaultAccion
    };

    this.actionsList.update(list => this.recalculateActionSequence([...list, newItem]));
    this.emitActions();
  }

  removeAction(index: number): void {
    this.actionsList.update(list => {
      const filtered = list.filter((_, i) => i !== index);
      return this.recalculateActionSequence(filtered);
    });
    this.emitActions();
  }

  emitActions(): void {
    const resultObj: any = {};
    let enableDisableIndex = 0;

    this.actionsList().forEach(item => {
      const cleanAccion = { ...item.accion };
      delete cleanAccion._voiceMode;
      delete cleanAccion._targetAnalyticType;
      delete cleanAccion._targetCameraName;

      let backendTipo = item.tipo;

      if (
        item.tipo.startsWith('Activar analisis') ||
        item.tipo.startsWith('Desactivar analisis') ||
        item.tipo.startsWith('Habilitar/Deshabilitar')
      ) {
        const isActivation = item.tipo.startsWith('Activar analisis') || cleanAccion.estado === 'active';
        cleanAccion.estado = isActivation ? 'active' : 'inactive';

        const seqSuffix = String(enableDisableIndex).padStart(2, '0');
        backendTipo = `Habilitar/Deshabilitar Analisis-${seqSuffix}`;
        enableDisableIndex++;
      }

      resultObj[item.idIndex] = {
        tipo: backendTipo,
        accion: cleanAccion
      };
    });

    console.groupCollapsed(
      '%c⚡ [DEBUG ACTIONS BUILDER] Mapeo Frontend ➔ Backend',
      'background: #6366f1; color: white; font-weight: bold; font-size: 11px; padding: 2px 6px; border-radius: 3px;'
    );
    if (this.actionsList().length > 0) {
      console.table(
        this.actionsList().map(item => ({
          'Frontend (Visual)': item.tipo,
          'Backend (Tipo)': resultObj[item.idIndex]?.tipo,
          'Estado': resultObj[item.idIndex]?.accion?.estado || '-',
          'Analítica Target': resultObj[item.idIndex]?.accion?.analitica || '-',
          'Detalle Acción': JSON.stringify(resultObj[item.idIndex]?.accion)
        }))
      );
    }
    console.log('📤 Objeto payload.acciones generado:', resultObj);
    console.groupEnd();

    this.actionsChanged.emit(resultObj);
  }

  // =========================================================================
  // GESTIÓN DEL MODAL DE SELECCIÓN JERÁRQUICA DE ANALÍTICA OBJETIVO
  // =========================================================================

  readonly isSelectModalOpen = signal<boolean>(false);
  readonly selectedActionItemForModal = signal<ActionItem | null>(null);

  readonly activeModalTab = signal<'nodos' | 'todas'>('nodos');
  readonly modalSearchQuery = signal<string>('');
  readonly modalTypeFilter = signal<string>('all');
  readonly showTypeFilterDropdown = signal<boolean>(false);
  readonly modalStatusFilter = signal<'all' | 'active' | 'inactive'>('all');
  readonly showStatusFilterDropdown = signal<boolean>(false);
  readonly modalSortDirection = signal<'asc' | 'desc'>('asc');

  readonly selectedNode = signal<Host | null>(null);
  readonly selectedCamera = signal<Camera | null>(null);
  readonly tempSelectedAnalyticId = signal<string | null>(null);

  private backdropMouseDownTarget: HTMLElement | null = null;

  private analyticMatchesCamera(a: any, cam: Camera): boolean {
    return !!(
      (a.targetCameraIds && a.targetCameraIds.includes(cam.id)) ||
      (a.targetCameraNames && a.targetCameraNames.includes(cam.name))
    );
  }

  cameraMatchesFilters(cam: Camera, typeFilter: string, statusFilter: string): boolean {
    const analytics = this.analyticService.analytics();
    return analytics.some(a => {
      if (!this.analyticMatchesCamera(a, cam)) return false;
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      return true;
    });
  }

  readonly availableAnalyticTypes = computed(() => {
    const set = new Set<string>();
    const cameras = this.cameraService.cameras();
    const statusFilter = this.modalStatusFilter();

    this.analyticService.analytics().forEach(a => {
      if (!a.type) return;
      if (statusFilter !== 'all' && a.status !== statusFilter) return;

      const hasCamera = cameras.some(c => this.analyticMatchesCamera(a, c));
      if (hasCamera) {
        set.add(a.type);
      }
    });
    return Array.from(set).sort();
  });

  readonly availableAnalyticStatuses = computed(() => {
    const set = new Set<string>();
    const cameras = this.cameraService.cameras();
    const typeFilter = this.modalTypeFilter();

    this.analyticService.analytics().forEach(a => {
      if (!a.status) return;
      if (typeFilter !== 'all' && a.type !== typeFilter) return;

      const hasCamera = cameras.some(c => this.analyticMatchesCamera(a, c));
      if (hasCamera) {
        set.add(a.status);
      }
    });
    return set;
  });

  readonly filteredNodes = computed(() => {
    const query = this.modalSearchQuery().toLowerCase().trim();
    const typeFilter = this.modalTypeFilter();
    const statusFilter = this.modalStatusFilter();
    const sortDir = this.modalSortDirection();
    const hosts = this.hostService.allHosts();
    const cameras = this.cameraService.cameras();

    const groups: { host: Host; cameras: Camera[] }[] = [];

    hosts.forEach(host => {
      let hostCameras = cameras.filter(c =>
        (c.hostFingerprint && c.hostFingerprint === host.fingerprint) ||
        (host.id && (c as any).hostId === host.id)
      );

      // Filtro por tipo y estado de analítica: las cámaras deben tener analíticas coincidentes
      hostCameras = hostCameras.filter(c => this.cameraMatchesFilters(c, typeFilter, statusFilter));

      // Filtro por texto de búsqueda: busca por nodo o por cámara
      if (query) {
        const matchesHost = (host.hostname || '').toLowerCase().includes(query) ||
          (host.fingerprint || '').toLowerCase().includes(query);
        if (!matchesHost) {
          hostCameras = hostCameras.filter(c =>
            (c.name && c.name.toLowerCase().includes(query)) ||
            (c.id && c.id.toLowerCase().includes(query))
          );
        }
      }

      // Solo mostrar nodos que tengan cámaras coincidentes (como en monitoreo)
      if (hostCameras.length > 0) {
        const sortedCams = hostCameras.slice().sort((a, b) => {
          const cmp = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
          return sortDir === 'asc' ? cmp : -cmp;
        });

        groups.push({
          host,
          cameras: sortedCams
        });
      }
    });

    return groups.sort((a, b) => {
      const nameA = a.host.hostname || a.host.fingerprint;
      const nameB = b.host.hostname || b.host.fingerprint;
      const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

  readonly nodeCameras = computed(() => {
    const node = this.selectedNode();
    if (!node) return [];
    const query = this.modalSearchQuery().toLowerCase().trim();
    const typeFilter = this.modalTypeFilter();
    const statusFilter = this.modalStatusFilter();
    const sortDir = this.modalSortDirection();

    let cameras = this.cameraService.cameras().filter(c =>
      (c.hostFingerprint && c.hostFingerprint === node.fingerprint) ||
      (node.id && (c as any).hostId === node.id)
    );

    // Filtrar cámaras que cumplan con los filtros de analítica
    cameras = cameras.filter(c => this.cameraMatchesFilters(c, typeFilter, statusFilter));

    // Filtrar por término de búsqueda en la cámara
    if (query) {
      cameras = cameras.filter(c =>
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.id && c.id.toLowerCase().includes(query))
      );
    }

    return cameras.sort((a, b) => {
      const cmp = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

  readonly allCamerasList = computed(() => {
    const query = this.modalSearchQuery().toLowerCase().trim();
    const typeFilter = this.modalTypeFilter();
    const statusFilter = this.modalStatusFilter();
    const sortDir = this.modalSortDirection();

    let cameras = this.cameraService.cameras();

    // Filtrar cámaras que cumplan con los filtros de analítica
    cameras = cameras.filter(c => this.cameraMatchesFilters(c, typeFilter, statusFilter));

    // Filtrar por búsqueda (nombre de cámara, ID o hostname de nodo)
    if (query) {
      const hosts = this.hostService.allHosts();
      cameras = cameras.filter(c => {
        const matchesCam = (c.name && c.name.toLowerCase().includes(query)) ||
          (c.id && c.id.toLowerCase().includes(query));
        if (matchesCam) return true;
        const host = hosts.find(h => h.fingerprint === c.hostFingerprint || (h.id && (c as any).hostId === h.id));
        return host ? (host.hostname || '').toLowerCase().includes(query) : false;
      });
    }

    return cameras.sort((a, b) => {
      const cmp = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

  readonly cameraAnalytics = computed(() => {
    const cam = this.selectedCamera();
    if (!cam) return [];
    const typeFilter = this.modalTypeFilter();
    const statusFilter = this.modalStatusFilter();
    const sortDir = this.modalSortDirection();

    const analytics = this.analyticService.analytics().filter(a => {
      if (!this.analyticMatchesCamera(a, cam)) return false;
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      return true;
    });

    return analytics.sort((a, b) => {
      const cmp = (a.type || '').localeCompare(b.type || '', undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

  openAnalyticSelectModal(actionItem: ActionItem): void {
    this.selectedActionItemForModal.set(actionItem);
    this.tempSelectedAnalyticId.set(actionItem.accion.analitica || null);
    this.selectedNode.set(null);
    this.selectedCamera.set(null);
    this.modalSearchQuery.set('');
    this.modalSortDirection.set('asc');
    this.modalStatusFilter.set('all');
    this.modalTypeFilter.set('all');
    this.showTypeFilterDropdown.set(false);
    this.showStatusFilterDropdown.set(false);
    this.isSelectModalOpen.set(true);

    // Si ya tiene una analítica previamente seleccionada, intentar posicionar la cámara en el modal
    if (actionItem.accion.analitica) {
      const existing = this.analyticService.analytics().find(a => a.id === actionItem.accion.analitica);
      if (existing && existing.targetCameraIds?.length) {
        const foundCam = this.cameraService.cameras().find(c => c.id === existing.targetCameraIds[0]);
        if (foundCam) {
          this.selectedCamera.set(foundCam);
          if (foundCam.hostFingerprint) {
            const foundHost = this.hostService.allHosts().find(h => h.fingerprint === foundCam.hostFingerprint);
            if (foundHost) {
              this.selectedNode.set(foundHost);
            }
          }
        }
      }
    }

    // Refrescar catálogos de backend
    this.hostService.loadAllHosts().subscribe();
    this.cameraService.getAllCameras().subscribe();
    this.analyticService.getAllAnalytics().subscribe();
  }

  closeSelectModal(): void {
    this.isSelectModalOpen.set(false);
    this.selectedActionItemForModal.set(null);
    this.tempSelectedAnalyticId.set(null);
    this.selectedNode.set(null);
    this.selectedCamera.set(null);
    this.showTypeFilterDropdown.set(false);
    this.showStatusFilterDropdown.set(false);
  }

  switchModalTab(tab: 'nodos' | 'todas'): void {
    this.activeModalTab.set(tab);
    this.selectedNode.set(null);
    this.selectedCamera.set(null);
  }

  selectNode(node: Host): void {
    this.selectedNode.set(node);
  }

  selectCamera(cam: Camera): void {
    this.selectedCamera.set(cam);
  }

  goBack(): void {
    if (this.selectedCamera()) {
      this.selectedCamera.set(null);
    } else if (this.selectedNode()) {
      this.selectedNode.set(null);
    }
  }

  shouldShowContextualHeader(): boolean {
    if (this.activeModalTab() === 'nodos') {
      return !!(this.selectedNode() || this.selectedCamera());
    } else {
      return !!this.selectedCamera();
    }
  }

  getContextualHeaderTitle(): string {
    if (this.selectedCamera()) {
      return `Cámara: ${this.selectedCamera()!.name}`;
    }
    if (this.selectedNode()) {
      return `Nodo: ${this.selectedNode()!.hostname || this.selectedNode()!.fingerprint.slice(0, 12)}`;
    }
    return '';
  }

  getContextualHeaderCount(): string {
    if (this.selectedCamera()) {
      return `${this.cameraAnalytics().length} analíticas`;
    }
    if (this.selectedNode()) {
      return `${this.nodeCameras().length} cámaras`;
    }
    return '';
  }

  toggleAnalyticSelection(analyticId: string): void {
    this.tempSelectedAnalyticId.update(curr => curr === analyticId ? null : analyticId);
  }

  confirmAnalyticSelection(): void {
    const item = this.selectedActionItemForModal();
    const targetId = this.tempSelectedAnalyticId();
    if (!item || !targetId) return;

    const analytic = this.analyticService.analytics().find(a => a.id === targetId);
    item.accion.analitica = targetId;
    if (analytic) {
      item.accion._targetAnalyticType = analytic.type;
      item.accion._targetCameraName = this.selectedCamera()?.name || analytic.targetCameraNames?.[0] || '';
    }

    this.emitActions();
    this.closeSelectModal();
  }

  toggleModalSortDirection(): void {
    this.modalSortDirection.update(d => d === 'asc' ? 'desc' : 'asc');
  }

  toggleTypeFilterDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showTypeFilterDropdown.update(v => !v);
    this.showStatusFilterDropdown.set(false);
  }

  selectTypeFilter(type: string, event: MouseEvent): void {
    event.stopPropagation();
    this.modalTypeFilter.set(type);
    this.showTypeFilterDropdown.set(false);
  }

  toggleStatusFilterDropdown(event: MouseEvent): void {
    event.stopPropagation();
    this.showStatusFilterDropdown.update(v => !v);
    this.showTypeFilterDropdown.set(false);
  }

  selectStatusFilter(status: 'all' | 'active' | 'inactive', event: MouseEvent): void {
    event.stopPropagation();
    this.modalStatusFilter.set(status);
    this.showStatusFilterDropdown.set(false);
  }

  getStatusFilterLabel(status: string): string {
    switch (status) {
      case 'active': return 'Activas';
      case 'inactive': return 'Inactivas';
      default: return 'Todos';
    }
  }

  getSelectedAnalyticLabel(actionItem: ActionItem): string {
    if (actionItem.accion._targetAnalyticType) {
      return actionItem.accion._targetAnalyticType;
    }
    const analytic = this.analyticService.analytics().find(a => a.id === actionItem.accion.analitica);
    if (analytic) {
      return analytic.type;
    }
    return actionItem.accion.analitica ? `Analítica (${actionItem.accion.analitica.slice(0, 8)}...)` : 'Sin analítica';
  }

  getSelectedAnalyticCamera(actionItem: ActionItem): string {
    if (actionItem.accion._targetCameraName) {
      return actionItem.accion._targetCameraName;
    }
    const analytic = this.analyticService.analytics().find(a => a.id === actionItem.accion.analitica);
    if (analytic && analytic.targetCameraNames?.length) {
      return analytic.targetCameraNames[0];
    }
    return '';
  }

  getSelectedAnalyticMeta(actionItem: ActionItem): string {
    const camName = actionItem.accion._targetCameraName;
    if (camName) {
      return `Cámara: ${camName} • ID: ${actionItem.accion.analitica.slice(0, 8)}...`;
    }
    const analytic = this.analyticService.analytics().find(a => a.id === actionItem.accion.analitica);
    if (analytic && analytic.targetCameraNames?.length) {
      return `Cámara: ${analytic.targetCameraNames[0]} • ID: ${actionItem.accion.analitica.slice(0, 8)}...`;
    }
    return actionItem.accion.analitica ? `ID: ${actionItem.accion.analitica}` : '';
  }

  getCameraStatusClass(camera: Camera | null | undefined): string {
    const status = getCameraEffectiveStatus(camera, this.hostService.allHosts());
    return getCameraStatusCssClass(status);
  }

  getCameraStatusLabel(camera: Camera | null | undefined): string {
    return getCameraEffectiveStatus(camera, this.hostService.allHosts());
  }

  getCameraAnalyticsBadges(camera: Camera): string[] {
    const typeFilter = this.modalTypeFilter();
    const statusFilter = this.modalStatusFilter();
    const analytics = this.analyticService.analytics().filter(a => {
      if (!this.analyticMatchesCamera(a, camera)) return false;
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      if (statusFilter !== 'all' && a.status !== statusFilter) return false;
      return true;
    });

    const badges = Array.from(new Set(analytics.map(a => a.type || 'Analítica'))).sort();
    return badges;
  }

  getCameraAnalyticsBadgesInfo(camera: Camera): { visible: string[]; remainingCount: number; remainingTooltip: string } {
    const allBadges = this.getCameraAnalyticsBadges(camera);
    const maxVisible = 2;
    if (allBadges.length <= maxVisible) {
      return {
        visible: allBadges,
        remainingCount: 0,
        remainingTooltip: ''
      };
    }
    const visible = allBadges.slice(0, maxVisible);
    const remaining = allBadges.slice(maxVisible);
    return {
      visible,
      remainingCount: remaining.length,
      remainingTooltip: remaining.join(', ')
    };
  }

  getAnalyticClassesInfo(analytic: Analytic): { visible: string[]; remainingCount: number; remainingTooltip: string } {
    const classes = analytic.detectionClasses || [];
    const maxVisible = 3;
    if (classes.length <= maxVisible) {
      return {
        visible: classes,
        remainingCount: 0,
        remainingTooltip: ''
      };
    }
    const visible = classes.slice(0, maxVisible);
    const remaining = classes.slice(maxVisible);
    return {
      visible,
      remainingCount: remaining.length,
      remainingTooltip: remaining.join(', ')
    };
  }

  getCameraAnalyticsCount(cam: Camera): number {
    const typeFilter = this.modalTypeFilter();
    const statusFilter = this.modalStatusFilter();
    return this.analyticService.analytics().filter(a =>
      this.analyticMatchesCamera(a, cam) &&
      (typeFilter === 'all' || a.type === typeFilter) &&
      (statusFilter === 'all' || a.status === statusFilter)
    ).length;
  }

  isLinuxHost(host: Host): boolean {
    const sys = host.hwInfo?.system?.toLowerCase() || '';
    return sys.includes('linux') || sys.includes('ubuntu') || sys.includes('debian');
  }

  isWindowsHost(host: Host): boolean {
    const sys = host.hwInfo?.system?.toLowerCase() || '';
    return sys.includes('windows') || sys.includes('win');
  }

  getHostOsIcon(host: Host): string {
    if (this.isLinuxHost(host)) {
      return 'icon-ubuntu';
    }
    if (this.isWindowsHost(host)) {
      return 'icon-windows';
    }
    return 'icon-nodos';
  }

  getNodeSystemLabel(host: Host): string {
    return host.hwInfo?.system || (this.isLinuxHost(host) ? 'Linux' : this.isWindowsHost(host) ? 'Windows' : 'Servidor');
  }

  onModalBackdropMouseDown(event: MouseEvent): void {
    this.backdropMouseDownTarget = event.target as HTMLElement;
  }

  onModalBackdropMouseUp(event: MouseEvent): void {
    if (this.backdropMouseDownTarget === event.currentTarget && event.target === event.currentTarget) {
      this.closeSelectModal();
    }
    this.backdropMouseDownTarget = null;
  }
}
