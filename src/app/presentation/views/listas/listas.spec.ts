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
      metadata: {
        url_img: 'http://face.jpg',
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
});
