import { describe, it, expect } from 'vitest';
import { EventMapper } from './event.mapper';

describe('EventMapper', () => {
  it('should map camara_id_nx and convert timestamp_real to milliseconds', () => {
    const rawHit = {
      _id: 'hit-123',
      _source: {
        event_id: 'ev-custom-id',
        timestamp: '2026-10-19T17:30:12.345Z',
        timestamp_real: 1729359012.345, // Segundos con decimales
        nombre_camara: 'Entrada Vehicular',
        id_camara: 'cam-01',
        camara_id_nx: 'nx-uuid-camera-abc',
        analitica: 'Cruce de Linea',
        objeto: 'Auto',
        detalle_evento: 'Vehículo cruzó la línea'
      }
    };

    const domain = EventMapper.toDomain(rawHit);

    expect(domain.id).toBe('hit-123');
    expect(domain.eventId).toBe('ev-custom-id');
    expect(domain.camaraIdNx).toBe('nx-uuid-camera-abc');
    expect(domain.idCamara).toBe('cam-01');
    expect(domain.nombreCamara).toBe('Entrada Vehicular');
    // 1729359012.345 * 1000 = 1729359012345 ms
    expect(domain.timestampReal).toBe(1729359012345);
  });

  it('should handle missing camara_id_nx and fallback id_camara / camara_id', () => {
    const rawHit = {
      _id: 'hit-456',
      _source: {
        timestamp: '2026-10-19T17:30:12Z',
        camara_id: 'fallback-cam-id',
        nombre_camara: 'Pasillo'
      }
    };

    const domain = EventMapper.toDomain(rawHit);

    expect(domain.camaraIdNx).toBeUndefined();
    expect(domain.idCamara).toBe('fallback-cam-id');
    expect(domain.timestampReal).toBeUndefined();
  });
});
