import { Injectable, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, Observable, forkJoin, of, throwError } from 'rxjs';
import { catchError, expand, finalize, map, reduce, shareReplay, tap } from 'rxjs/operators';
import { IReportTypeRepository } from '../domain/repositories/report-type.repository';
import {
  AzorPanelInvalidResponseError,
  ReportType,
  ReportTypeFormData,
  isSupportedReportTypeClassification
} from '../domain/entities/report-type.models';
import { AzorCandidateOrigin, AzorDomain, AzorScheme, getAzorCandidateOrigins } from '../utils/azor-endpoint.util';

/**
 * Estado de la consulta de un dominio de Azor Panel:
 * - checking: primera verificación en curso (aún sin datos)
 * - ready:    respondió con tipos de reporte
 * - empty:    respondió correctamente, pero sin tipos de reporte (se permite crear el primero)
 * - error:    ningún esquema respondió correctamente
 */
export type AzorDomainState = 'checking' | 'ready' | 'empty' | 'error';

export interface AzorDomainLookup {
  key: string;
  domain: AzorDomain;
  state: AzorDomainState;
  /** Origen y esquema resueltos por la consulta híbrida (null mientras verifica o si falló). */
  origin: string | null;
  scheme: AzorScheme | null;
  proxyBase: string | null;
  reportTypes: ReportType[];
  /** Mensaje del error cuando state === 'error'. */
  error: string | null;
  /** Hay una nueva consulta en curso sobre datos ya cargados. */
  refreshing: boolean;
  /** Falló una actualización posterior: se conservan los datos anteriores. */
  refreshError: string | null;
  /** Se escribió un esquema, pero el dominio solo respondió por el otro. */
  schemeFallback: boolean;
}

/**
 * Estado de un ID de Report Type dentro de un dominio:
 * - empty:   sin ID asignado
 * - loading: el dominio aún se está verificando
 * - found:   existe en el dominio
 * - missing: el dominio respondió y el ID no existe
 * - error:   el dominio no respondió; no se puede verificar
 */
export type ReportTypeStatus = 'empty' | 'loading' | 'found' | 'missing' | 'error';

type AttemptResult =
  | { ok: true; candidate: AzorCandidateOrigin; items: ReportType[] }
  | { ok: false; candidate: AzorCandidateOrigin; error: unknown };

@Injectable({
  providedIn: 'root'
})
export class ReportTypeService {
  private reportTypeRepository = inject(IReportTypeRepository);

  private static readonly PAGE_LIMIT = 100;
  private static readonly UNREACHABLE_STATUSES = [0, 502, 503, 504];

  /** Consultas por dominio, indexadas por la clave limpia del dominio (AzorDomain.key). */
  readonly lookups = signal<Record<string, AzorDomainLookup>>({});
  readonly isSaving = signal<boolean>(false);

  readonly newRecordIds = signal<Set<string>>(new Set());
  readonly updatedRecordIds = signal<Set<string>>(new Set());

  private inFlight = new Map<string, Observable<AzorDomainLookup>>();

