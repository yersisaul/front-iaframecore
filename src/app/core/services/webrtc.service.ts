import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, firstValueFrom } from 'rxjs';
import { AppEnvironment } from '../config/app-environment';

export interface StreamingResponse {
  host: string;
  port: number;
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
    if (!streamInfo || !streamInfo.host || !streamInfo.port) {
      console.error(`[WebRTC Frontend] No se pudo obtener la información de streaming para cámara ${cameraId}:`, streamInfo);
      throw new Error('No se pudo obtener la información de streaming de la cámara.');
    }

    console.log(`%c[WebRTC Frontend] Información de streaming recibida -> Host: ${streamInfo.host}, Port: ${streamInfo.port}, Camera ID: ${streamInfo.camera_id}`, 'color: #2ed573; font-weight: bold;');

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

    // 7. Enviar la Offer al servidor de medios con timeout de 10s
    let targetHost = (streamInfo.host || '').trim();
    const isLoopback = !targetHost || targetHost === 'localhost' || targetHost === '127.0.0.1' || targetHost === '0.0.0.0';
    if (isLoopback && typeof window !== 'undefined' && window.location.hostname && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      targetHost = window.location.hostname;
      console.info(`[WebRtcService] Host WebRTC loopback del backend corregido a hostname '${targetHost}'`);
    }
    const offerUrl = `http://${targetHost}:${streamInfo.port}/offer`;
    console.log(`%c[WebRTC Frontend] Enviando POST /offer a: ${offerUrl}`, 'color: #ff6348; font-weight: bold;', {
      camera_id: streamInfo.camera_id,
      sdp_type: pc.localDescription?.type
    });

    const response = await window.fetch(offerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        sdp: pc.localDescription?.sdp,
        type: pc.localDescription?.type,
        camera_id: streamInfo.camera_id
      })
    });

    if (!response.ok) {
      console.error(`[WebRTC Frontend] Error en POST /offer: HTTP ${response.status} ${response.statusText}`);
      throw new Error(`Error en el servidor de medios al enviar la oferta: ${response.statusText}`);
    }

    const answer = await response.json();
    console.log(`%c[WebRTC Frontend] SDP Answer recibida (HTTP ${response.status}). Aplicando setRemoteDescription...`, 'color: #2ed573; font-weight: bold;', answer);

    // 8. Establecer descripción remota con la Answer recibida
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    console.log(`%c[WebRTC Frontend] setRemoteDescription aplicado con éxito. Negociación SDP completada.`, 'color: #2ed573; font-weight: bold;');

    return pc;
  }
}
