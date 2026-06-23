import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Usuarios } from './usuarios';

import { provideHttpClient } from '@angular/common/http';
import { IUserRepository } from '../../../core/domain/repositories/user.repository';
import { UserHttpRepository } from '../../../data/repositories/user-http.repository';

describe('Usuarios', () => {
  let component: Usuarios;
  let fixture: ComponentFixture<Usuarios>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Usuarios],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: IUserRepository, useClass: UserHttpRepository }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Usuarios);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
