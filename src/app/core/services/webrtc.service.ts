import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { AppEnvironment } from '../config/app-environment';

export interface StreamingResponse {
  server: string;
  camera_id: string;
  [key: string]: any;
}

export interface WebRtcDebugInfo {
  server: string;
  cleanServer: string;
  cameraId: string;
  whepUrl: string;
  timestamp: string;
}

@Injectable({
  providedIn: 'root'
})
export class WebRtcService {
  private http = inject(HttpClient);
  readonly debugInfoMap = new Map<string, WebRtcDebugInfo>();

  constructor() {
    if (typeof window !== 'undefined') {
      (window as any).__webrtcDebug = {
        streams: this.debugInfoMap,
        getInfo: (cameraId?: string) => {
          if (cameraId) return this.debugInfoMap.get(cameraId);
          return Object.fromEntries(this.debugInfoMap.entries());
        },
        setOverrideServer: (serverUrl: string) => {
          (window as any).__webrtc_override_server = serverUrl;
          console.log(`%c[WebRTC Debug] Servidor sobreescrito para próximas peticiones: "${serverUrl}"`, 'color: #00d2ff; font-weight: bold;');
        },
        clearOverrideServer: () => {
          delete (window as any).__webrtc_override_server;
          console.log('%c[WebRTC Debug] Sobreescritura eliminada. Se usará el endpoint backend tal cual.', 'color: #2ed573; font-weight: bold;');
        }
      };
    }
  }

  requestStreaming(cameraId: string): Observable<StreamingResponse> {
    return this.http.post<StreamingResponse>(
      `${AppEnvironment.apiUrl}/frontend/webrtc/${cameraId}`,
      {}
    );
  }

