import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { Horarios } from './horarios';

describe('Horarios', () => {
  let component: Horarios;
  let fixture: ComponentFixture<Horarios>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Horarios],
      providers: [provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(Horarios);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
