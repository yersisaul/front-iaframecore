import { Component, Input, Output, EventEmitter, signal, computed, effect, inject, HostListener, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ListService } from '../../../../../core/services/list.service';
import { List } from '../../../../../core/domain/entities/list.models';

export interface AnalyticTypeOption {
  id: string;
  name: string;
  backendType: string;
  geometryType: 'polygon' | 'speed_quad' | 'line';
  icon: string;
  defaultModel: string;
  fixedModel?: string;
  category?: string;
  maxAreas: number;
}

export interface ModelClassOption {
  classIndex: number;
  className: string;
}

export interface NodeModelItem {
  fullPath: string;
  cleanName: string;
  category: string;
  classes: ModelClassOption[];
}

@Component({
  selector: 'app-analytic-params-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './analytic-params-form.component.html',
  styleUrls: ['./analytic-params-form.component.css']
})
export class AnalyticParamsFormComponent implements OnChanges {
  private readonly listService = inject(ListService);
  private restoredInitialRef: any = null;

  @Input() availableModels: any = null;
  @Input() initialValues: any = null;
  @Input() highlightError: boolean = false;

  @Output() formChanged = new EventEmitter<any>();
  @Output() geometryTypeChanged = new EventEmitter<'polygon' | 'speed_quad' | 'line'>();

  readonly availableModelsSignal = signal<any>(null);

  // Catálogo completo de las 16 analíticas especificadas en README_ANALYTICS.md
  readonly analyticTypes: AnalyticTypeOption[] = [
    { id: 'object_in_area', name: 'Objeto en área', backendType: 'Objeto en area', geometryType: 'polygon', icon: 'icon-camara', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'parking_management', name: 'Gestión de estacionamientos', backendType: 'Gestion de estacionamientos', geometryType: 'polygon', icon: 'icon-location-pin', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'object_surveillance', name: 'Vigilancia de Objeto', backendType: 'Vigilancia de Objeto', geometryType: 'polygon', icon: 'icon-cpu', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'persons_with_objects', name: 'Personas con objetos', backendType: 'Personas con objetos', geometryType: 'polygon', icon: 'icon-users', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'object_permanence', name: 'Permanencia de objeto', backendType: 'Permanencia de objeto', geometryType: 'polygon', icon: 'icon-clock', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'object_proximity', name: 'Cercanía entre objetos', backendType: 'Cercania entre objetos', geometryType: 'polygon', icon: 'icon-filter', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'vehicle_surveillance', name: 'Vigilancia vehicular', backendType: 'Vigilancia vehicular', geometryType: 'polygon', icon: 'icon-camara', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'crowd_gathering', name: 'Aglomeración', backendType: 'Aglomeracion', geometryType: 'polygon', icon: 'icon-users', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'object_out_of_area', name: 'Objeto fuera de área', backendType: 'Objeto fuera de area', geometryType: 'polygon', icon: 'icon-close', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'speed_measurement', name: 'Medición de velocidad', backendType: 'Medicion de velocidad', geometryType: 'speed_quad', icon: 'icon-speed', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 1 },
    { id: 'human_behavior', name: 'Comportamiento humano', backendType: 'Comportamiento humano', geometryType: 'polygon', icon: 'icon-users', defaultModel: 'generic_stgcn_model.pth', category: 'pose_estimation_models', maxAreas: 1 },
    { id: 'face_recognition', name: 'Reconocimiento facial', backendType: 'Reconocimiento facial', geometryType: 'polygon', icon: 'icon-user', defaultModel: 'dependencias/weights/face_detection/yolov8n-face-5keypoints.pt', fixedModel: 'dependencias/weights/face_detection/yolov8n-face-5keypoints.pt', category: 'face_recognition_models', maxAreas: 1 },
    { id: 'license_plate_recognition', name: 'Reconocimiento de placas', backendType: 'Reconocimiento de placas', geometryType: 'polygon', icon: 'icon-card', defaultModel: 'dependencias/weights/licence_detector/placas.pt', fixedModel: 'dependencias/weights/licence_detector/placas.pt', category: 'license_plate_models', maxAreas: 1 },
    { id: 'line_crossing', name: 'Cruce de Línea', backendType: 'Cruce de Linea', geometryType: 'line', icon: 'icon-chevron-right', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'capacity_control', name: 'Control de aforo', backendType: 'Control de aforo', geometryType: 'line', icon: 'icon-users', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 },
    { id: 'traffic_analysis', name: 'Análisis de tráfico', backendType: 'Analisis de trafico', geometryType: 'line', icon: 'icon-camara', defaultModel: 'yolo26m.pt', category: 'object_detection_models', maxAreas: 10 }
  ];

  // Estado del Formulario
  readonly selectedType = signal<string>('object_in_area');
  readonly selectedModel = signal<string>('yolo26m.pt');
  readonly selectedTracker = signal<string>('Sort');
  readonly selectedClassIndexes = signal<number[]>([]);

  // Sub-modelos Específicos Adicionales
  readonly poseEstimationModel = signal<string>('dependencias/weights/pose_estimation/generic_stgcn_model.pth');
  readonly featureExtractorModel = signal<string>('reid_osnet.pth');
  readonly nDeteccionesPersonasObjetos = signal<number>(5);

  // Desplegable de selección múltiple de clases
  readonly isClassesDropdownOpen = signal<boolean>(false);
  readonly classSearchQuery = signal<string>('');

  // Sliders Fluidos & Parámetros Generales
  readonly confThres = signal<number>(0.5);
  readonly iouThres = signal<number>(0.45);
  readonly maxAge = signal<number>(90);
  readonly minHits = signal<number>(2);
  readonly iouTrackerThreshold = signal<number>(0.15);
  readonly tiempoReactivacion = signal<number>(5.0);
  readonly scaleFactor = signal<number>(1.2);
  readonly zonaLinea = signal<number>(20);

