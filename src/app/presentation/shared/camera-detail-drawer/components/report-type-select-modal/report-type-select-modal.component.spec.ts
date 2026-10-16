import { TestBed, ComponentFixture } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { vi } from 'vitest';
import { ReportTypeSelectModalComponent } from './report-type-select-modal.component';
import { IReportTypeRepository } from '../../../../../core/domain/repositories/report-type.repository';
import {
  REPORT_TYPE_CLASSIFICATION_DETECCION_IA,
  REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA,
  ReportType
} from '../../../../../core/domain/entities/report-type.models';
import { AzorDomain, normalizeAzorDomain } from '../../../../../core/utils/azor-endpoint.util';

/** Base del proxy del dominio resuelto (https es el esquema preferido cuando no se escribe uno). */
const HTTPS_BASE = '/azor-proxy/https/panel.com/443';

function domainOf(input: string): AzorDomain {
  const result = normalizeAzorDomain(input);
  if (!result.ok) throw new Error(result.message);
  return result.domain;
}

function rt(id: string, name: string, classification = REPORT_TYPE_CLASSIFICATION_DETECCION_IA): ReportType {
  return { id, name, description: '', classification, configCreateMetadata: {} };
}

const SEED: ReportType[] = [
  rt('b', 'Permanencia de objeto'),
  rt('a', 'Análisis de tráfico'),
  rt('c', 'Reconocimiento de placas', REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA)
];

