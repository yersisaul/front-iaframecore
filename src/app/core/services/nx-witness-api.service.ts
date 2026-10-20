import { Injectable, signal, OnDestroy } from '@angular/core';
import {
  NxResource,
  NxItemParams,
  NxVmsApi,
  NxErrorResult
} from '../domain/entities/nx-witness.models';

export interface NxOpenResult {
  ok: boolean;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class NxWitnessApiService implements OnDestroy {
  readonly isApiReady = signal<boolean>(false);
  readonly isInNxBrowser = signal<boolean>(false);
  readonly isOpening = signal<boolean>(false);
  readonly lastError = signal<string | null>(null);

  private checkIntervalId: any = null;
  private checkTimeoutId: any = null;

  constructor() {
    this.initNxApiDetection();
  }

  ngOnDestroy(): void {
    this.cleanupTimers();
  }

  private cleanupTimers(): void {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }
    if (this.checkTimeoutId) {
      clearTimeout(this.checkTimeoutId);
      this.checkTimeoutId = null;
    }
  }

  /**
   * Inicializa la escucha y detección de Nx Witness API
   */
  private initNxApiDetection(): void {
    if (typeof window === 'undefined') return;

    // Registrar callback global requerido por Nx Witness
    const existingInit = window.vmsApiInit;
    window.vmsApiInit = async () => {
      if (typeof existingInit === 'function') {
        try {
          await existingInit();
        } catch (e) {
          console.warn('[NxWitnessApiService] Error ejecutando previo vmsApiInit:', e);
        }
      }
      this.markApiReady();
    };

    // Si window.vms ya fue inyectado antes del constructor
    if (window.vms) {
      this.markApiReady();
      return;
    }

    // Polling breve por si Nx inyecta el objeto asíncronamente
    this.checkIntervalId = setInterval(() => {
      if (window.vms) {
        this.markApiReady();
        this.cleanupTimers();
      }
    }, 100);

    // Timeout de verificación a los 10 segundos
    this.checkTimeoutId = setTimeout(() => {
      this.cleanupTimers();
      if (!this.isApiReady()) {
        // En navegador estándar no es un error crítico, simplemente no está en Nx
        this.isInNxBrowser.set(false);
      }
    }, 10000);
  }

  private markApiReady(): void {
    this.isInNxBrowser.set(true);
    this.isApiReady.set(true);
    this.lastError.set(null);
    if (window.vms?.log) {
      window.vms.log.info('[NxWitnessApiService] API de Nx Witness detectada y lista en IAFrame');
    }
  }

  /**
   * Normaliza un identificador de Nx (remueve llaves {} y espacios, minúsculas)
   */
  private normalizeId(id: string): string {
    return (id || '').replace(/[{}]/g, '').trim().toLowerCase();
  }

  /**
   * Obtiene la lista de cámaras disponibles en el cliente de Nx Witness
   */
  async getAvailableCameras(): Promise<NxResource[]> {
    if (!this.isApiReady() || !window.vms) {
      return [];
    }
    try {
      const resources = await window.vms.resources.resources();
      return (resources || []).filter(r => r.type === 'camera' || !r.type);
    } catch (err) {
      console.error('[NxWitnessApiService] Error obteniendo recursos de Nx:', err);
      return [];
    }
  }

  /**
   * Busca un recurso de cámara por su ID (comparando con tolerancia a llaves {})
   */
  async resolveCameraResource(camaraIdNx: string): Promise<NxResource | null> {
    if (!camaraIdNx || !this.isApiReady() || !window.vms) return null;
    const targetNorm = this.normalizeId(camaraIdNx);
    const cameras = await this.getAvailableCameras();
    const match = cameras.find(c => this.normalizeId(c.id) === targetNorm);
    return match || null;
  }

