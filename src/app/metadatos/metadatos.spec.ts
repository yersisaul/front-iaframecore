import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Metadatos } from './metadatos';

describe('Metadatos', () => {
  let component: Metadatos;
  let fixture: ComponentFixture<Metadatos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Metadatos],
    }).compileComponents();

    fixture = TestBed.createComponent(Metadatos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