describe('ReportTypeSelectModalComponent', () => {
  let fixture: ComponentFixture<ReportTypeSelectModalComponent>;
  let component: ReportTypeSelectModalComponent;
  let repo: Record<keyof IReportTypeRepository, ReturnType<typeof vi.fn>>;
  const el = () => fixture.nativeElement as HTMLElement;

  // setInput marca la vista como modificada (el componente corre sin zone.js) y dispara ngOnChanges como lo haría el padre
  function open(selectedId: string | null = null, domain: AzorDomain | null = domainOf('panel.com')): void {
    fixture.componentRef.setInput('domain', domain);
    fixture.componentRef.setInput('selectedId', selectedId);
    fixture.componentRef.setInput('show', true);
    fixture.detectChanges();
  }

  function close(): void {
    fixture.componentRef.setInput('show', false);
    fixture.detectChanges();
  }

  beforeEach(() => {
    repo = {
      // Ambos esquemas responden igual: gana https (preferido)
      getReportTypes: vi.fn((_base: string) => of({ page: 1, totalItems: SEED.length, totalPages: 1, limit: 100, items: [...SEED] })),
      createReportType: vi.fn((_base: string, data: any) => of({ ...rt('new', data.name, data.classification) })),
      updateReportType: vi.fn((_base: string, id: string, data: any) => of({ ...rt(id, data.name, data.classification) }))
    };

    TestBed.configureTestingModule({
      imports: [ReportTypeSelectModalComponent],
      providers: [{ provide: IReportTypeRepository, useValue: repo }]
    });

    fixture = TestBed.createComponent(ReportTypeSelectModalComponent);
    component = fixture.componentInstance;
  });

  // ── Carga ──

  it('should query the GET of its domain (https and http) every time the modal is opened', () => {
    open();
    expect(repo.getReportTypes).toHaveBeenCalledTimes(2);
    expect(repo.getReportTypes.mock.calls.map(c => c[0])).toEqual([HTTPS_BASE, '/azor-proxy/http/panel.com/80']);

    close();
    open();
    expect(repo.getReportTypes).toHaveBeenCalledTimes(4);
  });

  it('should not query anything without a domain', () => {
    open(null, null);
    expect(repo.getReportTypes).not.toHaveBeenCalled();
  });

  it('should show the resolved domain in the header', () => {
    open();
    expect(el().querySelector('.modal-domain-chip')?.textContent?.trim()).toBe('https://panel.com');
  });

  it('should open directly in the create view when requested (domain without report types)', () => {
    repo.getReportTypes.mockReturnValue(of({ page: 1, totalItems: 0, totalPages: 1, limit: 100, items: [] }));
    fixture.componentRef.setInput('startInCreate', true);
    open();

    expect(component.view()).toBe('form');
    expect(component.isEditing()).toBe(false);
    expect(el().querySelector('.modal-header-section h5')?.textContent).toContain('Nuevo Tipo de Reporte');

    component.backToList();
    fixture.detectChanges();
    expect(el().textContent).toContain('Este dominio aún no tiene tipos de reporte');
  });

  it('should keep showing the cached list when a refresh on open fails', () => {
    vi.spyOn(console, 'error').mockImplementation(() => { });
    open();
    close();

    repo.getReportTypes
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502 })))
      .mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 502 })));
    open();

    expect(el().querySelectorAll('.report-type-card').length).toBe(3);
    expect(component.refreshError()).toContain('No se pudo conectar');
    expect(el().querySelector('.report-type-alert.is-danger')?.textContent).toContain('No se pudo actualizar la lista');
  });

  it('should list report types sorted A→Z with no sort or reload controls', () => {
    open();
    expect(component.filteredReportTypes().map(r => r.id)).toEqual(['a', 'b', 'c']);

    expect(el().querySelector('.btn-sort-toggle')).toBeNull();
    expect(el().querySelector('.btn-icon-round')).toBeNull();
    expect(el().querySelector('.modal-filter-pill')).toBeNull();
  });

  // ── Toggle de clasificación ──

  it('should render a toggle with "Todas" plus the two classifications, defaulting to "Todas"', () => {
    open();
    const tabs = Array.from(el().querySelectorAll('.classification-segmented .btn-segmented')) as HTMLElement[];
    expect(tabs.map(t => t.textContent?.trim())).toEqual(['Todas', 'Detección IA', 'Reconocimiento IA']);
    expect(tabs[0].classList.contains('active')).toBe(true);
    expect(component.filteredReportTypes().length).toBe(3);
  });

  it('should place the compact toggle to the right of the search bar, inside the same row', () => {
    open();
    const row = el().querySelector('.modal-search-row') as HTMLElement;
    const children = Array.from(row.children) as HTMLElement[];
    expect(children.length).toBe(2);
    expect(children[0].classList.contains('modal-search-wrapper')).toBe(true);
    expect(children[1].classList.contains('classification-segmented')).toBe(true);
    expect(el().querySelector('.modal-tabs-pill')).toBeNull();
  });

  it('should color each toggle option like the badge of its classification, leaving "Todas" neutral', () => {
    open();
    const tabs = Array.from(el().querySelectorAll('.classification-segmented .btn-segmented')) as HTMLElement[];

    expect(tabs[0].classList.contains('is-deteccion') || tabs[0].classList.contains('is-reconocimiento')).toBe(false);
    expect(tabs[1].classList.contains('is-deteccion')).toBe(true);
    expect(tabs[2].classList.contains('is-reconocimiento')).toBe(true);

    // La misma clase que usa el badge de cada tarjeta, para que ambos compartan color
    const detectionBadge = el().querySelector('.report-type-card .classification-badge.is-deteccion');
    const recognitionBadge = el().querySelector('.report-type-card .classification-badge.is-reconocimiento');
    expect(detectionBadge).not.toBeNull();
    expect(recognitionBadge).not.toBeNull();

    tabs[2].click();
    fixture.detectChanges();
    expect(tabs[2].classList.contains('active') && tabs[2].classList.contains('is-reconocimiento')).toBe(true);
    expect(tabs[1].classList.contains('active')).toBe(false);
  });

  it('should filter by classification when a toggle option is clicked', () => {
    open();
    const tabs = Array.from(el().querySelectorAll('.classification-segmented .btn-segmented')) as HTMLElement[];

    tabs[2].click();
    fixture.detectChanges();
    expect(component.filteredReportTypes().map(r => r.id)).toEqual(['c']);
    expect(el().querySelectorAll('.report-type-card').length).toBe(1);

    tabs[1].click();
    fixture.detectChanges();
    expect(component.filteredReportTypes().map(r => r.id)).toEqual(['a', 'b']);

    tabs[0].click();
    fixture.detectChanges();
    expect(component.filteredReportTypes().length).toBe(3);
  });

  it('should combine the accent-insensitive search with the classification toggle', () => {
    open();
    component.searchQuery.set('trafico');
    expect(component.filteredReportTypes().map(r => r.id)).toEqual(['a']);

    component.setClassificationFilter(REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA);
    expect(component.filteredReportTypes()).toEqual([]);

    component.clearFilters();
    expect(component.filteredReportTypes().length).toBe(3);
  });

  // ── Tarjetas ──

  it('should not render descriptions under the report type names', () => {
    const withDescription = SEED.map(r => ({ ...r, description: 'Descripción visible de ' + r.name }));
    repo.getReportTypes.mockReturnValue(of({ page: 1, totalItems: 3, totalPages: 1, limit: 100, items: withDescription }));
    open();

    expect(el().querySelectorAll('.report-type-card').length).toBe(3);
    expect(el().textContent).not.toContain('Descripción visible de');
  });

  it('should render the edit icon as the button itself, without a square container', () => {
    open();
    const editButtons = el().querySelectorAll('.report-type-card .btn-edit-icon');
    expect(editButtons.length).toBe(3);

    const first = editButtons[0] as HTMLElement;
    expect(first.tagName).toBe('BUTTON');
    expect(first.classList.contains('icon-svg')).toBe(true);
    expect(first.classList.contains('icon-edit')).toBe(true);
    expect(first.children.length).toBe(0);
    expect(el().querySelector('.btn-card-action')).toBeNull();
  });

  it('should open the edit form without selecting the card when the edit icon is clicked', () => {
    open();
    (el().querySelector('.report-type-card .btn-edit-icon') as HTMLElement).click();
    fixture.detectChanges();

    expect(component.view()).toBe('form');
    expect(component.tempSelectedId()).toBeNull();
  });

  // ── Metadata ──

  it('should list timestamp_real among the fixed metadata fields of the form', () => {
    open();
    component.openCreateForm();
    fixture.detectChanges();

    const chips = Array.from(el().querySelectorAll('.metadata-chip')).map(c => c.textContent?.trim());
    expect(chips).toEqual(['idNx', 'Camara', 'Objeto', 'extra_info', 'id_match_detail', 'id_iaframe_camara', 'timestamp_real']);
  });

  // ── Selección ──

  it('should toggle a single selection and emit it on confirm', () => {
    open();
    const emitted = vi.fn();
    component.confirmed.subscribe(emitted);

    component.toggleSelection('a');
    component.toggleSelection('b');
    expect(component.tempSelectedId()).toBe('b');
    component.toggleSelection('b');
    expect(component.selectedReportType()).toBeNull();

    component.toggleSelection('c');
    component.confirmSelection();
    expect(emitted).toHaveBeenCalledWith(expect.objectContaining({ id: 'c' }));
  });

  it('should preselect the current report type when opened', () => {
    open('b');
    expect(component.selectedReportType()?.name).toBe('Permanencia de objeto');
  });

  // ── Crear ──

  it('should not create when the name is empty or duplicated', () => {
    open();
    component.openCreateForm();
    component.saveForm();
    expect(component.nameError()).toBe('El nombre es obligatorio.');

    component.formName.set('  analisis DE trafico ');
    expect(component.nameError()).toBe('Ya existe un tipo de reporte con ese nombre.');
    component.saveForm();
    expect(repo.createReportType).not.toHaveBeenCalled();
  });

  it('should create with the chosen classification, select it and return to the list', () => {
    open();
    component.searchQuery.set('zzz');
    component.openCreateForm();
    expect(component.formClassification()).toBe(REPORT_TYPE_CLASSIFICATION_DETECCION_IA);

    component.formName.set('Intrusión perimetral');
    component.formClassification.set(REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA);
    component.saveForm();

    expect(repo.createReportType).toHaveBeenCalledWith(HTTPS_BASE, {
      name: 'Intrusión perimetral',
      description: '',
      classification: REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA
    });
    expect(component.view()).toBe('list');
    expect(component.searchQuery()).toBe('');
    expect(component.tempSelectedId()).toBe('new');
  });

  it('should preselect the active toggle classification when creating, and reset the toggle if it would hide the new type', () => {
    open();
    component.setClassificationFilter(REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA);
    component.openCreateForm();
    expect(component.formClassification()).toBe(REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA);

    component.formName.set('Nuevo de detección');
    component.formClassification.set(REPORT_TYPE_CLASSIFICATION_DETECCION_IA);
    component.saveForm();

    expect(component.classificationFilter()).toBe('all');
    expect(component.tempSelectedId()).toBe('new');
  });

  it('should show the backend error and stay in the form when saving fails', () => {
    repo.createReportType.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 401 })));
    open();
    component.openCreateForm();
    component.formName.set('Nuevo');
    component.saveForm();
    expect(component.view()).toBe('form');
    expect(component.formError()).toBe('Clave de integración rechazada.');
  });

  // ── Editar ──

  it('should edit without flagging its own name as duplicate and keep the original classification', () => {
    open();
    component.openEditForm(SEED[2], new Event('click'));
    // Aunque el estado del formulario se alterara, el PATCH debe enviar la clasificación original
    component.formClassification.set(REPORT_TYPE_CLASSIFICATION_DETECCION_IA);
    component.formName.set('Reconocimiento de placas vehiculares');
    component.saveForm();

    expect(repo.updateReportType).toHaveBeenCalledWith(HTTPS_BASE, 'c', {
      name: 'Reconocimiento de placas vehiculares',
      description: '',
      classification: REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA
    });
    expect(component.view()).toBe('list');
  });

  const formTabs = () =>
    Array.from(el().querySelectorAll('.report-type-form .classification-segmented .btn-segmented')) as HTMLButtonElement[];

  it('should render the classification as a 2-option toggle colored like the badges, with no select', () => {
    open();
    component.openCreateForm();
    fixture.detectChanges();

    expect(el().querySelector('app-custom-select')).toBeNull();
    const tabs = formTabs();
    expect(tabs.map(t => t.querySelector('.segment-title')?.textContent?.trim())).toEqual(['Detección IA', 'Reconocimiento IA']);
    expect(tabs.map(t => t.querySelector('.segment-caption')?.textContent?.trim())).toEqual([
      'Otras analíticas',
      'Reconocimiento facial y de placas'
    ]);
    // Variante a todo el ancho; la nota de ayuda de debajo ya no se repite
    expect(el().querySelector('.report-type-form .classification-segmented--block')).not.toBeNull();
    expect(el().querySelector('.report-type-form .field-hint strong')).toBeNull();
    expect(tabs[0].classList.contains('is-deteccion')).toBe(true);
    expect(tabs[1].classList.contains('is-reconocimiento')).toBe(true);
    // Por defecto: Detección IA
    expect(tabs[0].classList.contains('active')).toBe(true);
    expect(tabs.every(t => !t.disabled)).toBe(true);
  });

  it('should let the user pick the classification with the toggle when creating', () => {
    open();
    component.openCreateForm();
    fixture.detectChanges();

    formTabs()[1].click();
    fixture.detectChanges();
    expect(component.formClassification()).toBe(REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA);
    expect(formTabs()[1].classList.contains('active')).toBe(true);
    expect(formTabs()[0].classList.contains('active')).toBe(false);

    component.formName.set('Nuevo reconocimiento');
    component.saveForm();
    expect(repo.createReportType).toHaveBeenCalledWith(
      HTTPS_BASE,
      expect.objectContaining({ classification: REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA })
    );
  });

  it('should lock the toggle when editing, keeping the original option selected', () => {
    open();
    component.openEditForm(SEED[2], new Event('click'));
    fixture.detectChanges();

    const tabs = formTabs();
    expect(tabs.every(t => t.disabled)).toBe(true);
    expect(tabs[1].classList.contains('active')).toBe(true);
    expect(el().querySelector('.classification-segmented.is-locked')).not.toBeNull();
    expect(el().querySelector('.report-type-form')?.textContent).toContain('No se puede cambiar');

    // Aunque se intente cambiar por código, la clasificación no se altera
    component.setFormClassification(REPORT_TYPE_CLASSIFICATION_DETECCION_IA);
    expect(component.formClassification()).toBe(REPORT_TYPE_CLASSIFICATION_RECONOCIMIENTO_IA);

    component.backToList();
    component.openCreateForm();
    fixture.detectChanges();
    expect(formTabs().every(t => !t.disabled)).toBe(true);
    expect(el().querySelector('.classification-segmented.is-locked')).toBeNull();
  });

  // ── Vista de formulario: no debe parecer un modal anidado ──

  it('should render the form as a full view of the same modal, without a nested card or a second title', () => {
    open();
    component.openCreateForm();
    fixture.detectChanges();

    expect(el().querySelectorAll('.premium-detail-modal').length).toBe(1);
    expect(el().querySelector('.report-type-form-card')).toBeNull();
    expect(el().querySelector('form.border')).toBeNull();
    // Un único título, el del encabezado del modal
    expect(el().querySelectorAll('h5').length).toBe(1);
    expect(el().querySelector('.modal-header-section h5')?.textContent).toContain('Nuevo Tipo de Reporte');
    expect(el().querySelector('.modal-header-section .btn-hierarchy-back-icon')).not.toBeNull();
  });

  // ── Sin DELETE ──

  it('should not expose any delete control or delete API', () => {
    open();
    expect(el().querySelector('.btn-card-action.is-danger')).toBeNull();
    expect(el().querySelector('app-confirm-delete-modal')).toBeNull();
    expect(el().querySelector('[title="Eliminar tipo de reporte"]')).toBeNull();
    expect('deleteReportType' in repo).toBe(false);
    expect((component as any).requestDelete).toBeUndefined();
  });

  // ── Cierre ──

  it('should close on backdrop click in list view', () => {
    open();
    const closed = vi.fn();
    component.closed.subscribe(closed);
    const backdrop = el().querySelector('.modal-backdrop-blur') as HTMLElement;

    const down = new MouseEvent('mousedown', { button: 0 });
    Object.defineProperty(down, 'target', { value: backdrop });
    component.onBackdropMouseDown(down);
    const up = new MouseEvent('mouseup', { button: 0 });
    Object.defineProperty(up, 'target', { value: backdrop });
    Object.defineProperty(up, 'currentTarget', { value: backdrop });
    component.onBackdropMouseUp(up);

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('should close on backdrop click in form view', () => {
    open();
    const closed = vi.fn();
    component.closed.subscribe(closed);
    const backdrop = el().querySelector('.modal-backdrop-blur') as HTMLElement;

    component.openCreateForm();
    const down = new MouseEvent('mousedown', { button: 0 });
    Object.defineProperty(down, 'target', { value: backdrop });
    component.onBackdropMouseDown(down);
    const up = new MouseEvent('mouseup', { button: 0 });
    Object.defineProperty(up, 'target', { value: backdrop });
    Object.defineProperty(up, 'currentTarget', { value: backdrop });
    component.onBackdropMouseUp(up);

    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('should not close on backdrop click while saving', () => {
    open();
    const closed = vi.fn();
    component.closed.subscribe(closed);
    const backdrop = el().querySelector('.modal-backdrop-blur') as HTMLElement;

    component.reportTypeService.isSaving.set(true);

    const down = new MouseEvent('mousedown', { button: 0 });
    Object.defineProperty(down, 'target', { value: backdrop });
    component.onBackdropMouseDown(down);
    const up = new MouseEvent('mouseup', { button: 0 });
    Object.defineProperty(up, 'target', { value: backdrop });
    Object.defineProperty(up, 'currentTarget', { value: backdrop });
    component.onBackdropMouseUp(up);

    expect(closed).not.toHaveBeenCalled();
  });
});
