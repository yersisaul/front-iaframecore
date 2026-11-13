import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';
import { signal } from '@angular/core';

import { Listas } from './listas';
import { IListRepository } from '../../../core/domain/repositories/list.repository';
import { IStorageRepository } from '../../../core/domain/repositories/storage.repository';
import { PermissionsService } from '../../../core/services/permissions.service';

describe('Listas', () => {
  let component: Listas;
  let fixture: ComponentFixture<Listas>;

  const mockListRepository = {
    getLists: () => of([]),
    registerList: () => of({}),
    deleteList: () => of(),
    getListDetails: () => of([]),
    registerListDetail: () => of({}),
    deleteListDetail: () => of(),
    updateList: () => of({}),
    updateDetailImg: () => of({}),
    updateFaceImg: () => of({}),
    updateFaceDetail: () => of({}),
    updatePlateDetail: () => of({})
  };

  const mockStorageRepository = {
    uploadImage: () => of({ url: 'http://test.url', embedding: [] })
  };

  const mockPermissionsService = {
    permissionsMatrix: signal({}),
    hasPermission: (module: string, action: string) => true,
    updatePermission: (role: string, module: string, action: string, value: boolean) => {},
    resetPermissions: () => {}
  };

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Listas],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: IListRepository, useValue: mockListRepository },
        { provide: IStorageRepository, useValue: mockStorageRepository },
        { provide: PermissionsService, useValue: mockPermissionsService },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of({
              get: (key: string) => key === 'listType' ? 'rostros' : null
            })
          }
        }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Listas);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should open edit subject modal and populate default values', () => {
    const detail = {
      detail_id: 'detail-abc',
      list_id: 'list-123',
      nombre_asociado: 'John Doe',
      fingerprint_host: '',
      embedding: [],
      img_minio_object_name: 'http://face.jpg',
      metadata: {
        img_minio_object_name: 'http://face.jpg',
        text_placa: 'XYZ123'
      }
    };
    component.openEditSubjectModal(detail);
    expect(component.showEditFaceSubjectModal()).toBe(true);
    expect(component.editFaceSubjectName()).toBe('John Doe');
    expect(component.editFaceImagePreviewUrl()).toBe('http://face.jpg');
  });

  it('should close edit subject modal and clean properties', () => {
    component.editFaceSubjectName.set('John Doe');
    component.showEditFaceSubjectModal.set(true);

    component.closeEditFaceSubjectModal();
    expect(component.showEditFaceSubjectModal()).toBe(false);
    expect(component.editFaceSubjectName()).toBe('');
  });

  it('should display plate-specific empty-state-view texts and icon when viewing an empty plate list', () => {
    const listService = (component as any).listService;
    component.listTypeParam.set('placas');
    listService.lists.set([{
      list_id: 'plate-list-1',
      name: 'Placas Sospechosas',
      list_type: 'plate_recognition',
      description: 'Control LPR'
    }]);
    component.selectedListId.set('plate-list-1');
    listService.listDetails.set([]);
    fixture.detectChanges();

    const emptyView = fixture.nativeElement.querySelector('.empty-state-view') as HTMLElement | null;
    expect(emptyView).toBeTruthy();
    expect(emptyView!.textContent).toContain('No Hay Placas Registradas');
    expect(emptyView!.textContent).toContain('Agregar Placa');
    expect(emptyView!.textContent).not.toContain('Sujetos');
    expect(emptyView!.querySelector('.icon-car')).toBeTruthy();
  });

  it('should display plate-specific empty-state-view message when plate list search has no matches', () => {
    const listService = (component as any).listService;
    component.listTypeParam.set('placas');
    listService.lists.set([{
      list_id: 'plate-list-1',
      name: 'Placas Sospechosas',
      list_type: 'plate_recognition',
      description: 'Control LPR'
    }]);
    component.selectedListId.set('plate-list-1');
    listService.listDetails.set([{
      detail_id: 'det-1',
      list_id: 'plate-list-1',
      nombre_asociado: 'Carlos Ruiz',
      fingerprint_host: '',
      embedding: [],
      img_minio_object_name: '',
      metadata: { text_placa: 'ABC123' }
    }]);
    component.searchQuery.set('ZZZ999');
    fixture.detectChanges();

    const emptyView = fixture.nativeElement.querySelector('.empty-state-view') as HTMLElement | null;
    expect(emptyView).toBeTruthy();
    expect(emptyView!.textContent).toContain('Sin Coincidencias');
    expect(emptyView!.textContent).toContain('No se encontraron placas con los filtros de búsqueda o criterios activos.');
  });

  it('should keep subject-specific empty-state-view texts and icon when viewing an empty face list', () => {
    const listService = (component as any).listService;
    component.listTypeParam.set('rostros');
    listService.lists.set([{
      list_id: 'face-list-1',
      name: 'Personas VIP',
      list_type: 'face_recognition',
      description: 'Control RF'
    }]);
    component.selectedListId.set('face-list-1');
    listService.listDetails.set([]);
    fixture.detectChanges();

    const emptyView = fixture.nativeElement.querySelector('.empty-state-view') as HTMLElement | null;
    expect(emptyView).toBeTruthy();
    expect(emptyView!.textContent).toContain('No Hay Sujetos Registrados');
    expect(emptyView!.textContent).toContain('Agregar Sujeto');
    expect(emptyView!.querySelector('.icon-user')).toBeTruthy();
  });
});
