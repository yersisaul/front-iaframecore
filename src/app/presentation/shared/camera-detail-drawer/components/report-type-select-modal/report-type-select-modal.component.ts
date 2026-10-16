import { Component, Input, Output, EventEmitter, signal, computed, inject, HostListener, OnChanges, SimpleChanges, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReportTypeService } from '../../../../../core/services/report-type.service';
import {
  DEFAULT_REPORT_TYPE_CLASSIFICATION,
  REPORT_TYPE_CLASSIFICATIONS,
  REPORT_TYPE_CLASSIFICATION_DETECCION_IA,
  REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA,
  REPORT_TYPE_METADATA_FIELDS,
  ReportType,
  getReportTypeClassificationLabel
} from '../../../../../core/domain/entities/report-type.models';
import { SelectOption } from '../../../custom-select/custom-select.component';
import { AzorDomain } from '../../../../../core/utils/azor-endpoint.util';

@Component({
  selector: 'app-report-type-select-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './report-type-select-modal.component.html',
  styleUrl: './report-type-select-modal.component.css'
})
export class ReportTypeSelectModalComponent implements OnChanges {
  readonly reportTypeService = inject(ReportTypeService);
  private elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  @Input() show: boolean = false;
  @Input() selectedId: string | null = null;
  /** Dominio de Azor Panel (ya limpio) donde se listan, crean y editan los tipos de reporte. */
  @Input() set domain(value: AzorDomain | null) {
    this.domainSignal.set(value);
  }
  get domain(): AzorDomain | null {
    return this.domainSignal();
  }
  /** Abre directo en "Nuevo tipo de reporte" (dominio verificado sin tipos de reporte). */
  @Input() startInCreate: boolean = false;

  @Output() confirmed = new EventEmitter<ReportType>();
  @Output() closed = new EventEmitter<void>();

  readonly metadataFields = REPORT_TYPE_METADATA_FIELDS;
  readonly classificationOptions: SelectOption[] = REPORT_TYPE_CLASSIFICATIONS.map(c => ({ label: c.label, value: c.id }));
  /** Frase corta bajo cada opción del toggle del formulario. */
  readonly classificationCaptions: Record<string, string> = {
    [REPORT_TYPE_CLASSIFICATION_DETECCION_IA]: 'Otras analíticas',
    [REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA]: 'Reconocimiento facial y de placas'
  };
  /** Opciones del toggle de filtro: "Todas" + las clasificaciones disponibles. */
  readonly classificationFilterOptions: SelectOption[] = [{ label: 'Todas', value: 'all' }, ...this.classificationOptions];

  // ── Estado de la vista ──
  readonly view = signal<'list' | 'form'>('list');

  // ── Listado: búsqueda, filtro de clasificación y selección ──
  readonly searchQuery = signal<string>('');
  readonly classificationFilter = signal<string>('all');
  readonly tempSelectedId = signal<string | null>(null);

  // ── Formulario de creación / edición ──
  readonly editingId = signal<string | null>(null);
  /** Clasificación original del registro en edición: no se puede cambiar y es la que se envía en el PATCH. */
  readonly editingClassification = signal<string | null>(null);
  readonly formName = signal<string>('');
  readonly formDescription = signal<string>('');
  readonly formClassification = signal<string>(DEFAULT_REPORT_TYPE_CLASSIFICATION);
  readonly formSubmitted = signal<boolean>(false);
  readonly formError = signal<string | null>(null);

  private backdropMouseDownTarget: EventTarget | null = null;

  // ── Dominio consultado ──
  private readonly domainSignal = signal<AzorDomain | null>(null);
  readonly domainKey = computed(() => this.domainSignal()?.key ?? null);
  readonly lookup = computed(() => this.reportTypeService.getLookup(this.domainKey()));
  readonly reportTypes = computed(() => this.lookup()?.reportTypes ?? []);
  /** Primera carga del dominio (sin datos todavía). */
  readonly isLoading = computed(() => this.lookup()?.state === 'checking');
  /** Actualización en segundo plano sobre datos ya cargados. */
  readonly isRefreshing = computed(() => !!this.lookup()?.refreshing);
  readonly loadError = computed(() => (this.lookup()?.state === 'error' ? this.lookup()?.error ?? null : null));

