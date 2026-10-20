/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NxWitnessApiService } from './nx-witness-api.service';
import { NxVmsApi } from '../domain/entities/nx-witness.models';

describe('NxWitnessApiService', () => {
  let service: NxWitnessApiService;
  let mockVms: Partial<NxVmsApi>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    delete (window as any).vms;
    delete (window as any).vmsApiInit;
  });

  afterEach(() => {
    service?.ngOnDestroy();
    delete (window as any).vms;
    delete (window as any).vmsApiInit;
    vi.useRealTimers();
  });

  it('debe detectar que NO está en Nx Witness si window.vms no existe', () => {
    service = new NxWitnessApiService();
    expect(service.isInNxBrowser()).toBe(false);
    expect(service.isApiReady()).toBe(false);
  });

  it('debe detectar que está en Nx Witness si window.vms ya está disponible al instanciar', () => {
    (window as any).vms = {
      log: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
      resources: { resources: vi.fn().mockResolvedValue([]), hasMediaStream: vi.fn().mockResolvedValue(true) },
      tab: { addItem: vi.fn() },
      ErrorCode: { success: 0, failed: 1, denied: 2, invalid_args: 3 }
    };

    service = new NxWitnessApiService();
    expect(service.isInNxBrowser()).toBe(true);
    expect(service.isApiReady()).toBe(true);
  });

  it('debe abrir cámara nueva en el tab con addItem y timestampMs', async () => {
    const addItemMock = vi.fn().mockResolvedValue({
      error: { code: 0, description: 'Success' },
      item: { id: 'item-123' }
    });

    (window as any).vms = {
      log: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
      resources: {
        resources: vi.fn().mockResolvedValue([
          { id: '{550e8400-e29b-41d4-a716-446655440001}', name: 'Camara Principal', type: 'camera' }
        ]),
        hasMediaStream: vi.fn().mockResolvedValue(true)
      },
      tab: {
        state: vi.fn().mockResolvedValue({ items: [] }),
        addItem: addItemMock
      },
      ErrorCode: { success: 0, failed: 1, denied: 2, invalid_args: 3 }
    };

    service = new NxWitnessApiService();

    // Abrimos pasando el ID sin llaves, para comprobar normalización
    const res = await service.openCamera('550e8400-e29b-41d4-a716-446655440001', 'Camara Principal', 1729353012000);

    expect(res.ok).toBe(true);
    expect(addItemMock).toHaveBeenCalledWith(
      '{550e8400-e29b-41d4-a716-446655440001}',
      {
        selected: true,
        focused: true,
        media: {
          timestampMs: 1729353012000,
          speed: 1
        }
      }
    );
  });

  it('debe reposicionar la cámara si ya está presente en el layout', async () => {
    const setParamsMock = vi.fn().mockResolvedValue({ code: 0, description: 'Success' });
    const addItemMock = vi.fn();

    (window as any).vms = {
      log: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
      resources: {
        resources: vi.fn().mockResolvedValue([
          { id: '{cam-uuid-1}', name: 'Camara Existente', type: 'camera' }
        ]),
        hasMediaStream: vi.fn().mockResolvedValue(true)
      },
      tab: {
        state: vi.fn().mockResolvedValue({
          items: [{ id: 'layout-item-99', resourceId: '{cam-uuid-1}' }]
        }),
        setItemParameters: setParamsMock,
        addItem: addItemMock
      },
      ErrorCode: { success: 0, failed: 1, denied: 2, invalid_args: 3 }
    };

    service = new NxWitnessApiService();

    const res = await service.openCamera('cam-uuid-1', 'Camara Existente', 1729353012000);

    expect(res.ok).toBe(true);
    expect(setParamsMock).toHaveBeenCalledWith('layout-item-99', {
      selected: true,
      focused: true,
      media: {
        timestampMs: 1729353012000,
        speed: 1
      }
    });
    expect(addItemMock).not.toHaveBeenCalled();
  });

  it('debe abortar y advertir si la cámara no tiene stream de media activo', async () => {
    (window as any).vms = {
      log: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), debug: vi.fn() },
      resources: {
        resources: vi.fn().mockResolvedValue([{ id: 'cam-offline', name: 'Offline Cam', type: 'camera' }]),
        hasMediaStream: vi.fn().mockResolvedValue(false)
      },
      tab: { addItem: vi.fn() },
      ErrorCode: { success: 0, failed: 1, denied: 2, invalid_args: 3 }
    };

    service = new NxWitnessApiService();
    const res = await service.openCamera('cam-offline', 'Offline Cam');

    expect(res.ok).toBe(false);
    expect(res.message).toContain('no tiene un stream de video activo');
  });
});
