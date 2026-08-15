import { Component, Input, Output, EventEmitter, signal, HostListener, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

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

  @Output() actionsChanged = new EventEmitter<any>();

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
    if (Array.isArray(raw)) {
      raw.forEach((item: any, idx: number) => {
        if (item && item.tipo) {
          items.push({
            idIndex: String(idx),
            tipo: item.tipo,
            accion: item.accion || {}
          });
        }
      });
    } else {
      const keys = Object.keys(raw);
      keys.forEach((k, idx) => {
        const val = raw[k];
        if (val && val.tipo) {
          items.push({
            idIndex: String(idx),
            tipo: val.tipo,
            accion: val.accion || {}
          });
        }
      });
    }

    this.actionsList.set(items);
    this.emitActions();
  }

  readonly actionsList = signal<ActionItem[]>([]);
  readonly isDropdownOpen = signal<boolean>(false);
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
    if (target && target.closest('.remove-action-btn, .btn-media-toggle, button, input, select, textarea')) {
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
          return updated.map((item, i) => ({ ...item, idIndex: String(i) }));
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
    this.isDropdownOpen.update(open => !open);
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

  readonly actionTypes = [
    { type: 'Voz de sistema-0', label: 'Voz de sistema (TTS)' },
    { type: 'Ventana emergente-0', label: 'Ventana emergente en vivo' },
    { type: 'Habilitar/Deshabilitar Analisis-0', label: 'Habilitar/Deshabilitar Análisis' },
    { type: 'Tiempo de espera-0', label: 'Tiempo de espera (Delay)' },
    { type: 'Enviar a API-0', label: 'Enviar a API (Webhook POST)' },
    { type: 'Evento a VMS NX-0', label: 'Evento a VMS NX Witness' },
    { type: 'Grabar video-0', label: 'Grabar video (Clip Evidencia)' }
  ];

  addAction(actionType: string): void {
    const nextIndex = String(this.actionsList().length);
    let defaultAccion: any = {};

    if (actionType.startsWith('Voz de sistema')) {
      defaultAccion = { contenido: 'Predeterminado por sistema', _voiceMode: 'default' };
    } else if (actionType.startsWith('Ventana emergente') || actionType.startsWith('Grabar video')) {
      defaultAccion = { id_cam: this.cameraId || '' };
    } else if (actionType.startsWith('Habilitar/Deshabilitar')) {
      defaultAccion = { analitica: '', estado: 'inactive' };
    } else if (actionType.startsWith('Tiempo de espera')) {
      defaultAccion = { tiempo: '30' };
    } else if (actionType.startsWith('Enviar a API')) {
      defaultAccion = { endpoint: 'https://api.mi-sistema.com/alertas', id_report_type: 'rep-001' };
    } else if (actionType.startsWith('Evento a VMS NX')) {
      defaultAccion = {
        id_cam: this.cameraId || '',
        caption: 'Evento de IA',
        usuario: 'conexion',
        password: 'password123',
        ip_server_nx: '192.168.1.100'
      };
    }

    const newItem: ActionItem = {
      idIndex: nextIndex,
      tipo: actionType,
      accion: defaultAccion
    };

    this.actionsList.update(list => [...list, newItem]);
    this.emitActions();
  }

  removeAction(index: number): void {
    this.actionsList.update(list => {
      const filtered = list.filter((_, i) => i !== index);
      return filtered.map((item, i) => ({ ...item, idIndex: String(i) }));
    });
    this.emitActions();
  }

  emitActions(): void {
    const resultObj: any = {};
    this.actionsList().forEach(item => {
      const cleanAccion = { ...item.accion };
      delete cleanAccion._voiceMode;
      resultObj[item.idIndex] = {
        tipo: item.tipo,
        accion: cleanAccion
      };
    });
    this.actionsChanged.emit(resultObj);
  }
}
