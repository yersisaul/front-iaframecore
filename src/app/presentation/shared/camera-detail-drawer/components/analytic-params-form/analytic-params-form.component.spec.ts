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

  it('debe inicializar confianzaRF con valor estándar 86 (0.49 de 0.57 en escala 0 a 100)', () => {
    expect(component.confianzaRF()).toBe(86);
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

  it('debe emitir 0.4902 en BD con el valor estándar por defecto de 86%', () => {
    component.selectedType.set('face_recognition');

    let emittedPayload: any = null;
    component.formChanged.subscribe((payload) => {
      emittedPayload = payload;
    });

    component.emitFormValues();

    expect(component.confianzaRF()).toBe(86);
    expect(emittedPayload.specific_params.confianza).toBe(0.4902);
  });

  it('debe cargar valor estándar 0.49 de BD convirtiéndolo a 86% en el slider', () => {
    component.selectedType.set('face_recognition');
    component.initialValues = {
      type: 'face_recognition',
      parameters: {
        confianza: 0.49
      }
    };

    component.ngOnChanges({
      initialValues: new SimpleChange(null, component.initialValues, true)
    });

    expect(component.confianzaRF()).toBe(86);
  });

  it('debe restablecer confianzaRF a 86 si initialValues omite el parámetro confianza', () => {
    component.selectedType.set('face_recognition');
    component.confianzaRF.set(25);
    component.initialValues = {
      type: 'face_recognition',
      parameters: {}
    };

    component.ngOnChanges({
      initialValues: new SimpleChange(null, component.initialValues, true)
    });

    expect(component.confianzaRF()).toBe(86);
  });
});

describe('AnalyticParamsFormComponent - Dirección en Cruce de Línea (str_direction)', () => {
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

  it('debe emitir str_direction en el nivel raíz y omitirlo de specific_params para line_crossing', () => {
    component.selectedType.set('line_crossing');

    let emittedPayload: any = null;
    component.formChanged.subscribe((payload) => {
      emittedPayload = payload;
    });

    component.selectDirection('De A a B');
    expect(emittedPayload).not.toBeNull();
    expect(emittedPayload.str_direction).toBe('De A a B');
    expect(emittedPayload.specific_params.str_direction).toBeUndefined();

    component.selectDirection('De B a A');
    expect(emittedPayload.str_direction).toBe('De B a A');
    expect(emittedPayload.specific_params.str_direction).toBeUndefined();
  });

  it('debe restaurar strDirection desde geometricObjects.lines cuando parameters no incluye str_direction', () => {
    const initial = {
      type: 'Cruce de Linea',
      parameters: {},
      geometricObjects: {
        lines: [
          {
            label: 'Linea0',
            str_direction: 'De B a A',
            extreme_points: [{ x: 10, y: 10 }, { x: 100, y: 100 }],
            analysis_zone: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
          }
        ]
      }
    };
    component.initialValues = initial;

    component.ngOnChanges({
      initialValues: new SimpleChange(null, initial, true)
    });

    expect(component.strDirection()).toBe('De B a A');
  });

  it('debe priorizar geometricObjects.lines[0].str_direction sobre parameters.str_direction legado', () => {
    const initial = {
      type: 'Cruce de Linea',
      parameters: {
        str_direction: 'De B a A'
      },
      geometricObjects: {
        lines: [
          {
            label: 'Linea0',
            str_direction: 'De A a B',
            extreme_points: [{ x: 10, y: 10 }, { x: 100, y: 100 }],
            analysis_zone: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
          }
        ]
      }
    };
    component.initialValues = initial;

    component.ngOnChanges({
      initialValues: new SimpleChange(null, initial, true)
    });

    expect(component.strDirection()).toBe('De A a B');
  });

  it('debe usar parameters.str_direction como fallback si geometricObjects.lines no trae str_direction', () => {
    const initial = {
      type: 'Cruce de Linea',
      parameters: {
        str_direction: 'De A a B'
      },
      geometricObjects: {
        lines: [
          {
            label: 'Linea0',
            extreme_points: [{ x: 10, y: 10 }, { x: 100, y: 100 }],
            analysis_zone: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
          }
        ]
      }
    };
    component.initialValues = initial;

    component.ngOnChanges({
      initialValues: new SimpleChange(null, initial, true)
    });

    expect(component.strDirection()).toBe('De A a B');
  });

  it('debe restablecer strDirection a Bidireccional cuando initialValues pasa a null', () => {
    component.selectDirection('De A a B');
    expect(component.strDirection()).toBe('De A a B');

    component.initialValues = null;
    component.ngOnChanges({
      initialValues: new SimpleChange({ type: 'Cruce de Linea' }, null, false)
    });

    expect(component.strDirection()).toBe('Bidireccional');
  });
});
