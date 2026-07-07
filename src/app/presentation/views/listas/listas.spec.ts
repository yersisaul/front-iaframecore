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
    expect(component.showEditSubjectModal()).toBe(true);
    expect(component.editSubjectName()).toBe('John Doe');
    expect(component.editSubjectPlate()).toBe('XYZ123');
    expect(component.editImagePreviewUrl()).toBe('http://face.jpg');
  });

  it('should close edit subject modal and clean properties', () => {
    component.editSubjectName.set('John Doe');
    component.editSubjectPlate.set('XYZ123');
    component.showEditSubjectModal.set(true);

    component.closeEditSubjectModal();
    expect(component.showEditSubjectModal()).toBe(false);
    expect(component.editSubjectName()).toBe('');
    expect(component.editSubjectPlate()).toBe('');
  });
});
