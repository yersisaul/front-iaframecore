import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SimpleChange } from '@angular/core';
import { of } from 'rxjs';
import { AnalyticCanvasComponent } from './analytic-canvas.component';
import { MediaFileService } from '../../../../../core/services/media-file.service';

describe('AnalyticCanvasComponent - Dirección en líneas (str_direction)', () => {
  let component: AnalyticCanvasComponent;
  let fixture: ComponentFixture<AnalyticCanvasComponent>;

  const mockMediaFileService = {
    getFileUrl: vi.fn((url: string) => of(url || '')),
  };

  beforeEach(async () => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      } as any;
    }

    await TestBed.configureTestingModule({
      imports: [AnalyticCanvasComponent],
      providers: [
        { provide: MediaFileService, useValue: mockMediaFileService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticCanvasComponent);
    component = fixture.componentInstance;
    component.geometryType = 'line';
    component.cameraId = 'cam-1';
    await fixture.whenStable();
  });

  it('debe incluir str_direction en cada objeto de lines al emitir geometría en modo line', () => {
    component.strDirection = 'De A a B';
    component.shapes.set([
      {
        id: 'line_1',
        points: [
          { x: 100, y: 200 },
          { x: 400, y: 200 }
        ],
        isClosed: true
      }
    ]);

    let emittedPayload: any = null;
    component.geometryChanged.subscribe((payload) => {
      emittedPayload = payload;
    });

    component.emitGeometry(true);

    expect(emittedPayload).not.toBeNull();
    expect(emittedPayload.lines).toHaveLength(1);
    expect(emittedPayload.lines[0].str_direction).toBe('De A a B');
  });

  it('debe re-emitir str_direction actualizado en ngOnChanges sin marcar hasUserModified como true', () => {
    component.shapes.set([
      {
        id: 'line_1',
        points: [
          { x: 100, y: 200 },
          { x: 400, y: 200 }
        ],
        isClosed: true
      }
    ]);
    component.hasUserModifiedGeometry.set(false);

    let emittedPayload: any = null;
    component.geometryChanged.subscribe((payload) => {
      emittedPayload = payload;
    });

    component.strDirection = 'De B a A';
    component.ngOnChanges({
      strDirection: new SimpleChange('De A a B', 'De B a A', false)
    });

    expect(emittedPayload).not.toBeNull();
    expect(emittedPayload.lines).toHaveLength(1);
    expect(emittedPayload.lines[0].str_direction).toBe('De B a A');
    expect(emittedPayload.hasUserModified).toBe(false);
  });
});