  /**
   * Abre o reposiciona una cámara en el panel activo de Nx Witness con un timestamp exacto.
   *
   * @param camaraIdNx ID de la cámara en Nx (ej. "{550e8400-...}" o "550e8400-...")
   * @param cameraName Nombre de la cámara para logs y mensajes
   * @param timestampMs Instante de tiempo epoch en milisegundos (opcional)
   */
  async openCamera(camaraIdNx: string, cameraName?: string, timestampMs?: number): Promise<NxOpenResult> {
    const vms = window.vms;
    const displayName = cameraName || camaraIdNx;

    if (!this.isApiReady() || !vms) {
      const msg = 'Nx Witness API no está disponible en este entorno.';
      this.lastError.set(msg);
      return { ok: false, message: msg };
    }

    if (!camaraIdNx?.trim()) {
      const msg = 'No se proporcionó un ID de Nx para esta cámara.';
      this.lastError.set(msg);
      return { ok: false, message: msg };
    }

    this.isOpening.set(true);
    this.lastError.set(null);

    try {
      // 1. Resolver el ID exacto registrado en Nx si es posible
      const resolved = await this.resolveCameraResource(camaraIdNx);
      const effectiveId = resolved ? resolved.id : camaraIdNx.trim();

      // 2. Comprobar si tiene stream de media
      try {
        const hasStream = await vms.resources.hasMediaStream(effectiveId);
        if (hasStream === false) {
          const msg = `La cámara "${displayName}" no tiene un stream de video activo en Nx Witness.`;
          vms.log.warning(`[IAFrame] ${msg}`);
          this.lastError.set(msg);
          this.isOpening.set(false);
          return { ok: false, message: msg };
        }
      } catch (e) {
        // Si falla la llamada de verificación, continuar con el intento de agregar item
        console.warn('[NxWitnessApiService] hasMediaStream omitido por error:', e);
      }

      // 3. Preparar parámetros del item
      const itemParams: NxItemParams = {
        selected: true,
        focused: true
      };

      if (timestampMs !== undefined && Number.isFinite(timestampMs) && timestampMs > 0) {
        itemParams.media = {
          timestampMs: Math.round(timestampMs),
          speed: 1
        };
      }

      // 4. Verificar si la cámara ya está presente en el layout actual
      let existingItemId: string | null = null;
      try {
        if (typeof vms.tab?.state === 'function') {
          const tabState = await vms.tab.state();
          const items = tabState?.items || [];
          const targetNorm = this.normalizeId(effectiveId);
          const found = items.find((it: any) => this.normalizeId(it.resourceId || it.resource?.id) === targetNorm);
          if (found?.id) {
            existingItemId = found.id;
          }
        }
      } catch (err) {
        console.warn('[NxWitnessApiService] Error verificando estado de layout:', err);
      }

      // 5. Reposicionar si ya existe o agregar si es nueva
      if (existingItemId) {
        let setParamsFn: ((itemId: string, params: NxItemParams) => Promise<NxErrorResult>) | undefined;
        if (typeof vms.tab?.setItemParameters === 'function') {
          setParamsFn = vms.tab.setItemParameters.bind(vms.tab);
        } else if (typeof vms.tab?.setItemParams === 'function') {
          setParamsFn = vms.tab.setItemParams.bind(vms.tab);
        }

        if (setParamsFn) {
          const updateRes = await setParamsFn(existingItemId, itemParams);
          if (updateRes.code === vms.ErrorCode.success) {
            vms.log.info(`[IAFrame] Cámara "${displayName}" reposicionada en Nx`);
            this.isOpening.set(false);
            return { ok: true };
          }
        }
      }

      // Si no existía o el reposicionamiento falló, agregamos como item nuevo
      const addResult = await vms.tab.addItem(effectiveId, itemParams);

      if (addResult.error.code === vms.ErrorCode.success) {
        vms.log.info(`[IAFrame] Cámara "${displayName}" abierta exitosamente en Nx`);
        this.isOpening.set(false);
        return { ok: true };
      } else {
        const errorDesc = addResult.error.description || `Código ${addResult.error.code}`;
        const msg = `Error al abrir cámara en Nx: ${errorDesc}`;
        vms.log.error(`[IAFrame] ${msg}`);
        this.lastError.set(msg);
        this.isOpening.set(false);
        return { ok: false, message: msg };
      }
    } catch (err: any) {
      const errText = err?.message || 'Error desconocido';
      const msg = `Error al comunicar con Nx Witness: ${errText}`;
      if (vms?.log) {
        vms.log.error(`[IAFrame] ${msg}`);
      }
      this.lastError.set(msg);
      this.isOpening.set(false);
      return { ok: false, message: msg };
    }
  }
}
