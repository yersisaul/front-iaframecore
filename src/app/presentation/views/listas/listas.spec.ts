import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { of } from 'rxjs';

import { Listas } from './listas';
import { IListRepository } from '../../../core/domain/repositories/list.repository';
import { IStorageRepository } from '../../../core/domain/repositories/storage.repository';

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
    updateList: () => of({})
  };

  const mockStorageRepository = {
    uploadImage: () => of({ url: 'http://test.url', embedding: [] })
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
});