  readonly hasActiveFilters = computed(() =>
    this.searchQuery().trim() !== '' || this.classificationFilter() !== 'all'
  );

  /** Orden fijo alfabético (A→Z) por nombre. */
  readonly filteredReportTypes = computed(() => {
    const query = this.normalize(this.searchQuery());
    const classification = this.classificationFilter();

    return this.reportTypes()
      .filter(rt => classification === 'all' || rt.classification === classification)
      .filter(rt => {
        if (!query) return true;
        return this.normalize(rt.name).includes(query) ||
          this.normalize(rt.description).includes(query) ||
          rt.id.toLowerCase().includes(query);
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  });

  readonly selectedReportType = computed(() => {
    const id = this.tempSelectedId();
    return id ? this.reportTypes().find(rt => rt.id === id) || null : null;
  });

  /** Error de una actualización en segundo plano: se muestra sobre la lista ya cargada sin ocultarla. */
  readonly refreshError = computed(() => this.lookup()?.refreshError ?? null);

  readonly isEditing = computed(() => this.editingId() !== null);

  readonly nameError = computed(() => {
    if (!this.formSubmitted()) return null;
    const name = this.formName().trim();
    if (!name) return 'El nombre es obligatorio.';
    const normalized = this.normalize(name);
    const duplicate = this.reportTypes()
      .some(rt => rt.id !== this.editingId() && this.normalize(rt.name) === normalized);
    return duplicate ? 'Ya existe un tipo de reporte con ese nombre.' : null;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['show'] && this.show && !changes['show'].previousValue) {
      this.resetState();
      this.loadReportTypes();
      if (this.startInCreate) this.openCreateForm();
    }
  }

  // =========================================================================
  // CARGA
  // =========================================================================

  /**
   * Consulta el GET en el dominio de Azor Panel. Se ejecuta cada vez que se abre el modal:
   * si ya hay una lista en caché se muestra de inmediato y se actualiza en segundo plano.
   */
  loadReportTypes(): void {
    const domain = this.domainSignal();
    if (!domain) return;
    const hadCache = this.reportTypes().length > 0;
    const selectedId = this.tempSelectedId();
    if (hadCache && selectedId) this.scrollToCard(selectedId);

    // El resultado (datos o error) queda en el estado del dominio del servicio
    this.reportTypeService.checkDomain(domain, { force: true }).subscribe({
      next: () => {
        if (!hadCache && selectedId) this.scrollToCard(selectedId);
      },
      error: () => { }
    });
  }

  // =========================================================================
  // LISTADO
  // =========================================================================

  toggleSelection(id: string): void {
    this.tempSelectedId.update(curr => (curr === id ? null : id));
  }

  setClassificationFilter(value: string): void {
    this.classificationFilter.set(value);
  }

  /** La clasificación solo se puede elegir al crear; al editar el toggle está bloqueado. */
  setFormClassification(value: string): void {
    if (this.isEditing() || this.reportTypeService.isSaving()) return;
    this.formClassification.set(value);
  }

  clearFilters(): void {
    this.searchQuery.set('');
    this.classificationFilter.set('all');
  }

  getClassificationLabel(classificationId: string | null): string {
    return getReportTypeClassificationLabel(classificationId);
  }

  getClassificationBadgeClass(classificationId: string | null): string {
    if (classificationId === REPORT_TYPE_CLASSIFICATION_DETECCION_IA) return 'is-deteccion';
    if (classificationId === REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA) return 'is-reconocimiento';
    return 'is-unknown';
  }

  /** Clase de color de la opción del toggle: la misma de los badges; "Todas" queda neutra. */
  getFilterOptionClass(value: string): string {
    return value === 'all' ? '' : this.getClassificationBadgeClass(value);
  }

  confirmSelection(): void {
    const selected = this.selectedReportType();
    if (!selected) return;
    this.confirmed.emit(selected);
  }

  close(): void {
    if (this.reportTypeService.isSaving()) return;
    this.closed.emit();
  }

  // =========================================================================
  // FORMULARIO (CREAR / EDITAR)
  // =========================================================================

  openCreateForm(): void {
    const activeFilter = this.classificationFilter();
    this.editingId.set(null);
    this.editingClassification.set(null);
    this.formName.set('');
    this.formDescription.set('');
    // Si el listado está filtrado por una clasificación, el nuevo tipo parte de esa
    this.formClassification.set(activeFilter !== 'all' ? activeFilter : DEFAULT_REPORT_TYPE_CLASSIFICATION);
    this.openForm();
  }

  openEditForm(reportType: ReportType, event: Event): void {
    event.stopPropagation();
    const classification = reportType.classification || DEFAULT_REPORT_TYPE_CLASSIFICATION;
    this.editingId.set(reportType.id);
    this.editingClassification.set(classification);
    this.formName.set(reportType.name);
    this.formDescription.set(reportType.description);
    this.formClassification.set(classification);
    this.openForm();
  }

  backToList(): void {
    if (this.reportTypeService.isSaving()) return;
    this.view.set('list');
    this.formError.set(null);
    this.formSubmitted.set(false);
  }

  saveForm(): void {
    if (this.reportTypeService.isSaving()) return;
    this.formSubmitted.set(true);
    this.formError.set(null);
    if (this.nameError()) return;

    const domainKey = this.domainKey();
    if (!domainKey) return;
    const editingId = this.editingId();
    const data = {
      name: this.formName(),
      description: this.formDescription(),
      // Al actualizar, la clasificación siempre es la original del registro
      classification: editingId
        ? (this.editingClassification() ?? this.formClassification())
        : this.formClassification()
    };
    const request$ = editingId
      ? this.reportTypeService.updateReportType(domainKey, editingId, data)
      : this.reportTypeService.createReportType(domainKey, data);

    request$.subscribe({
      next: saved => {
        this.view.set('list');
        this.formSubmitted.set(false);
        if (!editingId && saved.id) {
          // El recién creado queda seleccionado y visible aunque hubiera filtros que lo ocultaran
          this.searchQuery.set('');
          const activeFilter = this.classificationFilter();
          if (activeFilter !== 'all' && activeFilter !== saved.classification) {
            this.classificationFilter.set('all');
          }
          this.tempSelectedId.set(saved.id);
        }
        const targetId = saved.id || editingId;
        if (targetId) this.scrollToCard(targetId);
      },
      error: err => this.formError.set(this.reportTypeService.getErrorMessage(err))
    });
  }

  // =========================================================================
  // CIERRE / TECLADO
  // =========================================================================

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.show || this.reportTypeService.isSaving()) return;
    if (this.view() === 'form') {
      this.backToList();
    } else {
      this.close();
    }
  }

