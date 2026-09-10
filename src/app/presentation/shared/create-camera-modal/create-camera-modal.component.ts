import {
  Component, Input, Output, EventEmitter, OnInit, OnChanges, SimpleChanges,
  inject, signal, computed, HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { CameraService } from '../../../core/services/camera.service';
import { Host } from '../../../core/domain/entities/host.models';
import { Camera, CameraRegisterRequest, CameraUpdateRequest, StreamType, DecoderType } from '../../../core/domain/entities/camera.models';

export interface StreamTypeOption {
  value: StreamType;
  label: string;
  description: string;
}

@Component({
  selector: 'app-create-camera-modal',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './create-camera-modal.component.html',
  styleUrl: './create-camera-modal.component.css'
})
export class CreateCameraModalComponent implements OnInit, OnChanges {
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

  private backdropMouseDownTarget: EventTarget | null = null;

  ngOnInit(): void {
    this.initForm();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['show'] && this.show) {
      if (this.mode === 'edit' && this.camera) {
        this.populateForm(this.camera);
      } else {
        this.resetForm();
      }
    } else if (changes['camera'] && this.show && this.mode === 'edit' && this.camera) {
      this.populateForm(this.camera);
    }
    if (changes['preselectedHostId'] && this.cameraForm && this.mode === 'create') {
      if (this.preselectedHostId) {
        this.cameraForm.patchValue({ fingerprint_host: this.preselectedHostId });
      }
    }
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
      lat: [null, [Validators.required, this.numericValidator]],
      lon: [null, [Validators.required, this.numericValidator]],
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
      lat: null,
      lon: null,
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
    this.cameraForm.get('decoder')?.setValue(curr === decoder ? '' : decoder);
    this.cameraForm.get('decoder')?.markAsDirty();
    this.cameraForm.get('decoder')?.updateValueAndValidity();
    this.clearFieldAlert('decoder');
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
          lat: Number(f.lat),
          lon: Number(f.lon)
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
        lat: Number(f.lat),
        lon: Number(f.lon)
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

  // Validadores auxiliares
  private numericValidator(control: AbstractControl): ValidationErrors | null {
    if (control.value === null || control.value === undefined || control.value === '') {
      return null;
    }
    const val = Number(control.value);
    return isNaN(val) ? { numeric: true } : null;
  }

  private fpsValidator(control: AbstractControl): ValidationErrors | null {
    if (control.value === null || control.value === undefined || control.value === '') {
      return null;
    }
    const val = Number(control.value);
    if (isNaN(val) || val < 5 || val > 15) {
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