  // Campos Específicos por Tipo de Analítica (README_ANALYTICS.md)
  readonly tiempoPermanencia = signal<number>(30);
  readonly pruebaMovimiento = signal<number>(5);
  readonly colorFiltro = signal<string>('Sin color');
  readonly nValidacionesEstacionamiento = signal<number>(90);
  readonly parteDeCuerpo = signal<string>('Cabeza');
  readonly pertenenciaObjeto = signal<string>('Con objeto');
  readonly escalaOrbita = signal<number>(1.15);
  readonly humbralMaximo = signal<number>(60);
  readonly humbralMinimo = signal<number>(10);
  readonly nObjetosCercanos = signal<number>(1);
  readonly tiempoVigilanciaVehicular = signal<number>(5);
  readonly tiempoDescenso = signal<number>(60);
  readonly similitudProp = signal<number>(85);
  readonly nEmbeddings = signal<number>(3);
  readonly minimoPersonas = signal<number>(6);
  readonly densidadAglomeracion = signal<number>(0.0025);
  readonly tiempoAbandono = signal<number>(60);
  readonly maxSpeed = signal<number>(40);
  readonly distanciaAB = signal<number>(14);
  readonly distanciaBC = signal<number>(60);
  readonly minPointsForSpeed = signal<number>(10);
  readonly tiempoComportamiento = signal<number>(3);
  readonly condicionEventoComportamiento = signal<string>('Cumple');
  readonly confianzaPostura = signal<number>(0.6);
  readonly confianzaRF = signal<number>(0.4);
  readonly nDeteccionesRF = signal<number>(3);
  readonly nReconocimientosRF = signal<number>(1);
  readonly aforoMaximo = signal<number>(20);
  readonly aforoActual = signal<number>(0);
  readonly strDirection = signal<string>('Bidireccional');
  readonly selectedListId = signal<string>('');
  readonly isFixedModelAnalytic = computed<boolean>(() => {
    const selId = this.selectedType();
    return selId === 'face_recognition' || selId === 'license_plate_recognition';
  });

  readonly isModelDropdownBelow = computed<boolean>(() => {
    return this.selectedType() === 'human_behavior';
  });

  readonly classTimesMap = signal<Record<number, number>>({});
  readonly draggedClassIndex = signal<number | null>(null);
  readonly previewClassTargetIndex = signal<number | null>(null);
  readonly draggedClassCardHeight = signal<number>(0);
  readonly isClassTransitionDisabled = signal<boolean>(false);
  private isClassPointerDragging = false;
  private classDragProxyEl: HTMLElement | null = null;

  getClassRowTransform(index: number): string | null {
    const dragged = this.draggedClassIndex();
    if (dragged === index) return null;

    const target = this.previewClassTargetIndex();
    if (dragged !== null && target !== null && dragged !== target) {
      const shiftHeight = this.draggedClassCardHeight() > 0 ? this.draggedClassCardHeight() + 8 : 45;
      if (dragged < target && index > dragged && index <= target) {
        return `translate3d(0, -${shiftHeight}px, 0)`;
      }
      if (dragged > target && index < dragged && index >= target) {
        return `translate3d(0, ${shiftHeight}px, 0)`;
      }
    }
    return null;
  }

