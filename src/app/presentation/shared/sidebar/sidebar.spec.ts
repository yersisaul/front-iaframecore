import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Sidebar } from './sidebar';

import { provideHttpClient } from '@angular/common/http';
import { IAuthRepository } from '../../../core/domain/repositories/auth.repository';
import { AuthHttpRepository } from '../../../data/repositories/auth-http.repository';
import { IMetadataRepository } from '../../../core/domain/repositories/metadata.repository';
import { OpenSearchRepository } from '../../../data/repositories/opensearch.repository';

describe('Sidebar', () => {
  let component: Sidebar;
  let fixture: ComponentFixture<Sidebar>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: IAuthRepository, useClass: AuthHttpRepository },
        { provide: IMetadataRepository, useClass: OpenSearchRepository }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Sidebar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
