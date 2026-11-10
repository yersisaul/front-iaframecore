import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { AnalyticParamsFormComponent } from './analytic-params-form.component';
import { ListService } from '../../../../../core/services/list.service';
import { signal } from '@angular/core';
import { of } from 'rxjs';

describe('AnalyticParamsFormComponent - Umbral de Similitud Facial', () => {
  let component: AnalyticParamsFormComponent;
  let fixture: ComponentFixture<AnalyticParamsFormComponent>;

  const mockListService = {
    lists: signal([]),
    isLoading: signal(false),
    loadLists: vi.fn().mockReturnValue(of([])),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticParamsFormComponent],
      providers: [
        { provide: ListService, useValue: mockListService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticParamsFormComponent);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('debe inicializar confianzaRF con valor por defecto 70 (escala 0 a 100)', () => {
    expect(component.confianzaRF()).toBe(70);
  });

  it('debe validar que confianza_rf sea válido entre 0 y 100', () => {
    component.selectedType.set('face_recognition');

    component.confianzaRF.set(0);
    expect(component.isParamInvalid('confianza_rf')).toBe(false);

    component.confianzaRF.set(57);
    expect(component.isParamInvalid('confianza_rf')).toBe(false);

    component.confianzaRF.set(100);
    expect(component.isParamInvalid('confianza_rf')).toBe(false);

    component.confianzaRF.set(-1);
    expect(component.isParamInvalid('confianza_rf')).toBe(true);

    component.confianzaRF.set(101);
    expect(component.isParamInvalid('confianza_rf')).toBe(true);
  });

  it('debe emitir 0.456 en BD cuando el slider está en 80% (80 * 0.57 / 100 = 0.456)', () => {
    component.selectedType.set('face_recognition');
    component.confianzaRF.set(80);

    let emittedPayload: any = null;
    component.formChanged.subscribe((payload) => {
      emittedPayload = payload;
    });

    (component as any).emitFormValues();

    expect(emittedPayload).not.toBeNull();
    expect(emittedPayload.specific_params.confianza).toBe(0.456);
  });

  it('debe emitir 0.0057 con 4 decimales cuando el slider está en 1% (1 * 0.57 / 100 = 0.0057)', () => {
    component.selectedType.set('face_recognition');
    component.confianzaRF.set(1);

    let emittedPayload: any = null;
    component.formChanged.subscribe((payload) => {
      emittedPayload = payload;
    });

    (component as any).emitFormValues();

    expect(emittedPayload).not.toBeNull();
    expect(emittedPayload.specific_params.confianza).toBe(0.0057);
  });

  it('debe emitir 0.57 en BD cuando el slider está en 100% (cota superior)', () => {
    component.selectedType.set('face_recognition');
    component.confianzaRF.set(100);

    let emittedPayload: any = null;
    component.formChanged.subscribe((payload) => {
      emittedPayload = payload;
    });

    (component as any).emitFormValues();

    expect(emittedPayload).not.toBeNull();
    expect(emittedPayload.specific_params.confianza).toBe(0.57);
  });

  it('debe emitir 0.0 en BD cuando el slider está en 0%', () => {
    component.selectedType.set('face_recognition');
    component.confianzaRF.set(0);

    let emittedPayload: any = null;
    component.formChanged.subscribe((payload) => {
      emittedPayload = payload;
    });

    (component as any).emitFormValues();

    expect(emittedPayload).not.toBeNull();
    expect(emittedPayload.specific_params.confianza).toBe(0);
  });

  it('debe cargar y convertir 0.456 de BD a 80% en el slider en ngOnChanges', () => {
    component.selectedType.set('face_recognition');
    component.initialValues = {
      type: 'face_recognition',
      parameters: {
        confianza: 0.456
      }
    };

    component.ngOnChanges({
      initialValues: new SimpleChange(null, component.initialValues, true)
    });

    expect(component.confianzaRF()).toBe(80);
  });

  it('debe cargar y convertir 0.0057 de BD a 1% en el slider en ngOnChanges', () => {
    component.selectedType.set('face_recognition');
    component.initialValues = {
      type: 'face_recognition',
      parameters: {
        confianza: 0.0057
      }
    };

    component.ngOnChanges({
      initialValues: new SimpleChange(null, component.initialValues, true)
    });

    expect(component.confianzaRF()).toBe(1);
  });

  it('debe cargar valor 0.57 de BD convirtiéndolo a 100% en el slider', () => {
    component.selectedType.set('face_recognition');
    component.initialValues = {
      type: 'face_recognition',
      parameters: {
        confianza: 0.57
      }
    };

    component.ngOnChanges({
      initialValues: new SimpleChange(null, component.initialValues, true)
    });

    expect(component.confianzaRF()).toBe(100);
  });

  it('debe cargar valor 0.0 de BD convirtiéndolo a 0% en el slider', () => {
    component.selectedType.set('face_recognition');
    component.initialValues = {
      type: 'face_recognition',
      parameters: {
        confianza: 0.0
      }
    };

    component.ngOnChanges({
      initialValues: new SimpleChange(null, component.initialValues, true)
    });

    expect(component.confianzaRF()).toBe(0);
  });
});
