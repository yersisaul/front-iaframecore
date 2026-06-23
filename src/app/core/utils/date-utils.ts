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
    // Regex matches if the string ends with 'Z' or a timezone offset like +HH:MM, -HH:MM, +HH, -HH
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

