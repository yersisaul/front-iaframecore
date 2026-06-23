import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { DashboardLayout } from './dashboard-layout';

import { provideHttpClient } from '@angular/common/http';
import { IAuthRepository } from '../../../core/domain/repositories/auth.repository';
import { AuthHttpRepository } from '../../../data/repositories/auth-http.repository';
import { IMetadataRepository } from '../../../core/domain/repositories/metadata.repository';
import { OpenSearchRepository } from '../../../data/repositories/opensearch.repository';

describe('DashboardLayout', () => {
  let component: DashboardLayout;
  let fixture: ComponentFixture<DashboardLayout>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardLayout],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: IAuthRepository, useClass: AuthHttpRepository },
        { provide: IMetadataRepository, useClass: OpenSearchRepository }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardLayout);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
