import { TestBed, ComponentFixture } from '@angular/core/testing';
import { SimpleChange, signal } from '@angular/core';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { vi } from 'vitest';
import { AnalyticActionsBuilderComponent } from './analytic-actions-builder.component';
import { CameraService } from '../../../../../core/services/camera.service';
import { HostService } from '../../../../../core/services/host.service';
import { AnalyticService } from '../../../../../core/services/analytic.service';
import { IReportTypeRepository } from '../../../../../core/domain/repositories/report-type.repository';
import {
  REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA,
  ReportType
} from '../../../../../core/domain/entities/report-type.models';

const PLACAS: ReportType = {
  id: 'rt-placas',
  name: 'Reconocimiento de placas',
  description: '',
  classification: REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA,
  configCreateMetadata: {}
};

const SAVED_ENDPOINT = 'http://38.187.6.36:3010/azor-analytics/reports';

describe('AnalyticActionsBuilderComponent – Enviar a API', () => {
  let fixture: ComponentFixture<AnalyticActionsBuilderComponent>;
  let component: AnalyticActionsBuilderComponent;
  let repo: Record<keyof IReportTypeRepository, ReturnType<typeof vi.fn>>;
  let emitted: ReturnType<typeof vi.fn>;

  function loadActions(raw: any): void {
    component.initialActions = raw;
    component.ngOnChanges({ initialActions: new SimpleChange(null, raw, true) });
    fixture.detectChanges();
  }

  const sendToApi = (endpoint: string, idReportType: string) =>
    ({ '0': { tipo: 'Enviar a API', accion: { endpoint, id_report_type: idReportType } } });

  const lastEmitted = () => emitted.mock.calls.at(-1)![0];

  beforeEach(() => {
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => { });
    vi.spyOn(console, 'table').mockImplementation(() => { });
    vi.spyOn(console, 'log').mockImplementation(() => { });
    vi.spyOn(console, 'groupEnd').mockImplementation(() => { });

    // Solo responde el esquema http (el guardado); https falla
    repo = {
      getReportTypes: vi.fn((base: string) => base.includes('/http/')
        ? of({ page: 1, totalItems: 1, totalPages: 1, limit: 100, items: [PLACAS] })
        : throwError(() => new HttpErrorResponse({ status: 502 }))),
      createReportType: vi.fn(),
      updateReportType: vi.fn()
    };

    TestBed.configureTestingModule({
      imports: [AnalyticActionsBuilderComponent],
      providers: [
        { provide: IReportTypeRepository, useValue: repo },
        { provide: CameraService, useValue: { cameras: signal([]), getAllCameras: () => of([]) } },
        { provide: HostService, useValue: { allHosts: signal([]), loadAllHosts: () => of([]) } },
        { provide: AnalyticService, useValue: { analytics: signal([]), getAllAnalytics: () => of([]) } }
      ]
    });

    fixture = TestBed.createComponent(AnalyticActionsBuilderComponent);
    component = fixture.componentInstance;
    emitted = vi.fn();
    component.actionsChanged.subscribe(emitted);
  });

  it('should create "Enviar a API" actions with an empty domain and no placeholder values', () => {
    component.addAction('Enviar a API');
    fixture.detectChanges();

    expect(lastEmitted()['0'].accion).toEqual({ endpoint: '', id_report_type: '' });
    expect(fixture.nativeElement.querySelector('app-send-to-api-action')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('api.mi-sistema.com');
    expect(fixture.nativeElement.querySelector('input[placeholder="Ej. rep-001"]')).toBeNull();
    expect(repo.getReportTypes).not.toHaveBeenCalled();
  });

  it('should not query Azor Panel when no action needs it', () => {
    loadActions({ '0': { tipo: 'Tiempo de espera', accion: { tiempo: '30' } } });
    expect(repo.getReportTypes).not.toHaveBeenCalled();
    expect(component.getSendToApiStatuses()).toEqual({});
  });

  it('should verify the domain of a saved action and report it as valid for saving', () => {
    loadActions(sendToApi(SAVED_ENDPOINT, 'rt-placas'));

    expect(fixture.nativeElement.textContent).toContain('Reconocimiento de placas');
    expect(component.getSendToApiStatuses()).toEqual({ '0': 'ok' });
    // El endpoint guardado ya estaba limpio: se conserva tal cual
    expect(lastEmitted()['0'].accion.endpoint).toBe(SAVED_ENDPOINT);
  });

  it('should save a legacy endpoint cleaned (path removed, resolved scheme)', () => {
    loadActions(sendToApi('38.187.6.36:3010/backend/v1', 'rt-placas'));

    expect(lastEmitted()['0'].accion).toEqual({ endpoint: SAVED_ENDPOINT, id_report_type: 'rt-placas' });
  });

  it('should flag report types that do not exist in the domain (e.g. legacy "rep-001")', () => {
    loadActions(sendToApi(SAVED_ENDPOINT, 'rep-001'));

    expect(component.getSendToApiStatuses()).toEqual({ '0': 'unknown-report-type' });
    expect(fixture.nativeElement.textContent).toContain('No encontrado en este dominio');
  });

  it('should report an unreachable domain', () => {
    repo.getReportTypes.mockImplementation(() => throwError(() => new HttpErrorResponse({ status: 502 })));
    loadActions(sendToApi('https://api.mi-sistema.com/alertas', 'rt-1'));

    expect(component.getSendToApiStatuses()).toEqual({ '0': 'unreachable-domain' });
  });

  it('should update the emitted actions when the send-to-api component changes', () => {
    loadActions(sendToApi('', ''));
    component.onSendToApiChanged('0', { endpoint: SAVED_ENDPOINT, id_report_type: 'rt-placas' });

    expect(lastEmitted()['0'].accion).toEqual({ endpoint: SAVED_ENDPOINT, id_report_type: 'rt-placas' });
    expect(lastEmitted()['0'].tipo).toContain('Enviar a API');
  });

  it('should report the status of every send-to-api action by action key', () => {
    loadActions({
      '0': { tipo: 'Enviar a API', accion: { endpoint: SAVED_ENDPOINT, id_report_type: 'rt-placas' } },
      '1': { tipo: 'Tiempo de espera', accion: { tiempo: '5' } },
      '2': { tipo: 'Enviar a API', accion: { endpoint: '', id_report_type: '' } }
    });

    expect(component.getSendToApiStatuses()).toEqual({ '0': 'ok', '2': 'missing-domain' });
  });
});
