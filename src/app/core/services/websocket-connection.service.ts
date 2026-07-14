import { Injectable, inject, effect, computed } from '@angular/core';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { ApiKeyConfig } from '../config/api-key.config';
import { HttpClient } from '@angular/common/http';
import { AppEnvironment } from '../config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class WebsocketConnectionService {
  private authService = inject(AuthService);
  private http = inject(HttpClient);

  private socket: WebSocket | null = null;
  private reconnectTimeout: any = null;
  private isConnecting = false;
  private maxReconnectDelay = 30000;
  private reconnectDelay = 2000;

  // Stream expuesto para que los despachadores (handlers) consuman los mensajes del WebSocket
  readonly messages$ = new Subject<any>();

  // Computed que rastrea solo el ID del usuario.
  // Evita reconexiones innecesarias cuando el objeto currentUser se actualiza (ej. al agregar el roleId).
  private currentUserId = computed(() => {
    const id = this.authService.currentUser()?.id;
    console.log('[WebSocket Connection] currentUserId evaluado:', id);
    return id;
  });

  constructor() {
    console.log('[WebSocket Connection] Servicio instanciado');
    // Escuchar cambios de sesión de usuario de forma reactiva
    effect(() => {
      const userId = this.currentUserId();
      console.log('[WebSocket Connection] Effect ejecutado, userId:', userId);
      // Limpiar cualquier conexión o intento previo antes de conectar para evitar bloqueos por tokens obsoletos
      this.disconnect();
      
      if (userId) {
        this.connect();
      }
    });

    // Debugger periódico del token en sessionStorage (cada 5 segundos)
    setInterval(() => {
      const activeToken = sessionStorage.getItem('auth_token');
      const currentUser = this.authService.currentUser();
      console.warn('[WS Debugger] Token activo en sessionStorage:', activeToken);
      console.warn('[WS Debugger] Usuario activo en señal:', currentUser);
    }, 5000);
  }

  private buildWsUrl(token: string): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws/client?token=${token}`;
  }

  private connect(): void {
    console.log('[WebSocket Connection] Intentando conectar. isConnecting:', this.isConnecting, 'socket:', !!this.socket);
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
        const handshakeFailed = this.isConnecting;
        console.log('[WebSocket Connection] Conexión cerrada. Handshake fallido:', handshakeFailed, 'razón:', event.reason);
        this.socket = null;
        this.isConnecting = false;

        if (handshakeFailed) {
          this.validateSessionToken();
        }

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

  private validateSessionToken(): void {
    const token = sessionStorage.getItem('auth_token');
    if (!token) return;

    console.log('[WebSocket Connection] Lanzando petición HTTP de verificación de sesión...');
    // Realizamos una petición simple que requiera autenticación.
    // Si la petición retorna 401/403, el errorInterceptor del HTTP se encargará
    // automáticamente de cerrar la sesión, limpiar sessionStorage y desactivar la señal currentUser.
    this.http.get(`${AppEnvironment.apiUrl}/frontend/permisos/`).subscribe({
      next: () => {
        console.log('[WebSocket Connection] El token sigue siendo válido según la API HTTP.');
      },
      error: (err) => {
        console.warn('[WebSocket Connection] La validación HTTP del token falló.', err);
        // Si el servidor HTTP retorna 401 (Token inválido o expirado), forzamos el logout
        // para limpiar la sesión en sessionStorage y en la señal currentUser, deteniendo así el bucle de reconexión.
        if (err.status === 401) {
          console.warn('[WebSocket Connection] Token inválido detectado (401). Forzando logout local.');
          this.authService.logout().subscribe();
        }
      }
    });
  }

  private disconnect(): void {
    console.log('[WebSocket Connection] disconnect() llamado');
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.socket) {
      console.log('[WebSocket Connection] Cerrando socket existente');
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
