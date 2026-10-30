import {
  Component, Input, Output, EventEmitter, OnInit, OnChanges, OnDestroy, SimpleChanges,
  inject, signal, computed, HostListener, ViewChild, ElementRef, DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, merge, of, Observable, timer } from 'rxjs';
import { debounceTime, switchMap, tap, catchError, takeUntil, map, filter, finalize } from 'rxjs/operators';
import * as L from 'leaflet';
import { CameraService } from '../../../core/services/camera.service';
import { Host } from '../../../core/domain/entities/host.models';
import {
  Camera,
  CameraFrontendCreateRequest,
  CameraFrontendUpdateRequest,
  StreamType,
  DecoderType,
  PtzMode,
  ProveedorDetecciones,
  OnvifProfileInfo,
  OnvifProfilesProbeData,
  NxCameraInfo
} from '../../../core/domain/entities/camera.models';

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
  private destroyRef = inject(DestroyRef);

  @Input() mode: 'create' | 'edit' = 'create';
  @Input() camera: Camera | null = null;
  @Input() show: boolean = false;
  @Input() preselectedHostId: string | null = null;
  @Input() preselectedHostName: string | null = null;
  @Input() hosts: Host[] = [];

  private editingCameraSnapshot: Camera | null = null;

  get modalTitle(): string {
    if (this.mode === 'edit') {
      const cam = this.editingCameraSnapshot || this.camera;
      return `Editar Cámara - ${cam?.name || 'Configuración'}`;
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

  // Probe / Test state
  readonly isProbing = signal<boolean>(false);
  readonly probeStatus = signal<'idle' | 'success' | 'error'>('idle');
  readonly probeMessage = signal<string | null>(null);
  readonly onvifProfiles = signal<OnvifProfileInfo[]>([]);
  readonly onvifTokens = signal<string[]>([]);
  readonly nxCamerasList = signal<NxCameraInfo[]>([]);

  // Espejos reactivos de controles del formulario usados por computeds.
  // Los valores de FormControl NO son signals: si un computed los lee directamente
  // no se registran como dependencias y el computed puede quedar congelado.
  readonly streamTypeSig = signal<StreamType | ''>('');
  readonly selectedProfileTokenSig = signal<string>('');

  cleanNxId(id?: string | null): string {
    if (!id) return '';
    return id.replace(/^\{|\}$/g, '').trim();
  }

  // Motor reactivo de Auto-Probe (/probe)
  private readonly autoProbeImmediate$ = new Subject<{ force?: boolean }>();
  private readonly autoProbeDebounced$ = new Subject<{ force?: boolean }>();
  private readonly cancelProbe$ = new Subject<void>();
  private lastProbedKey: string = '';
  private isPopulatingForm = false;

  private cancelCurrentProbe(): void {
    this.cancelProbe$.next();
    this.isProbing.set(false);
    this.probeStatus.set('idle');
    this.probeMessage.set(null);
    this.lastProbedKey = '';
  }

  get canSubmit(): boolean {
    if (this.isSubmitting() || this.isProbing()) {
      return false;
    }
    if (!this.cameraForm || this.cameraForm.invalid) {
      return false;
    }
    if (this.mode === 'create') {
      return this.probeStatus() === 'success';
    }
    // En modo edición: si se modificó algún parámetro de conexión, se exige probe exitoso
    if (this.hasConnectionParametersChanged()) {
      return this.probeStatus() === 'success';
    }
    return true;
  }

  get submitButtonTooltip(): string {
    if (this.isSubmitting()) return 'Guardando cambios...';
    if (this.isProbing()) return 'Verificando conexión con el nodo...';
    if (!this.cameraForm || this.cameraForm.invalid) {
      return 'Completa todos los campos obligatorios del formulario';
    }
    if (this.mode === 'create' && this.probeStatus() !== 'success') {
      if (this.probeStatus() === 'error') return 'La verificación de conexión falló. Corrige los datos.';
      return 'Se requiere verificación exitosa de conexión (/probe) antes de crear la cámara';
    }
    if (this.mode === 'edit' && this.hasConnectionParametersChanged() && this.probeStatus() !== 'success') {
      if (this.probeStatus() === 'error') return 'La verificación de conexión falló. Corrige los datos.';
      return 'Se requiere verificación exitosa de los nuevos datos de conexión (/probe)';
    }
    return this.mode === 'edit' ? 'Guardar Cambios' : 'Crear Cámara';
  }

  private hasConnectionParametersChanged(): boolean {
    if (!this.editingCameraSnapshot) return false;
    const initial = this.editingCameraSnapshot;
    const f = this.cameraForm?.value;
    if (!f) return false;

    const initialStreamUrl = initial.streamUrl || initial.rtspUrl || initial.url || '';
    if (f.stream_type !== initial.streamType) return true;
    if (f.fingerprint_host !== initial.hostFingerprint) return true;
    if (f.stream_type !== 'Onvif' && (f.stream_url || '') !== initialStreamUrl) return true;
    if ((f.ip_address || '') !== (initial.ipAddress || '')) return true;
    if ((f.http_port || null) !== (initial.httpPort || null)) return true;
    if ((f.user || '') !== (initial.user || '')) return true;
    if ((f.password || '') !== (initial.password || '')) return true;
    if (f.stream_type === 'nx' && (f.nx_id || '') !== (initial.nxId || '')) return true;
    return false;
  }



  // Dropdowns state
  readonly activeDropdown = signal<'host' | 'streamType' | 'resolution' | 'ptzMode' | 'nxCamera' | 'onvifProfile' | null>(null);
  readonly hostSearch = signal<string>('');
  readonly nxCameraSearch = signal<string>('');
  readonly filteredNxCameras = computed(() => {
    const q = this.nxCameraSearch().trim().toLowerCase();
    const list = this.nxCamerasList();
    if (!q) return list;
    return list.filter(c =>
      (c.name && c.name.toLowerCase().includes(q)) ||
      (c.id && c.id.toLowerCase().includes(q)) ||
      (c.ipAddress && c.ipAddress.toLowerCase().includes(q))
    );
  });

  readonly streamTypeOptions: StreamTypeOption[] = [
    { value: 'rtsp', label: 'RTSP', description: 'Protocolo de streaming en tiempo real' },
    { value: 'rtmp', label: 'RTMP', description: 'Flujo de mensajería en tiempo real' },
    { value: 'Onvif', label: 'ONVIF', description: 'Descubrimiento de perfiles de cámara IP' },
    { value: 'nx', label: 'Nx Witness', description: 'Integración directa con VMS NX' },
    { value: 'Archivo', label: 'Archivo de Video', description: 'Reproducción de video desde archivo local o red' }
  ];

  readonly ptzModeOptions: { value: PtzMode; label: string; description: string }[] = [
    { value: 'auto', label: 'Automático', description: 'Detección automática de capacidades PTZ' },
    { value: 'completa', label: 'PTZ Completa', description: 'Control de paneo, inclinación y zoom' },
    { value: 'solo_zoom', label: 'Solo Zoom', description: 'Control de zoom óptico o digital' },
    { value: 'desactivado', label: 'Desactivado', description: 'Desactivar movimientos PTZ' }
  ];

  readonly resolutionOptions = [
    { label: '1920x1080 — Full HD 1080p', value: '1920x1080' },
    { label: '1280x720 — HD 720p', value: '1280x720' },
    { label: '1024x768 — 4:3 XGA', value: '1024x768' },
    { label: '800x600 — 4:3 SVGA', value: '800x600' },
    { label: '640x480 — 4:3 VGA', value: '640x480' },
    { label: '320x240 — 4:3 QVGA', value: '320x240' }
  ];

  parseResolution(resStr: string | null | undefined): { width: number; height: number } | null {
    if (!resStr) return null;
    const match = resStr.match(/^(\d+)x(\d+)/i);
    if (!match) return null;
    const width = parseInt(match[1], 10);
    const height = parseInt(match[2], 10);
    return isNaN(width) || isNaN(height) ? null : { width, height };
  }

  readonly selectedOnvifIndex = signal<number | null>(null);

  readonly activeOnvifProfile = computed<OnvifProfileInfo | null>(() => {
    // IMPORTANTE: leer TODAS las signals antes de cualquier return.
    // Si el computed retorna sin leer signals, queda sin dependencias y
    // nunca vuelve a recalcularse (límites de FPS/resolución congelados).
    const streamType = this.streamTypeSig();
    const profiles = this.onvifProfiles();
    const tokens = this.onvifTokens();
    const idx = this.selectedOnvifIndex();
    const token = this.selectedProfileTokenSig();

    if (streamType !== 'Onvif') return null;
    if (idx !== null && idx >= 0 && idx < profiles.length) {
      return profiles[idx];
    }
    if (token) {
      const tokenIdx = tokens.indexOf(token);
      if (tokenIdx >= 0 && tokenIdx < profiles.length) {
        return profiles[tokenIdx];
      }
    }
    return profiles.length > 0 ? profiles[0] : null;
  });

  readonly maxAllowedFps = computed<number>(() => {
    const profile = this.activeOnvifProfile();
    if (profile && profile.fps && profile.fps > 0) {
      return profile.fps;
    }
    return 120;
  });

  readonly filteredResolutionOptions = computed(() => {
    const profile = this.activeOnvifProfile();
    if (!profile || !profile.resolucion) {
      return this.resolutionOptions;
    }
    const maxRes = this.parseResolution(profile.resolucion);
    if (!maxRes) {
      return this.resolutionOptions;
    }

    const filtered = this.resolutionOptions.filter(opt => {
      const parsed = this.parseResolution(opt.value);
      if (!parsed) return true;
      return parsed.width <= maxRes.width && parsed.height <= maxRes.height;
    });

    const nativeVal = `${maxRes.width}x${maxRes.height}`;
    const hasNative = filtered.some(opt => opt.value === nativeVal);
    if (!hasNative) {
      return [
        { label: `${nativeVal} — Nativa del Perfil`, value: nativeVal },
        ...filtered
      ];
    }
    return filtered;
  });

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
    this.setupAutoProbe();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['show']) {
      if (this.show) {
        if (this.mode === 'edit' && this.camera) {
          this.editingCameraSnapshot = { ...this.camera };
          this.populateForm(this.editingCameraSnapshot);
          const st = this.currentStreamType;
          if (st === 'Onvif' || st === 'nx' || st === 'rtsp' || st === 'rtmp' || st === 'Archivo') {
            this.autoProbeImmediate$.next({ force: true });
          }
        } else {
          this.editingCameraSnapshot = null;
          this.resetForm();
        }
        this.scheduleMapInit();
      } else {
        this.editingCameraSnapshot = null;
        this.destroyMap();
      }
    }
    if (changes['preselectedHostId'] && this.cameraForm && this.mode === 'create') {
      if (this.preselectedHostId) {
        this.cameraForm.patchValue({ fingerprint_host: this.preselectedHostId });
      }
    }
  }

  ngOnDestroy(): void {
    this.cancelCurrentProbe();
    if (this.mapInitTimeout) {
      clearTimeout(this.mapInitTimeout);
    }
    this.destroyMap();
  }

  private populateForm(cam: Camera): void {
    this.isPopulatingForm = true;
    try {
      this.lastProbedKey = '';
      const streamType = (cam.streamType || 'rtsp') as StreamType;
      this.updateConditionalValidators(streamType);

      if (Array.isArray(cam.streams) && cam.streams.length > 0) {
        this.onvifTokens.set(cam.streams);
      } else {
        this.onvifTokens.set([]);
      }
      this.onvifProfiles.set([]);
      this.nxCamerasList.set([]);
      this.probeStatus.set('idle');
      this.probeMessage.set(null);

      this.cameraForm.reset({
        camera_name: cam.name || '',
        fingerprint_host: cam.hostFingerprint || '',
        stream_type: streamType,
        stream_url: cam.streamUrl || cam.rtspUrl || cam.url || '',
        lat: cam.location?.lat ?? null,
        lon: cam.location?.lon ?? null,
        ip_address: cam.ipAddress || '',
        http_port: cam.httpPort ?? (streamType === 'nx' ? 7001 : (streamType === 'Onvif' ? 80 : null)),
        user: cam.user || '',
        password: cam.password || '',
        selected_stream: cam.selectedStream ?? 0,
        selected_profile_token: cam.selectedProfileToken || (Array.isArray(cam.streams) && cam.streams.length > (cam.selectedStream ?? 0) ? cam.streams[cam.selectedStream ?? 0] : ''),
        nx_id: this.cleanNxId(cam.nxId) || '',
        forced_resolution: cam.forcedResolution || '',
        forced_fps: cam.forcedFps ?? null,
        decoder: cam.decoder || 'opencv',
        compatibility_mode: !!cam.compatibilityMode,
        ptz_mode: cam.ptzMode || 'auto',
        proveedor_detecciones: cam.proveedorDetecciones || 'servidor'
      });
      this.selectedOnvifIndex.set(cam.selectedStream ?? 0);



      this.fieldsWithAlert.set(new Set());
      this.errorMessage.set(null);
      this.isSubmitting.set(false);
      this.isSubmitted.set(false);
      this.showPassword.set(false);
      this.activeDropdown.set(null);
      this.hostSearch.set('');
      this.nxCameraSearch.set('');
    } finally {
      this.isPopulatingForm = false;
    }
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
      selected_stream: [0],
      selected_profile_token: [''],
      // NX
      nx_id: [''],
      // Procesamiento & Avanzado
      forced_resolution: [''],
      forced_fps: [null, [this.fpsValidator]],
      decoder: ['opencv', Validators.required],
      compatibility_mode: [false],
      ptz_mode: ['auto'],
      proveedor_detecciones: ['servidor']
    });

    this.updateConditionalValidators('');

    // Escuchar cambios en campos de conexión para auto-probe con debounce
    const debouncedFields = ['stream_url', 'ip_address', 'http_port', 'user', 'password'];
    debouncedFields.forEach(field => {
      this.cameraForm.get(field)?.valueChanges.subscribe(() => {
        if (this.isPopulatingForm) return;
        // Si el tipo de flujo es NX y el campo modificado es stream_url, no reiniciar probe ni borrar selección
        if (this.currentStreamType === 'nx' && field === 'stream_url') {
          return;
        }
        this.probeStatus.set('idle');
        this.probeMessage.set(null);
        this.nxCamerasList.set([]);
        this.onvifProfiles.set([]);
        this.onvifTokens.set([]);
        this.lastProbedKey = '';
        if (field === 'ip_address' || field === 'http_port' || field === 'user') {
          this.cameraForm.get('nx_id')?.setValue('', { emitEvent: false });
          if (this.currentStreamType === 'nx') {
            this.cameraForm.get('stream_url')?.setValue('', { emitEvent: false });
          }
          if (this.currentStreamType === 'Onvif') {
            this.clearOnvifSelection();
            if (this.activeDropdown() === 'onvifProfile') {
              this.closeDropdowns();
            }
          }
        }
        this.autoProbeDebounced$.next({});
      });
    });

    this.cameraForm.get('stream_type')?.valueChanges.subscribe(type => {
      const streamType = (type || '') as StreamType;
      this.streamTypeSig.set(streamType);
      // Cancelar de inmediato cualquier probe en curso o en cola
      this.cancelCurrentProbe();

      this.updateConditionalValidators(streamType);
      this.probeStatus.set('idle');
      this.probeMessage.set(null);
      this.isProbing.set(false);
      this.onvifProfiles.set([]);
      this.onvifTokens.set([]);
      this.nxCamerasList.set([]);
      this.lastProbedKey = '';
      this.cameraForm.get('nx_id')?.setValue('', { emitEvent: false });
      if (streamType === 'Onvif') {
        this.clearOnvifSelection();
      }
      this.selectedOnvifIndex.set(null);
      this.cameraForm.get('forced_fps')?.updateValueAndValidity();
      if (this.isPopulatingForm) return;

      // Limpieza integral de stream_url al alternar entre flujos de video
      this.cameraForm.get('stream_url')?.setValue('', { emitEvent: false });
      this.cameraForm.get('stream_url')?.markAsPristine();
      this.cameraForm.get('stream_url')?.updateValueAndValidity();

      const currentPort = this.cameraForm.get('http_port')?.value;
      if (streamType === 'nx') {
        if (!currentPort || currentPort === 80) {
          this.cameraForm.get('http_port')?.setValue(7001, { emitEvent: false });
        }
      } else if (streamType === 'Onvif') {
        if (!currentPort || currentPort === 7001) {
          this.cameraForm.get('http_port')?.setValue(80, { emitEvent: false });
        }
      }

      // Edición: al volver al tipo de flujo original de la cámara, restaurar su
      // configuración de conexión (perfil ONVIF, tokens, stream_url, puerto, nx_id)
      const snap = this.editingCameraSnapshot;
      if (this.mode === 'edit' && snap && streamType === snap.streamType) {
        this.restoreConnectionFromSnapshot(snap);
      }

      // Re-verificar conexión para el nuevo tipo (debounce para evitar ráfagas /
      // lockout ONVIF; executeProbe no dispara si faltan credenciales)
      this.autoProbeDebounced$.next({ force: true });
    });

    this.cameraForm.get('fingerprint_host')?.valueChanges.subscribe(() => {
      this.cancelCurrentProbe();
      this.probeStatus.set('idle');
      this.probeMessage.set(null);
      this.isProbing.set(false);
      this.nxCamerasList.set([]);
      this.onvifProfiles.set([]);
      this.onvifTokens.set([]);
      this.lastProbedKey = '';
      this.cameraForm.get('nx_id')?.setValue('', { emitEvent: false });
      if (this.currentStreamType === 'nx') {
        this.cameraForm.get('stream_url')?.setValue('', { emitEvent: false });
      }
      if (this.currentStreamType === 'Onvif') {
        this.clearOnvifSelection();
        if (this.activeDropdown() === 'onvifProfile') {
          this.closeDropdowns();
        }
      }
      if (this.isPopulatingForm) return;
      this.autoProbeImmediate$.next({ force: true });
    });

    this.cameraForm.get('decoder')?.valueChanges.subscribe(dec => {
      if (dec !== 'ffmpeg') {
        this.cameraForm.get('forced_resolution')?.setValue('', { emitEvent: false });
        this.cameraForm.get('forced_fps')?.setValue(null, { emitEvent: false });
        this.clearFieldAlert('forced_fps');
        this.clearFieldAlert('forced_resolution');
      }
    });

    this.cameraForm.get('selected_stream')?.valueChanges.subscribe(idx => {
      this.selectedOnvifIndex.set(idx !== null && idx !== undefined ? Number(idx) : null);
      this.cameraForm.get('forced_fps')?.updateValueAndValidity();
    });

    this.cameraForm.get('selected_profile_token')?.valueChanges.subscribe(token => {
      this.selectedProfileTokenSig.set(token || '');
    });

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
    const profileTokenCtrl = this.cameraForm.get('selected_profile_token');

    profileTokenCtrl?.clearValidators();
    ipCtrl?.clearValidators();
    portCtrl?.clearValidators();
    userCtrl?.clearValidators();
    passCtrl?.clearValidators();
    nxIdCtrl?.clearValidators();
    streamUrlCtrl?.clearValidators();

    if (type === 'Onvif' || type === 'nx') {
      ipCtrl?.setValidators([Validators.required]);
      portCtrl?.setValidators([Validators.required, Validators.min(1), Validators.max(65535)]);
      userCtrl?.setValidators([Validators.required]);
      passCtrl?.setValidators([Validators.required]);
      if (type === 'nx') {
        nxIdCtrl?.setValidators([Validators.required]);
      }
      if (type === 'Onvif') {
        profileTokenCtrl?.setValidators([Validators.required]);
      }
    } else if (type === 'rtsp' || type === 'rtmp') {
      streamUrlCtrl?.setValidators([Validators.required, this.urlSchemeValidator]);
    } else if (type === 'Archivo') {
      streamUrlCtrl?.setValidators([Validators.required]);
    }

    ipCtrl?.updateValueAndValidity();
    portCtrl?.updateValueAndValidity();
    userCtrl?.updateValueAndValidity();
    passCtrl?.updateValueAndValidity();
    nxIdCtrl?.updateValueAndValidity();
    streamUrlCtrl?.updateValueAndValidity();
    profileTokenCtrl?.updateValueAndValidity();
  }

  /** Limpia la selección de perfil ONVIF manteniendo sincronizadas las signals espejo. */
  private clearOnvifSelection(): void {
    this.cameraForm.get('selected_profile_token')?.setValue('', { emitEvent: false });
    this.cameraForm.get('selected_stream')?.setValue(null, { emitEvent: false });
    this.selectedProfileTokenSig.set('');
    this.selectedOnvifIndex.set(null);
  }

  /**
   * Restaura los parámetros de conexión de la cámara en edición cuando el usuario
   * vuelve a su tipo de flujo original sin guardar (ej. ONVIF → NX → ONVIF).
   * Usa emitEvent: false para no disparar los handlers de debounce, que vaciarían
   * los tokens y la selección recién restaurados.
   */
  private restoreConnectionFromSnapshot(snap: Camera): void {
    const type = snap.streamType as StreamType;
    const tokens = Array.isArray(snap.streams) ? snap.streams : [];
    const idx = snap.selectedStream ?? 0;
    const token = snap.selectedProfileToken || tokens[idx] || '';

    this.cameraForm.patchValue({
      stream_url: snap.streamUrl || snap.rtspUrl || snap.url || '',
      http_port: snap.httpPort ?? (type === 'nx' ? 7001 : (type === 'Onvif' ? 80 : null)),
      nx_id: this.cleanNxId(snap.nxId) || '',
      ...(type === 'Onvif' ? { selected_stream: idx, selected_profile_token: token } : {})
    }, { emitEvent: false });

    if (type === 'Onvif') {
      this.onvifTokens.set(tokens);
      this.selectedOnvifIndex.set(idx);
      this.selectedProfileTokenSig.set(token);
    }
    this.cameraForm.get('forced_fps')?.updateValueAndValidity();
  }

  private resetForm(): void {
    this.isPopulatingForm = true;
    try {
      this.lastProbedKey = '';
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
        selected_stream: 0,
        selected_profile_token: '',
        nx_id: '',
        forced_resolution: '',
        forced_fps: null,
        decoder: 'opencv',
        compatibility_mode: false,
        ptz_mode: 'auto',
        proveedor_detecciones: 'servidor'
      });
      this.updateConditionalValidators('');
      this.onvifTokens.set([]);
      this.onvifProfiles.set([]);
      this.selectedOnvifIndex.set(null);
      this.nxCamerasList.set([]);
      this.probeStatus.set('idle');
      this.probeMessage.set(null);
      this.fieldsWithAlert.set(new Set());
      this.errorMessage.set(null);
      this.isSubmitting.set(false);
      this.isSubmitted.set(false);
      this.showPassword.set(false);
      this.activeDropdown.set(null);
      this.hostSearch.set('');
      this.nxCameraSearch.set('');
      this.destroyMap();
    } finally {
      this.isPopulatingForm = false;
    }
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

  get selectedNxCamera(): NxCameraInfo | undefined {
    const rawId = this.cameraForm?.get('nx_id')?.value;
    if (!rawId) return undefined;
    const clean = this.cleanNxId(rawId);
    return this.nxCamerasList().find(c => this.cleanNxId(c.id) === clean);
  }

  get currentNxCameraLabel(): string {
    const currentId = this.cameraForm?.get('nx_id')?.value;
    if (currentId) {
      return this.cleanNxId(currentId);
    }
    if (this.isProbing()) {
      return 'Descubriendo cámaras en el servidor...';
    }
    if (this.nxCamerasList().length > 0) {
      return 'Seleccionar cámara detectada...';
    }
    if (this.probeStatus() === 'error') {
      return 'Sin conexión con el servidor NX';
    }
    return 'Ingresa IP y credenciales para listar cámaras';
  }

  checkNxMarquee(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    const textEl = target.querySelector('.nx-cam-name-marquee') as HTMLElement | null;
    const containerEl = target.querySelector('.nx-cam-name-container') as HTMLElement | null;
    if (!textEl || !containerEl) return;
    const shift = textEl.scrollWidth - containerEl.clientWidth;
    if (shift > 2) {
      textEl.style.setProperty('--nx-marquee-shift', `-${shift + 4}px`);
      textEl.classList.add('is-animating-marquee');
    }
  }

  resetNxMarquee(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    const textEl = target.querySelector('.nx-cam-name-marquee') as HTMLElement | null;
    if (textEl) {
      textEl.classList.remove('is-animating-marquee');
      textEl.style.removeProperty('--nx-marquee-shift');
    }
  }

  get currentOnvifProfileLabel(): string {
    const token = this.cameraForm?.get('selected_profile_token')?.value;
    if (token) {
      return token;
    }
    const streamIdx = this.cameraForm?.get('selected_stream')?.value;
    const tokens = this.onvifTokens();
    if (streamIdx !== null && streamIdx !== undefined && tokens.length > streamIdx) {
      return tokens[streamIdx];
    }
    if (this.isProbing()) {
      return 'Detectando perfiles...';
    }
    if (this.probeStatus() === 'error') {
      return 'Sin conexión con la cámara';
    }
    if (tokens.length > 0) {
      return 'Seleccionar perfil...';
    }
    return 'Ingresa IP y credenciales';
  }

  get currentResolutionLabel(): string {
    const val = this.cameraForm?.get('forced_resolution')?.value;
    const opt = this.filteredResolutionOptions().find(o => o.value === val) || this.resolutionOptions.find(o => o.value === val);
    return opt ? opt.label : (val ? `${val} — Personalizada` : 'Seleccionar resolución...');
  }

  get currentPtzModeLabel(): string {
    const val = this.cameraForm?.get('ptz_mode')?.value;
    const opt = this.ptzModeOptions.find(o => o.value === val);
    return opt ? opt.label : 'Automático';
  }

  get currentProveedorDetecciones(): ProveedorDetecciones {
    return (this.cameraForm?.get('proveedor_detecciones')?.value as ProveedorDetecciones) || 'servidor';
  }

  setProveedorDetecciones(prov: ProveedorDetecciones): void {
    if (this.cameraForm.get('proveedor_detecciones')?.value === prov) return;
    this.cameraForm.get('proveedor_detecciones')?.setValue(prov);
    this.cameraForm.get('proveedor_detecciones')?.markAsDirty();
  }

  get isFfmpegDecoder(): boolean {
    return this.cameraForm?.get('decoder')?.value === 'ffmpeg';
  }

  get isCompatibilityMode(): boolean {
    return !!this.cameraForm?.get('compatibility_mode')?.value;
  }

  setDecoder(dec: DecoderType): void {
    if (this.cameraForm.get('decoder')?.value === dec) return;
    this.cameraForm.get('decoder')?.setValue(dec);
    this.cameraForm.get('decoder')?.markAsDirty();
    this.clearFieldAlert('decoder');
  }

  toggleDecoder(): void {
    const current = this.cameraForm.get('decoder')?.value;
    const next: DecoderType = current === 'ffmpeg' ? 'opencv' : 'ffmpeg';
    this.setDecoder(next);
  }

  onDecoderSwitchChange(event: Event): void {
    const isChecked = (event.target as HTMLInputElement).checked;
    this.setDecoder(isChecked ? 'ffmpeg' : 'opencv');
  }

  setCompatibilityMode(val: boolean): void {
    if (this.cameraForm.get('compatibility_mode')?.value === val) return;
    this.cameraForm.get('compatibility_mode')?.setValue(val);
    this.cameraForm.get('compatibility_mode')?.markAsDirty();
  }

  toggleCompatibilityMode(): void {
    const current = !!this.cameraForm.get('compatibility_mode')?.value;
    this.setCompatibilityMode(!current);
  }

  toggleDropdown(name: 'host' | 'streamType' | 'resolution' | 'ptzMode' | 'nxCamera' | 'onvifProfile', event?: MouseEvent): void {
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
    const prevType = this.cameraForm.get('stream_type')?.value;
    if (prevType !== type) {
      this.cancelCurrentProbe();
    }
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
    this.cameraForm.get('forced_resolution')?.markAsDirty();
    this.clearFieldAlert('forced_resolution');
    this.closeDropdowns();
  }



  selectPtzMode(mode: PtzMode, event?: MouseEvent): void {
    event?.stopPropagation();
    this.cameraForm.get('ptz_mode')?.setValue(mode);
    this.cameraForm.get('ptz_mode')?.markAsDirty();
    this.closeDropdowns();
  }

  onHostSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.hostSearch.set(val);
  }

  isFieldInvalid(field: string): boolean {
    const ctrl = this.cameraForm.get(field);
    if (!ctrl) return false;
    return (ctrl.invalid && (ctrl.touched || this.isSubmitted())) || this.fieldsWithAlert().has(field);
  }

  clearFieldAlert(field: string): void {
    if (this.fieldsWithAlert().has(field)) {
      this.fieldsWithAlert.update(set => {
        const next = new Set(set);
        next.delete(field);
        return next;
      });
    }
  }

  // ── Motor Reactivo de Verificación Automática (/probe) ───────────────────
  private setupAutoProbe(): void {
    merge(
      this.autoProbeImmediate$.pipe(
        map(ev => ({ force: !!ev.force, streamType: this.currentStreamType }))
      ),
      this.autoProbeDebounced$.pipe(
        map(ev => ({ force: !!ev.force, streamType: this.currentStreamType })),
        switchMap(payload =>
          timer(750).pipe(
            takeUntil(this.cancelProbe$),
            map(() => payload)
          )
        )
      )
    ).pipe(
      takeUntilDestroyed(this.destroyRef),
      filter((payload): payload is { force: boolean; streamType: StreamType } => !!payload.streamType && payload.streamType === this.currentStreamType),
      switchMap(payload =>
        this.executeProbe(payload.force, payload.streamType).pipe(
          takeUntil(this.cancelProbe$),
          finalize(() => {
            if (this.currentStreamType === payload.streamType) {
              this.isProbing.set(false);
            }
          })
        )
      )
    ).subscribe();
  }

  retryProbe(): void {
    this.cancelCurrentProbe();
    this.autoProbeImmediate$.next({ force: true });
  }

  probeConnection(): void {
    this.retryProbe();
  }

  private executeProbe(force: boolean = false, targetStreamType?: StreamType | ''): Observable<any> {
    const f = this.cameraForm?.value;
    if (!f) {
      this.isProbing.set(false);
      return of(null);
    }

    const host = f.fingerprint_host;
    const type = targetStreamType || this.currentStreamType;

    if (!host || !type || type !== this.currentStreamType) {
      this.isProbing.set(false);
      return of(null);
    }

    // ── RTSP / RTMP ──
    if (type === 'rtsp' || type === 'rtmp') {
      const url = (f.stream_url || '').trim();
      if (!url || !/^(rtsp|rtmp):\/\/\S+$/i.test(url)) {
        this.isProbing.set(false);
        return of(null);
      }
      const probeKey = `${host}|${type}|${url}`;
      if (!force && probeKey === this.lastProbedKey && this.probeStatus() === 'success') {
        return of(null);
      }
      this.lastProbedKey = probeKey;
      this.isProbing.set(true);
      this.probeStatus.set('idle');
      this.probeMessage.set(null);

      return this.cameraService.probeCamera<{ status?: 'Online' | 'Offline'; mensaje?: string }>({
        fingerprint_host: host,
        probe_type: 'validate_stream',
        params: { url }
      }).pipe(
        takeUntil(this.cancelProbe$),
        tap({
          next: (res) => {
            if (this.currentStreamType !== type) return;
            this.isProbing.set(false);
            const status = res.data?.status;
            if (status === 'Online') {
              this.probeStatus.set('success');
              this.probeMessage.set('Flujo de video verificado en línea (Online).');
            } else if (status === 'Offline') {
              this.probeStatus.set('error');
              this.probeMessage.set('El flujo de video no entrega frames o se encuentra fuera de línea (Offline).');
            } else {
              this.probeStatus.set('success');
              this.probeMessage.set(res.data?.mensaje || 'Flujo de video verificado correctamente desde el nodo.');
            }
          },
          error: (err) => {
            if (this.currentStreamType !== type) return;
            this.isProbing.set(false);
            this.probeStatus.set('error');
            this.probeMessage.set(err?.error?.detail || 'El nodo no pudo abrir el flujo de video indicado.');
          }
        }),
        catchError(() => of(null))
      );
    }

    // ── ARCHIVO ──
    if (type === 'Archivo') {
      const path = (f.stream_url || '').trim();
      if (!path) {
        this.isProbing.set(false);
        return of(null);
      }
      const probeKey = `${host}|${type}|${path}`;
      if (!force && probeKey === this.lastProbedKey && this.probeStatus() === 'success') {
        return of(null);
      }
      this.lastProbedKey = probeKey;
      this.isProbing.set(true);
      this.probeStatus.set('idle');
      this.probeMessage.set(null);

      return this.cameraService.probeCamera<{ exists?: boolean; is_video?: boolean; mensaje?: string }>({
        fingerprint_host: host,
        probe_type: 'validate_file',
        params: { path }
      }).pipe(
        takeUntil(this.cancelProbe$),
        tap({
          next: (res) => {
            if (this.currentStreamType !== type) return;
            this.isProbing.set(false);
            const exists = res.data?.exists;
            const isVideo = res.data?.is_video;
            if (exists && isVideo) {
              this.probeStatus.set('success');
              this.probeMessage.set('Archivo de video comprobado y legible en el nodo.');
            } else if (exists === false) {
              this.probeStatus.set('error');
              this.probeMessage.set('El archivo no existe en el disco del host.');
            } else if (isVideo === false) {
              this.probeStatus.set('error');
              this.probeMessage.set('El archivo existe pero no es un video compatible legible.');
            } else {
              this.probeStatus.set('success');
              this.probeMessage.set(res.data?.mensaje || 'Archivo de video comprobado correctamente en el nodo.');
            }
          },
          error: (err) => {
            if (this.currentStreamType !== type) return;
            this.isProbing.set(false);
            this.probeStatus.set('error');
            this.probeMessage.set(err?.error?.detail || 'El nodo no pudo leer el archivo de video en la ruta especificada.');
          }
        }),
        catchError(() => of(null))
      );
    }

    // ── ONVIF ──
    if (type === 'Onvif') {
      const ip = (f.ip_address || '').trim();
      const port = f.http_port ? Number(f.http_port) : 80;
      const user = (f.user || '').trim();
      const password = (f.password || '').trim();
      const hasPassword = !!password;

      // Salvaguarda estricta: NO disparar si falta contraseña o usuario para prevenir lockout físico
      if (!ip || !user || !hasPassword || isNaN(port) || port < 1 || port > 65535) {
        this.isProbing.set(false);
        return of(null);
      }

      const probeKey = `${host}|${type}|${ip}|${port}|${user}|${password}`;
      if (!force && probeKey === this.lastProbedKey && this.probeStatus() === 'success') {
        return of(null);
      }
      this.lastProbedKey = probeKey;
      this.isProbing.set(true);
      this.probeStatus.set('idle');
      this.probeMessage.set(null);

      return this.cameraService.probeCamera<OnvifProfilesProbeData>({
        fingerprint_host: host,
        probe_type: 'onvif_profiles',
        params: { ip, port, user, password }
      }).pipe(
        takeUntil(this.cancelProbe$),
        tap({
          next: (res) => {
            if (this.currentStreamType !== type) return;
            this.isProbing.set(false);
            const data = res.data || {};
            const profiles = data.perfiles || [];
            const tokens = data.tokens || [];
            this.onvifProfiles.set(profiles);
            this.onvifTokens.set(tokens);
            if (tokens.length > 0 && !this.cameraForm.get('selected_profile_token')?.value) {
              this.cameraForm.patchValue({
                selected_stream: 0,
                selected_profile_token: tokens[0]
              });
              this.selectedOnvifIndex.set(0);
              if (profiles.length > 0) {
                const prof = profiles[0];
                if (prof.resolucion) {
                  this.cameraForm.get('forced_resolution')?.setValue(prof.resolucion, { emitEvent: false });
                  this.clearFieldAlert('forced_resolution');
                }
                if (prof.fps && prof.fps > 0) {
                  this.cameraForm.get('forced_fps')?.setValue(prof.fps, { emitEvent: false });
                  this.clearFieldAlert('forced_fps');
                }
                this.cameraForm.get('forced_fps')?.updateValueAndValidity();
              }
            } else if (tokens.length > 0) {
              const currentToken = this.cameraForm.get('selected_profile_token')?.value;
              const idx = tokens.indexOf(currentToken);
              const streamIdx = this.cameraForm.get('selected_stream')?.value;
              const selectedIdx = idx >= 0 ? idx : (streamIdx !== null && streamIdx !== undefined && streamIdx >= 0 && streamIdx < tokens.length ? Number(streamIdx) : 0);
              this.selectedOnvifIndex.set(selectedIdx);
              if (profiles.length > selectedIdx) {
                const prof = profiles[selectedIdx];
                const currentRes = this.cameraForm.get('forced_resolution')?.value;
                const currentFps = this.cameraForm.get('forced_fps')?.value;
                if (!currentRes && prof.resolucion) {
                  this.cameraForm.get('forced_resolution')?.setValue(prof.resolucion, { emitEvent: false });
                  this.clearFieldAlert('forced_resolution');
                } else if (currentRes && prof.resolucion) {
                  const currParsed = this.parseResolution(currentRes);
                  const maxParsed = this.parseResolution(prof.resolucion);
                  if (currParsed && maxParsed && (currParsed.width > maxParsed.width || currParsed.height > maxParsed.height)) {
                    this.cameraForm.get('forced_resolution')?.setValue(prof.resolucion, { emitEvent: false });
                    this.clearFieldAlert('forced_resolution');
                  }
                }
                if ((currentFps === null || currentFps === '') && prof.fps && prof.fps > 0) {
                  this.cameraForm.get('forced_fps')?.setValue(prof.fps, { emitEvent: false });
                  this.clearFieldAlert('forced_fps');
                } else if (currentFps !== null && currentFps !== '' && prof.fps && Number(currentFps) > prof.fps) {
                  this.cameraForm.get('forced_fps')?.setValue(prof.fps, { emitEvent: false });
                  this.clearFieldAlert('forced_fps');
                }
                this.cameraForm.get('forced_fps')?.updateValueAndValidity();
              }
            }
            if (tokens.length > 0) {
              this.probeStatus.set('success');
              this.probeMessage.set(`ONVIF detectado: ${data.fabricante || 'Dispositivo'} (${tokens.length} perfiles disponibles).`);
            } else {
              this.probeStatus.set('error');
              this.probeMessage.set('Conexión ONVIF establecida, pero no se detectaron perfiles de video disponibles.');
            }
          },
          error: (err) => {
            if (this.currentStreamType !== type) return;
            this.isProbing.set(false);
            this.probeStatus.set('error');
            this.probeMessage.set(err?.error?.detail || 'No se pudo conectar a la cámara ONVIF desde el nodo.');
            this.onvifProfiles.set([]);
            this.onvifTokens.set([]);
            this.selectedOnvifIndex.set(null);
            if (this.mode === 'create') {
              this.clearOnvifSelection();
            }
            if (this.activeDropdown() === 'onvifProfile') {
              this.closeDropdowns();
            }
          }
        }),
        catchError(() => of(null))
      );
    }

    // ── NX WITNESS ──
    if (type === 'nx') {
      const ip = (f.ip_address || '').trim();
      const port = f.http_port ? Number(f.http_port) : 7001;
      const user = (f.user || '').trim();
      const password = (f.password || '').trim();
      const hasPassword = !!password;

      // Salvaguarda estricta: NO disparar si falta IP, usuario, contraseña o puerto inválido
      if (!ip || !user || !hasPassword || isNaN(port) || port < 1 || port > 65535) {
        this.isProbing.set(false);
        return of(null);
      }

      const probeKey = `${host}|${type}|${ip}|${port}|${user}|${password}`;
      if (!force && probeKey === this.lastProbedKey && this.probeStatus() === 'success') {
        return of(null);
      }
      this.lastProbedKey = probeKey;
      this.isProbing.set(true);
      this.probeStatus.set('idle');
      this.probeMessage.set(null);

      return this.cameraService.probeCamera<NxCameraInfo[] | { cameras?: NxCameraInfo[] }>({
        fingerprint_host: host,
        probe_type: 'nx_list_cameras',
        params: { ip, port, user, password }
      }).pipe(
        takeUntil(this.cancelProbe$),
        tap({
          next: (res) => {
            if (this.currentStreamType !== type) return;
            this.isProbing.set(false);
            this.probeStatus.set('success');
            const rawData = res.data;
            const rawCams: NxCameraInfo[] = Array.isArray(rawData) ? rawData : (rawData?.cameras || []);
            const cams: NxCameraInfo[] = rawCams.map(c => ({
              ...c,
              id: this.cleanNxId(c.id)
            }));
            this.nxCamerasList.set(cams);
            if (cams.length > 0) {
              this.probeMessage.set(`Servidor NX conectado: ${cams.length} cámara(s) detectada(s).`);
              if (!this.cameraForm.get('nx_id')?.value) {
                this.selectNxCamera(cams[0]);
              }
            } else {
              this.probeMessage.set('Conexión con el servidor NX exitosa, pero no se encontraron cámaras registradas.');
            }
          },
          error: (err) => {
            if (this.currentStreamType !== type) return;
            this.isProbing.set(false);
            this.probeStatus.set('error');
            this.probeMessage.set(err?.error?.detail || 'No se pudo conectar al servidor Nx Witness desde el nodo.');
          }
        }),
        catchError(() => of(null))
      );
    }

    this.isProbing.set(false);
    return of(null);
  }

  selectOnvifProfile(index: number, token: string, event?: MouseEvent): void {
    event?.stopPropagation();
    this.selectedOnvifIndex.set(index);
    this.cameraForm.patchValue({
      selected_stream: index,
      selected_profile_token: token
    });
    this.cameraForm.get('selected_stream')?.markAsDirty();
    this.cameraForm.get('selected_profile_token')?.markAsDirty();
    this.closeDropdowns();

    // Adaptación automática de resolución y FPS según el perfil seleccionado
    const profiles = this.onvifProfiles();
    const prof = profiles[index];
    if (prof) {
      if (prof.resolucion) {
        this.cameraForm.get('forced_resolution')?.setValue(prof.resolucion);
        this.cameraForm.get('forced_resolution')?.markAsDirty();
        this.clearFieldAlert('forced_resolution');
      }
      if (prof.fps && prof.fps > 0) {
        this.cameraForm.get('forced_fps')?.setValue(prof.fps);
        this.cameraForm.get('forced_fps')?.markAsDirty();
        this.clearFieldAlert('forced_fps');
      }
      this.cameraForm.get('forced_fps')?.updateValueAndValidity();
    }
  }

  buildNxRtspStreamUrl(nxId?: string): string {
    const rawId = nxId || this.cameraForm?.get('nx_id')?.value || '';
    const cleanId = this.cleanNxId(rawId);
    if (!cleanId) return '';

    const user = this.cameraForm?.get('user')?.value?.trim() || '';
    const password = this.cameraForm?.get('password')?.value || '';
    const ip = this.cameraForm?.get('ip_address')?.value?.trim() || '';
    const port = this.cameraForm?.get('http_port')?.value || 7001;

    return `rtsp://${user}:${password}@${ip}:${port}/${cleanId}?stream=0&`;
  }

  selectNxCamera(cam: NxCameraInfo, event?: MouseEvent): void {
    event?.stopPropagation();
    const cleanId = this.cleanNxId(cam.id);
    const generatedStreamUrl = this.buildNxRtspStreamUrl(cleanId);
    this.cameraForm.patchValue({
      nx_id: cleanId,
      camera_name: cam.name || '',
      stream_url: generatedStreamUrl
    });
    this.cameraForm.get('camera_name')?.markAsDirty();
    this.cameraForm.get('nx_id')?.markAsDirty();
    this.cameraForm.get('stream_url')?.markAsDirty();
    this.clearFieldAlert('nx_id');
    this.clearFieldAlert('camera_name');
    this.clearFieldAlert('stream_url');
    this.probeMessage.set(`Cámara NX seleccionada: ${cam.name} (${cleanId})`);
    this.closeDropdowns();
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(v => !v);
  }

  onFpsKeydown(event: KeyboardEvent): void {
    if (['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      return;
    }
    if (!/^\d$/.test(event.key)) {
      event.preventDefault();
    }
  }

  onFpsPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') || '';
    if (!/^\d+$/.test(text.trim())) {
      event.preventDefault();
    }
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
      this.cancelCurrentProbe();
      this.close.emit();
    }
  }

  onSubmit(): void {
    this.closeDropdowns();
    this.isSubmitted.set(true);

    if (!this.canSubmit) {
      if (this.cameraForm.invalid) {
        this.cameraForm.markAllAsTouched();
        const invalidFields = new Set<string>();
        Object.keys(this.cameraForm.controls).forEach(key => {
          if (this.cameraForm.get(key)?.invalid) {
            invalidFields.add(key);
          }
        });
        this.fieldsWithAlert.set(invalidFields);
      }
      return;
    }

    this.fieldsWithAlert.set(new Set());
    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const f = this.cameraForm.value;
    const streamType: StreamType = f.stream_type;
    const targetCam = this.editingCameraSnapshot || this.camera;

    if (this.mode === 'edit' && targetCam) {
      // PATCH DIFERENCIAL: Enviar únicamente campos modificados
      const initial = targetCam;
      const updatePayload: CameraFrontendUpdateRequest = {};

      if (f.camera_name?.trim() !== initial.name) {
        updatePayload.camera_name = f.camera_name.trim();
      }
      if (streamType !== initial.streamType) {
        updatePayload.stream_type = streamType;
      }
      if (f.decoder && f.decoder !== initial.decoder) {
        updatePayload.decoder = f.decoder;
      }
      const latStr = String(f.lat).trim();
      const lonStr = String(f.lon).trim();
      const initLat = String(initial.location?.lat ?? '').trim();
      const initLon = String(initial.location?.lon ?? '').trim();
      if (latStr !== initLat || lonStr !== initLon) {
        updatePayload.location = { lat: latStr, lon: lonStr };
      }
      if (f.compatibility_mode !== initial.compatibilityMode) {
        updatePayload.compatibility_mode = !!f.compatibility_mode;
      }
      if (f.ptz_mode !== initial.ptzMode) {
        updatePayload.ptz_mode = f.ptz_mode;
      }
      if (f.proveedor_detecciones !== initial.proveedorDetecciones) {
        updatePayload.proveedor_detecciones = f.proveedor_detecciones;
      }

      // nx_id: universal y opcional
      const nxVal = this.cleanNxId(f.nx_id) || null;
      if (nxVal !== (this.cleanNxId(initial.nxId) || null)) {
        updatePayload.nx_id = nxVal;
      }

      // Flujos y credenciales
      if (streamType === 'Onvif') {
        if (f.ip_address?.trim() !== (initial.ipAddress || '')) {
          updatePayload.ip_address = f.ip_address?.trim() || null;
        }
        if (f.http_port !== (initial.httpPort || null)) {
          updatePayload.http_port = f.http_port ? Number(f.http_port) : null;
        }
        if (f.user?.trim() !== (initial.user || '')) {
          updatePayload.user = f.user?.trim() || null;
        }
        if (f.password) {
          updatePayload.password = f.password;
        }
        // selected_stream y selected_profile_token se envían siempre como par coherente:
        // sin token seleccionado no se modifica el índice (evita guardar un par inconsistente)
        if (f.selected_profile_token) {
          if (f.selected_stream !== initial.selectedStream) {
            updatePayload.selected_stream = f.selected_stream !== null && f.selected_stream !== '' ? Number(f.selected_stream) : 0;
          }
          if (f.selected_profile_token !== initial.selectedProfileToken) {
            updatePayload.selected_profile_token = f.selected_profile_token;
          }
        }
        if (this.onvifTokens().length > 0) {
          updatePayload.streams = this.onvifTokens();
        }
        if (f.stream_url?.trim() && f.stream_url.trim() !== (initial.streamUrl || '')) {
          updatePayload.stream_url = f.stream_url.trim();
        }
      } else if (streamType === 'nx') {
        if (f.ip_address?.trim() !== (initial.ipAddress || '')) {
          updatePayload.ip_address = f.ip_address?.trim() || null;
        }
        if (f.http_port !== (initial.httpPort || null)) {
          updatePayload.http_port = f.http_port ? Number(f.http_port) : null;
        }
        if (f.user?.trim() !== (initial.user || '')) {
          updatePayload.user = f.user?.trim() || null;
        }
        if (f.password) {
          updatePayload.password = f.password;
        }
        if (this.cleanNxId(f.nx_id) !== (this.cleanNxId(initial.nxId) || '')) {
          updatePayload.nx_id = this.cleanNxId(f.nx_id) || null;
        }
        const effectiveStreamUrl = f.stream_url?.trim() || this.buildNxRtspStreamUrl(this.cleanNxId(f.nx_id) || undefined);
        if (effectiveStreamUrl && effectiveStreamUrl !== (initial.streamUrl || '')) {
          updatePayload.stream_url = effectiveStreamUrl;
        }
      } else {
        if (f.stream_url?.trim() !== (initial.streamUrl || '')) {
          updatePayload.stream_url = f.stream_url?.trim() || null;
        }
      }

      // Parámetros de procesamiento
      if (f.forced_resolution !== (initial.forcedResolution || '')) {
        updatePayload.forced_resolution = f.forced_resolution || null;
      }
      if (f.forced_fps !== (initial.forcedFps ?? null)) {
        updatePayload.forced_fps = f.forced_fps !== null && f.forced_fps !== '' ? Number(f.forced_fps) : null;
      }

      this.cameraService.updateCamera(targetCam.id, updatePayload).subscribe({
        next: (updatedCam) => {
          this.isSubmitting.set(false);
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

    // CREACIÓN (POST /frontend/cameras/)
    const request: CameraFrontendCreateRequest = {
      camera_name: f.camera_name.trim(),
      fingerprint_host: f.fingerprint_host,
      stream_type: streamType,
      location: {
        lat: String(f.lat).trim(),
        lon: String(f.lon).trim()
      },
      decoder: f.decoder || 'opencv',
      compatibility_mode: !!f.compatibility_mode,
      ptz_mode: f.ptz_mode || 'auto',
      proveedor_detecciones: f.proveedor_detecciones || 'servidor',
      nx_id: this.cleanNxId(f.nx_id) || null
    };

    if (streamType === 'Onvif') {
      request.ip_address = f.ip_address?.trim() || null;
      request.http_port = f.http_port ? Number(f.http_port) : 80;
      request.user = f.user?.trim() || null;
      request.password = f.password || null;
      request.selected_stream = f.selected_stream !== null && f.selected_stream !== '' ? Number(f.selected_stream) : 0;
      request.selected_profile_token = f.selected_profile_token || (this.onvifTokens()[request.selected_stream] || null);
      request.streams = this.onvifTokens().length > 0 ? this.onvifTokens() : [request.selected_profile_token || 'Profile_1'];
      if (f.stream_url?.trim()) {
        request.stream_url = f.stream_url.trim();
      }
    } else if (streamType === 'nx') {
      request.ip_address = f.ip_address?.trim() || null;
      request.http_port = f.http_port ? Number(f.http_port) : 7001;
      request.user = f.user?.trim() || null;
      request.password = f.password || null;
      request.nx_id = this.cleanNxId(f.nx_id) || null;
      request.stream_url = f.stream_url?.trim() || this.buildNxRtspStreamUrl(request.nx_id || undefined) || null;
      request.streams = null;
    } else {
      request.stream_url = f.stream_url?.trim() || null;
      request.streams = null;
    }

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
    const initialZoom = 14;

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

      let consecutiveTileErrors = 0;
      const tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap',
        bounds: maxWorldBounds,
        noWrap: true,
        errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      });

      tileLayer.on('tileerror', () => {
        consecutiveTileErrors++;
        if (consecutiveTileErrors >= 3 && this.map && this.map.hasLayer(tileLayer)) {
          this.map.removeLayer(tileLayer);
        }
      });

      tileLayer.addTo(this.map);

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

  recenterMap(): void {
    if (!this.map) return;
    const lat = Number(this.cameraForm.get('lat')?.value) || Number(DEFAULT_LATITUDE);
    const lon = Number(this.cameraForm.get('lon')?.value) || Number(DEFAULT_LONGITUDE);
    this.map.setView([lat, lon], 14, { animate: true });
    if (this.marker) {
      this.marker.setLatLng([lat, lon]);
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

  // ─────────────────────────────────────────────────────────────
  // VALIDACIONES PERSONALIZADAS
  // ─────────────────────────────────────────────────────────────
  private numericValidator(control: AbstractControl): ValidationErrors | null {
    if (control.value === null || control.value === '' || control.value === undefined) {
      return null;
    }
    return isNaN(Number(control.value)) ? { numeric: true } : null;
  }

  private urlSchemeValidator(control: AbstractControl): ValidationErrors | null {
    const val = control.value;
    if (!val || typeof val !== 'string') return null;
    const trimmed = val.trim().toLowerCase();
    const valid = trimmed.startsWith('rtsp://') || trimmed.startsWith('rtmp://');
    return valid ? null : { invalidScheme: true };
  }

  private fpsValidator = (control: AbstractControl): ValidationErrors | null => {
    const val = control.value;
    if (val === null || val === '' || val === undefined) return null;
    const num = Number(val);
    const max = this.maxAllowedFps ? this.maxAllowedFps() : 120;
    if (isNaN(num) || num < 1 || num > max) {
      return { invalidFps: true, max };
    }
    return null;
  };
}
