import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { signal } from '@angular/core';
import { Eventos } from './eventos';
import { IEventRepository } from '../../../core/domain/repositories/event.repository';
import { PermissionsService } from '../../../core/services/permissions.service';
import { CameraService } from '../../../core/services/camera.service';

import { ListService } from '../../../core/services/list.service';

describe('Eventos', () => {
  let component: Eventos;
  let fixture: ComponentFixture<Eventos>;

  const mockEventRepository = {
    search: () => of({
      records: [],
      total: 0,
      filterOptions: {
        camaras: [],
        analiticas: [],
        objetos: []
      }
    }),
    getAvailableSubjects: () => of([])
  };

  const mockPermissionsService = {
    hasPermission: () => true
  };

  const mockCameraService = {
    cameras: signal([]),
    getAllCameras: () => of([])
  };

  const mockListService = {
    lists: signal([]),
    loadLists: () => of([]),
    isViewActive: signal(false)
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Eventos],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: IEventRepository, useValue: mockEventRepository },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: CameraService, useValue: mockCameraService },
        { provide: ListService, useValue: mockListService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Eventos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should compute limitOptions and adjust pageSize on layout changes', () => {
    component.columns.set(5);

    // cols = 5 -> limitOptions = [50, 100, 150]
    expect(component.limitOptions()).toEqual([50, 100, 150]);

    const spySetPageSize = vi.spyOn((component as any).eventService, 'setPageSize');
    const spySetPage = vi.spyOn((component as any).eventService, 'setPage');

    // Trigger grid columns adjustment to 4 cols (4 * 359 - 24 = 1412)
    component['adjustColumnsAndLimit'](1412);

    expect(component.columns()).toBe(4);
    expect(spySetPageSize).toHaveBeenCalledWith(40);
    expect(spySetPage).toHaveBeenCalledWith(1);
  });

  it('should toggle multi-select filters and mark pending changes', () => {
    component.toggleMultiSelectFilter('camaras', 'Camara-01');
    expect(component.tempFilters().camaras).toContain('Camara-01');
    expect(component.hasPendingFilterChanges()).toBe(true);

    component.toggleMultiSelectFilter('camaras', 'Camara-01');
    expect(component.tempFilters().camaras).not.toContain('Camara-01');
  });

  it('should reset filters to defaults when onResetFilters is called', () => {
    const spyResetFilters = vi.spyOn((component as any).eventService, 'resetFilters');
    component.onResetFilters();
    expect(spyResetFilters).toHaveBeenCalled();
  });

  it('should toggle sidebar when toggleSidebar is called', () => {
    const spyToggleSidebar = vi.spyOn((component as any).sidebarService, 'toggleSidebar');
    component.toggleSidebar();
    expect(spyToggleSidebar).toHaveBeenCalled();
  });

  it('should exclude traffic analysis events from filteredAnaliticasOptions', () => {
    component.filterOptions.set({
      camaras: [],
      analiticas: ['Cruce de Linea', 'Analisis de Trafico', 'Análisis de Tráfico', 'Aglomeracion', 'traffic_analysis'],
      objetos: [],
      listas: [],
      sujetos: [],
      direcciones: []
    });

    const options = component.filteredAnaliticasOptions();
    expect(options).toContain('Aglomeracion');
    expect(options).toContain('Cruce de Linea');
    expect(options).not.toContain('Analisis de Trafico');
    expect(options).not.toContain('Análisis de Tráfico');
    expect(options).not.toContain('traffic_analysis');
  });

  describe('Nx Witness integration', () => {
    it('should determine canOpenInNx accurately based on environment and record fields', () => {
      // Por defecto no estamos en cliente Nx Witness
      const isInNxSpy = vi.spyOn((component as any).nxWitnessService, 'isInNxBrowser').mockReturnValue(false);

      const record: any = {
        id: 'ev-1',
        nombreCamara: 'Acceso Norte',
        idCamara: 'cam-01',
        camaraIdNx: 'nx-uuid-1234',
        timestampReal: 1729353012000
      };

      // Si no está en Nx browser, debe ser falso
      expect(component.canOpenInNx(record)).toBe(false);

      // Ahora simulamos estar dentro del cliente Nx Witness
      isInNxSpy.mockReturnValue(true);

      // Con camaraIdNx y timestampReal válidos -> true
      expect(component.canOpenInNx(record)).toBe(true);

      // Sin timestampReal pero con timestamp Date válido -> true (fallback)
      expect(component.canOpenInNx({ ...record, timestampReal: undefined, timestamp: new Date(1729353012000) })).toBe(true);

      // Sin timestampReal ni timestamp válido -> false
      expect(component.canOpenInNx({ ...record, timestampReal: undefined, timestamp: undefined })).toBe(false);

      // Sin camaraIdNx directo pero con cámara resoluble en CameraService -> true
      (mockCameraService.cameras as any).set([{ id: 'cam-01', nxId: 'nx-from-service' }]);
      const recordWithoutDirectNx: any = {
        id: 'ev-2',
        nombreCamara: 'Acceso Norte',
        idCamara: 'cam-01',
        timestampReal: 1729353012000
      };
      expect(component.canOpenInNx(recordWithoutDirectNx)).toBe(true);

      // Con idCamara no registrada en sistema y sin camaraIdNx -> false
      expect(component.canOpenInNx({ ...recordWithoutDirectNx, idCamara: 'cam-desconocida' })).toBe(false);
    });

    it('should call openCamera on nxWitnessService when openInNx is executed', async () => {
      const openCameraSpy = vi.spyOn((component as any).nxWitnessService, 'openCamera').mockResolvedValue({ ok: true });
      const stopPropSpy = vi.fn();
      const mockEvent = { stopPropagation: stopPropSpy } as unknown as Event;

      const record: any = {
        id: 'ev-1',
        nombreCamara: 'Camara Principal',
        camaraIdNx: 'nx-uuid-999',
        timestampReal: 1729353012000
      };

      await component.openInNx(record, mockEvent);

      expect(stopPropSpy).toHaveBeenCalled();
      expect(openCameraSpy).toHaveBeenCalledWith('nx-uuid-999', 'Camara Principal', 1729353012000);
    });
  });
});
