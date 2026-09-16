import { Component, Input, Output, EventEmitter, signal, computed, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Camera } from '../../../core/domain/entities/camera.models';
import { Host } from '../../../core/domain/entities/host.models';
import { Analytic } from '../../../core/domain/entities/analytic.models';
import { getCameraEffectiveStatus, getCameraStatusCssClass, getCameraStatusFilterLabel } from '../../../core/utils/camera-status.utils';

@Component({
  selector: 'app-camera-selection-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './camera-selection-modal.component.html',
  styleUrl: './camera-selection-modal.component.css'
})
export class CameraSelectionModalComponent implements OnChanges {
  // Reactive Backing Signals for Inputs
  readonly showSignal = signal<boolean>(false);
  readonly camerasSignal = signal<Camera[]>([]);
  readonly hostsSignal = signal<Host[]>([]);
  readonly analyticsSignal = signal<Analytic[]>([]);
  readonly initialSelectedIdsSignal = signal<Set<string>>(new Set());

  @Input() set show(val: boolean) {
    this.showSignal.set(val);
    if (val) {
      this.resetModalState();
    }
  }
  get show(): boolean {
    return this.showSignal();
  }

  @Input() set cameras(val: Camera[] | null | undefined) {
    this.camerasSignal.set(val || []);
  }
  get cameras(): Camera[] {
    return this.camerasSignal();
  }

  @Input() set hosts(val: Host[] | null | undefined) {
    this.hostsSignal.set(val || []);
  }
  get hosts(): Host[] {
    return this.hostsSignal();
  }

  @Input() set analytics(val: Analytic[] | null | undefined) {
    this.analyticsSignal.set(val || []);
  }
  get analytics(): Analytic[] {
    return this.analyticsSignal();
  }

  @Input() set initialSelectedIds(val: Set<string> | null | undefined) {
    const nextSet = val ? new Set(val) : new Set<string>();
    this.initialSelectedIdsSignal.set(nextSet);
    this.selectedCameraIds.set(nextSet);
  }
  get initialSelectedIds(): Set<string> {
    return this.initialSelectedIdsSignal();
  }

  @Output() close = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<Set<string>>();

  // Internal Signals
  readonly activeModalTab = signal<'nodos' | 'todas'>('nodos');
  readonly expandedNodes = signal<Set<string>>(new Set());
  readonly selectedCameraIds = signal<Set<string>>(new Set());

  // Search, Filter & Sort States
  readonly modalSearchQuery = signal<string>('');
  readonly modalTypeFilter = signal<string>('all');
  readonly showModalTypeDropdown = signal<boolean>(false);
  readonly modalStatusFilter = signal<string>('all');
  readonly showModalStatusDropdown = signal<boolean>(false);
  readonly modalSortDirection = signal<'asc' | 'desc'>('asc');

