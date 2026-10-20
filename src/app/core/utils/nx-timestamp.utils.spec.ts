import { describe, it, expect } from 'vitest';
import { toEpochMs } from './nx-timestamp.utils';

describe('toEpochMs', () => {
  it('debe devolver undefined para valores nulos, indefinidos o vacíos', () => {
    expect(toEpochMs(null)).toBeUndefined();
    expect(toEpochMs(undefined)).toBeUndefined();
    expect(toEpochMs('')).toBeUndefined();
    expect(toEpochMs('   ')).toBeUndefined();
  });

  it('debe devolver undefined para valores no numéricos o menores/iguales a cero', () => {
    expect(toEpochMs(NaN)).toBeUndefined();
    expect(toEpochMs('abc')).toBeUndefined();
    expect(toEpochMs(0)).toBeUndefined();
    expect(toEpochMs(-1500)).toBeUndefined();
  });

  it('debe convertir segundos a milisegundos y redondear al entero exacto', () => {
    // 1729353012 segundos
    expect(toEpochMs(1729353012)).toBe(1729353012000);
    expect(toEpochMs('1729353012')).toBe(1729353012000);

    // Con decimales (microsegundos/fracciones de segundo)
    expect(toEpochMs(1729353012.3456)).toBe(1729353012346);
    expect(toEpochMs('1729353012.3454')).toBe(1729353012345);
    expect(toEpochMs(1729353012.5)).toBe(1729353012500);
  });

  it('debe conservar valores que ya vienen en milisegundos (> 1e11) redondeándolos si tienen decimales', () => {
    const ms = 1729353012345;
    expect(toEpochMs(ms)).toBe(ms);
    expect(toEpochMs('1729353012345')).toBe(ms);
    expect(toEpochMs(1729353012345.8)).toBe(1729353012346);
  });
});
