import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ReportTypeService } from './report-type.service';
import { IReportTypeRepository } from '../domain/repositories/report-type.repository';
import { ReportTypeHttpRepository } from '../../data/repositories/report-type-http.repository';
import {
  REPORT_TYPE_CLASSIFICATION_DETECCION_IA,
  REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA,
  REPORT_TYPE_METADATA_FIELDS
} from '../domain/entities/report-type.models';
import { AzorDomain, normalizeAzorDomain } from '../utils/azor-endpoint.util';

const HTTPS_BASE = '/azor-proxy/https/panel.com/443/others/report-types';
const HTTP_BASE = '/azor-proxy/http/panel.com/80/others/report-types';

function domainOf(input: string): AzorDomain {
  const result = normalizeAzorDomain(input);
  if (!result.ok) throw new Error(result.message);
  return result.domain;
}

function dto(id: string, name: string, classification: string | null = REPORT_TYPE_CLASSIFICATION_DETECCION_IA) {
  return { id, name, description: name, configCreateMetadata: { idNx: 'metadata.idNx' }, classification };
}

function page(items: any[], extra: Partial<{ page: number; totalPages: number }> = {}) {
  return { page: 1, totalItems: items.length, totalPages: 1, limit: 100, items, ...extra };
}

describe('ReportTypeService (por dominio)', () => {
  let service: ReportTypeService;
  let http: HttpTestingController;

  const expectGet = (base: string, pageNumber = 1): TestRequest =>
    http.expectOne(req => req.method === 'GET' && req.url === base && req.params.get('page') === String(pageNumber));

  const fail = (req: TestRequest, status: number, headers?: Record<string, string>) =>
    req.flush({ detail: 'error' }, { status, statusText: 'Error', headers });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: IReportTypeRepository, useClass: ReportTypeHttpRepository }
      ]
    });
    service = TestBed.inject(ReportTypeService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // ── Consulta híbrida ──

  it('should query https and http in parallel and prefer https when no scheme was typed', () => {
    service.checkDomain(domainOf('panel.com'));
    expect(service.getLookup('panel.com')?.state).toBe('checking');

    const https = expectGet(HTTPS_BASE);
    const httpReq = expectGet(HTTP_BASE);
    expect(https.request.params.get('hasReports')).toBe('false');
    expect(https.request.params.get('limit')).toBe('100');

    httpReq.flush(page([dto('h', 'Por HTTP')]));
    https.flush(page([dto('s', 'Por HTTPS')]));

    const lookup = service.getLookup('panel.com')!;
    expect(lookup.state).toBe('ready');
    expect(lookup.scheme).toBe('https');
    expect(lookup.origin).toBe('https://panel.com');
    expect(lookup.reportTypes.map(r => r.id)).toEqual(['s']);
    expect(lookup.schemeFallback).toBe(false);
  });

  it('should fall back to http when https cannot connect', () => {
    service.checkDomain(domainOf('panel.com'));
    fail(expectGet(HTTPS_BASE), 502);
    expectGet(HTTP_BASE).flush(page([dto('h', 'Por HTTP')]));

    const lookup = service.getLookup('panel.com')!;
    expect(lookup.scheme).toBe('http');
    expect(lookup.origin).toBe('http://panel.com');
    expect(lookup.proxyBase).toBe('/azor-proxy/http/panel.com/80');
  });

  it('should prefer the typed scheme when both respond', () => {
    service.checkDomain(domainOf('http://panel.com'));
    expectGet(HTTPS_BASE).flush(page([dto('s', 'S')]));
    expectGet(HTTP_BASE).flush(page([dto('h', 'H')]));

    expect(service.getLookup('http://panel.com')?.scheme).toBe('http');
    expect(service.getLookup('http://panel.com')?.schemeFallback).toBe(false);
  });

  it('should flag a scheme fallback when the typed scheme does not respond', () => {
    service.checkDomain(domainOf('http://panel.com'));
    fail(expectGet(HTTP_BASE), 502);
    expectGet(HTTPS_BASE).flush(page([dto('s', 'S')]));

    const lookup = service.getLookup('http://panel.com')!;
    expect(lookup.scheme).toBe('https');
    expect(lookup.schemeFallback).toBe(true);
  });

  it('should keep explicit ports for both schemes', () => {
    service.checkDomain(domainOf('38.187.6.36:3010/backend'));
    expectGet('/azor-proxy/https/38.187.6.36/3010/others/report-types').flush(page([dto('a', 'A')]));
    expectGet('/azor-proxy/http/38.187.6.36/3010/others/report-types').flush(page([]));

    expect(service.getLookup('38.187.6.36:3010')?.origin).toBe('https://38.187.6.36:3010');
  });

  // ── Resultados ──

  it('should report "empty" when the domain answers correctly without report types', () => {
    service.checkDomain(domainOf('panel.com'));
    expectGet(HTTPS_BASE).flush(page([]));
    fail(expectGet(HTTP_BASE), 502);

    const lookup = service.getLookup('panel.com')!;
    expect(lookup.state).toBe('empty');
    expect(lookup.proxyBase).toBe('/azor-proxy/https/panel.com/443');
  });

  it('should not treat a non Azor Panel response as an empty list', () => {
    service.checkDomain(domainOf('panel.com'));
    expectGet(HTTPS_BASE).flush({ status: 'ok' });
    expectGet(HTTP_BASE).flush('<html>otro servidor</html>');

    const lookup = service.getLookup('panel.com')!;
    expect(lookup.state).toBe('error');
    expect(lookup.error).toBe('No es un Azor Panel válido.');
  });

  it('should show the most informative error when no scheme works', () => {
    service.checkDomain(domainOf('panel.com'));
    fail(expectGet(HTTPS_BASE), 502);
    fail(expectGet(HTTP_BASE), 401);

    expect(service.getLookup('panel.com')?.error).toBe('Clave de integración rechazada.');
  });

  it('should report a connection error when the domain is unreachable', () => {
    service.checkDomain(domainOf('panel.com'));
    fail(expectGet(HTTPS_BASE), 504);
    fail(expectGet(HTTP_BASE), 502);

    expect(service.getLookup('panel.com')?.error).toContain('no respondió a tiempo');
  });

  it('should prioritize an invalid panel session over any other error', () => {
    service.checkDomain(domainOf('panel.com'));
    fail(expectGet(HTTPS_BASE), 401, { 'X-Azor-Proxy-Auth': 'denied' });
    fail(expectGet(HTTP_BASE), 404);

    expect(service.getLookup('panel.com')?.error).toBe('Sesión expirada.');
  });

  it('should load every page and keep only supported classifications', () => {
    service.checkDomain(domainOf('https://panel.com'));
    fail(expectGet(HTTP_BASE), 502);
    expectGet(HTTPS_BASE, 1).flush(page([
      dto('a', 'A'),
      dto('x', 'Otra', 'aaaaaaaa-0000-0000-0000-000000000000')
    ], { totalPages: 2 }));
    expectGet(HTTPS_BASE, 2).flush(page([
      dto('b', 'B', REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA),
      dto('n', 'Sin clasificación', null)
    ], { page: 2, totalPages: 2 }));

    expect(service.getLookup('https://panel.com')?.reportTypes.map(r => r.id)).toEqual(['a', 'b']);
  });

  // ── Caché ──

  it('should reuse an in-flight check and the cached result unless forced', () => {
    const domain = domainOf('panel.com');
    service.checkDomain(domain);
    service.checkDomain(domain, { force: true });
    expectGet(HTTPS_BASE).flush(page([dto('a', 'A')]));
    expectGet(HTTP_BASE).flush(page([]));

    // Sin force: usa el resultado (verify() confirma que no hay nuevas peticiones)
    let fromCache: any;
    service.checkDomain(domain).subscribe(l => (fromCache = l));
    expect(fromCache.state).toBe('ready');

    // Con force: vuelve a consultar ambos esquemas
    service.checkDomain(domain, { force: true });
    expect(service.getLookup('panel.com')?.refreshing).toBe(true);
    expectGet(HTTPS_BASE).flush(page([dto('a', 'A'), dto('b', 'B')]));
    expectGet(HTTP_BASE).flush(page([]));
    expect(service.getLookup('panel.com')?.reportTypes.length).toBe(2);
  });

  it('should keep previous data when a forced refresh fails', () => {
    const domain = domainOf('panel.com');
    service.checkDomain(domain);
    expectGet(HTTPS_BASE).flush(page([dto('a', 'A')]));
    expectGet(HTTP_BASE).flush(page([]));

    service.checkDomain(domain, { force: true });
    fail(expectGet(HTTPS_BASE), 502);
    fail(expectGet(HTTP_BASE), 502);

    const lookup = service.getLookup('panel.com')!;
    expect(lookup.state).toBe('ready');
    expect(lookup.reportTypes.map(r => r.id)).toEqual(['a']);
    expect(lookup.refreshError).toContain('No se pudo conectar');
  });

  it('should report the status of a report type within its domain', () => {
    expect(service.getReportTypeStatus('panel.com', '')).toBe('empty');
    expect(service.getReportTypeStatus('panel.com', 'a')).toBe('loading');

    service.checkDomain(domainOf('panel.com'));
    expect(service.getReportTypeStatus('panel.com', 'a')).toBe('loading');
    expectGet(HTTPS_BASE).flush(page([dto('a', 'A')]));
    expectGet(HTTP_BASE).flush(page([]));

    expect(service.getReportTypeStatus('panel.com', 'a')).toBe('found');
    expect(service.getReportTypeStatus('panel.com', 'zzz')).toBe('missing');
    expect(service.getReportTypeStatus('otro.com', 'a')).toBe('loading');

    service.checkDomain(domainOf('caido.com'));
    fail(expectGet('/azor-proxy/https/caido.com/443/others/report-types'), 502);
    fail(expectGet('/azor-proxy/http/caido.com/80/others/report-types'), 502);
    expect(service.getReportTypeStatus('caido.com', 'a')).toBe('error');
  });

  // ── Crear / editar (solo por el esquema resuelto) ──

  function resolveHttpsOnly(items: any[] = []): void {
    service.checkDomain(domainOf('panel.com'));
    expectGet(HTTPS_BASE).flush(page(items));
    fail(expectGet(HTTP_BASE), 502);
  }

  it('should POST once, to the resolved scheme, with the fixed metadata fields and no icon', () => {
    resolveHttpsOnly();
    service.createReportType('panel.com', {
      name: '  Nuevo  ', description: 'Desc', classification: REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA
    }).subscribe();

    const req = http.expectOne(r => r.method === 'POST');
    expect(req.request.url).toBe(HTTPS_BASE);
    expect(req.request.body).toEqual({
      name: 'Nuevo',
      description: 'Desc',
      classification: REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA,
      metadataFields: [...REPORT_TYPE_METADATA_FIELDS]
    });
    expect(req.request.body.metadataFields).toContain('timestamp_real');
    expect('icon' in req.request.body).toBe(false);
    req.flush(dto('new-id', 'Nuevo', REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA));

    const lookup = service.getLookup('panel.com')!;
    expect(lookup.state).toBe('ready');
    expect(service.findReportType('panel.com', 'new-id')?.name).toBe('Nuevo');
  });

  it('should PATCH /:id on the resolved scheme and update the domain cache', () => {
    resolveHttpsOnly([dto('a', 'A')]);
    service.updateReportType('panel.com', 'a', {
      name: 'A2', description: 'D2', classification: REPORT_TYPE_CLASSIFICATION_DETECCION_IA
    }).subscribe();

    const req = http.expectOne(`${HTTPS_BASE}/a`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body.metadataFields).toEqual([...REPORT_TYPE_METADATA_FIELDS]);
    req.flush({});

    expect(service.findReportType('panel.com', 'a')?.name).toBe('A2');
  });

  it('should refuse to write to a domain that is not verified', () => {
    let error: any;
    service.createReportType('sin-verificar.com', { name: 'X', description: '', classification: '' })
      .subscribe({ error: e => (error = e) });
    expect(error?.message).toBe('Dominio no verificado.');
  });

  it('should not expose a delete operation', () => {
    expect((service as any).deleteReportType).toBeUndefined();
    expect((TestBed.inject(IReportTypeRepository) as any).deleteReportType).toBeUndefined();
  });
});
