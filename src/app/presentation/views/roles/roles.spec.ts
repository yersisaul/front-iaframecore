import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Roles } from './roles';

describe('Roles', () => {
  let component: Roles;
  let fixture: ComponentFixture<Roles>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Roles],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(Roles);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
