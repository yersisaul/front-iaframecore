import { Injectable, inject, effect } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { ApiKeyConfig } from '../config/api-key.config';

@Injectable({
  providedIn: 'root'
})
export class WebsocketConnectionService {
  private authService = inject(AuthService);

  private socket: WebSocket | null = null;
  private reconnectTimeout: any = null;
  private isConnecting = false;
  private maxReconnectDelay = 30000;
  private reconnectDelay = 2000;

  // Stream expuesto para que los despachadores (handlers) consuman los mensajes del WebSocket
  readonly messages$ = new Subject<any>();

  constructor() {
    // Escuchar cambios de sesión de usuario de forma reactiva
    effect(() => {
      const user = this.authService.currentUser();
      // Limpiar cualquier conexión o intento previo antes de conectar para evitar bloqueos por tokens obsoletos
      this.disconnect();
      
      if (user) {
        this.connect();
      }
    });
  }

  private buildWsUrl(token: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/client?token=${token}`;
  }

  private connect(): void {
    if (this.socket || this.isConnecting) return;

    const token = sessionStorage.getItem('auth_token');
    if (!token) {
      console.log('[WebSocket Connection] Conexión omitida: no se encontró un token de sesión de usuario real.');
      return;
    }

    this.isConnecting = true;
    const url = this.buildWsUrl(token);

    console.log('[WebSocket Connection] Conectando a:', url);

    try {
      const ws = new WebSocket(url);
      this.socket = ws;

      ws.onopen = () => {
        if (this.socket !== ws) return; // Ignorar si es un socket cancelado
        console.log('[WebSocket Connection] Conexión abierta');
        this.isConnecting = false;
        this.reconnectDelay = 2000; // Resetear retraso de reintento
      };

      ws.onmessage = (event) => {
        if (this.socket !== ws) return; // Ignorar si es un socket cancelado
        try {
          const data = JSON.parse(event.data);
          // Difundir el mensaje a los suscriptores
          this.messages$.next(data);
        } catch (e) {
          console.warn('[WebSocket Connection] Mensaje recibido no es JSON:', event.data);
        }
      };

      ws.onclose = (event) => {
        if (this.socket !== ws) {
          console.log('[WebSocket Connection] Conexión cerrada de un socket antiguo (ignorado)');
          return;
        }
        console.log('[WebSocket Connection] Conexión cerrada:', event.reason);
        this.socket = null;
        this.isConnecting = false;
        this.scheduleReconnect();
      };

      ws.onerror = (err) => {
        if (this.socket !== ws) return;
        console.error('[WebSocket Connection] Error detectado:', err);
      };
    } catch (e) {
      console.error('[WebSocket Connection] Fallo al instanciar el cliente:', e);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  private disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.isConnecting = false;
  }

  private closeAndReconnect(): void {
    if (this.socket) {
      try {
        this.socket.close();
      } catch (e) {}
      this.socket = null;
    }
    this.isConnecting = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    // Solo reconectar si el usuario continúa logueado
    if (!this.authService.currentUser()) return;

    console.log(`[WebSocket Connection] Programando reconexión en ${this.reconnectDelay}ms`);
    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
  }
}
