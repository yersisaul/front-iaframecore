import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { AppEnvironment } from '../config/app-environment';

export interface StreamingResponse {
  server: string;
  camera_id: string;
}

@Injectable({
  providedIn: 'root'
})
export class WebRtcService {
  private http = inject(HttpClient);

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
    console.log(`%c[WebRTC Frontend ${timestamp}] Solicitando endpoint de streaming para cámara: ${cameraId}`, 'color: #00d2ff; font-weight: bold;');

    // 1. Obtener la información del streaming desde el backend
    const streamInfo = await firstValueFrom(this.requestStreaming(cameraId));
    if (!streamInfo || !streamInfo.server || !streamInfo.camera_id) {
      console.error(`[WebRTC Frontend] No se pudo obtener la información de streaming para cámara ${cameraId}:`, streamInfo);
      throw new Error('No se pudo obtener la información de streaming de la cámara.');
    }

    console.log(`%c[WebRTC Frontend] Información de streaming recibida -> Server: ${streamInfo.server}, Camera ID: ${streamInfo.camera_id}`, 'color: #2ed573; font-weight: bold;');

    // 2. Crear RTCPeerConnection con STUN básico
    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        }
      ]
    });

    console.log(`[WebRTC Frontend] RTCPeerConnection inicializada con STUN stun:stun.l.google.com:19302`);

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

    // 3. Asignar el stream cuando se reciba el track
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

    // 4. Agregar transceiver para recibir video
    pc.addTransceiver('video', { direction: 'recvonly' });

    // 5. Crear y establecer descripción local
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    console.log(`[WebRTC Frontend Local SDP Offer creada] Type: ${offer.type}`);

    // 6. Esperar a que el ICE gathering esté completo de forma reactiva
    if (pc.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          pc.removeEventListener('icegatheringstatechange', checkState);
          resolve(); // Continuar tras timeout de 2.5s para permitir recopilar candidatos sin congelar
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

    // 7. Enviar la Offer al endpoint WHEP de MediaMTX
    let serverBase = streamInfo.server.trim();
    try {
      const parsedUrl = new URL(serverBase);
      const isLoopback = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1' || parsedUrl.hostname === '0.0.0.0';
      if (isLoopback && typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        parsedUrl.hostname = window.location.hostname;
        console.info(`[WebRtcService] Host WebRTC loopback del backend corregido a hostname '${window.location.hostname}'`);
      }
      const cleanPath = parsedUrl.pathname.replace(/\/+$/, '');
      serverBase = `${parsedUrl.origin}${cleanPath}`;
    } catch {
      serverBase = serverBase.replace(/\/+$/, '');
    }

    // Endpoint WHEP estándar para MediaMTX
    const whepUrl = `${serverBase}/${streamInfo.camera_id}/whep`;
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

    // 8. Establecer descripción remota con la Answer recibida en formato SDP texto plano
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
