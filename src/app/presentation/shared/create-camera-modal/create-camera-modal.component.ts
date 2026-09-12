import {
  Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges,
  inject, signal, computed, HostListener, ViewChild, ElementRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import * as L from 'leaflet';
import { CameraService } from '../../../core/services/camera.service';
import { Host } from '../../../core/domain/entities/host.models';
import { Camera, CameraRegisterRequest, CameraUpdateRequest, StreamType, DecoderType } from '../../../core/domain/entities/camera.models';

export interface StreamTypeOption {
  value: StreamType;
  label: string;
  description: string;
}

export const DEFAULT_LATITUDE = '-12.126308';
export const DEFAULT_LONGITUDE = '-76.975727';

@Component({
  selector: 'app-create-camera-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-camera-modal.component.html',
  styleUrl: './create-camera-modal.component.css'
})
export class CreateCameraModalComponent implements OnInit, OnChanges, OnDestroy {
  private fb = inject(FormBuilder);
  private cameraService = inject(CameraService);

  @Input() mode: 'create' | 'edit' = 'create';
  @Input() camera: Camera | null = null;
  @Input() show: boolean = false;
  @Input() preselectedHostId: string | null = null;
  @Input() preselectedHostName: string | null = null;
  @Input() hosts: Host[] = [];

  get modalTitle(): string {
    if (this.mode === 'edit') {
      return `Editar Cámara - ${this.camera?.name || 'Configuración'}`;
    }
    if (this.preselectedHostId) {
      const host = this.hosts?.find(h => h.fingerprint === this.preselectedHostId);
      const name = this.preselectedHostName || host?.hostname || (host?.ipAddress ? 'Nodo ' + host.ipAddress : '') || 'Nodo';
      return `Crear nueva cámara - ${name}`;
    }
    return 'Crear Nueva Cámara';
  }

  @Output() close = new EventEmitter<void>();
  @Output() cameraCreated = new EventEmitter<Camera>();
  @Output() cameraUpdated = new EventEmitter<Camera>();

  readonly isSubmitting = signal<boolean>(false);
  readonly isSubmitted = signal<boolean>(false);
  readonly fieldsWithAlert = signal<Set<string>>(new Set<string>());
  readonly errorMessage = signal<string | null>(null);
  readonly showPassword = signal<boolean>(false);

  // Dropdowns state
  readonly activeDropdown = signal<'host' | 'streamType' | 'resolution' | 'decoder' | null>(null);
  readonly hostSearch = signal<string>('');

  readonly streamTypeOptions: StreamTypeOption[] = [
    { value: 'rtsp', label: 'RTSP', description: 'Protocolo de streaming en tiempo real' },
    { value: 'Onvif', label: 'ONVIF', description: 'Descubrimiento de perfiles de cámara IP' },
    { value: 'rtmp', label: 'RTMP', description: 'Flujo de mensajería en tiempo real' },
    { value: 'nx', label: 'Nx Witness', description: 'Integración directa con VMS NX' }
  ];

  readonly resolutionOptions = [
    { label: '1920x1080 — Full HD 1080p', value: '1920x1080' },
    { label: '1280x270 — Ultra panorámico', value: '1280x270' },
    { label: '1024x768 — 4:3 XGA', value: '1024x768' },
    { label: '800x600 — 4:3 SVGA', value: '800x600' },
    { label: '640x480 — 4:3 VGA', value: '640x480' },
    { label: '320x240 — 4:3 QVGA', value: '320x240' }
  ];

  readonly decoderOptions: { value: DecoderType; label: string }[] = [
    { value: 'opencv', label: 'OpenCV' },
    { value: 'ffmpeg', label: 'FFmpeg' }
  ];

  readonly filteredHostOptions = computed(() => {
    const query = this.hostSearch().trim().toLowerCase();
    const list = this.hosts || [];
    if (!query) return list;
    return list.filter(h =>
      (h.hostname && h.hostname.toLowerCase().includes(query)) ||
      (h.ipAddress && h.ipAddress.toLowerCase().includes(query)) ||
      (h.fingerprint && h.fingerprint.toLowerCase().includes(query))
    );
  });

  cameraForm!: FormGroup;

  @ViewChild('mapContainer') mapContainer?: ElementRef<HTMLDivElement>;
  private map: L.Map | null = null;
  private marker: L.Marker | null = null;
  private mapInitTimeout: ReturnType<typeof setTimeout> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private isUpdatingCoordsInternally = false;

  get hasSelectedCoordinates(): boolean {
    const lat = this.cameraForm?.get('lat')?.value;
    const lon = this.cameraForm?.get('lon')?.value;
    return lat !== null && lat !== '' && !isNaN(Number(lat)) &&
           lon !== null && lon !== '' && !isNaN(Number(lon));
  }

  private backdropMouseDownTarget: EventTarget | null = null;

  ngOnInit(): void {
    this.initForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['show']) {
      if (this.show) {
        if (this.mode === 'edit' && this.camera) {
          this.populateForm(this.camera);
        } else {
          this.resetForm();
        }
        this.scheduleMapInit();
      } else {
        this.destroyMap();
      }
    } else if (changes['camera'] && this.show && this.mode === 'edit' && this.camera) {
      this.populateForm(this.camera);
      this.scheduleMapInit();
    }
    if (changes['preselectedHostId'] && this.cameraForm && this.mode === 'create') {
      if (this.preselectedHostId) {
        this.cameraForm.patchValue({ fingerprint_host: this.preselectedHostId });
      }
    }
  }

  ngOnDestroy(): void {
    if (this.mapInitTimeout) {
      clearTimeout(this.mapInitTimeout);
    }
    this.destroyMap();
  }

  private populateForm(cam: Camera): void {
    const streamType = (cam.streamType || 'rtsp') as StreamType;
    this.updateConditionalValidators(streamType);

    this.cameraForm.reset({
      camera_name: cam.name || '',
      fingerprint_host: cam.hostFingerprint || '',
      stream_type: streamType,
      stream_url: cam.streamUrl || cam.rtspUrl || cam.url || '',
      lat: cam.location?.lat ?? null,
      lon: cam.location?.lon ?? null,
      ip_address: cam.ipAddress || '',
      http_port: cam.httpPort || null,
      user: cam.user || '',
      password: cam.password || '',
      selected_stream: cam.selectedStream ?? null,
      nx_id: cam.nxId || '',
      forced_resolution: cam.forcedResolution || '',
      forced_fps: cam.forcedFps ?? null,
      decoder: cam.decoder || 'opencv'
    });

    this.fieldsWithAlert.set(new Set());
    this.errorMessage.set(null);
    this.isSubmitting.set(false);
    this.isSubmitted.set(false);
    this.showPassword.set(false);
    this.activeDropdown.set(null);
    this.hostSearch.set('');
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.activeDropdown()) return;
    const target = event.target as HTMLElement | null;
    if (!target) return;

    const clickedInsideMenu = !!target.closest('.modal-dropdown-menu');
    const clickedTrigger = !!target.closest('.dropdown-field-trigger');

    if (!clickedInsideMenu && !clickedTrigger) {
      this.closeDropdowns();
    }
  }

  @HostListener('document:keydown.escape')
  onEscapePress(): void {
    if (this.activeDropdown()) {
      this.closeDropdowns();
      return;
    }
    if (this.show && !this.isSubmitting()) {
      this.onCancel();
    }
  }

  private initForm(): void {
    const initialHost = this.preselectedHostId || '';

    this.cameraForm = this.fb.group({
      camera_name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      fingerprint_host: [initialHost, Validators.required],
      stream_type: ['', Validators.required],
      stream_url: [''],
      lat: [DEFAULT_LATITUDE, [Validators.required, this.numericValidator, Validators.min(-90), Validators.max(90)]],
      lon: [DEFAULT_LONGITUDE, [Validators.required, this.numericValidator, Validators.min(-180), Validators.max(180)]],
      // ONVIF
      ip_address: [''],
      http_port: [null, [Validators.min(1), Validators.max(65535)]],
      user: [''],
      password: [''],
      selected_stream: [null],
      // NX
      nx_id: [''],
      // Advanced
      forced_resolution: [''],
      forced_fps: [null, [this.fpsValidator]],
      decoder: ['', Validators.required]
    });

    this.updateConditionalValidators('');

    // Escuchar cambios de stream_type
    this.cameraForm.get('stream_type')?.valueChanges.subscribe(type => {
      this.updateConditionalValidators((type || '') as StreamType);
    });

    // Escuchar cambios de decoder para limpiar parámetros de FFmpeg
    this.cameraForm.get('decoder')?.valueChanges.subscribe(dec => {
      if (dec !== 'ffmpeg') {
        this.cameraForm.get('forced_resolution')?.setValue('', { emitEvent: false });
        this.cameraForm.get('forced_fps')?.setValue(null, { emitEvent: false });
        this.clearFieldAlert('forced_fps');
        this.clearFieldAlert('forced_resolution');
      }
    });

    // Escuchar cambios manuales de lat y lon para sincronizar marcador en el mapa
    this.cameraForm.get('lat')?.valueChanges.subscribe(() => {
      if (!this.isUpdatingCoordsInternally) {
        this.syncMarkerFromInputs();
      }
    });
    this.cameraForm.get('lon')?.valueChanges.subscribe(() => {
      if (!this.isUpdatingCoordsInternally) {
        this.syncMarkerFromInputs();
      }
    });
  }

  onCoordinateInput(field: 'lat' | 'lon'): void {
    const ctrl = this.cameraForm.get(field);
    if (!ctrl) return;
    const raw = ctrl.value;
    if (raw === null || raw === '' || raw === undefined) return;

    const num = Number(raw);
    if (isNaN(num)) return;

    const min = field === 'lat' ? -90 : -180;
    const max = field === 'lat' ? 90 : 180;

    if (num > max) {
      ctrl.setValue(max);
    } else if (num < min) {
      ctrl.setValue(min);
    }
  }

  private updateConditionalValidators(type: StreamType | ''): void {
    const streamUrlCtrl = this.cameraForm.get('stream_url');
    const ipCtrl = this.cameraForm.get('ip_address');
    const portCtrl = this.cameraForm.get('http_port');
    const userCtrl = this.cameraForm.get('user');
    const passCtrl = this.cameraForm.get('password');
    const nxIdCtrl = this.cameraForm.get('nx_id');

    // Resetear validadores
    ipCtrl?.clearValidators();
    portCtrl?.clearValidators();
    userCtrl?.clearValidators();
    passCtrl?.clearValidators();
    nxIdCtrl?.clearValidators();
    streamUrlCtrl?.clearValidators();

    if (type === 'Onvif') {
      ipCtrl?.setValidators([Validators.required]);
      portCtrl?.setValidators([Validators.required, Validators.min(1), Validators.max(65535)]);
      userCtrl?.setValidators([Validators.required]);
      passCtrl?.setValidators([Validators.required]);
    } else if (type === 'nx') {
      nxIdCtrl?.setValidators([Validators.required]);
      streamUrlCtrl?.setValidators([Validators.required, this.urlSchemeValidator]);
    } else if (type === 'rtsp' || type === 'rtmp') {
      streamUrlCtrl?.setValidators([Validators.required, this.urlSchemeValidator]);
    }

    ipCtrl?.updateValueAndValidity();
    portCtrl?.updateValueAndValidity();
    userCtrl?.updateValueAndValidity();
    passCtrl?.updateValueAndValidity();
    nxIdCtrl?.updateValueAndValidity();
    streamUrlCtrl?.updateValueAndValidity();
  }

  private resetForm(): void {
    const initialHost = this.preselectedHostId || '';
    this.cameraForm.reset({
      camera_name: '',
      fingerprint_host: initialHost,
      stream_type: '',
      stream_url: '',
      lat: DEFAULT_LATITUDE,
      lon: DEFAULT_LONGITUDE,
      ip_address: '',
      http_port: null,
      user: '',
      password: '',
      selected_stream: null,
      nx_id: '',
      forced_resolution: '',
      forced_fps: null,
      decoder: ''
    });
    this.updateConditionalValidators('');
    this.fieldsWithAlert.set(new Set());
    this.errorMessage.set(null);
    this.isSubmitting.set(false);
    this.isSubmitted.set(false);
    this.showPassword.set(false);
    this.activeDropdown.set(null);
    this.hostSearch.set('');
    this.destroyMap();
  }

  get currentStreamType(): StreamType | '' {
    return this.cameraForm?.get('stream_type')?.value || '';
  }

  get currentStreamTypeLabel(): string {
    if (!this.currentStreamType) return 'Seleccionar tipo de flujo...';
    const opt = this.streamTypeOptions.find(o => o.value === this.currentStreamType);
    return opt ? opt.label : 'Seleccionar tipo de flujo...';
  }

  get selectedHost(): Host | undefined {
    const fp = this.cameraForm?.get('fingerprint_host')?.value;
    return this.hosts.find(h => h.fingerprint === fp);
  }

  get selectedHostLabel(): string {
    const h = this.selectedHost;
    if (!h) return 'Seleccionar nodo...';
    return `${h.hostname || 'Nodo ' + h.ipAddress} (${h.ipAddress})`;
  }

  get currentResolutionLabel(): string {
    const val = this.cameraForm?.get('forced_resolution')?.value;
    const opt = this.resolutionOptions.find(o => o.value === val);
    return opt ? opt.label : 'Seleccionar resolución...';
  }

  get currentDecoderLabel(): string {
    const val = this.cameraForm?.get('decoder')?.value;
    const opt = this.decoderOptions.find(o => o.value === val);
    return opt ? opt.label : 'Seleccionar decodificador...';
  }

  get isFfmpegDecoder(): boolean {
    return this.cameraForm?.get('decoder')?.value === 'ffmpeg';
  }

  toggleDropdown(name: 'host' | 'streamType' | 'resolution' | 'decoder', event?: MouseEvent): void {
    event?.stopPropagation();
    this.activeDropdown.update(curr => curr === name ? null : name);
  }

  closeDropdowns(): void {
    this.activeDropdown.set(null);
  }

  selectHost(fingerprint: string, event?: MouseEvent): void {
    event?.stopPropagation();
    const curr = this.cameraForm.get('fingerprint_host')?.value;
    this.cameraForm.get('fingerprint_host')?.setValue(curr === fingerprint ? '' : fingerprint);
    this.cameraForm.get('fingerprint_host')?.markAsDirty();
    this.cameraForm.get('fingerprint_host')?.updateValueAndValidity();
    this.clearFieldAlert('fingerprint_host');
    this.closeDropdowns();
  }

  selectStreamType(type: StreamType | '', event?: MouseEvent): void {
    event?.stopPropagation();
    this.cameraForm.get('stream_type')?.setValue(type as StreamType);
    this.cameraForm.get('stream_type')?.markAsDirty();
    this.cameraForm.get('stream_type')?.updateValueAndValidity();
    this.clearFieldAlert('stream_type');
    this.closeDropdowns();
  }

  selectResolution(res: string, event?: MouseEvent): void {
    event?.stopPropagation();
    const curr = this.cameraForm.get('forced_resolution')?.value;
    this.cameraForm.get('forced_resolution')?.setValue(curr === res ? '' : res);
    this.closeDropdowns();
  }

  selectDecoder(decoder: DecoderType | '', event?: MouseEvent): void {
    event?.stopPropagation();
    const curr = this.cameraForm.get('decoder')?.value;
    const next = curr === decoder ? '' : decoder;
    this.cameraForm.get('decoder')?.setValue(next);
    this.cameraForm.get('decoder')?.markAsDirty();
    this.cameraForm.get('decoder')?.updateValueAndValidity();
    this.clearFieldAlert('decoder');
    if (next !== 'ffmpeg') {
      this.cameraForm.get('forced_resolution')?.setValue('');
      this.cameraForm.get('forced_fps')?.setValue(null);
      this.clearFieldAlert('forced_fps');
      this.clearFieldAlert('forced_resolution');
    }
    this.closeDropdowns();
  }

  clearFieldAlert(controlName: string): void {
    if (this.fieldsWithAlert().has(controlName)) {
      this.fieldsWithAlert.update(set => {
        const next = new Set(set);
        next.delete(controlName);
        return next;
      });
    }
  }

  isFieldInvalid(controlName: string): boolean {
    return this.fieldsWithAlert().has(controlName);
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

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
      if (this.activeDropdown()) {
        this.closeDropdowns();
        this.backdropMouseDownTarget = null;
        return;
      }
      this.onCancel();
    }
    this.backdropMouseDownTarget = null;
  }

  onCancel(): void {
    if (!this.isSubmitting()) {
      this.close.emit();
    }
  }

  onSubmit(): void {
    this.closeDropdowns();
    this.isSubmitted.set(true);

    if (this.cameraForm.invalid) {
      this.cameraForm.markAllAsTouched();
      const invalidFields = new Set<string>();
      Object.keys(this.cameraForm.controls).forEach(key => {
        if (this.cameraForm.get(key)?.invalid) {
          invalidFields.add(key);
        }
      });
      this.fieldsWithAlert.set(invalidFields);
      return;
    }

    this.fieldsWithAlert.set(new Set());
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const f = this.cameraForm.value;
    const streamType: StreamType = f.stream_type;

    if (this.mode === 'edit' && this.camera) {
      const updatePayload: CameraUpdateRequest = {
        camera_name: f.camera_name.trim(),
        fingerprint_host: f.fingerprint_host,
        stream_type: streamType,
        location: {
          lat: String(f.lat).trim(),
          lon: String(f.lon).trim()
        },
        decoder: f.decoder || 'opencv',
        compatibility_mode: false
      };

      if (streamType === 'Onvif') {
        updatePayload.ip_address = f.ip_address?.trim() || null;
        updatePayload.http_port = f.http_port ? Number(f.http_port) : 80;
        updatePayload.user = f.user?.trim() || null;
        updatePayload.password = f.password || null;
        updatePayload.selected_stream = f.selected_stream !== null && f.selected_stream !== '' ? Number(f.selected_stream) : 0;
        updatePayload.streams = [{ stream_index: updatePayload.selected_stream }];
        if (f.stream_url?.trim()) {
          updatePayload.stream_url = f.stream_url.trim();
        }
      } else if (streamType === 'nx') {
        updatePayload.nx_id = f.nx_id?.trim() || null;
        updatePayload.stream_url = f.stream_url?.trim() || null;
      } else {
        updatePayload.stream_url = f.stream_url?.trim() || null;
      }

      if (f.forced_resolution) {
        updatePayload.forced_resolution = f.forced_resolution;
      }
      if (f.forced_fps !== null && f.forced_fps !== '' && !isNaN(Number(f.forced_fps))) {
        updatePayload.forced_fps = Number(f.forced_fps);
      }

      this.cameraService.updateCamera(this.camera.id, updatePayload).subscribe({
        next: () => {
          this.isSubmitting.set(false);
          const updatedCam: Camera = {
            ...this.camera!,
            name: updatePayload.camera_name || this.camera!.name,
            hostFingerprint: updatePayload.fingerprint_host || this.camera!.hostFingerprint,
            streamType: (updatePayload.stream_type as string) || this.camera!.streamType,
            decoder: (updatePayload.decoder as string) || this.camera!.decoder,
            location: updatePayload.location || this.camera!.location,
            streamUrl: updatePayload.stream_url !== undefined ? (updatePayload.stream_url || undefined) : this.camera!.streamUrl,
            rtspUrl: updatePayload.stream_url !== undefined ? (updatePayload.stream_url || undefined) : this.camera!.rtspUrl,
            nxId: updatePayload.nx_id !== undefined ? (updatePayload.nx_id || undefined) : this.camera!.nxId,
            forcedResolution: updatePayload.forced_resolution !== undefined ? (updatePayload.forced_resolution || undefined) : this.camera!.forcedResolution,
            forcedFps: updatePayload.forced_fps !== undefined ? (updatePayload.forced_fps ?? undefined) : this.camera!.forcedFps,
            ipAddress: updatePayload.ip_address !== undefined ? (updatePayload.ip_address || undefined) : this.camera!.ipAddress,
            user: updatePayload.user !== undefined ? (updatePayload.user || undefined) : this.camera!.user,
            password: updatePayload.password !== undefined ? (updatePayload.password || undefined) : this.camera!.password,
            httpPort: updatePayload.http_port !== undefined ? (updatePayload.http_port ?? undefined) : this.camera!.httpPort,
            selectedStream: updatePayload.selected_stream !== undefined ? (updatePayload.selected_stream ?? undefined) : this.camera!.selectedStream
          };
          this.cameraUpdated.emit(updatedCam);
          this.close.emit();
        },
        error: (err) => {
          this.isSubmitting.set(false);
          console.error('Error updating camera:', err);
          const detail = err?.error?.detail || err?.error?.message || err?.message;
          if (typeof detail === 'string') {
            this.errorMessage.set(detail);
          } else if (Array.isArray(detail) && detail.length > 0) {
            this.errorMessage.set(detail.map(d => d.msg || d).join(', '));
          } else {
            this.errorMessage.set('Ocurrió un error al actualizar la cámara. Verifica los parámetros ingresados.');
          }
        }
      });
      return;
    }

    const request: CameraRegisterRequest = {
      camera_name: f.camera_name.trim(),
      fingerprint_host: f.fingerprint_host,
      stream_type: streamType,
      location: {
        lat: String(f.lat).trim(),
        lon: String(f.lon).trim()
      },
      decoder: f.decoder || 'opencv',
      compatibility_mode: false
    };

    // Campos condicionales según stream_type
    if (streamType === 'Onvif') {
      request.ip_address = f.ip_address?.trim() || null;
      request.http_port = f.http_port ? Number(f.http_port) : 80;
      request.user = f.user?.trim() || null;
      request.password = f.password || null;
      request.selected_stream = f.selected_stream !== null && f.selected_stream !== '' ? Number(f.selected_stream) : 0;
      request.streams = [{ stream_index: request.selected_stream }];
      if (f.stream_url?.trim()) {
        request.stream_url = f.stream_url.trim();
      }
    } else if (streamType === 'nx') {
      request.nx_id = f.nx_id?.trim() || null;
      request.stream_url = f.stream_url?.trim() || null;
    } else {
      request.stream_url = f.stream_url?.trim() || null;
    }

    // Resolución forzada y FPS
    if (f.forced_resolution) {
      request.forced_resolution = f.forced_resolution;
    }
    if (f.forced_fps !== null && f.forced_fps !== '' && !isNaN(Number(f.forced_fps))) {
      request.forced_fps = Number(f.forced_fps);
    }

    this.cameraService.registerCamera(request).subscribe({
      next: (newCam) => {
        this.isSubmitting.set(false);
        this.cameraCreated.emit(newCam);
        this.close.emit();
      },
      error: (err) => {
        this.isSubmitting.set(false);
        console.error('Error registering camera:', err);
        const detail = err?.error?.detail || err?.error?.message || err?.message;
        if (typeof detail === 'string') {
          this.errorMessage.set(detail);
        } else if (Array.isArray(detail) && detail.length > 0) {
          this.errorMessage.set(detail.map(d => d.msg || d).join(', '));
        } else {
          this.errorMessage.set('Ocurrió un error al registrar la cámara. Verifica la conexión con el nodo y los parámetros ingresados.');
        }
      }
    });
  }

  // ─────────────────────────────────────────────────────────────
  // GESTIÓN DEL MAPA LEAFLET & GEOLOCALIZACIÓN
  // ─────────────────────────────────────────────────────────────
  private scheduleMapInit(): void {
    if (this.mapInitTimeout) {
      clearTimeout(this.mapInitTimeout);
    }
    // Esperar a que concluya la animación CSS del modal (slideUpModal dura 260ms)
    this.mapInitTimeout = setTimeout(() => {
      this.initMap();
    }, 280);
  }

  private initMap(): void {
    if (!this.mapContainer?.nativeElement || !this.show) return;

    if (this.map) {
      this.destroyMap();
    }

    const hasCoords = this.hasSelectedCoordinates;
    // Centrar en coordenadas seleccionadas o en las coordenadas por defecto
    const initialLat = hasCoords ? Math.max(-90, Math.min(90, Number(this.cameraForm.get('lat')?.value))) : Number(DEFAULT_LATITUDE);
    const initialLon = hasCoords ? Math.max(-180, Math.min(180, Number(this.cameraForm.get('lon')?.value))) : Number(DEFAULT_LONGITUDE);
    const initialZoom = hasCoords ? 14 : 14;

    // Límites estrictos del mapa para evitar coordenadas fuera de rango y duplicación infinita
    const maxWorldBounds = L.latLngBounds(L.latLng(-85.0511, -180), L.latLng(85.0511, 180));

    try {
      this.map = L.map(this.mapContainer.nativeElement, {
        center: [initialLat, initialLon],
        zoom: initialZoom,
        minZoom: 2,
        maxBounds: maxWorldBounds,
        maxBoundsViscosity: 1.0,
        worldCopyJump: false,
        zoomControl: true,
        attributionControl: false
      });

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
        bounds: maxWorldBounds,
        noWrap: true
      }).addTo(this.map);

      if (hasCoords) {
        this.setMapMarker(initialLat, initialLon, false);
      }

      this.map.on('click', (e: L.LeafletMouseEvent) => {
        const wrapped = e.latlng.wrap();
        const clampedLat = Math.max(-90, Math.min(90, Number(wrapped.lat.toFixed(6))));
        const clampedLon = Math.max(-180, Math.min(180, Number(wrapped.lng.toFixed(6))));
        this.updateCoordinatesFromMap(clampedLat, clampedLon);
      });

      // Asegurar redibujado preciso del tamaño del contenedor
      setTimeout(() => {
        this.map?.invalidateSize();
      }, 100);
      setTimeout(() => {
        this.map?.invalidateSize();
      }, 350);

      // Observador de cambios de tamaño del contenedor
      if (typeof ResizeObserver !== 'undefined' && this.mapContainer?.nativeElement) {
        this.resizeObserver = new ResizeObserver(() => {
          this.map?.invalidateSize();
        });
        this.resizeObserver.observe(this.mapContainer.nativeElement);
      }
    } catch (err) {
      console.error('Error initializing Leaflet map:', err);
    }
  }

  private setMapMarker(lat: number, lon: number, panTo: boolean = true): void {
    if (!this.map) return;

    // Pin SVG de alta precisión donde la punta inferior está en (14, 36)
    const customIcon = L.divIcon({
      className: 'custom-camera-map-pin',
      html: `
        <svg viewBox="0 0 28 36" width="28" height="36" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M14 0C6.268 0 0 6.268 0 14c0 9.8 12.6 21.2 13.2 21.7a1.2 1.2 0 0 0 1.6 0C15.4 35.2 28 23.8 28 14 28 6.268 21.732 0 14 0z" fill="#6366f1"/>
          <circle cx="14" cy="13" r="4.5" fill="#ffffff"/>
        </svg>
      `,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -36]
    });

    if (this.marker) {
      this.marker.setLatLng([lat, lon]);
    } else {
      this.marker = L.marker([lat, lon], {
        icon: customIcon,
        draggable: true
      }).addTo(this.map);

      this.marker.on('drag', (event) => {
        const pos = event.target.getLatLng();
        const wrapped = pos.wrap();
        const clampedLat = Math.max(-90, Math.min(90, pos.lat));
        const clampedLon = Math.max(-180, Math.min(180, wrapped.lng));
        if (pos.lat !== clampedLat || pos.lng !== clampedLon) {
          event.target.setLatLng([clampedLat, clampedLon]);
        }
      });

      this.marker.on('dragend', (event) => {
        const pos = event.target.getLatLng();
        const wrapped = pos.wrap();
        const clampedLat = Math.max(-90, Math.min(90, Number(wrapped.lat.toFixed(6))));
        const clampedLon = Math.max(-180, Math.min(180, Number(wrapped.lng.toFixed(6))));
        event.target.setLatLng([clampedLat, clampedLon]);
        this.updateCoordinatesFromMap(clampedLat, clampedLon);
      });
    }

    if (panTo) {
      const currentZoom = this.map.getZoom();
      const targetZoom = currentZoom < 10 ? 14 : currentZoom;
      this.map.setView([lat, lon], targetZoom, { animate: true });
    }
  }

  private updateCoordinatesFromMap(lat: number, lon: number): void {
    this.isUpdatingCoordsInternally = true;
    this.cameraForm.patchValue({
      lat: lat,
      lon: lon
    });
    this.clearFieldAlert('lat');
    this.clearFieldAlert('lon');
    this.setMapMarker(lat, lon, false);
    this.isUpdatingCoordsInternally = false;
  }

  private syncMarkerFromInputs(): void {
    if (!this.map) return;
    const latVal = this.cameraForm.get('lat')?.value;
    const lonVal = this.cameraForm.get('lon')?.value;

    if (latVal !== null && latVal !== '' && !isNaN(Number(latVal)) &&
        lonVal !== null && lonVal !== '' && !isNaN(Number(lonVal))) {
      const lat = Number(latVal);
      const lon = Number(lonVal);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        this.setMapMarker(lat, lon, true);
        return;
      }
    }

    if (this.marker) {
      this.marker.remove();
      this.marker = null;
    }
  }

  private destroyMap(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.marker) {
      this.marker.remove();
      this.marker = null;
    }
    if (this.map) {
      this.map.off();
      this.map.remove();
      this.map = null;
    }
  }

  // Validadores auxiliares
  private numericValidator(control: AbstractControl): ValidationErrors | null {
    if (control.value === null || control.value === undefined || control.value === '') {
      return null;
    }
    const val = Number(control.value);
    return isNaN(val) ? { numeric: true } : null;
  }

  onFpsKeydown(event: KeyboardEvent): void {
    // Bloquear punto, coma, exponentes y signos para permitir solo enteros
    if (['.', ',', 'e', 'E', '+', '-'].includes(event.key)) {
      event.preventDefault();
    }
  }

  onFpsPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') || '';
    if (!/^\d+$/.test(text.trim())) {
      event.preventDefault();
    }
  }

  private fpsValidator(control: AbstractControl): ValidationErrors | null {
    if (control.value === null || control.value === undefined || control.value === '') {
      return null;
    }
    const val = Number(control.value);
    if (isNaN(val) || !Number.isInteger(val) || val < 5 || val > 15) {
      return { fpsRange: true };
    }
    return null;
  }

  private urlSchemeValidator(control: AbstractControl): ValidationErrors | null {
    if (!control.value) return null;
    const str = String(control.value).trim();
    const pattern = /^(rtsp|rtmp|http|https):\/\//i;
    return pattern.test(str) ? null : { invalidScheme: true };
  }
}
