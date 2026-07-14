/**
 * Parses a date value (string, Date, number) as UTC if it doesn't specify a timezone.
 * Returns a Javascript Date object representing local time.
 */
export function parseUtcDate(value: any): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    let str = value.trim();
    
    // Soporte para formato DD/MM/YYYY HH:mm(:ss) — el backend devuelve hora LOCAL en este formato
    const slashRegex = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})(:(\d{2}))?$/;
    const match = str.match(slashRegex);
    if (match) {
      const day = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // 0-indexado
      const year = parseInt(match[3], 10);
      const hour = parseInt(match[4], 10);
      const minute = parseInt(match[5], 10);
      const second = match[7] ? parseInt(match[7], 10) : 0;
      // Usar constructor LOCAL (no UTC) porque el backend devuelve hora local del servidor
      return new Date(year, month, day, hour, minute, second);
    }

    const tzRegex = /(Z|([+-]\d{2}(:?\d{2})?))$/;
    if (!tzRegex.test(str)) {
      str = str + 'Z';
    }
    return new Date(str);
  }
  return new Date(value);
}

/**
 * Parses a date value (string, Date, number) in the local timezone.
 * Unlike parseUtcDate, if the string does not specify a timezone, Z is not appended,
 * allowing it to be parsed as local time by the Javascript Date constructor.
 */
export function parseLocalDate(value: any): Date {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    let str = value.trim();
    return new Date(str);
  }
  return new Date(value);
}

/**
 * Extracts HH:mm from a Date object using UTC methods.
 * Use this when the Date was parsed from a UTC backend timestamp (via parseUtcDate)
 * and you need to display the original UTC time regardless of the browser's local timezone.
 */
export function getUtcTimeString(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Extracts YYYY-MM-DD from a Date object using UTC methods.
 * Use this when the Date was parsed from a UTC backend timestamp (via parseUtcDate)
 * and you need to display the original UTC date regardless of the browser's local timezone.
 */
export function getUtcDateString(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
