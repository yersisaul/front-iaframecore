/**
 * Convierte un timestamp (en segundos o milisegundos) proveniente del backend
 * al formato entero exacto en milisegundos desde la época Unix (1970-01-01T00:00:00Z)
 * requerido por el API de Nx Witness (media.timestampMs).
 *
 * @param value Valor numérico o string numérico (ej. 1729353012.3456 o 1729353012)
 * @returns Número entero redondeado en milisegundos, o undefined si es inválido.
 */
export function toEpochMs(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const raw = typeof value === 'string' ? value.trim() : value;
  if (raw === '') {
    return undefined;
  }

  const num = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    return undefined;
  }

  // Si el valor ya viene en milisegundos (timestamp moderno > 1e11 es aprox > año 1973 en ms)
  // ej: 1.7e12 ms vs 1.7e9 segundos
  if (num > 1e11) {
    return Math.round(num);
  }

  // Viene en segundos (con o sin decimales): multiplicar por 1000 y redondear al entero exacto
  return Math.round(num * 1000);
}