  private backdropMouseDownTarget: EventTarget | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['show'] && this.show) {
      this.resetModalState();
    }
  }

  private resetModalState(): void {
    this.modalSearchQuery.set('');
    this.modalTypeFilter.set('all');
    this.modalStatusFilter.set('all');
    this.showModalTypeDropdown.set(false);
    this.showModalStatusDropdown.set(false);
    this.activeModalTab.set('nodos');
    this.selectedCameraIds.set(new Set(this.initialSelectedIdsSignal()));
    // All node groups start collapsed by default
    this.expandedNodes.set(new Set());
  }

  // --- Modal Backdrop Management ---
  onBackdropMouseDown(event: MouseEvent): void {
    if (event.button === 0) {
      this.backdropMouseDownTarget = event.target;
    }
  }

  onBackdropMouseUp(event: MouseEvent): void {
    if (
      event.button === 0 &&
      this.backdropMouseDownTarget === event.currentTarget &&
      event.target === event.currentTarget
    ) {
      this.onCancel();
    }
    this.backdropMouseDownTarget = null;
  }

  // --- Sort & Filter Actions ---
  toggleModalSortDirection(): void {
    this.modalSortDirection.update(dir => dir === 'asc' ? 'desc' : 'asc');
  }

  toggleModalTypeDropdown(event?: Event): void {
    if (event) event.stopPropagation();
    this.showModalTypeDropdown.update(v => !v);
    this.showModalStatusDropdown.set(false);
  }

  selectModalType(type: string, event?: Event): void {
    if (event) event.stopPropagation();
    this.modalTypeFilter.set(type);
    this.showModalTypeDropdown.set(false);
  }

  toggleModalStatusDropdown(event?: Event): void {
    if (event) event.stopPropagation();
    this.showModalStatusDropdown.update(v => !v);
    this.showModalTypeDropdown.set(false);
  }

  selectModalStatus(status: string, event?: Event): void {
    if (event) event.stopPropagation();
    this.modalStatusFilter.set(status);
    this.showModalStatusDropdown.set(false);
  }

  toggleNodeCollapse(fingerprint: string): void {
    this.expandedNodes.update(s => {
      const next = new Set(s);
      if (next.has(fingerprint)) {
        next.delete(fingerprint);
      } else {
        next.add(fingerprint);
      }
      return next;
    });
  }

  // --- Camera Selection Logic ---
  toggleCameraSelectionLocal(camera: Camera): void {
    this.selectedCameraIds.update(set => {
      const next = new Set(set);
      if (next.has(camera.id)) {
        next.delete(camera.id);
      } else {
        next.add(camera.id);
      }
      return next;
    });
  }

  areAllNodeCamerasSelected(nodeCameras: Camera[]): boolean {
    if (nodeCameras.length === 0) return false;
    const selected = this.selectedCameraIds();
    return nodeCameras.every(c => selected.has(c.id));
  }

  someNodeCamerasSelected(nodeCameras: Camera[]): boolean {
    if (nodeCameras.length === 0) return false;
    const selected = this.selectedCameraIds();
    const count = nodeCameras.filter(c => selected.has(c.id)).length;
    return count > 0 && count < nodeCameras.length;
  }

  selectAllCamerasInNode(nodeCameras: Camera[], event: Event): void {
    event.stopPropagation();
    const nextIds = new Set(this.selectedCameraIds());
    const allSelected = this.areAllNodeCamerasSelected(nodeCameras);
    if (allSelected) {
      nodeCameras.forEach(c => nextIds.delete(c.id));
    } else {
      nodeCameras.forEach(c => nextIds.add(c.id));
    }
    this.selectedCameraIds.set(nextIds);
  }

  areAllSystemCamerasSelected(): boolean {
    const cams = this.filteredCamerasForModal();
    if (cams.length === 0) return false;
    const selected = this.selectedCameraIds();
    return cams.every(c => selected.has(c.id));
  }

  toggleAllSystemCameras(): void {
    const cams = this.filteredCamerasForModal();
    const nextIds = new Set(this.selectedCameraIds());
    const allSelected = this.areAllSystemCamerasSelected();
    if (allSelected) {
      cams.forEach(c => nextIds.delete(c.id));
    } else {
      cams.forEach(c => nextIds.add(c.id));
    }
    this.selectedCameraIds.set(nextIds);
  }

  onCancel(): void {
    this.close.emit();
  }

  onConfirm(): void {
    this.confirm.emit(new Set(this.selectedCameraIds()));
  }

  // --- Analytic & Status Helpers ---
  getAnalyticLabel(type: string): string {
    const map: Record<string, string> = {
      'face_recognition': 'Facial',
      'lpr': 'LPR',
      'intrusion_detection': 'Intrusión',
      'fall_detection': 'Caída',
      'weapon_detection': 'Armas',
      'fire_detection': 'Fuego',
      'smoke_detection': 'Humo',
      'people_counting': 'Aforo',
      'vehicle_counting': 'Conteo Vehicular',
      'crowd_detection': 'Multitudes',
      'loitering_detection': 'Merodeo'
    };
    return map[type] || type;
  }

  getCameraAnalytics(camera: Camera): string[] {
    const list: string[] = [];
    this.analytics.forEach(a => {
      if (a.targetCameraIds && a.targetCameraIds.includes(camera.id)) {
        list.push(this.getAnalyticLabel(a.type));
      }
    });

    if (list.length === 0) {
      const name = camera.name.toLowerCase();
      if (name.includes('facial') || name.includes('rostro')) {
        list.push('Facial');
      } else if (name.includes('vehiculo') || name.includes('placa') || name.includes('patente') || name.includes('porton')) {
        list.push('LPR');
      } else if (name.includes('intrusion') || name.includes('cerca') || name.includes('perimetro')) {
        list.push('Intrusión');
      } else {
        list.push('Detección');
      }
    }
    return list;
  }

  cameraMatchesAnalyticType(c: Camera, typeFilter: string): boolean {
    if (typeFilter === 'all') return true;
    const badges = this.getCameraAnalytics(c);
    return badges.some(b => b.toLowerCase() === typeFilter.toLowerCase());
  }

  getStatusFilterLabel(status: string): string {
    return getCameraStatusFilterLabel(status);
  }

  getStatusCssClass(status: string): string {
    const stLower = status.trim().toLowerCase();
    if (stLower === 'all' || stLower === 'todos') return 'all';
    if (stLower === 'online' || stLower === 'active' || stLower === 'activo') return 'online';
    if (stLower === 'degraded' || stLower === 'degradado') return 'degraded';
    if (stLower === 'recovering' || stLower === 'recuperando') return 'recovering';
    if (stLower === 'pending' || stLower === 'pendiente') return 'pending';
    return 'offline';
  }

  getCameraStatusClass(camera: Camera): string {
    const status = getCameraEffectiveStatus(camera, this.hosts);
    return getCameraStatusCssClass(status);
  }

  getCameraStatusLabel(camera: Camera): string {
    return getCameraEffectiveStatus(camera, this.hosts);
  }

  isLinuxHost(host: Host): boolean {
    const sys = host?.hwInfo?.system?.toLowerCase() || '';
    return sys.includes('linux') || sys.includes('ubuntu') || sys.includes('debian');
  }

  isWindowsHost(host: Host): boolean {
    const sys = host?.hwInfo?.system?.toLowerCase() || '';
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

  // --- Computed Lists (Reactive via Signals) ---
  readonly modalTypeOptions = computed(() => {
    const set = new Set<string>();
    this.camerasSignal().forEach(c => {
      const badges = this.getCameraAnalytics(c);
      badges.forEach(b => set.add(b));
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  });

  readonly modalStatusOptions = computed(() => {
    const set = new Set<string>();
    const hosts = this.hostsSignal();
    this.camerasSignal().forEach(c => {
      const effStatus = getCameraEffectiveStatus(c, hosts);
      set.add(effStatus);
    });
    const statusOrder = ['Online', 'Degraded', 'Recovering', 'Pending', 'Offline'];
    return Array.from(set).sort((a, b) => {
      const idxA = statusOrder.indexOf(a);
      const idxB = statusOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  });

  readonly filteredCamerasForModal = computed(() => {
    const query = this.modalSearchQuery().trim().toLowerCase();
    const statusFilter = this.modalStatusFilter();
    const typeFilter = this.modalTypeFilter();
    const sortDir = this.modalSortDirection();
    const hosts = this.hostsSignal();
    let cams = this.camerasSignal();

    if (query) {
      cams = cams.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.id.toLowerCase().includes(query) ||
        (c.streamType && c.streamType.toLowerCase().includes(query))
      );
    }

    if (typeFilter !== 'all') {
      cams = cams.filter(c => this.cameraMatchesAnalyticType(c, typeFilter));
    }

    if (statusFilter !== 'all') {
      const stLower = statusFilter.toLowerCase();
      cams = cams.filter(c => {
        const effLower = getCameraEffectiveStatus(c, hosts).toLowerCase();
        if (stLower === 'active' || stLower === 'online') return effLower === 'online';
        if (stLower === 'inactive' || stLower === 'offline') return effLower === 'offline';
        return effLower === stLower;
      });
    }

    return cams.slice().sort((a, b) => {
      const cmp = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });

  readonly filteredNodeGroupsForModal = computed(() => {
    const query = this.modalSearchQuery().trim().toLowerCase();
    const statusFilter = this.modalStatusFilter();
    const typeFilter = this.modalTypeFilter();
    const sortDir = this.modalSortDirection();
    const hosts = this.hostsSignal();
    const cameras = this.camerasSignal();

    const matchesStatus = (c: Camera) => {
      if (statusFilter === 'all') return true;
      const stLower = statusFilter.toLowerCase();
      const effLower = getCameraEffectiveStatus(c, hosts).toLowerCase();
      if (stLower === 'active' || stLower === 'online') return effLower === 'online';
      if (stLower === 'inactive' || stLower === 'offline') return effLower === 'offline';
      return effLower === stLower;
    };

    const matchesFilters = (c: Camera) => {
      return matchesStatus(c) && this.cameraMatchesAnalyticType(c, typeFilter);
    };

    const groups: { host: Host; cameras: Camera[] }[] = [];

    hosts.forEach(h => {
      let hostCams = cameras.filter(c => c.hostFingerprint === h.fingerprint);

      if (query) {
        hostCams = hostCams.filter(c =>
          c.name.toLowerCase().includes(query) ||
          c.id.toLowerCase().includes(query) ||
          (c.streamType && c.streamType.toLowerCase().includes(query))
        );
      }

      hostCams = hostCams.filter(matchesFilters);

      const matchesHost = query ? (h.hostname.toLowerCase().includes(query) || h.fingerprint.toLowerCase().includes(query)) : false;

      const finalCams = matchesHost
        ? cameras.filter(c => c.hostFingerprint === h.fingerprint && matchesFilters(c))
        : hostCams;

      if (finalCams.length > 0) {
        const sortedCams = finalCams.slice().sort((a, b) => {
          const cmp = (a.name || '').localeCompare(b.name || '', undefined, { numeric: true, sensitivity: 'base' });
          return sortDir === 'asc' ? cmp : -cmp;
        });

        groups.push({
          host: h,
          cameras: sortedCams
        });
      }
    });

    return groups.sort((a, b) => {
      const cmp = (a.host.hostname || '').localeCompare(b.host.hostname || '', undefined, { numeric: true, sensitivity: 'base' });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  });
}
