import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { Metadatos } from './metadatos';
import { IStorageRepository } from '../../../core/domain/repositories/storage.repository';
import { IMetadataRepository } from '../../../core/domain/repositories/metadata.repository';
import { IListRepository } from '../../../core/domain/repositories/list.repository';

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

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Metadatos],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: IStorageRepository, useValue: mockStorageRepository },
        { provide: IMetadataRepository, useValue: mockMetadataRepository },
        { provide: IListRepository, useValue: mockListRepository }
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
    component.rows.set(3);

    // base = 15. We drop base * 1, so limitOptions starts at base * 2 (30)
    expect(component.limitOptions()).toEqual([30, 45, 60]);

    const spySetPageSize = vi.spyOn((component as any).metadataService, 'setPageSize');
    const spySetPage = vi.spyOn((component as any).metadataService, 'setPage');

    // Trigger adjustment. We call it with a width that fits 4 columns and 3 rows (base = 12)
    // Old base was 15, current size in service is 30 (screens = 2). New size should be 12 * 2 = 24.
    component['adjustColumnsAndLimit'](4 * 444 - 24);

    expect(component.columns()).toBe(4);
    expect(component.rows()).toBe(3);
    expect(spySetPageSize).toHaveBeenCalledWith(24);
    expect(spySetPage).toHaveBeenCalledWith(1);
  });
});


