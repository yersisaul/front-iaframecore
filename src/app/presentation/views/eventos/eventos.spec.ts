import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { Eventos } from './eventos';
import { IEventRepository } from '../../../core/domain/repositories/event.repository';
import { PermissionsService } from '../../../core/services/permissions.service';

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
    })
  };

  const mockPermissionsService = {
    hasPermission: () => true
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Eventos],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: IEventRepository, useValue: mockEventRepository },
        { provide: PermissionsService, useValue: mockPermissionsService }
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
});
