import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Nodos } from './nodos';

describe('Nodos', () => {
  let component: Nodos;
  let fixture: ComponentFixture<Nodos>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Nodos],
    }).compileComponents();

    fixture = TestBed.createComponent(Nodos);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