  onBackdropMouseDown(event: MouseEvent): void {
    this.backdropMouseDownTarget = event.button === 0 ? event.target : null;
  }

  onBackdropClick(event: MouseEvent): void {
    if (
      event.button === 0 &&
      this.backdropMouseDownTarget === event.currentTarget &&
      event.target === event.currentTarget
    ) {
      event.stopPropagation();
      this.close();
    }
    this.backdropMouseDownTarget = null;
  }

  onBackdropMouseUp(event: MouseEvent): void {
    this.onBackdropClick(event);
  }

  // =========================================================================
  // UTILIDADES
  // =========================================================================

  private openForm(): void {
    this.formSubmitted.set(false);
    this.formError.set(null);
    this.view.set('form');
  }

  private resetState(): void {
    this.view.set('list');
    this.searchQuery.set('');
    this.classificationFilter.set('all');
    this.tempSelectedId.set(this.selectedId || null);
    this.editingId.set(null);
    this.editingClassification.set(null);
    this.formSubmitted.set(false);
    this.formError.set(null);
  }

  private scrollToCard(id: string): void {
    setTimeout(() => {
      const cards = this.elementRef.nativeElement.querySelectorAll('.report-type-card') as NodeListOf<HTMLElement>;
      const card = Array.from(cards).find(el => el.dataset['reportTypeId'] === id);
      card?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    });
  }

  private normalize(value: string | null | undefined): string {
    return (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();
  }
}
