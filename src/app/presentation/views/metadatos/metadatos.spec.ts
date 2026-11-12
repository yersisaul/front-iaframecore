import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { Metadatos } from './metadatos';
import { IStorageRepository } from '../../../core/domain/repositories/storage.repository';
import { IMetadataRepository } from '../../../core/domain/repositories/metadata.repository';
import { IListRepository } from '../../../core/domain/repositories/list.repository';
import { ICameraRepository } from '../../../core/domain/repositories/camera.repository';
import { IAuthRepository } from '../../../core/domain/repositories/auth.repository';
import { MediaFileService } from '../../../core/services/media-file.service';

describe('Metadatos', () => {
  let component: Metadatos;
  let fixture: ComponentFixture<Metadatos>;

  const mockStorageRepository = {
    uploadImage: () => of({ url: 'http://test.url', embedding: [] })
  };

  const mockMetadataRepository = {
    getAvailableIndices: () => of([]),
    search: () => of({ records: [], total: 0, filterOptions: { camaras: [], tipoObjeto: [], edades: [], generos: [], reconocimientos: [], colores: [], posturas: [], confiabilidadStats: { min: 0, max: 1 } } }),
    searchFacesByImage: () => of([])
  };

  const mockListRepository = {
    getLists: () => of([]),
    registerList: () => of({}),
    deleteList: () => of(),
    getListDetails: () => of([]),
    registerListDetail: () => of({}),
    deleteListDetail: () => of(),
    updateList: () => of({})
  };

  const mockCameraRepository = {
    getByHost: () => of([]),
    getAll: () => of([]),
    create: () => of({}),
    update: () => of({}),
    updateStatus: () => of({}),
    delete: () => of(undefined)
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Metadatos],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: IStorageRepository, useValue: mockStorageRepository },
        { provide: IMetadataRepository, useValue: mockMetadataRepository },
        { provide: IListRepository, useValue: mockListRepository },
        { provide: ICameraRepository, useValue: mockCameraRepository },
        { provide: IAuthRepository, useValue: { login: () => of() } },
        { provide: MediaFileService, useValue: { getFileUrl: () => of('') } }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Metadatos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should compute limitOptions and adjust pageSize on layout changes', () => {
    component.columns.set(5);

    // base = 5. limitOptions should be: [50, 100, 150]
    expect(component.limitOptions()).toEqual([50, 100, 150]);

    const spySetPageSize = vi.spyOn((component as any).metadataService, 'setPageSize');

    // Trigger adjustment. We call it with a width that fits 4 columns (base cols = 4)
    // 4 * (335 + 24) - 24 = 1412px
    component['adjustColumnsAndLimit'](1412);

    expect(component.columns()).toBe(4);
    expect(spySetPageSize).toHaveBeenCalledWith(40);
  });

  it('should correctly evaluate canAddToList for faces and vehicles based on embedding and recognition', () => {
    // Simular permisos de creación de detalles de listas
    vi.spyOn(component.permissionsService, 'hasPermission').mockReturnValue(true);

    // 1. Rostros con embedding
    component.activeIndex.set('rostros');
    expect(component.canAddToList({ embedding: [0.12, 0.34] })).toBe(true);

    // 2. Rostros sin embedding
    expect(component.canAddToList({ embedding: [] })).toBe(false);
    expect(component.canAddToList({ embedding: null })).toBe(false);
    expect(component.canAddToList({})).toBe(false);

    // 3. Vehículos con reconocimiento (placa)
    component.activeIndex.set('vehiculos');
    expect(component.canAddToList({ reconocimiento: 'ABC-123' })).toBe(true);
    expect(component.canAddToList({ reconocimiento: '' })).toBe(false);
    expect(component.canAddToList({})).toBe(false);
  });

  it('should evaluate canOpenInNx as false when not running inside Nx Witness', () => {
    (component as any).nxWitnessService.isInNxBrowser.set(false);
    expect(component.canOpenInNx({ camaraIdNx: 'cam-1', timestampReal: 1729353012000 })).toBe(false);
  });

  it('should evaluate canOpenInNx as true only when in Nx browser and has camaraIdNx and timestampReal', () => {
    // Simular que estamos en Nx Witness
    (component as any).nxWitnessService.isInNxBrowser.set(true);

    // Con datos completos
    expect(component.canOpenInNx({ camaraIdNx: 'cam-1', timestampReal: 1729353012000 })).toBe(true);

    // Sin timestampReal ni timestamp -> false
    expect(component.canOpenInNx({ camaraIdNx: 'cam-1', timestampReal: undefined, timestamp: undefined })).toBe(false);

    // Sin timestampReal (aunque tenga Date timestamp, NO hay fallback) -> false
    expect(component.canOpenInNx({ camaraIdNx: 'cam-1', timestampReal: undefined, timestamp: new Date(1729353012000) })).toBe(false);

    // Sin camaraIdNx ni cámara en sistema
    expect(component.canOpenInNx({ camaraIdNx: '', timestampReal: 1729353012000 })).toBe(false);
    expect(component.canOpenInNx({ camara_id: 'no-nx-cam', timestampReal: 1729353012000 })).toBe(false);
  });

  it('should call openCamera on nxWitnessService when openInNx is invoked', async () => {
    const openCameraSpy = vi.spyOn((component as any).nxWitnessService, 'openCamera').mockResolvedValue({ ok: true });
    const record = {
      id: 'rec-1',
      camara: 'Entrada',
      camaraIdNx: 'nx-cam-uuid',
      timestampReal: 1729353012000
    };

    await component.openInNx(record);

    expect(openCameraSpy).toHaveBeenCalledWith('nx-cam-uuid', 'Entrada', 1729353012000);
  });

  it('should render En espera / En vivo compact switch at the end of filters-row without badge and sync with buffer banner', () => {
    const metadataService = (component as any).metadataService;
    fixture.detectChanges();

    const toggleBtn = fixture.nativeElement.querySelector('.filters-row #btn-toggle-live-metadata') as HTMLButtonElement | null;
    expect(toggleBtn).toBeTruthy();
    expect(component.isLivePaused()).toBe(true);
    expect(toggleBtn!.getAttribute('role')).toBe('switch');
    expect(toggleBtn!.getAttribute('aria-checked')).toBe('false');
    expect(toggleBtn!.classList.contains('is-live')).toBe(false);
    expect(toggleBtn!.textContent).toContain('En espera');
    expect(toggleBtn!.querySelector('.live-switch-thumb-icon.icon-pause-simple')).toBeTruthy();
    expect(toggleBtn!.querySelector('.live-switch-badge')).toBeNull();

    // Simular llegada de un metadato en espera mientras el switch está en "En espera"
    metadataService.addNewRecord({
      id: 'meta-buf-1',
      camara: 'Cam 1',
      timestamp: '2026-11-12T12:00:00Z',
      confiabilidad: 0.9,
      colores: []
    });
    fixture.detectChanges();

    // No debe renderizar live-switch-badge en el switch; el conteo vive en el banner inferior
    expect(toggleBtn!.querySelector('.live-switch-badge')).toBeNull();
    const bannerBtn = Array.from(fixture.nativeElement.querySelectorAll('button'))
      .find((b: any) => b.textContent?.includes('Ver nuevos metadatos')) as HTMLButtonElement | undefined;
    expect(bannerBtn).toBeTruthy();

    // Pulsar "Ver nuevos metadatos" debe traer el buffer y cambiar el switch a "En vivo"
    bannerBtn!.click();
    fixture.detectChanges();

    expect(component.isLivePaused()).toBe(false);
    expect(component.bufferedEvents().length).toBe(0);
    expect(toggleBtn!.getAttribute('aria-checked')).toBe('true');
    expect(toggleBtn!.classList.contains('is-live')).toBe(true);
    expect(toggleBtn!.textContent).toContain('En vivo');
    expect(toggleBtn!.querySelector('.live-switch-thumb-icon.icon-play-simple')).toBeTruthy();

    // Pulsar el switch vuelve a "En espera"
    toggleBtn!.click();
    fixture.detectChanges();

    expect(component.isLivePaused()).toBe(true);
    expect(toggleBtn!.getAttribute('aria-checked')).toBe('false');
    expect(toggleBtn!.classList.contains('is-live')).toBe(false);
    expect(toggleBtn!.textContent).toContain('En espera');
    expect(toggleBtn!.querySelector('.live-switch-thumb-icon.icon-pause-simple')).toBeTruthy();
  });
});