  markAsNew(id: string): void {
    this.newRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  markAsUpdated(id: string): void {
    this.updatedRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.updatedRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  getLookup(key: string | null | undefined): AzorDomainLookup | null {
    return key ? this.lookups()[key] ?? null : null;
  }

  /**
   * Consulta los Report Types del dominio por https y http en paralelo (consulta híbrida) y
   * se queda con el esquema preferido que responda. La consulta corre aunque nadie se suscriba;
   * si ya hay una en curso para el mismo dominio, se reutiliza.
   * Sin `force`, devuelve el resultado ya obtenido (salvo error).
   */
  checkDomain(domain: AzorDomain, options: { force?: boolean } = {}): Observable<AzorDomainLookup> {
    const key = domain.key;
    const running = this.inFlight.get(key);
    if (running) return running;

    const previous = this.getLookup(key);
    if (!options.force && previous && previous.state !== 'error' && previous.state !== 'checking') {
      return of(previous);
    }

    const hadData = !!previous && (previous.state === 'ready' || previous.state === 'empty');
    this.patch(key, hadData
      ? { ...previous!, refreshing: true }
      : this.emptyLookup(domain, 'checking'));

    const candidates = getAzorCandidateOrigins(domain);
    const run$ = forkJoin(candidates.map(candidate => this.attempt(candidate))).pipe(
      map(results => this.resolveLookup(domain, results, hadData ? previous! : null)),
      tap(lookup => this.patch(key, lookup)),
      finalize(() => this.inFlight.delete(key)),
      shareReplay({ bufferSize: 1, refCount: false })
    );

    this.inFlight.set(key, run$);
    run$.subscribe({ error: () => { } });
    return run$;
  }

  /** Consulta en curso del dominio (para esperar su resultado), o null si no hay ninguna. */
  getPendingCheck(key: string | null | undefined): Observable<AzorDomainLookup> | null {
    return key ? this.inFlight.get(key) ?? null : null;
  }

  findReportType(key: string | null | undefined, id: string | null | undefined): ReportType | null {
    if (!id) return null;
    return this.getLookup(key)?.reportTypes.find(rt => rt.id === id) ?? null;
  }

  /** Busca un Report Type en cualquier dominio ya consultado (solo para logs de depuración). */
  findAnyCachedReportType(id: string | null | undefined): ReportType | null {
    if (!id) return null;
    for (const lookup of Object.values(this.lookups())) {
      const found = lookup.reportTypes.find(rt => rt.id === id);
      if (found) return found;
    }
    return null;
  }

  getReportTypeStatus(key: string | null | undefined, id: string | null | undefined): ReportTypeStatus {
    if (!id || String(id).trim() === '') return 'empty';
    const lookup = this.getLookup(key);
    if (!lookup || lookup.state === 'checking') return 'loading';
    if (lookup.state === 'error') return 'error';
    return lookup.reportTypes.some(rt => rt.id === id) ? 'found' : 'missing';
  }

  /** Crea en el dominio ya verificado (solo por el esquema resuelto, nunca por ambos). */
  createReportType(key: string, data: ReportTypeFormData): Observable<ReportType> {
    const lookup = this.getLookup(key);
    if (!lookup?.proxyBase) return throwError(() => new Error('Dominio no verificado.'));

    this.isSaving.set(true);
    return this.reportTypeRepository.createReportType(lookup.proxyBase, data).pipe(
      tap(created => {
        this.updateLookupReportTypes(key, current => [...current.filter(rt => rt.id !== created.id), created]);
        if (created.id) this.markAsNew(created.id);
      }),
      finalize(() => this.isSaving.set(false))
    );
  }

  updateReportType(key: string, id: string, data: ReportTypeFormData): Observable<ReportType> {
    const lookup = this.getLookup(key);
    if (!lookup?.proxyBase) return throwError(() => new Error('Dominio no verificado.'));

    this.isSaving.set(true);
    return this.reportTypeRepository.updateReportType(lookup.proxyBase, id, data).pipe(
      tap(updated => {
        this.updateLookupReportTypes(key, current => current.map(rt => (rt.id === id ? updated : rt)));
        this.markAsUpdated(id);
      }),
      finalize(() => this.isSaving.set(false))
    );
  }

  /** Traduce errores del proxy / Azor Panel a mensajes legibles para el usuario. */
  getErrorMessage(err: unknown): string {
    if (err instanceof AzorPanelInvalidResponseError) {
      return 'No es un Azor Panel válido.';
    }
    if (!(err instanceof HttpErrorResponse)) {
      return err instanceof Error && err.message ? err.message : 'Error inesperado con Azor Panel.';
    }
    if (err.headers?.get('X-Azor-Proxy-Auth') === 'denied') {
      return 'Sesión expirada.';
    }
    // 200 con un cuerpo que no es JSON (p. ej. HTML de otro servidor)
    if (err.status >= 200 && err.status < 300) {
      return 'No es un Azor Panel válido.';
    }
    switch (err.status) {
      case 0:
        return 'Sin conexión con el servidor.';
      case 401:
      case 403:
        return 'Clave de integración rechazada.';
      case 404:
        return 'El dominio no expone tipos de reporte.';
      case 502:
      case 503:
        return 'No se pudo conectar con el dominio.';
      case 504:
        return 'El dominio no respondió a tiempo.';
    }
    const backendMessage = err.error?.message;
    if (Array.isArray(backendMessage) && backendMessage.length > 0) {
      return backendMessage.join(' · ');
    }
    if (typeof backendMessage === 'string' && backendMessage.trim() !== '') {
      return backendMessage;
    }
    return `Error ${err.status} de Azor Panel.`;
  }

  // =========================================================================
  // INTERNOS
  // =========================================================================

  /** Descarga todas las páginas del dominio por un esquema. Nunca falla: devuelve el error como resultado. */
  private attempt(candidate: AzorCandidateOrigin): Observable<AttemptResult> {
    const limit = ReportTypeService.PAGE_LIMIT;
    return this.reportTypeRepository.getReportTypes(candidate.proxyBase, { page: 1, limit }).pipe(
      // El número de página se calcula por índice para no depender del "page" de la respuesta
      expand((pageRes, index) => {
        const nextPage = index + 2;
        return pageRes.items.length > 0 && nextPage <= pageRes.totalPages
          ? this.reportTypeRepository.getReportTypes(candidate.proxyBase, { page: nextPage, limit })
          : EMPTY;
      }),
      reduce((acc, pageRes) => [...acc, ...pageRes.items], [] as ReportType[]),
      map(items => ({
        ok: true as const,
        candidate,
        // Solo Detección IA y Reconocimiento IA; el backend no permite filtrar por varias clasificaciones a la vez
        items: this.dedupeById(items).filter(item => isSupportedReportTypeClassification(item.classification))
      })),
      catchError(error => of({ ok: false as const, candidate, error }))
    );
  }

  private resolveLookup(domain: AzorDomain, results: AttemptResult[], previous: AzorDomainLookup | null): AzorDomainLookup {
    // Los candidatos vienen en orden de preferencia: el primero que respondió bien gana
    const success = results.find((r): r is Extract<AttemptResult, { ok: true }> => r.ok);
    if (success) {
      return {
        key: domain.key,
        domain,
        state: success.items.length > 0 ? 'ready' : 'empty',
        origin: success.candidate.origin,
        scheme: success.candidate.scheme,
        proxyBase: success.candidate.proxyBase,
        reportTypes: success.items,
        error: null,
        refreshing: false,
        refreshError: null,
        schemeFallback: !!domain.explicitScheme && domain.explicitScheme !== success.candidate.scheme
      };
    }

    const message = this.getErrorMessage(this.pickMostInformativeError(results));
    // Si ya había datos, una actualización fallida no los oculta
    if (previous) {
      return { ...previous, refreshing: false, refreshError: message };
    }
    return { ...this.emptyLookup(domain, 'error'), error: message };
  }

  /**
   * Error a mostrar cuando ningún esquema respondió bien. Prioridad:
   * sesión inválida > el servidor contestó (clave rechazada, 404, no es Azor Panel) > error de conexión.
   */
  private pickMostInformativeError(results: AttemptResult[]): unknown {
    const errors = results.filter(r => !r.ok).map(r => (r as Extract<AttemptResult, { ok: false }>).error);
    const sessionDenied = errors.find(e => e instanceof HttpErrorResponse && e.headers?.get('X-Azor-Proxy-Auth') === 'denied');
    if (sessionDenied) return sessionDenied;
    const answered = errors.find(e =>
      e instanceof AzorPanelInvalidResponseError ||
      (e instanceof HttpErrorResponse && !ReportTypeService.UNREACHABLE_STATUSES.includes(e.status))
    );
    return answered ?? errors[0];
  }

  private updateLookupReportTypes(key: string, update: (current: ReportType[]) => ReportType[]): void {
    const lookup = this.getLookup(key);
    if (!lookup) return;
    const reportTypes = update(lookup.reportTypes);
    this.patch(key, {
      ...lookup,
      reportTypes,
      state: reportTypes.length > 0 ? 'ready' : 'empty'
    });
  }

  private emptyLookup(domain: AzorDomain, state: AzorDomainState): AzorDomainLookup {
    return {
      key: domain.key,
      domain,
      state,
      origin: null,
      scheme: null,
      proxyBase: null,
      reportTypes: [],
      error: null,
      refreshing: false,
      refreshError: null,
      schemeFallback: false
    };
  }

  private patch(key: string, lookup: AzorDomainLookup): void {
    this.lookups.update(all => ({ ...all, [key]: lookup }));
  }

  private dedupeById(items: ReportType[]): ReportType[] {
    const seen = new Map<string, ReportType>();
    items.forEach(item => seen.set(item.id, item));
    return [...seen.values()];
  }
}
