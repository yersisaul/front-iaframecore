import { describe, it, expect } from 'vitest';
import { toEpochMs } from './nx-timestamp.utils';

describe('toEpochMs', () => {
  it('debe devolver undefined para valores nulos, indefinidos o vacíos', () => {
    expect(toEpochMs(null)).toBeUndefined();
    expect(toEpochMs(undefined)).toBeUndefined();
    expect(toEpochMs('')).toBeUndefined();
    expect(toEpochMs('   ')).toBeUndefined();
  });

  it('debe rechazar números y cadenas numéricas (ya no se aceptan numbers)', () => {
    expect(toEpochMs(1729353012 as any)).toBeUndefined();
    expect(toEpochMs(1729353012.345 as any)).toBeUndefined();
    expect(toEpochMs(0 as any)).toBeUndefined();
    expect(toEpochMs(-1500 as any)).toBeUndefined();
    expect(toEpochMs(NaN as any)).toBeUndefined();
    expect(toEpochMs('1729353012')).toBeUndefined();
    expect(toEpochMs('1729353012.345')).toBeUndefined();
    expect(toEpochMs('abc')).toBeUndefined();
  });

  it('debe parsear correctamente cadenas de fecha en formato ISO 8601 a milisegundos de época', () => {
    const isoStringWithTz = '2026-11-04T17:58:34.477+00:00';
    const expectedMsWithTz = Date.parse(isoStringWithTz);
    expect(toEpochMs(isoStringWithTz)).toBe(expectedMsWithTz);

    const isoStringUtc = '2026-10-19T17:30:12.345Z';
    const expectedMsUtc = Date.parse(isoStringUtc);
    expect(toEpochMs(isoStringUtc)).toBe(expectedMsUtc);
  });

  it('debe parsear correctamente instancias nativas de Date', () => {
    const date = new Date('2026-11-04T17:58:34.477Z');
    expect(toEpochMs(date)).toBe(date.getTime());
  });
});