describe('AnalyticCanvasComponent - Insignias interactivas A y B', () => {
  let component: AnalyticCanvasComponent;
  let fixture: ComponentFixture<AnalyticCanvasComponent>;

  const mockMediaFileService = {
    getFileUrl: vi.fn((url: string) => of(url || '')),
  };

  const closedLineShape = {
    id: 'line_1',
    points: [
      { x: 200, y: 300 },
      { x: 600, y: 300 }
    ],
    isClosed: true
  };

  beforeEach(async () => {
    if (typeof globalThis.ResizeObserver === 'undefined') {
      globalThis.ResizeObserver = class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      } as any;
    }

    await TestBed.configureTestingModule({
      imports: [AnalyticCanvasComponent],
      providers: [
        { provide: MediaFileService, useValue: mockMediaFileService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(AnalyticCanvasComponent);
    component = fixture.componentInstance;
    component.geometryType = 'line';
    component.currentGeometryType.set('line');
    component.cameraId = 'cam-1';
    component.imageUrlSignal.set('data:image/png;base64,test');
    component.shapes.set([{ ...closedLineShape, points: closedLineShape.points.map(p => ({ ...p })) }]);
    component.hasUserModifiedGeometry.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  const createMouseEvent = () => ({
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as MouseEvent);

  it('desde Bidireccional: clic en A cambia a De A a B, desactiva A, mantiene B activo y conserva hasUserModified = false', () => {
    const emittedDirections: string[] = [];
    let lastGeoPayload: any = null;
    component.strDirectionChanged.subscribe(dir => emittedDirections.push(dir));
    component.geometryChanged.subscribe(geo => { lastGeoPayload = geo; });

    component.strDirection = 'Bidireccional';
    component.onDirectionBadgeClick('A', createMouseEvent());

    expect(component.strDirection).toBe('De A a B');
    expect(component.isDirectionSideActive('A')).toBe(false);
    expect(component.isDirectionSideActive('B')).toBe(true);
    expect(emittedDirections).toEqual(['De A a B']);
    expect(lastGeoPayload.lines[0].str_direction).toBe('De A a B');
    expect(lastGeoPayload.hasUserModified).toBe(false);
  });

  it('desde Bidireccional: clic en B cambia a De B a A, desactiva B y mantiene A activo', () => {
    const emittedDirections: string[] = [];
    component.strDirectionChanged.subscribe(dir => emittedDirections.push(dir));

    component.strDirection = 'Bidireccional';
    component.onDirectionBadgeClick('B', createMouseEvent());

    expect(component.strDirection).toBe('De B a A');
    expect(component.isDirectionSideActive('A')).toBe(true);
    expect(component.isDirectionSideActive('B')).toBe(false);
    expect(emittedDirections).toEqual(['De B a A']);
  });

  it('desde De A a B: clic en A (gris) vuelve a Bidireccional y clic en B (activo) invierte a De B a A', () => {
    component.strDirection = 'De A a B';
    component.onDirectionBadgeClick('A', createMouseEvent());
    expect(component.strDirection).toBe('Bidireccional');
    expect(component.isDirectionSideActive('A')).toBe(true);
    expect(component.isDirectionSideActive('B')).toBe(true);

    component.strDirection = 'De A a B';
    component.onDirectionBadgeClick('B', createMouseEvent());
    expect(component.strDirection).toBe('De B a A');
    expect(component.isDirectionSideActive('A')).toBe(true);
    expect(component.isDirectionSideActive('B')).toBe(false);
  });

  it('desde De B a A: clic en B (gris) vuelve a Bidireccional y clic en A (activo) invierte a De A a B', () => {
    component.strDirection = 'De B a A';
    component.onDirectionBadgeClick('B', createMouseEvent());
    expect(component.strDirection).toBe('Bidireccional');
    expect(component.isDirectionSideActive('A')).toBe(true);
    expect(component.isDirectionSideActive('B')).toBe(true);

    component.strDirection = 'De B a A';
    component.onDirectionBadgeClick('A', createMouseEvent());
    expect(component.strDirection).toBe('De A a B');
    expect(component.isDirectionSideActive('A')).toBe(false);
    expect(component.isDirectionSideActive('B')).toBe(true);
  });

  it('detiene la propagación en mousedown y click, e ignora clics cuando el lienzo está bloqueado o hay una forma abierta', () => {
    const downEvent = createMouseEvent();
    component.onDirectionBadgeMouseDown(downEvent);
    expect(downEvent.stopPropagation).toHaveBeenCalledTimes(1);
    expect(downEvent.preventDefault).toHaveBeenCalledTimes(1);

    const emittedDirections: string[] = [];
    component.strDirectionChanged.subscribe(dir => emittedDirections.push(dir));

    // Lienzo bloqueado (sin imagen)
    component.imageUrlSignal.set('');
    const lockedClick = createMouseEvent();
    component.onDirectionBadgeClick('A', lockedClick);
    expect(lockedClick.stopPropagation).toHaveBeenCalledTimes(1);
    expect(lockedClick.preventDefault).toHaveBeenCalledTimes(1);
    expect(component.strDirection).toBe('Bidireccional');
    expect(emittedDirections).toHaveLength(0);

    // Forma abierta en trazado
    component.imageUrlSignal.set('data:image/png;base64,test');
    component.shapes.set([{ id: 'open_1', points: [{ x: 100, y: 100 }], isClosed: false }]);
    component.onDirectionBadgeClick('B', createMouseEvent());
    expect(component.strDirection).toBe('Bidireccional');
    expect(emittedDirections).toHaveLength(0);
  });

  it('actualiza clases .is-active / .is-inactive y la flecha direccional en el DOM SVG al hacer clic en A y B', () => {
    const svg = fixture.nativeElement as HTMLElement;
    const getBadges = () => Array.from(svg.querySelectorAll('g.svg-direction-badge'));

    // Estado inicial Bidireccional
    let badges = getBadges();
    expect(badges).toHaveLength(2);
    expect(badges[0].classList.contains('is-active')).toBe(true);
    expect(badges[1].classList.contains('is-active')).toBe(true);
    expect(svg.querySelector('line[marker-start="url(#arrow-head-double-start)"]')).not.toBeNull();
    expect(svg.querySelector('line.svg-direction-arrow-flow')).toBeNull();

    // Clic en insignia A -> De A a B (A gris, B ámbar con punta de flecha única y flujo animado)
    badges[0].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    badges = getBadges();
    expect(component.strDirection).toBe('De A a B');
    expect(badges[0].classList.contains('is-inactive')).toBe(true);
    expect(badges[0].classList.contains('is-active')).toBe(false);
    expect(badges[1].classList.contains('is-active')).toBe(true);
    const arrowAB = svg.querySelector('line.svg-direction-arrow-flow[marker-end="url(#arrow-head-single)"]');
    expect(arrowAB).not.toBeNull();

    // Clic en insignia B -> De B a A (B gris, A ámbar recibiendo la punta)
    badges[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();

    badges = getBadges();
    expect(component.strDirection).toBe('De B a A');
    expect(badges[0].classList.contains('is-active')).toBe(true);
    expect(badges[1].classList.contains('is-inactive')).toBe(true);
    const arrowBA = svg.querySelector('line.svg-direction-arrow-flow[marker-end="url(#arrow-head-single)"]');
    expect(arrowBA).not.toBeNull();
  });
});