  startClassPointerDrag(index: number, event: PointerEvent): void {
    if (this.selectedClassIndexes().length <= 1) return;

    const target = event.target as HTMLElement;
    if (target && target.closest('input, button, select, textarea')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const rowElements = Array.from(document.querySelectorAll('.class-time-row')) as HTMLElement[];
    const targetRowEl = rowElements[index] || (event.currentTarget as HTMLElement);
    if (!targetRowEl) return;

    const rect = targetRowEl.getBoundingClientRect();
    const grabOffsetX = event.clientX - rect.left;
    const grabOffsetY = event.clientY - rect.top;
    const draggedHeight = rect.height;

    this.draggedClassCardHeight.set(draggedHeight);

    const slotMidpoints = rowElements.map((el) => {
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });

    const thresholds: number[] = [];
    for (let i = 0; i < slotMidpoints.length - 1; i++) {
      thresholds.push((slotMidpoints[i] + slotMidpoints[i + 1]) / 2);
    }

    const proxy = targetRowEl.cloneNode(true) as HTMLElement;
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
    this.classDragProxyEl = proxy;

    this.isClassPointerDragging = true;
    this.draggedClassIndex.set(index);
    this.previewClassTargetIndex.set(index);

    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    const onPointerMove = (moveEv: PointerEvent) => {
      if (!this.isClassPointerDragging || !this.classDragProxyEl) return;

      const posX = moveEv.clientX - grabOffsetX;
      const posY = moveEv.clientY - grabOffsetY;
      this.classDragProxyEl.style.transform = `translate3d(${posX}px, ${posY}px, 0)`;

      const draggedCenterY = posY + draggedHeight / 2;
      let candidateIndex = 0;
      for (let i = 0; i < thresholds.length; i++) {
        if (draggedCenterY >= thresholds[i]) {
          candidateIndex = i + 1;
        }
      }

      if (this.previewClassTargetIndex() !== candidateIndex) {
        this.previewClassTargetIndex.set(candidateIndex);
      }
    };

    const onPointerUp = () => {
      if (!this.isClassPointerDragging) return;

      if (this.classDragProxyEl && this.classDragProxyEl.parentNode) {
        this.classDragProxyEl.parentNode.removeChild(this.classDragProxyEl);
        this.classDragProxyEl = null;
      }

      const sourceIdx = this.draggedClassIndex();
      const targetIdx = this.previewClassTargetIndex();
      this.isClassPointerDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      this.isClassTransitionDisabled.set(true);

      if (sourceIdx !== null && targetIdx !== null && sourceIdx !== targetIdx) {
        this.selectedClassIndexes.update(list => {
          const updated = [...list];
          const [movedItem] = updated.splice(sourceIdx, 1);
          updated.splice(targetIdx, 0, movedItem);
          return updated;
        });
      }

      this.draggedClassIndex.set(null);
      this.previewClassTargetIndex.set(null);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.isClassTransitionDisabled.set(false);
        });
      });
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  readonly watchlists = computed(() => this.listService.lists());

  // Catálogo Estructurado de Modelos y Clases del Nodo
  readonly nodeModelCatalog = computed<NodeModelItem[]>(() => {
    const raw = this.availableModelsSignal() || this.availableModels;
    if (!raw) return [];
    if (!raw) return [];

    const items: NodeModelItem[] = [];
    const infoModels = raw.info_models || raw.infoModels || raw;

    if (typeof infoModels === 'object' && infoModels !== null) {
      for (const catKey of Object.keys(infoModels)) {
        const catVal = infoModels[catKey];
        if (typeof catVal === 'object' && catVal !== null) {
          for (const modelPath of Object.keys(catVal)) {
            const classesObj = catVal[modelPath];
            const classList: ModelClassOption[] = [];

            if (typeof classesObj === 'object' && classesObj !== null) {
              for (const idxKey of Object.keys(classesObj)) {
                const idx = parseInt(idxKey, 10);
                if (!isNaN(idx)) {
                  classList.push({
                    classIndex: idx,
                    className: String(classesObj[idxKey])
                  });
                }
              }
            }

            classList.sort((a, b) => a.classIndex - b.classIndex);

            const cleanName = modelPath.split(/[/\\]/).pop() || modelPath;
            items.push({
              fullPath: modelPath,
              cleanName: cleanName,
              category: catKey,
              classes: classList
            });
          }
        }
      }
    }

    return items;
  });

  // Modelos dinámicos del nodo filtrados según el tipo de analítica seleccionada actualmente (Punto 1)
  readonly availableModelsForSelectedType = computed<NodeModelItem[]>(() => {
    const catalog = this.nodeModelCatalog();
    if (catalog.length === 0) return [];

    const typeObj = this.getSelectedAnalyticTypeObj();
    if (!typeObj) return catalog;

    if (typeObj.id === 'human_behavior' || typeObj.category === 'pose_estimation_models') {
      const poseModels = catalog.filter(m =>
        m.category === 'pose_estimation_models' ||
        m.category.toLowerCase().includes('pose') ||
        m.cleanName.endsWith('.pth')
      );
      return poseModels.length > 0 ? poseModels : catalog;
    }

    if (typeObj.id === 'face_recognition' || typeObj.category === 'face_recognition_models') {
      const faceModels = catalog.filter(m =>
        m.category.toLowerCase().includes('face') ||
        m.cleanName.toLowerCase().includes('face')
      );
      return faceModels.length > 0 ? faceModels : catalog;
    }

    if (typeObj.id === 'license_plate_recognition' || typeObj.category === 'license_plate_models') {
      const plateModels = catalog.filter(m =>
        m.category.toLowerCase().includes('plate') ||
        m.category.toLowerCase().includes('placa') ||
        m.cleanName.toLowerCase().includes('placas')
      );
      return plateModels.length > 0 ? plateModels : catalog;
    }

    // Por defecto (Analíticas de detección de objetos)
    const objectModels = catalog.filter(m =>
      !m.category.toLowerCase().includes('pose') &&
      !m.category.toLowerCase().includes('face') &&
      !m.category.toLowerCase().includes('plate') &&
      !m.category.toLowerCase().includes('placa')
    );
    return objectModels.length > 0 ? objectModels : catalog;
  });

  readonly modelCategories = computed(() => {
    const catalog = this.nodeModelCatalog();
    const typeObj = this.getSelectedAnalyticTypeObj();
    const isHumanBehavior = typeObj?.id === 'human_behavior';

    const map = new Map<string, NodeModelItem[]>();
    for (const item of catalog) {
      const isPose = item.category === 'pose_estimation_models' || item.category.toLowerCase().includes('pose') || item.cleanName.endsWith('.pth');

      if (isHumanBehavior) {
        if (!isPose) continue;
      } else {
        if (isPose) continue;
      }

      const catLabel = isPose
        ? '🧍 Modelos de Estimación de Pose'
        : (item.category === 'objet_detection_models' || item.category === 'object_detection_models')
          ? '🔷 Detección de Objetos'
          : item.category === 'face_recognition_models'
            ? '👤 Reconocimiento Facial'
            : item.category === 'license_plate_models'
              ? '🚘 Reconocimiento de Placas'
              : item.category;

      if (!map.has(catLabel)) {
        map.set(catLabel, []);
      }
      map.get(catLabel)!.push(item);
    }
    return Array.from(map.entries()).map(([label, models]) => ({ label, models }));
  });

  // Modelos del grupo pose_estimation_models para el selector específico de Comportamiento Humano (Punto 3)
  readonly availablePoseEstimationModels = computed<NodeModelItem[]>(() => {
    const catalog = this.nodeModelCatalog();
    return catalog.filter(m =>
      m.category === 'pose_estimation_models' ||
      m.category.toLowerCase().includes('pose') ||
      m.cleanName.endsWith('.pth')
    );
  });

  readonly availableModelList = computed<string[]>(() => {
    return this.nodeModelCatalog().map(m => m.cleanName);
  });

  readonly currentModelClasses = computed<ModelClassOption[]>(() => {
    if (this.isFixedModelAnalytic()) {
      return [];
    }
    const catalog = this.nodeModelCatalog();
    const selModel = this.selectedModel();
    if (!selModel && catalog.length > 0) return catalog[0].classes;
    const target = (selModel.split(/[/\\]/).pop() || selModel).toLowerCase();
    const found = catalog.find(
      m => m.cleanName.toLowerCase() === target ||
        m.fullPath.toLowerCase().endsWith(target)
    );
    return found ? found.classes : (catalog[0]?.classes || []);
  });

  readonly filteredModelClasses = computed<ModelClassOption[]>(() => {
    const classes = this.currentModelClasses();
    const query = this.classSearchQuery().trim().toLowerCase();
    if (!query) return classes;
    return classes.filter(c => c.className.toLowerCase().includes(query) || String(c.classIndex).includes(query));
  });

  getSelectedClassesSummary(): string {
    const selectedCount = this.selectedClassIndexes().length;
    if (this.selectedType() === 'object_proximity') {
      return `${selectedCount}/2 objetos`;
    }
    const total = this.currentModelClasses().length;
    return `${selectedCount}/${total} activas`;
  }

  isClassSelectionValid(): boolean {
    if (this.isFixedModelAnalytic()) {
      return true;
    }
    const count = this.selectedClassIndexes().length;
    if (this.selectedType() === 'object_proximity') {
      return count === 2;
    }
    return count >= 1;
  }

  getSelectedClassNames(): string {
    const selectedIndexes = this.selectedClassIndexes();
    const currentClasses = this.currentModelClasses();

    if (this.selectedType() === 'object_proximity') {
      if (selectedIndexes.length === 0) {
        return 'Elegir 2 objetos (1º Núcleo, 2º Órbita)';
      }
      if (selectedIndexes.length === 1) {
        const name0 = this.getObjectRoleName(0);
        return `1º Núcleo: ${name0} | (Falta 2º Órbita)`;
      }
      if (selectedIndexes.length >= 2) {
        const name0 = this.getObjectRoleName(0);
        const name1 = this.getObjectRoleName(1);
        return `1º Núcleo: ${name0} | 2º Órbita: ${name1}`;
      }
    }

    if (selectedIndexes.length === 0) {
      return 'Sin clases seleccionadas';
    }

    if (selectedIndexes.length === currentClasses.length && currentClasses.length > 0) {
      return 'Todas las clases';
    }
    const selectedNames = selectedIndexes.map(idx => {
      const found = currentClasses.find(c => c.classIndex === idx);
      return found ? found.className : String(idx);
    });

    return selectedNames.join(', ') || 'Sin clases seleccionadas';
  }

  getObjectRoleInfo(classIdx: number): { label: string; role: string; type: 'nucleus' | 'orbit' } | null {
    if (this.selectedType() !== 'object_proximity') return null;
    const indexes = this.selectedClassIndexes();
    const pos = indexes.indexOf(classIdx);
    if (pos === 0) {
      return { label: '1º Núcleo', role: 'Objeto Principal', type: 'nucleus' };
    }
    if (pos === 1) {
      return { label: '2º Órbita', role: 'Objeto Secundario', type: 'orbit' };
    }
    return null;
  }

  getObjectRoleName(index: number): string {
    const indexes = this.selectedClassIndexes();
    if (index < 0 || index >= indexes.length) return '';
    const classIdx = indexes[index];
    const found = this.currentModelClasses().find(c => c.classIndex === classIdx);
    return found ? found.className : `#${classIdx}`;
  }

  isClassSelectionDisabled(classIdx: number): boolean {
    if (this.selectedType() === 'object_proximity') {
      const indexes = this.selectedClassIndexes();
      return !indexes.includes(classIdx) && indexes.length >= 2;
    }
    return false;
  }

  getClassObj(classIdx: number): ModelClassOption | undefined {
    return this.currentModelClasses().find(c => c.classIndex === classIdx);
  }

  getClassTime(classIdx: number): number {
    return this.classTimesMap()[classIdx] ?? 1;
  }

  updateClassTime(classIdx: number, event: Event): void {
    const target = event.target as HTMLInputElement;
    const val = Math.max(1, Number(target.value) || 1);
    this.classTimesMap.update(map => ({
      ...map,
      [classIdx]: val
    }));
    this.emitFormValues();
  }

  readonly isTypeDropdownOpen = signal<boolean>(false);
  readonly isModelDropdownOpen = signal<boolean>(false);

  toggleTypeDropdown(event: Event): void {
    event.stopPropagation();
    this.isTypeDropdownOpen.update(open => !open);
    this.isClassesDropdownOpen.set(false);
    this.isModelDropdownOpen.set(false);
  }

  toggleClassesDropdown(event: Event): void {
    event.stopPropagation();
    this.isClassesDropdownOpen.update(open => !open);
    this.isTypeDropdownOpen.set(false);
    this.isModelDropdownOpen.set(false);
  }

  toggleModelDropdown(event: Event): void {
    event.stopPropagation();
    this.isModelDropdownOpen.update(open => !open);
    this.isTypeDropdownOpen.set(false);
    this.isClassesDropdownOpen.set(false);
  }

  selectAnalyticTypeAndClose(typeId: string, event?: Event): void {
    if (event) event.stopPropagation();
    this.selectAnalyticType(typeId);
    this.isTypeDropdownOpen.set(false);
  }

  selectModelAndClose(modelName: string, event?: Event): void {
    if (event) event.stopPropagation();
    this.selectModel(modelName);
    this.isModelDropdownOpen.set(false);
  }

  isModelOptionDisabled(m: NodeModelItem): boolean {
    if (this.getSelectedAnalyticTypeObj()?.fixedModel) {
      const cleanSel = this.selectedModel().split(/[/\\]/).pop() || this.selectedModel();
      return m.cleanName !== cleanSel;
    }
    return !this.isModelCompatibleWithSelectedType(m);
  }

  @HostListener('document:click')
  closeDropdowns(): void {
    this.isClassesDropdownOpen.set(false);
    this.isTypeDropdownOpen.set(false);
    this.isModelDropdownOpen.set(false);
  }

  getSelectedAnalyticTypeLabel(): string {
    const selId = this.selectedType();
    const typeObj = this.analyticTypes.find(t => t.id === selId);
    if (!typeObj) return 'Seleccionar analítica';

    let label = typeObj.name;

    if (selId === 'human_behavior') {
      label += ' (yolo26m-pose.pt)';
    } else if (selId === 'face_recognition') {
      label += ' (yolov8n-face-5keypoints.pt)';
    } else if (selId === 'license_plate_recognition') {
      label += ' (placas.pt)';
    }

    return label;
  }

  getAnalyticOptionLabel(type: AnalyticTypeOption): string {
    const isSelected = this.selectedType() === type.id;
    let label = type.name;

    if (!this.isAnalyticTypeSupported(type)) {
      label += ' (No instalado)';
    } else if (isSelected) {
      if (type.id === 'human_behavior') {
        label += ' (yolo26m-pose.pt)';
      } else if (type.id === 'face_recognition') {
        label += ' (yolov8n-face-5keypoints.pt)';
      } else if (type.id === 'license_plate_recognition') {
        label += ' (placas.pt)';
      }
    }

    return label;
  }

  isAnalyticTypeSupported(type: AnalyticTypeOption): boolean {
    // Analíticas con modelos fijos hardcodeados siempre se consideran instaladas/soportadas (no dependen del endpoint de detectores)
    if (type.id === 'human_behavior' || type.category === 'pose_estimation_models') {
      return true;
    }
    if (type.id === 'face_recognition' || type.category === 'face_recognition_models') {
      return true;
    }
    if (type.id === 'license_plate_recognition' || type.category === 'license_plate_models') {
      return true;
    }

    const catalog = this.nodeModelCatalog();
    if (catalog.length === 0) return true;

    return catalog.some(m =>
      m.category.toLowerCase().includes('objet') ||
      m.category.toLowerCase().includes('object') ||
      m.cleanName.endsWith('.pt') ||
      m.cleanName.endsWith('.onnx') ||
      m.cleanName.endsWith('.engine')
    );
  }

  isModelCompatibleWithSelectedType(model: NodeModelItem): boolean {
    const typeObj = this.getSelectedAnalyticTypeObj();
    if (!typeObj) return true;

    if (typeObj.id === 'human_behavior' || typeObj.category === 'pose_estimation_models') {
      return model.category === 'pose_estimation_models' ||
        model.category.toLowerCase().includes('pose') ||
        model.cleanName.endsWith('.pth');
    }
    if (typeObj.id === 'face_recognition' || typeObj.category === 'face_recognition_models') {
      return model.category.toLowerCase().includes('face') || model.cleanName.toLowerCase().includes('face');
    }
    if (typeObj.id === 'license_plate_recognition' || typeObj.category === 'license_plate_models') {
      return model.category.toLowerCase().includes('plate') || model.category.toLowerCase().includes('placa') || model.cleanName.toLowerCase().includes('placas');
    }

    return model.category.toLowerCase().includes('objet') ||
      model.category.toLowerCase().includes('object') ||
      model.cleanName.endsWith('.pt') ||
      model.cleanName.endsWith('.onnx') ||
      model.cleanName.endsWith('.engine');
  }

  readonly supportedAnalyticTypesCount = computed(() => {
    return this.analyticTypes.filter(t => this.isAnalyticTypeSupported(t)).length;
  });

  constructor() {
    // Cargar listas de control al inicializar
    this.listService.loadLists().subscribe();

    // Sincronización inicial del catálogo de modelos
    effect(() => {
      const catalog = this.nodeModelCatalog();
      if (this.initialValues) {
        if (this.restoredInitialRef !== this.initialValues) {
          this.restoreInitialValues();
        }
        return;
      }

      const typeObj = this.getSelectedAnalyticTypeObj();
      if (typeObj?.fixedModel) {
        const cleanFixed = typeObj.fixedModel.split(/[/\\]/).pop() || typeObj.fixedModel;
        this.selectedModel.set(cleanFixed);
        return;
      }

      if (catalog.length > 0) {
        const available = this.availableModelsForSelectedType();
        if (available.length > 0) {
          const currentSel = this.selectedModel();
          const target = (currentSel.split(/[/\\]/).pop() || currentSel).toLowerCase();
          const exists = available.some(m => m.cleanName.toLowerCase() === target || m.fullPath.toLowerCase().endsWith(target));
          if (!exists) {
            this.selectModel(available[0].cleanName);
          }
        }
      }
    });

    // Sincronizar geometrías e informar al Canvas y emitir cambios de cualquier control del formulario
    effect(() => {
      const typeObj = this.analyticTypes.find(t => t.id === this.selectedType());
      if (typeObj) {
        this.geometryTypeChanged.emit(typeObj.geometryType);
        if (typeObj.fixedModel) {
          const cleanFixed = typeObj.fixedModel.split(/[/\\]/).pop() || typeObj.fixedModel;
          this.selectedModel.set(cleanFixed);
        }
      }

      // Suscribirse de forma reactiva a la modificación de cualquier control del formulario
      this.selectedType();
      this.selectedModel();
      this.selectedTracker();
      this.selectedClassIndexes();
      this.confThres();
      this.iouThres();
      this.maxAge();
      this.minHits();
      this.iouTrackerThreshold();
      this.tiempoReactivacion();
      this.scaleFactor();
      this.zonaLinea();
      this.tiempoPermanencia();
      this.pruebaMovimiento();
      this.colorFiltro();
      this.nValidacionesEstacionamiento();
      this.parteDeCuerpo();
      this.pertenenciaObjeto();
      this.escalaOrbita();
      this.humbralMaximo();
      this.humbralMinimo();
      this.nObjetosCercanos();
      this.tiempoVigilanciaVehicular();
      this.tiempoDescenso();
      this.similitudProp();
      this.nEmbeddings();
      this.minimoPersonas();
      this.densidadAglomeracion();
      this.tiempoAbandono();
      this.maxSpeed();
      this.distanciaAB();
      this.distanciaBC();
      this.minPointsForSpeed();
      this.tiempoComportamiento();
      this.condicionEventoComportamiento();
      this.confianzaPostura();
      this.confianzaRF();
      this.nDeteccionesRF();
      this.nReconocimientosRF();
      this.aforoMaximo();
      this.aforoActual();
      this.strDirection();
      this.selectedListId();

      this.emitFormValues();
    });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['availableModels']) {
      this.availableModelsSignal.set(this.availableModels);
    }

    if (changes['initialValues']) {
      this.restoredInitialRef = null;
      if (this.initialValues) {
        this.restoreInitialValues();
      } else {
        this.selectedType.set('object_in_area');
        this.selectedClassIndexes.set([]);
        this.geometryTypeChanged.emit('polygon');
      }
    }
  }

  findAnalyticType(rawType: string): AnalyticTypeOption {
    if (!rawType) return this.analyticTypes[0];

    const clean = String(rawType)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[-_]/g, ' ')
      .trim();

    const found = this.analyticTypes.find(t => {
      const cleanId = t.id.replace(/[-_]/g, ' ').toLowerCase();
      const cleanBackend = t.backendType.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_]/g, ' ').trim();
      const cleanName = t.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_]/g, ' ').trim();

      return clean === cleanId || clean === cleanBackend || clean === cleanName;
    });

    return found || this.analyticTypes[0];
  }

  private restoreInitialValues(): void {
    if (!this.initialValues) return;
    this.restoredInitialRef = this.initialValues;

    const rawType = this.initialValues.analytic_type || this.initialValues.type || 'object_in_area';
    const typeObj = this.findAnalyticType(rawType);

    this.selectedType.set(typeObj.id);

    const params = this.initialValues.parameters || {};

    const rawModel = params['Modelo'] || params['model'];
    if (typeObj?.id === 'human_behavior') {
      const poseModelParam = params['pose_estimation_model'] || rawModel;
      if (poseModelParam) {
        this.poseEstimationModel.set(String(poseModelParam));
        const cleanPose = String(poseModelParam).split(/[/\\]/).pop() || String(poseModelParam);
        this.selectedModel.set(cleanPose);
      }
    } else if (typeObj?.fixedModel) {
      const cleanFixed = typeObj.fixedModel.split(/[/\\]/).pop() || typeObj.fixedModel;
      this.selectedModel.set(cleanFixed);
    } else if (rawModel) {
      const cleanModel = String(rawModel).split(/[/\\]/).pop() || String(rawModel);
      this.selectedModel.set(cleanModel);
    }

    // Restaurar clases seleccionadas preservando el orden de selección y los nombres de clase
    const rawClasses = this.initialValues.detection_classes || this.initialValues.detectionClasses;
    if (Array.isArray(rawClasses) && rawClasses.length > 0) {
      const modelClasses = this.currentModelClasses();
      const restoredIndexes: number[] = [];
      const restoredTimes: Record<number, number> = {};

      rawClasses.forEach((item: any) => {
        let idx: number | undefined = undefined;
        if (typeof item === 'number') {
          idx = item;
          restoredIndexes.push(item);
        } else if (item && typeof item === 'object') {
          const name = String(item.class_name || item.className || '').trim();
          if (name) {
            const found = modelClasses.find(mc => mc.className.toLowerCase() === name.toLowerCase());
            if (found) {
              idx = found.classIndex;
              restoredIndexes.push(found.classIndex);
            } else if (item.class_index !== undefined && item.class_index !== null) {
              idx = Number(item.class_index);
              restoredIndexes.push(idx);
            } else if (item.classIndex !== undefined && item.classIndex !== null) {
              idx = Number(item.classIndex);
              restoredIndexes.push(idx);
            }
          } else if (item.class_index !== undefined && item.class_index !== null) {
            idx = Number(item.class_index);
            restoredIndexes.push(idx);
          } else if (item.classIndex !== undefined && item.classIndex !== null) {
            idx = Number(item.classIndex);
            restoredIndexes.push(idx);
          }

          if (idx !== undefined && item.tiempo !== undefined && item.tiempo !== null) {
            restoredTimes[idx] = Number(item.tiempo);
          }
        } else if (typeof item === 'string') {
          const name = item.toLowerCase();
          const found = modelClasses.find(mc => mc.className.toLowerCase() === name);
          if (found) restoredIndexes.push(found.classIndex);
        }
      });

      if (restoredIndexes.length > 0) {
        this.selectedClassIndexes.set(restoredIndexes);
      }
      if (Object.keys(restoredTimes).length > 0) {
        this.classTimesMap.set(restoredTimes);
      }
    }

    if (params['tipo_de_tracker'] || params['tipo']) this.selectedTracker.set(params['tipo_de_tracker'] || params['tipo']);
    if (params['conf_thres'] !== undefined) this.confThres.set(Number(params['conf_thres']));
    if (params['iou_thres'] !== undefined) this.iouThres.set(Number(params['iou_thres']));
    if (params['max_age'] !== undefined) this.maxAge.set(Number(params['max_age']));
    if (params['min_hits'] !== undefined) this.minHits.set(Number(params['min_hits']));
    if (params['iou_threshold'] !== undefined) this.iouTrackerThreshold.set(Number(params['iou_threshold']));
    if (params['tiempo_reactivacion'] !== undefined) this.tiempoReactivacion.set(Number(params['tiempo_reactivacion']));
    if (params['scale_area'] !== undefined || params['Escala'] !== undefined || params['scale_factor'] !== undefined) {
      this.scaleFactor.set(Number(params['scale_area'] ?? params['Escala'] ?? params['scale_factor']));
    }
    if (params['zona_analisis'] !== undefined || params['Zona'] !== undefined || params['zona'] !== undefined) {
      this.zonaLinea.set(Number(params['zona_analisis'] ?? params['Zona'] ?? params['zona']));
    }
    if (params['str_direction'] !== undefined) this.strDirection.set(params['str_direction']);

    if (params['list_id'] !== undefined) this.selectedListId.set(params['list_id']);

    if (params['Tiempo'] !== undefined) {
      const val = Number(params['Tiempo']);
      this.tiempoPermanencia.set(val);
      this.tiempoVigilanciaVehicular.set(val);
      this.tiempoComportamiento.set(val);
    }
    if (params['prueba_movimiento'] !== undefined) this.pruebaMovimiento.set(Number(params['prueba_movimiento']));
    if (params['Color'] !== undefined || params['color'] !== undefined) this.colorFiltro.set(params['Color'] ?? params['color']);
    if (params['N_validaciones'] !== undefined) this.nValidacionesEstacionamiento.set(Number(params['N_validaciones']));
    if (params['ParteDeCuerpo'] !== undefined) this.parteDeCuerpo.set(params['ParteDeCuerpo']);
    if (params['Pertenencia'] !== undefined) this.pertenenciaObjeto.set(params['Pertenencia']);
    if (params['escala_orbita'] !== undefined) this.escalaOrbita.set(Number(params['escala_orbita']));
    if (params['N_Detecciones'] !== undefined) {
      const numDet = Number(params['N_Detecciones']);
      this.nDeteccionesPersonasObjetos.set(numDet);
      this.nDeteccionesRF.set(numDet);
    }
    if (params['humbral_maximo'] !== undefined) this.humbralMaximo.set(Number(params['humbral_maximo']));
    if (params['humbral_minmo'] !== undefined) this.humbralMinimo.set(Number(params['humbral_minmo']));
    if (params['N_objetos'] !== undefined) this.nObjetosCercanos.set(Number(params['N_objetos']));
    if (params['tiempo_descenso'] !== undefined) this.tiempoDescenso.set(Number(params['tiempo_descenso']));
    if (params['similitud'] !== undefined) this.similitudProp.set(Number(params['similitud']));
    if (params['N_embedings'] !== undefined) this.nEmbeddings.set(Number(params['N_embedings']));
    if (params['minimo_personas'] !== undefined) this.minimoPersonas.set(Number(params['minimo_personas']));
    if (params['densidad'] !== undefined) this.densidadAglomeracion.set(Number(params['densidad']));
    if (params['tiempo_abandono'] !== undefined) this.tiempoAbandono.set(Number(params['tiempo_abandono']));
    if (params['max_speed'] !== undefined) this.maxSpeed.set(Number(params['max_speed']));
    if (params['distancia_a_b'] !== undefined) this.distanciaAB.set(Number(params['distancia_a_b']));
    if (params['distancia_b_c'] !== undefined) this.distanciaBC.set(Number(params['distancia_b_c']));
    if (params['min_points_for_speed'] !== undefined) this.minPointsForSpeed.set(Number(params['min_points_for_speed']));
    if (params['pose_estimation_model'] !== undefined) this.poseEstimationModel.set(params['pose_estimation_model']);
    if (params['condicion_evento'] !== undefined) this.condicionEventoComportamiento.set(params['condicion_evento']);
    if (params['confianza_postura'] !== undefined) this.confianzaPostura.set(Number(params['confianza_postura']));
    if (params['confianza'] !== undefined) this.confianzaRF.set(Number(params['confianza']));
    if (params['n_reconocimientos'] !== undefined) this.nReconocimientosRF.set(Number(params['n_reconocimientos']));
    if (params['Aforo'] !== undefined) this.aforoMaximo.set(Number(params['Aforo']));
    if (params['Aforo actual'] !== undefined) this.aforoActual.set(Number(params['Aforo actual']));

    if (typeObj) {
      this.geometryTypeChanged.emit(typeObj.geometryType);
    }
    this.emitFormValues();
  }

  getSelectedAnalyticTypeObj(): AnalyticTypeOption | undefined {
    return this.analyticTypes.find(t => t.id === this.selectedType());
  }

  selectAnalyticType(typeId: string): void {
    this.selectedType.set(typeId);
    this.selectedClassIndexes.set([]); // Deseleccionar todas las clases al cambiar de tipo de analítica para evitar despasamientos u homónimos obsoletos

    const typeObj = this.analyticTypes.find(t => t.id === typeId);
    if (typeObj) {
      this.geometryTypeChanged.emit(typeObj.geometryType); // Emite INMEDIATAMENTE en tiempo real al seleccionar en el desplegable
      if (typeObj.fixedModel) {
        const cleanFixed = typeObj.fixedModel.split(/[/\\]/).pop() || typeObj.fixedModel;
        this.selectedModel.set(cleanFixed);
        this.emitFormValues();
        return;
      }
    }

    const availableForType = this.availableModelsForSelectedType();
    if (availableForType.length > 0) {
      const currentSel = this.selectedModel();
      const target = (currentSel.split(/[/\\]/).pop() || currentSel).toLowerCase();
      const exists = availableForType.some(m => m.cleanName.toLowerCase() === target || m.fullPath.toLowerCase().endsWith(target));
      if (!exists) {
        this.selectedModel.set(availableForType[0].cleanName);
      }
    }

    this.emitFormValues();
  }

  selectModel(modelName: string): void {
    this.selectedModel.set(modelName);
    // Al cambiar o modificar el modelo de IA, deseleccionar todas las clases para que el usuario elija explícitamente las correspondientes al nuevo modelo
    this.selectedClassIndexes.set([]);

    const catalog = this.nodeModelCatalog();
    const foundItem = catalog.find(m => m.cleanName.toLowerCase() === modelName.toLowerCase() || m.fullPath.toLowerCase().endsWith(modelName.toLowerCase()));

    if (this.selectedType() === 'human_behavior') {
      if (foundItem) {
        this.poseEstimationModel.set(foundItem.fullPath);
      } else {
        this.poseEstimationModel.set(`dependencias/weights/pose_estimation/${modelName}`);
      }
    }

    this.emitFormValues();
  }

  toggleClassSelection(classIdx: number): void {
    this.selectedClassIndexes.update(indexes => {
      if (indexes.includes(classIdx)) {
        return indexes.filter(i => i !== classIdx);
      } else {
        if (this.selectedType() === 'object_proximity' && indexes.length >= 2) {
          return indexes; // Bloqueo estricto: máximo 2 objetos para Cercanía entre Objetos
        }
        return [...indexes, classIdx];
      }
    });
  }

  selectAllClasses(): void {
    const classes = this.currentModelClasses();
    if (this.selectedType() === 'object_proximity') {
      if (classes.length >= 2) {
        this.selectedClassIndexes.set([classes[0].classIndex, classes[1].classIndex]);
      } else if (classes.length === 1) {
        this.selectedClassIndexes.set([classes[0].classIndex]);
      }
    } else {
      this.selectedClassIndexes.set(classes.map(c => c.classIndex));
    }
  }

  deselectAllClasses(): void {
    this.selectedClassIndexes.set([]);
  }

  emitFormValues(): void {
    const selectedModelStr = this.selectedModel();
    const catalog = this.nodeModelCatalog();

    const selectedModelItem = catalog.find(
      m => m.cleanName.toLowerCase() === selectedModelStr.toLowerCase() ||
        m.fullPath.toLowerCase() === selectedModelStr.toLowerCase()
    );

    const typeObj = this.getSelectedAnalyticTypeObj();

    let fullModelPath = typeObj?.fixedModel || selectedModelItem?.fullPath || selectedModelStr;
    if (!typeObj?.fixedModel && !fullModelPath.includes('/') && !fullModelPath.includes('\\')) {
      const rawModelInInitial = this.initialValues?.parameters?.['Modelo'] || this.initialValues?.parameters?.['model'];
      if (rawModelInInitial && String(rawModelInInitial).endsWith(selectedModelStr)) {
        fullModelPath = String(rawModelInInitial);
      } else {
        fullModelPath = `dependencias/weights/objetc_detection/${fullModelPath}`;
      }
    }

    // Obtener clases seleccionadas activas preservando el orden de selección
    const availableClasses = selectedModelItem?.classes || [];
    const selectedIndexes = this.selectedClassIndexes();
    const selType = this.selectedType();

    let activeClasses: { class_index: number; class_name: string }[] = [];

    if (this.isFixedModelAnalytic()) {
      activeClasses = [];
    } else if (selType === 'object_proximity') {
      // Para Cercanía entre Objetos: Núcleo es siempre class_index: 0 y Órbita es class_index: 1
      activeClasses = selectedIndexes.map((idx, seqIdx) => {
        const found = availableClasses.find(c => c.classIndex === idx);
        return {
          class_index: seqIdx, // 0 para 1º Núcleo, 1 para 2º Órbita
          class_name: found ? found.className : String(idx)
        };
      });
    } else if (selType === 'human_behavior') {
      // Para Comportamiento Humano: incluye el atributo "tiempo" en segundos por cada clase
      activeClasses = selectedIndexes.map(idx => {
        const found = availableClasses.find(c => c.classIndex === idx);
        const t = this.classTimesMap()[idx] ?? 1;
        return {
          class_index: found ? found.classIndex : idx,
          class_name: found ? found.className : String(idx),
          tiempo: t
        };
      });
    } else {
      // Para analíticas estándar: se preservan los classIndex y classNames del modelo
      activeClasses = selectedIndexes.map(idx => {
        const found = availableClasses.find(c => c.classIndex === idx);
        return {
          class_index: found ? found.classIndex : idx,
          class_name: found ? found.className : String(idx)
        };
      });
    }

    // Construir mapa de parámetros exactos especificados en README_ANALYTICS.md
    const specificParams: Record<string, any> = {
      'Modelo': fullModelPath
    };

    if (selType === 'object_in_area') {
      specificParams['Tiempo'] = this.tiempoPermanencia();
      specificParams['prueba_movimiento'] = this.pruebaMovimiento();
      specificParams['Color'] = this.colorFiltro();
    } else if (selType === 'parking_management') {
      specificParams['N_validaciones'] = this.nValidacionesEstacionamiento();
    } else if (selType === 'object_surveillance') {
      specificParams['prueba_movimiento'] = this.pruebaMovimiento();
    } else if (selType === 'persons_with_objects') {
      specificParams['escala_orbita'] = this.escalaOrbita();
      specificParams['ParteDeCuerpo'] = this.parteDeCuerpo();
      specificParams['Pertenencia'] = this.pertenenciaObjeto();
      specificParams['N_Detecciones'] = this.nDeteccionesPersonasObjetos();
    } else if (selType === 'object_permanence') {
      specificParams['humbral_maximo'] = this.humbralMaximo();
      specificParams['humbral_minmo'] = this.humbralMinimo();
    } else if (selType === 'object_proximity') {
      specificParams['N_objetos'] = this.nObjetosCercanos();
      specificParams['escala_orbita'] = this.escalaOrbita();
    } else if (selType === 'vehicle_surveillance') {
      specificParams['Tiempo'] = this.tiempoVigilanciaVehicular();
      specificParams['tiempo_descenso'] = this.tiempoDescenso();
      specificParams['similitud'] = this.similitudProp();
      specificParams['N_embedings'] = this.nEmbeddings();
    } else if (selType === 'crowd_gathering') {
      specificParams['minimo_personas'] = this.minimoPersonas();
      specificParams['densidad'] = this.densidadAglomeracion();
    } else if (selType === 'object_out_of_area') {
      specificParams['tiempo_abandono'] = this.tiempoAbandono();
    } else if (selType === 'speed_measurement') {
      specificParams['max_speed'] = this.maxSpeed();
      specificParams['distancia_a_b'] = this.distanciaAB();
      specificParams['distancia_b_c'] = this.distanciaBC();
      specificParams['min_points_for_speed'] = this.minPointsForSpeed();
    } else if (selType === 'human_behavior') {
      specificParams['Modelo'] = 'dependencias/weights/keypoints_detection/yolo26m-pose.pt';
      specificParams['pose_estimation_model'] = this.poseEstimationModel();
      specificParams['Tiempo'] = this.tiempoComportamiento();
      specificParams['condicion_evento'] = this.condicionEventoComportamiento();
      specificParams['confianza_postura'] = this.confianzaPostura();
    } else if (selType === 'face_recognition') {
      specificParams['Modelo'] = 'dependencias/weights/face_detection/yolov8n-face-5keypoints.pt';
      specificParams['confianza'] = this.confianzaRF();
      specificParams['N_Detecciones'] = this.nDeteccionesRF();
      specificParams['n_reconocimientos'] = this.nReconocimientosRF();
      specificParams['list_id'] = this.selectedListId();
    } else if (selType === 'license_plate_recognition') {
      specificParams['Modelo'] = 'dependencias/weights/licence_detector/placas.pt';
      specificParams['list_id'] = this.selectedListId();
    } else if (selType === 'line_crossing') {
      specificParams['Color'] = this.colorFiltro();
      specificParams['str_direction'] = this.strDirection();
    } else if (selType === 'capacity_control') {
      specificParams['Aforo'] = this.aforoMaximo();
      specificParams['Aforo actual'] = this.aforoActual();
      specificParams['str_direction'] = this.strDirection();
    } else if (selType === 'traffic_analysis') {
      specificParams['str_direction'] = this.strDirection();
    }

    const isLineType = typeObj?.geometryType === 'line';
    const detectionParams: Record<string, any> = {
      conf_thres: this.confThres(),
      iou_thres: this.iouThres(),
      tiempo_reactivacion: this.tiempoReactivacion()
    };

    if (isLineType) {
      detectionParams['zona_analisis'] = this.zonaLinea();
    } else {
      detectionParams['scale_area'] = this.scaleFactor();
    }

    const payload = {
      analytic_type: typeObj?.backendType || this.selectedType(),
      maxAreas: typeObj ? typeObj.maxAreas : 10,
      model: fullModelPath,
      detection_classes: activeClasses,
      tracker: {
        tipo_de_tracker: this.selectedTracker(),
        max_age: this.maxAge(),
        min_hits: this.minHits(),
        iou_threshold: this.iouTrackerThreshold()
      },
      detection_params: detectionParams,
      specific_params: specificParams
    };
    this.formChanged.emit(payload);
  }
}