  async startStream(
    cameraId: string,
    videoElement?: HTMLVideoElement | null,
    onStreamReceived?: (stream: MediaStream) => void
  ): Promise<RTCPeerConnection> {
    const timestamp = new Date().toISOString();

    // 1. Obtener la información del streaming desde el backend
    const streamInfo = await firstValueFrom(this.requestStreaming(cameraId));
    if (!streamInfo || !streamInfo.server || !streamInfo.camera_id) {
      console.error(`[WebRTC Frontend] No se pudo obtener la información de streaming para cámara ${cameraId}:`, streamInfo);
      throw new Error('No se pudo obtener la información de streaming de la cámara.');
    }

    // 2. Determinar el servidor base limpio (permitiendo override manual desde DevTools para pruebas)
    let rawServer = (streamInfo.server || '').trim();
    if (typeof window !== 'undefined' && (window as any).__webrtc_override_server) {
      rawServer = String((window as any).__webrtc_override_server).trim();
      console.warn(`%c[WebRTC Debug Override] Usando servidor personalizado desde DevTools: "${rawServer}"`, 'color: #ffa502; font-weight: bold;');
    }

    // Asegurar esquema si el backend devuelve solo dominio o dominio:puerto (evita que el navegador lo trate como ruta relativa local)
    let serverBase = rawServer;
    if (!/^https?:\/\//i.test(serverBase)) {
      const defaultProtocol = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'https://' : 'https://';
      serverBase = `${defaultProtocol}${serverBase}`;
    }
    serverBase = serverBase.replace(/\/+$/, '');

    // Construir la URL WHEP exacta
    const whepUrl = `${serverBase}/${streamInfo.camera_id}/whep`;

    console.group(`%c[WebRTC DEBUG] Conectando Cámara: ${cameraId}`, 'color: #00d2ff; font-weight: bold;');
    console.log('📡 1. Payload recibido del backend:', streamInfo);
    console.log('🌐 2. Servidor base procesado:', serverBase);
    console.log('🎯 3. URL exacta que consultará fetch():', whepUrl);
    console.groupEnd();

    // Guardar información en el mapa de depuración
    const debugEntry: WebRtcDebugInfo = {
      server: streamInfo.server,
      cleanServer: serverBase,
      cameraId: streamInfo.camera_id,
      whepUrl,
      timestamp
    };
    this.debugInfoMap.set(cameraId, debugEntry);

    // Asignar atributos al videoElement para inspección directa en el DOM (DevTools -> Elements)
    if (videoElement) {
      videoElement.setAttribute('data-webrtc-server', streamInfo.server);
      videoElement.setAttribute('data-webrtc-clean-server', serverBase);
      videoElement.setAttribute('data-webrtc-url', whepUrl);
      videoElement.setAttribute('data-camera-id', streamInfo.camera_id);
    }

    // 3. Crear RTCPeerConnection con STUN básico
    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        }
      ]
    });
    (pc as any)._streamDebugInfo = debugEntry;

    // Monitoreo de candidatos locales generados por el cliente
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log(`[WebRTC Frontend Local Candidate] Tipo: %c${event.candidate.type}%c, Protocolo: ${event.candidate.protocol}, Host/IP: ${event.candidate.address || event.candidate.relatedAddress || 'local'}:${event.candidate.port}`, 'color: #ffa502; font-weight: bold;', 'color: inherit;');
      } else {
        console.log('[WebRTC Frontend] Recopilación de ICE candidates locales completada.');
      }
    };

    // Monitoreo de estados ICE y de Conexión
    pc.onicegatheringstatechange = () => {
      console.log(`[WebRTC Frontend ICE Gathering] State: %c${pc.iceGatheringState}`, 'color: #70a1ff; font-weight: bold;');
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WebRTC Frontend ICE Connection] State: %c${pc.iceConnectionState}`, 'color: #eccc68; font-weight: bold;');
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC Frontend PeerConnection] State: %c${pc.connectionState}`, 'color: #3742fa; font-weight: bold;');
    };

    // 4. Asignar el stream cuando se reciba el track
    pc.ontrack = (event) => {
      console.log(`%c[WebRTC Frontend ontrack] ¡Track de video recibido para cámara ${cameraId}!`, 'color: #2ed573; font-size: 1.1em; font-weight: bold;', {
        kind: event.track?.kind,
        id: event.track?.id,
        muted: event.track?.muted,
        readyState: event.track?.readyState,
        streamId: event.streams?.[0]?.id
      });

      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        (pc as any)._remoteStream = stream;
        if (videoElement) {
          videoElement.srcObject = stream;
          videoElement.play().catch(err => {
            console.warn('[WebRtcService] Autoplay warning on videoElement:', err);
          });
        }
        if (onStreamReceived) {
          onStreamReceived(stream);
        }
      }
    };

    // 5. Agregar transceiver para recibir video
    pc.addTransceiver('video', { direction: 'recvonly' });

    // 6. Crear y establecer descripción local
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log(`[WebRTC Frontend Local SDP Offer creada] Type: ${offer.type}`);

    // 7. Esperar a que el ICE gathering esté completo de forma reactiva
    if (pc.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve(); // Continuar tras timeout de 2.5s
        }, 2500);

        const checkState = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(timer);
            pc.removeEventListener('icegatheringstatechange', checkState);
            resolve();
          }
        };
        pc.addEventListener('icegatheringstatechange', checkState);
      });
    }

    // 8. Enviar la Offer al endpoint WHEP de MediaMTX
    console.log(`%c[WebRTC WHEP MediaMTX] Enviando POST a: ${whepUrl}`, 'color: #ff6348; font-weight: bold;', {
      camera_id: streamInfo.camera_id,
      sdp_length: pc.localDescription?.sdp?.length
    });

    const response = await window.fetch(whepUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/sdp'
      },
      signal: AbortSignal.timeout(10000),
      body: pc.localDescription?.sdp || ''
    });

    if (response.status !== 201 && !response.ok) {
      const errorMsg = await response.text().catch(() => response.statusText);
      console.error(`[WebRTC Frontend] Error en WHEP POST (${whepUrl}): HTTP ${response.status} ${response.statusText} - ${errorMsg}`);
      throw new Error(`Error en el servidor de medios MediaMTX WHEP: ${response.statusText} (${errorMsg})`);
    }

    // Guardar URL de sesión WHEP si viene en la cabecera Location (para DELETE al cerrar)
    const locationHeader = response.headers.get('Location');
    if (locationHeader) {
      const sessionUrl = new URL(locationHeader, whepUrl).toString();
      (pc as any)._whepSessionUrl = sessionUrl;
      console.log(`[WebRTC WHEP MediaMTX] Sesión registrada: ${sessionUrl}`);
    }

    const answerSdp = await response.text();
    console.log(`%c[WebRTC Frontend] SDP Answer recibida de MediaMTX (HTTP ${response.status}, ${answerSdp.length} bytes). Aplicando setRemoteDescription...`, 'color: #2ed573; font-weight: bold;');

    // 9. Establecer descripción remota con la Answer recibida en formato SDP texto plano
    await pc.setRemoteDescription(new RTCSessionDescription({
      type: 'answer',
      sdp: answerSdp
    }));
    console.log(`%c[WebRTC Frontend] setRemoteDescription aplicado con éxito. Negociación SDP completada.`, 'color: #2ed573; font-weight: bold;');

    return pc;
  }

  /**
   * Cierra de forma limpia la conexión WebRTC y notifica a MediaMTX mediante HTTP DELETE
   * para liberar inmediatamente los recursos y puertos del servidor.
   */
  stopStream(pc: RTCPeerConnection | null | undefined): void {
    if (!pc) return;

    const sessionUrl = (pc as any)._whepSessionUrl;
    if (sessionUrl) {
      window.fetch(sessionUrl, { method: 'DELETE' }).catch(err => {
        console.warn('[WebRtcService] Advertencia al cerrar sesión WHEP en MediaMTX:', err);
      });
      delete (pc as any)._whepSessionUrl;
    }

    try {
      pc.close();
    } catch (e) {
      console.warn('[WebRtcService] Error al cerrar RTCPeerConnection:', e);
    }
  }
}
