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

  async startStream(cameraId: string, videoElement: HTMLVideoElement): Promise<RTCPeerConnection> {
    // 1. Obtener la información del streaming desde el backend
    const streamInfo = await firstValueFrom(this.requestStreaming(cameraId));
    if (!streamInfo || !streamInfo.host || !streamInfo.port) {
      throw new Error('No se pudo obtener la información de streaming de la cámara.');
    }

    // 2. Crear RTCPeerConnection con STUN básico
    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: 'stun:stun.l.google.com:19302'
        }
      ]
    });

    // 3. Asignar el stream cuando se reciba el track
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        videoElement.srcObject = event.streams[0];
      }
    };

    // 4. Agregar transceiver para recibir video
    pc.addTransceiver('video', { direction: 'recvonly' });

    // 5. Crear y establecer descripción local
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // 6. Esperar a que el ICE gathering esté completo (igual que test.html)
    while (pc.iceGatheringState !== 'complete') {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // 7. Enviar la Offer al servidor de medios usando fetch nativo para evitar interceptores
    const offerUrl = `http://${streamInfo.host}:${streamInfo.port}/offer`;
    const response = await window.fetch(offerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        sdp: pc.localDescription?.sdp,
        type: pc.localDescription?.type,
        camera_id: streamInfo.camera_id
      })
    });

    if (!response.ok) {
      throw new Error(`Error en el servidor de medios al enviar la oferta: ${response.statusText}`);
    }

    const answer = await response.json();
    
    // 8. Establecer descripción remota con la Answer recibida
    await pc.setRemoteDescription(new RTCSessionDescription(answer));

    return pc;
  }
}
