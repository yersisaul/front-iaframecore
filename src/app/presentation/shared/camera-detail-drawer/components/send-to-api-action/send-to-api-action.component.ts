import { Component, Input, Output, EventEmitter, signal, computed, inject, OnChanges, OnDestroy, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { AzorDomainLookup, ReportTypeService } from '../../../../../core/services/report-type.service';
import { ReportType } from '../../../../../core/domain/entities/report-type.models';
import {
  AzorDomain,
  buildAzorReportsEndpoint,
  normalizeAzorDomain
} from '../../../../../core/utils/azor-endpoint.util';
import { SendToApiStatus } from '../../../../../core/utils/scheduled-actions-validation.util';
import { ReportTypeSelectModalComponent } from '../report-type-select-modal/report-type-select-modal.component';

export interface SendToApiActionValue {
  /** {origen resuelto}/azor-analytics/reports, o '' mientras el dominio no esté verificado. */
  endpoint: string;
  id_report_type: string;
}

/**
 * Estado del dominio en la acción:
 * idle (vacío) · typing (esperando a que termine de escribir) · invalid (formato) ·
 * checking · ready · empty (sin tipos de reporte) · error (no respondió)
 */
export type SendToApiDomainState = 'idle' | 'typing' | 'invalid' | 'checking' | 'ready' | 'empty' | 'error';

@Component({
  selector: 'app-send-to-api-action',
  standalone: true,
  imports: [CommonModule, ReportTypeSelectModalComponent],
  templateUrl: './send-to-api-action.component.html',
  styleUrl: './send-to-api-action.component.css'
})
export class SendToApiActionComponent implements OnChanges, OnDestroy {
  readonly reportTypeService = inject(ReportTypeService);

  /** Espera tras dejar de escribir antes de consultar (como un buscador automático). */
  static readonly DEBOUNCE_MS = 600;

  /** Clave de la acción en el objeto de acciones (idIndex del builder). */
  @Input() actionKey: string = '';
  @Input() endpoint: string = '';
  @Input() set reportTypeId(value: string | null | undefined) {
    this.reportTypeIdSignal.set(value || '');
  }
  get reportTypeId(): string {
    return this.reportTypeIdSignal();
  }
  @Input() highlightErrors: boolean = false;

  @Output() changed = new EventEmitter<SendToApiActionValue>();

  public readonly domainInput = signal<string>('');
  public readonly domain = signal<AzorDomain | null>(null);
  public readonly domainError = signal<string | null>(null);
  public readonly isTyping = signal<boolean>(false);
  public readonly clearedNotice = signal<string | null>(null);
  public readonly isModalOpen = signal<boolean>(false);
  public readonly modalStartInCreate = signal<boolean>(false);
  private readonly reportTypeIdSignal = signal<string>('');

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Último endpoint emitido: evita reinterpretar el valor que vuelve del builder. */
  private lastEmittedEndpoint: string | null = null;
  /** El dominio fue cambiado por el usuario (no cargado de una analítica guardada). */
  private domainChangedByUser = false;

  readonly lookup = computed(() => this.reportTypeService.getLookup(this.domain()?.key));

  readonly domainState = computed<SendToApiDomainState>(() => {
    if (this.isTyping()) return 'typing';
    if (this.domainError()) return 'invalid';
    if (!this.domain()) return 'idle';
    const lookup = this.lookup();
    if (!lookup || lookup.state === 'checking') return 'checking';
    return lookup.state;
  });

  readonly reportStatus = computed(() =>
    this.reportTypeService.getReportTypeStatus(this.domain()?.key, this.reportTypeIdSignal())
  );

  readonly selectedReportType = computed<ReportType | null>(() =>
    this.reportTypeService.findReportType(this.domain()?.key, this.reportTypeIdSignal())
  );

  readonly canOpenSelector = computed(() => ['ready', 'empty'].includes(this.domainState()));

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['endpoint'] && this.endpoint !== this.lastEmittedEndpoint) {
      this.loadFromEndpoint(this.endpoint || '');
    }
  }

  ngOnDestroy(): void {
    this.clearDebounce();
  }

  // =========================================================================
  // INPUT DE DOMINIO
  // =========================================================================

  onDomainInput(value: string): void {
    this.domainInput.set(value);
    this.isTyping.set(true);
    this.clearDebounce();
    this.debounceTimer = setTimeout(() => this.commitDomain(), SendToApiActionComponent.DEBOUNCE_MS);
  }

  onDomainBlur(): void {
    if (this.isTyping()) this.commitDomain();
  }

  onDomainEnter(event: Event): void {
    event.preventDefault();
    this.commitDomain();
  }

  /** Limpia lo escrito y, si es válido, consulta el dominio. Nunca consulta un valor inválido. */
  commitDomain(): void {
    this.clearDebounce();
    this.isTyping.set(false);

    const result = normalizeAzorDomain(this.domainInput());
    if (!result.ok) {
      this.domain.set(null);
      this.domainError.set(result.error === 'empty' ? null : result.message);
      this.domainChangedByUser = true;
      this.clearedNotice.set(null);
      if (this.endpoint) this.emitChange({ endpoint: '' });
      return;
    }

    const next = result.domain;
    const current = this.domain();
    this.domainError.set(null);

    // Mismo dominio ya verificado: solo se reescribe el input con el valor limpio
    if (current?.key === next.key && this.lookup() && this.lookup()!.state !== 'error') {
      this.domainInput.set(this.lookup()!.origin ?? next.display);
      return;
    }

    this.domainInput.set(next.display);
    this.domain.set(next);
    this.domainChangedByUser = true;
    this.clearedNotice.set(null);
    // Hasta verificar el nuevo dominio no hay endpoint válido
    if (this.endpoint) this.emitChange({ endpoint: '' });
    this.check(next);
  }

  // =========================================================================
  // TIPO DE REPORTE
  // =========================================================================

  openSelector(): void {
    if (!this.canOpenSelector()) return;
    this.modalStartInCreate.set(this.domainState() === 'empty');
    this.isModalOpen.set(true);
  }

  closeModal(): void {
    this.isModalOpen.set(false);
  }

  onReportTypeConfirmed(reportType: ReportType): void {
    this.clearedNotice.set(null);
    this.emitChange({ id_report_type: reportType.id });
    this.isModalOpen.set(false);
  }

  // =========================================================================
  // VALIDACIÓN (usada por el drawer al guardar)
  // =========================================================================

  getValidationStatus(): SendToApiStatus {
    switch (this.domainState()) {
      case 'idle': return 'missing-domain';
      case 'invalid': return 'invalid-domain';
      case 'typing':
      case 'checking': return 'checking';
      case 'error': return 'unreachable-domain';
    }
    switch (this.reportStatus()) {
      case 'empty': return 'missing-report-type';
      case 'missing': return 'unknown-report-type';
      case 'loading': return 'checking';
      case 'error': return 'unreachable-domain';
    }
    // El endpoint guardado debe ser el del origen resuelto
    const origin = this.lookup()?.origin;
    return origin && this.endpoint === buildAzorReportsEndpoint(origin) ? 'ok' : 'checking';
  }

  /** Completa la escritura pendiente y espera la verificación en curso del dominio. */
  whenSettled(): Observable<void> {
    if (this.isTyping()) this.commitDomain();
    const pending: Observable<unknown> = this.reportTypeService.getPendingCheck(this.domain()?.key) ?? of(null);
    return pending.pipe(map((): void => undefined));
  }

  // =========================================================================
  // INTERNOS
  // =========================================================================

  /** Interpreta el endpoint guardado: extrae y limpia el dominio y lo verifica de inmediato. */
  private loadFromEndpoint(endpoint: string): void {
    this.clearDebounce();
    this.isTyping.set(false);
    this.domainChangedByUser = false;
    this.clearedNotice.set(null);
    this.lastEmittedEndpoint = endpoint;

    if (!endpoint.trim()) {
      this.domainInput.set('');
      this.domain.set(null);
      this.domainError.set(null);
      return;
    }

    const result = normalizeAzorDomain(endpoint);
    if (!result.ok) {
      this.domainInput.set(endpoint);
      this.domain.set(null);
      this.domainError.set(result.message);
      return;
    }

    this.domainInput.set(result.domain.display);
    this.domain.set(result.domain);
    this.domainError.set(null);
    this.check(result.domain);
  }

  private check(domain: AzorDomain): void {
    this.reportTypeService.checkDomain(domain, { force: true }).subscribe(lookup => this.onResolved(lookup));
  }

  private onResolved(lookup: AzorDomainLookup): void {
    // Respuesta de un dominio que ya no es el actual
    if (lookup.key !== this.domain()?.key) return;
    if ((lookup.state !== 'ready' && lookup.state !== 'empty') || !lookup.origin) return;

    // El input muestra el origen resuelto (con el esquema detectado)
    if (!this.isTyping()) this.domainInput.set(lookup.origin);

    const change: Partial<SendToApiActionValue> = {};
    const resolvedEndpoint = buildAzorReportsEndpoint(lookup.origin);
    if (resolvedEndpoint !== this.endpoint) change.endpoint = resolvedEndpoint;

    // Si el usuario cambió de dominio y el tipo elegido no existe en el nuevo, se limpia con aviso
    const id = this.reportTypeIdSignal();
    if (this.domainChangedByUser && id && !lookup.reportTypes.some(rt => rt.id === id)) {
      change.id_report_type = '';
      this.clearedNotice.set('El tipo de reporte anterior no está en este dominio.');
    }

    if (Object.keys(change).length > 0) this.emitChange(change);
  }

  private emitChange(change: Partial<SendToApiActionValue>): void {
    const value: SendToApiActionValue = {
      endpoint: change.endpoint ?? this.endpoint ?? '',
      id_report_type: change.id_report_type ?? this.reportTypeIdSignal()
    };
    this.lastEmittedEndpoint = value.endpoint;
    this.endpoint = value.endpoint;
    this.reportTypeIdSignal.set(value.id_report_type);
    this.changed.emit(value);
  }

  private clearDebounce(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }
}
