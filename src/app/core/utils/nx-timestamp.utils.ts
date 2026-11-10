/**
 * Convierte un timestamp_real en formato Date o string de fecha ISO 8601
 * (ej. "2026-11-04T17:58:34.477+00:00" o Date) al valor exacto en milisegundos
 * desde la época Unix (Epoch ms) requerido por la API de Nx Witness (media.timestampMs).
 *
 * NOTA: Solo acepta formatos de fecha (Date o ISO string).
 * Los valores numéricos son rechazados explícitamente devolviendo undefined.
 *
 * @param value Cadena de fecha ISO 8601 o instancia de Date
 * @returns Número entero redondeado en milisegundos, o undefined si es nulo o inválido.
 */
export function toEpochMs(value: string | Date | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  // Rechazar números explícitamente en tiempo de ejecución (ya no se aceptan numbers)
  if (typeof value === 'number') {
    return undefined;
  }

  // Instancia nativa de Date
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) && ms > 0 ? Math.round(ms) : undefined;
  }

  // Cadena de texto
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;

    // Rechazar strings numéricos puros (ej. "1729353012" o "1729353012.345")
    if (/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return undefined;
    }

    // Parsear fecha ISO 8601 (ej. "2026-11-04T17:58:34.477+00:00")
    const parsedMs = Date.parse(trimmed);
    if (Number.isFinite(parsedMs) && parsedMs > 0) {
      return Math.round(parsedMs);
    }
  }

  return undefined;
}
