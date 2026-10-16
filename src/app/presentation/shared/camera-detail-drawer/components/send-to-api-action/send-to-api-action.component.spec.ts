import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { vi } from 'vitest';
import { SendToApiActionComponent, SendToApiActionValue } from './send-to-api-action.component';
import { IReportTypeRepository } from '../../../../../core/domain/repositories/report-type.repository';
import {
  REPORT_TYPE_CLASSIFICATION_DETECCION_IA,
  ReportType,
  ReportTypePage
} from '../../../../../core/domain/entities/report-type.models';

const rt = (id: string, name: string): ReportType =>
  ({ id, name, description: '', classification: REPORT_TYPE_CLASSIFICATION_DETECCION_IA, configCreateMetadata: {} });

const page = (items: ReportType[]): ReportTypePage => ({ page: 1, totalItems: items.length, totalPages: 1, limit: 100, items });
const unreachable = () => throwError(() => new HttpErrorResponse({ status: 502 }));

/** Respuestas por base de proxy; lo que no está definido no responde (502). */
type Responses = Record<string, () => Observable<ReportTypePage>>;

describe('SendToApiActionComponent', () => {
  let fixture: ComponentFixture<SendToApiActionComponent>;
  let component: SendToApiActionComponent;
  let repo: Record<keyof IReportTypeRepository, ReturnType<typeof vi.fn>>;
  let responses: Responses;
  let changes: SendToApiActionValue[];
  const el = () => fixture.nativeElement as HTMLElement;
  const input = () => el().querySelector('input') as HTMLInputElement;
  const feedback = () => el().querySelector('.domain-feedback')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const trigger = () => el().querySelector('.btn-target-selector-trigger') as HTMLButtonElement;

  function render(endpoint = '', reportTypeId = ''): void {
    fixture.componentRef.setInput('actionKey', '0');
    fixture.componentRef.setInput('endpoint', endpoint);
    fixture.componentRef.setInput('reportTypeId', reportTypeId);
    fixture.detectChanges();
  }

  function type(value: string): void {
    input().value = value;
    input().dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  /** Simula al builder: devuelve al componente los valores que emitió. */
  function syncFromParent(): void {
    const last = changes.at(-1);
    if (!last) return;
    fixture.componentRef.setInput('endpoint', last.endpoint);
    fixture.componentRef.setInput('reportTypeId', last.id_report_type);
    fixture.detectChanges();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    responses = {};
    repo = {
      getReportTypes: vi.fn((base: string) => (responses[base] ?? unreachable)()),
      createReportType: vi.fn(),
      updateReportType: vi.fn()
    };

    TestBed.configureTestingModule({
      imports: [SendToApiActionComponent],
      providers: [{ provide: IReportTypeRepository, useValue: repo }]
    });

    fixture = TestBed.createComponent(SendToApiActionComponent);
    component = fixture.componentInstance;
    changes = [];
    component.changed.subscribe(value => changes.push(value));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Espera tras escribir ──

  it('should wait 600 ms after the user stops typing before querying', () => {
    responses['/azor-proxy/http/38.187.6.36/3010'] = () => of(page([rt('a', 'A')]));
    render();

    type('38.187.6');
    vi.advanceTimersByTime(400);
    type('38.187.6.36:3010');
    vi.advanceTimersByTime(599);
    expect(repo.getReportTypes).not.toHaveBeenCalled();
    expect(component.domainState()).toBe('typing');

    vi.advanceTimersByTime(1);
    fixture.detectChanges();
    // Consulta híbrida: ambos esquemas
    expect(repo.getReportTypes.mock.calls.map(c => c[0]).sort()).toEqual([
      '/azor-proxy/http/38.187.6.36/3010',
      '/azor-proxy/https/38.187.6.36/3010'
    ]);
  });

  it('should query immediately on blur and on Enter', () => {
    render();
    type('panel.com');
    input().dispatchEvent(new Event('blur'));
    expect(repo.getReportTypes).toHaveBeenCalledTimes(2);

    type('otro.com');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(repo.getReportTypes).toHaveBeenCalledTimes(4);
  });

  // ── Limpieza antes de consultar ──

  it('should clean the domain before querying and rewrite the input with the resolved origin', () => {
    responses['/azor-proxy/https/panel.com/443'] = () => of(page([rt('a', 'A')]));
    render();

    type('HTTPS:/Panel.com/backend/v2');
    vi.advanceTimersByTime(600);
    fixture.detectChanges();

    expect(repo.getReportTypes.mock.calls.every(c => !String(c[0]).includes('backend'))).toBe(true);
    expect(input().value).toBe('https://panel.com');
    expect(feedback()).not.toContain('backend');
  });

  it('should never query an invalid domain and keep the selector locked', () => {
    render();
    type('panel com/backend');
    vi.advanceTimersByTime(600);
    fixture.detectChanges();

    expect(repo.getReportTypes).not.toHaveBeenCalled();
    expect(component.domainState()).toBe('invalid');
    expect(feedback()).toContain('Formato inválido.');
    expect(trigger().disabled).toBe(true);
    expect(component.getValidationStatus()).toBe('invalid-domain');
  });

  // ── Resultados del dominio ──

  it('should enable the selector and save {origin}/azor-analytics/reports when the domain responds', () => {
    responses['/azor-proxy/http/38.187.6.36/3010'] = () => of(page([rt('a', 'A')]));
    render();
    type('38.187.6.36:3010');
    vi.advanceTimersByTime(600);
    fixture.detectChanges();

    expect(component.domainState()).toBe('ready');
    expect(feedback()).toContain('1 tipo de reporte');
    expect(trigger().disabled).toBe(false);
    expect(changes.at(-1)).toEqual({ endpoint: 'http://38.187.6.36:3010/azor-analytics/reports', id_report_type: '' });

    syncFromParent();
    expect(component.getValidationStatus()).toBe('missing-report-type');
  });

  it('should allow creating the first report type when the domain answers without any', () => {
    responses['/azor-proxy/https/panel.com/443'] = () => of(page([]));
    render();
    type('panel.com');
    vi.advanceTimersByTime(600);
    fixture.detectChanges();

    expect(component.domainState()).toBe('empty');
    expect(feedback()).toContain('Sin tipos de reporte');
    expect(trigger().disabled).toBe(false);
    expect(trigger().textContent).toContain('Crear el primer tipo de reporte');

    trigger().click();
    fixture.detectChanges();
    expect(component.isModalOpen()).toBe(true);
    expect(component.modalStartInCreate()).toBe(true);
  });

  it('should keep the selector locked and explain the error when the domain does not respond', () => {
    render();
    type('caido.com');
    vi.advanceTimersByTime(600);
    fixture.detectChanges();

    expect(component.domainState()).toBe('error');
    expect(feedback()).toContain('No se pudo conectar con el dominio');
    expect(trigger().disabled).toBe(true);
    // Bloqueado y sin texto de instrucción; tampoco hay botón de reintentar
    expect(trigger().textContent?.trim()).toBe('');
    expect(el().querySelector('.btn-inline-retry')).toBeNull();
    expect(el().textContent).not.toContain('Reintentar');
    expect(component.getValidationStatus()).toBe('unreachable-domain');
  });

  it('should show the status on the same line as the "URL Azor Panel" label', () => {
    render();
    type('caido.com');
    vi.advanceTimersByTime(600);
    fixture.detectChanges();

    const row = el().querySelector('.domain-label-row') as HTMLElement;
    expect(row.querySelector('label')?.textContent?.trim()).toBe('URL Azor Panel');
    expect(row.querySelector('.domain-feedback')?.textContent).toContain('No se pudo conectar con el dominio');
  });

  it('should show only the registered name and ID in the locked selector', () => {
    responses['/azor-proxy/http/10.0.0.1/3010'] = () => of(page([rt('rt-1', 'Permanencia')]));
    render('http://10.0.0.1:3010/azor-analytics/reports', 'rt-1');
    expect(trigger().disabled).toBe(false);

    // Al escribir otro dominio el selector se bloquea, pero conserva lo registrado
    type('otro');
    expect(trigger().disabled).toBe(true);
    expect(trigger().textContent?.replace(/\s+/g, ' ').trim()).toBe('Permanencia ID: rt-1');

    // Sin tipo de reporte registrado: bloqueado y vacío
    fixture.componentRef.setInput('reportTypeId', '');
    fixture.detectChanges();
    expect(trigger().textContent?.trim()).toBe('');
  });

  it('should inform when the typed scheme does not respond and the other one is used', () => {
    responses['/azor-proxy/https/panel.com/443'] = () => of(page([rt('a', 'A')]));
    render();
    type('http://panel.com');
    vi.advanceTimersByTime(600);
    fixture.detectChanges();

    expect(feedback()).toContain('Solo responde por HTTPS.');
    expect(changes.at(-1)?.endpoint).toBe('https://panel.com/azor-analytics/reports');
  });

  // ── Endpoints guardados ──

  it('should verify a saved endpoint immediately and show its report type', () => {
    responses['/azor-proxy/http/38.187.6.36/3010'] = () => of(page([rt('rt-1', 'Permanencia')]));
    render('http://38.187.6.36:3010/azor-analytics/reports', 'rt-1');

    expect(repo.getReportTypes).toHaveBeenCalled();
    expect(input().value).toBe('http://38.187.6.36:3010');
    expect(trigger().textContent).toContain('Permanencia');
    expect(component.getValidationStatus()).toBe('ok');
    // Ya estaba limpio: no se emite ningún cambio
    expect(changes).toEqual([]);
  });

  it('should clean a legacy endpoint so the next save sends only the domain plus the fixed path', () => {
    responses['/azor-proxy/http/38.187.6.36/3010'] = () => of(page([rt('rt-1', 'Permanencia')]));
    render('http://38.187.6.36:3010/backend/webhook', 'rt-1');

    expect(changes.at(-1)).toEqual({ endpoint: 'http://38.187.6.36:3010/azor-analytics/reports', id_report_type: 'rt-1' });
  });

  it('should keep (not clear) a saved report type that no longer exists, flagging it', () => {
    responses['/azor-proxy/http/38.187.6.36/3010'] = () => of(page([rt('otro', 'Otro')]));
    render('http://38.187.6.36:3010/azor-analytics/reports', 'rep-001');

    expect(component.getValidationStatus()).toBe('unknown-report-type');
    expect(trigger().textContent).toContain('No encontrado en este dominio');
    expect(changes).toEqual([]);
  });

  // ── Cambio de dominio ──

  it('should clear the selected report type, with a notice, when the new domain does not have it', () => {
    responses['/azor-proxy/http/10.0.0.1/3010'] = () => of(page([rt('rt-1', 'A')]));
    responses['/azor-proxy/http/10.0.0.2/3010'] = () => of(page([rt('rt-9', 'B')]));
    render('http://10.0.0.1:3010/azor-analytics/reports', 'rt-1');

    type('http://10.0.0.2:3010');
    // Mientras el nuevo dominio no se verifica, no hay endpoint válido
    vi.advanceTimersByTime(600);
    fixture.detectChanges();

    expect(changes.some(c => c.endpoint === '')).toBe(true);
    expect(changes.at(-1)).toEqual({ endpoint: 'http://10.0.0.2:3010/azor-analytics/reports', id_report_type: '' });
    expect(feedback()).toContain('no está en este dominio');
  });

  it('should emit an empty endpoint when the user empties the domain', () => {
    responses['/azor-proxy/http/10.0.0.1/3010'] = () => of(page([rt('rt-1', 'A')]));
    render('http://10.0.0.1:3010/azor-analytics/reports', 'rt-1');

    type('');
    vi.advanceTimersByTime(600);
    fixture.detectChanges();

    expect(changes.at(-1)).toEqual({ endpoint: '', id_report_type: 'rt-1' });
    expect(component.getValidationStatus()).toBe('missing-domain');
    expect(trigger().disabled).toBe(true);
  });

  // ── Validación al guardar ──

  it('should report "checking" while typing and settle it on demand', () => {
    responses['/azor-proxy/https/panel.com/443'] = () => of(page([rt('a', 'A')]));
    render();
    type('panel.com');
    expect(component.getValidationStatus()).toBe('checking');

    let settled = false;
    component.whenSettled().subscribe(() => (settled = true));
    expect(settled).toBe(true);
    expect(component.domainState()).toBe('ready');
  });

  it('should store the report type chosen in the modal', () => {
    responses['/azor-proxy/https/panel.com/443'] = () => of(page([rt('a', 'A')]));
    render();
    type('panel.com');
    vi.advanceTimersByTime(600);
    syncFromParent();

    component.onReportTypeConfirmed(rt('a', 'A'));
    expect(changes.at(-1)).toEqual({ endpoint: 'https://panel.com/azor-analytics/reports', id_report_type: 'a' });
    syncFromParent();
    expect(component.getValidationStatus()).toBe('ok');
    expect(component.isModalOpen()).toBe(false);
  });
});
