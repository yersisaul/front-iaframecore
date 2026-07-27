import { Camera } from '../domain/entities/camera.models';
import { Host } from '../domain/entities/host.models';

export type CameraStatusType = 'Online' | 'Offline' | 'Degraded' | 'Recovering' | 'Pending';

/**
 * Resuelve el estado efectivo de una cámara considerando su estado individual
 * y la regla de negocio frontend: SOLO cuando la cámara está Online Y su Nodo (Host)
 * NO está Online (está en estado offline/inactivo/apagado), su estado pasa a 'Pending' (Cyan).
 */
export function getCameraEffectiveStatus(
  camera: Camera | null | undefined,
  hosts: Host[] = []
): CameraStatusType {
  if (!camera || !camera.status) return 'Offline';

  const raw = camera.status.trim();
  const rawLower = raw.toLowerCase();

  const isCameraOnline = rawLower === 'online' || rawLower === 'activo' || rawLower === 'active';
  const isCameraDegraded = rawLower === 'degraded' || rawLower === 'degradado';
  const isCameraRecovering = rawLower === 'recovering' || rawLower === 'recuperando';

  // 1. Regla Frontend: SOLO si la cámara está Online Y su Nodo NO está Online -> 'Pending' (Cyan)
  if (isCameraOnline && hosts && hosts.length > 0) {
    const targetFp = (camera.hostFingerprint || '').trim().toLowerCase();

    let host = targetFp
      ? hosts.find(h =>
          (h.fingerprint && h.fingerprint.trim().toLowerCase() === targetFp) ||
          (h.id && h.id.trim().toLowerCase() === targetFp) ||
          (h.hostname && h.hostname.trim().toLowerCase() === targetFp)
        )
      : null;

    if (!host && hosts.length === 1) {
      host = hosts[0];
    }

    if (host) {
      const hStatus = (host.status || '').trim().toLowerCase();
      const isHostOnline = hStatus === 'online' || hStatus === 'active' || hStatus === 'activo';

      // Si el nodo NO está online (está offline/inactivo/apagado/disabled/etc.), la cámara pasa a 'Pending'
      if (!isHostOnline) {
        return 'Pending';
      }
    }
  }

  // 2. Mapear estado directo de la cámara
  if (isCameraOnline) return 'Online';
  if (isCameraDegraded) return 'Degraded';
  if (isCameraRecovering) return 'Recovering';

  return 'Offline';
}

/**
 * Retorna la clase CSS descriptiva para el indicador de punto pulsante o badge.
 */
export function getCameraStatusCssClass(status: CameraStatusType): string {
  switch (status) {
    case 'Online':
      return 'online';
    case 'Degraded':
      return 'degraded';
    case 'Recovering':
      return 'recovering';
    case 'Pending':
      return 'pending';
    case 'Offline':
    default:
      return 'offline';
  }
}

/**
 * Retorna el código de color hexadecimal asignado al estado de la cámara.
 */
export function getCameraStatusColor(status: CameraStatusType): string {
  switch (status) {
    case 'Online':
      return '#10b981'; // Verde
    case 'Degraded':
      return '#f97316'; // Naranja
    case 'Recovering':
      return '#eab308'; // Amarillo
    case 'Pending':
      return '#00e5ff'; // Cyan
    case 'Offline':
    default:
      return '#ef4444'; // Rojo
  }
}
