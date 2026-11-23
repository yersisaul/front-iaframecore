import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Observable, of, throwError } from 'rxjs';
import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Listas } from './listas';
import { ListDetail } from '../../../core/domain/entities/list.models';
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
    getListDetails: (): Observable<ListDetail[]> => of([]),
    registerListDetail: (): Observable<ListDetail> => of({} as ListDetail),
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
    (component as any).reconciliationDelayMs = 0;
    await fixture.whenStable();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('reconciles HTTP 500 upload when the face record was actually persisted on the server (new list)', async () => {
    const listService = (component as any).listService;
    listService.listDetails.set([]);
    listService.activeListId.set('list-new');
    component.selectedListId.set('list-new');

    const file = new File(['face'], 'ana_lopez.jpg', { type: 'image/jpeg' });
    component.faceImportDrafts.set([
      { file, name: 'Ana Lopez', previewUrl: 'data:image/jpeg;base64,ana', isEditingName: false }
    ]);

    vi.spyOn(mockListRepository, 'registerListDetail').mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }))
    );
    vi.spyOn(mockListRepository, 'getListDetails').mockReturnValue(
      of([
        {
          detail_id: 'real-uuid-1',
          list_id: 'list-new',
          nombre_asociado: 'Ana Lopez',
          fingerprint_host: '',
          embedding: [],
          img_minio_object_name: 'bucket/ana.jpg',
          metadata: { img_minio_object_name: 'bucket/ana.jpg' }
        }
      ])
    );

    await component.saveFaceSubjects();

    expect(component.faceImportStep()).toBe('summary');
    expect(component.successfulUploads().length).toBe(1);
    expect(component.successfulUploads()[0].detailId).toBe('real-uuid-1');
    expect(component.failedUploads().length).toBe(0);
  });

  it('keeps HTTP 500 failure with honest server message when the record was not persisted (existing list)', async () => {
    const listService = (component as any).listService;
    const existingDetail = {
      detail_id: 'old-uuid',
      list_id: 'list-1',
      nombre_asociado: 'Carlos Perez',
      fingerprint_host: '',
      embedding: [],
      img_minio_object_name: ''
    };
    listService.listDetails.set([existingDetail]);
    listService.activeListId.set('list-1');
    component.selectedListId.set('list-1');

    const file = new File(['face'], 'nuevo_sujeto.jpg', { type: 'image/jpeg' });
    component.faceImportDrafts.set([
      { file, name: 'Nuevo Sujeto', previewUrl: 'data:image/jpeg;base64,nuevo', isEditingName: false }
    ]);

    vi.spyOn(mockListRepository, 'registerListDetail').mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' }))
    );
    vi.spyOn(mockListRepository, 'getListDetails').mockReturnValue(of([existingDetail]));

    await component.saveFaceSubjects();

    expect(component.faceImportStep()).toBe('summary');
    expect(component.successfulUploads().length).toBe(0);
    expect(component.failedUploads().length).toBe(1);
    expect(component.failedUploads()[0].errorMessage).toContain('HTTP 500');
    expect(component.failedUploads()[0].errorMessage).not.toContain('No se pudo validar el rostro');
  });

  it('does not reconcile HTTP 422 validation rejections and shows exact validation message', async () => {
    const listService = (component as any).listService;
    listService.listDetails.set([]);
    listService.activeListId.set('list-1');
    component.selectedListId.set('list-1');

    const file = new File(['face'], 'sin_rostro.jpg', { type: 'image/jpeg' });
    component.faceImportDrafts.set([
      { file, name: 'Sin Rostro', previewUrl: 'data:image/jpeg;base64,none', isEditingName: false }
    ]);

    vi.spyOn(mockListRepository, 'registerListDetail').mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 422, error: { detail: 'No face detected' } }))
    );
    const getListDetailsSpy = vi.spyOn(mockListRepository, 'getListDetails');

    await component.saveFaceSubjects();

    expect(getListDetailsSpy).not.toHaveBeenCalled();
    expect(component.successfulUploads().length).toBe(0);
    expect(component.failedUploads().length).toBe(1);
    expect(component.failedUploads()[0].errorMessage).toBe('No se detectó un rostro válido en la fotografía.');
  });

  it('reconciles empty 201 response (detail_id: "") into real persisted record', async () => {
    const listService = (component as any).listService;
    listService.listDetails.set([]);
    listService.activeListId.set('list-1');
    component.selectedListId.set('list-1');

    const file = new File(['face'], 'maria.jpg', { type: 'image/jpeg' });
    component.faceImportDrafts.set([
      { file, name: 'Maria', previewUrl: 'data:image/jpeg;base64,maria', isEditingName: false }
    ]);

    vi.spyOn(mockListRepository, 'registerListDetail').mockReturnValue(
      of({
        detail_id: '',
        list_id: 'list-1',
        nombre_asociado: 'Maria',
        fingerprint_host: '',
        embedding: [],
        img_minio_object_name: ''
      })
    );
    vi.spyOn(mockListRepository, 'getListDetails').mockReturnValue(
      of([
        {
          detail_id: 'real-uuid-maria',
          list_id: 'list-1',
          nombre_asociado: 'Maria',
          fingerprint_host: '',
          embedding: [],
          img_minio_object_name: 'bucket/maria.jpg',
          metadata: { img_minio_object_name: 'bucket/maria.jpg' }
        }
      ])
    );

    await component.saveFaceSubjects();

    expect(component.successfulUploads().length).toBe(1);
    expect(component.successfulUploads()[0].detailId).toBe('real-uuid-maria');
    expect(component.failedUploads().length).toBe(0);
  });

  it('refreshes list details when closing the face upload modal even if all uploads failed', () => {
    const listService = (component as any).listService;
    const loadSpy = vi.spyOn(listService, 'loadListDetails');
    const file = new File(['face'], 'fallo.jpg', { type: 'image/jpeg' });

    component.selectedListId.set('list-1');
    component.faceImportStep.set('summary');
    component.successfulUploads.set([]);
    component.failedUploads.set([
      { file, name: 'Fallo', previewUrl: 'data:image/jpeg;base64,fail', errorMessage: 'Error HTTP 500' }
    ]);

    component.closeAddFaceSubjectModal();

    expect(loadSpy).toHaveBeenCalledWith('list-1');
  });
});
