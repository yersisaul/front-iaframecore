import { Component, OnInit, OnDestroy, AfterViewInit, inject, signal, computed, HostListener, ViewChild, ElementRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { Subject, Subscription, forkJoin } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { ListService } from '../../../core/services/list.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { copyToClipboard } from '../../../core/utils/clipboard.util';
import { List, ListDetail } from '../../../core/domain/entities/list.models';
import { ConfirmDeleteModalComponent } from '../../shared/confirm-delete-modal/confirm-delete-modal.component';
import { PaginationControlsComponent } from '../../shared/pagination-controls/pagination-controls.component';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { FilterActionsComponent } from '../../shared/filter-actions/filter-actions.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { CustomSelectComponent } from '../../shared/custom-select/custom-select.component';

export interface FaceUploadResult {
  file: File;
  name: string;
  previewUrl: string;
  errorMessage?: string;
  detailId?: string;
}

export interface SubjectDetectionPostura {
  postura: string;
  conteo: number;
}

export interface SubjectDetectionColor {
  colorText: string;
  r: number;
  g: number;
  b: number;
  porcentaje: number;
}

export interface SubjectDetectionHit {
  id: string;
  eventId?: string;
  camara: string;
  timestamp: Date;
  confiabilidad: number;
  imagen: string;
  urlVideo?: string | null;
  detalleEvento?: string;
  // Atributos de identificación (rostros)
  tipoObjeto?: string;
  edad?: string;
  genero?: string;
  reconocimiento?: string;
  posturas?: SubjectDetectionPostura[];
  colores?: SubjectDetectionColor[];
}

export interface SubjectImportDraft {
  file: File;
  name: string;
  previewUrl: string;
  isEditingName: boolean;
}



@Component({
  selector: 'app-listas',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, ConfirmDeleteModalComponent, PageHeaderComponent, FilterActionsComponent, EmptyStateComponent, PaginationControlsComponent, CustomSelectComponent],
  templateUrl: './listas.html',
  styleUrl: './listas.css'
})
export class Listas implements OnInit, AfterViewInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private listService = inject(ListService);
  private sidebarService = inject(SidebarService);
  public permissionsService = inject(PermissionsService);

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;

  readonly listTypeParam = signal<string>('rostros');
  readonly listType = computed<'face_recognition' | 'plate_recognition'>(() => {
    return this.listTypeParam() === 'placas' ? 'plate_recognition' : 'face_recognition';
  });

  readonly selectedListId = signal<string | null>(null);

  readonly listNewIds = this.listService.newRecordIds;
  readonly listUpdatedIds = this.listService.updatedRecordIds;
  readonly listDeletingIds = this.listService.deletingRecordIds;

  readonly showListModal = signal<boolean>(false);
  readonly listModalMode = signal<'create' | 'edit'>('create');
  readonly listModalId = signal<string>('');
  readonly listModalName = signal<string>('');
  readonly listModalDesc = signal<string>('');
  readonly listModalError = signal<string>('');
  readonly isSavingList = signal<boolean>(false);

  readonly showDeleteListModal = signal<boolean>(false);
  readonly listToDelete = signal<List | null>(null);
  readonly isDeletingList = signal<boolean>(false);

  readonly showDeleteSubjectModal = signal<boolean>(false);
  readonly subjectToDeleteId = signal<string | null>(null);
  readonly subjectToDeleteName = signal<string | null>(null);
  readonly isDeletingSubject = signal<boolean>(false);
  readonly selectedSubjectDetailIds = signal<Set<string>>(new Set());

  readonly copiedRowId = signal<string | null>(null);
  private copiedTimeout: any = null;

  readonly isAllSubjectsSelected = computed<boolean>(() => {
    const total = this.filteredListDetails().length;
    if (total === 0) return false;
    return this.selectedSubjectDetailIds().size === total;
  });

  readonly hasSelectedSubjects = computed<boolean>(() => {
    return this.selectedSubjectDetailIds().size > 0;
  });

  // Señales para los modales independientes de creación
  readonly showAddFaceSubjectModal = signal<boolean>(false);
  readonly faceImportDrafts = signal<SubjectImportDraft[]>([]);
  readonly isDraggingOver = signal<boolean>(false);
  readonly showFloatingAddButton = signal<boolean>(false);

  // Controlador de Carga e Importación Masiva de Rostros
  readonly faceImportStep = signal<'prepare' | 'uploading' | 'summary'>('prepare');
  readonly isUploadingFaceSubjects = signal<boolean>(false);
  readonly uploadCurrentIndex = signal<number>(0);
  readonly uploadTotalCount = signal<number>(0);
  readonly uploadCurrentFileName = signal<string>('');

  readonly successfulUploads = signal<FaceUploadResult[]>([]);
  readonly failedUploads = signal<FaceUploadResult[]>([]);

  readonly uploadPercentage = computed<number>(() => {
    const total = this.uploadTotalCount();
    if (total === 0) return 0;
    return Math.min(100, Math.round((this.uploadCurrentIndex() / total) * 100));
  });

  readonly showAddPlateSubjectModal = signal<boolean>(false);
  readonly subjectName = signal<string>('');
  readonly subjectOwnerName = signal<string>('');
  readonly activePlateTab = signal<'individual' | 'masivo'>('individual');
  readonly selectedCsvFile = signal<File | null>(null);
  readonly parsedCsvRows = signal<{ plate: string; owner: string }[]>([]);
  readonly isDraggingOverCsv = signal<boolean>(false);

  // Señales para los modales independientes de edición
  readonly showEditFaceSubjectModal = signal<boolean>(false);
  readonly editFaceSubjectName = signal<string>('');
  readonly selectedEditFaceFile = signal<File | null>(null);
  readonly editFaceImagePreviewUrl = signal<string | null>(null);

  readonly showEditPlateSubjectModal = signal<boolean>(false);
  readonly editPlateSubjectPlate = signal<string>('');
  readonly editPlateSubjectName = signal<string>('');

  readonly isUpdatingSubject = signal<boolean>(false);
  readonly selectedSubjectDetailId = signal<string | null>(null);
  readonly selectedSubjectDetail = computed(() => {
    const id = this.selectedSubjectDetailId();
    if (!id) return null;
    return this.listDetails().find(d => d.detail_id === id) || null;
  });
  readonly drawerScrolledToBottom = signal<boolean>(false);
  readonly hoveredHit = signal<SubjectDetectionHit | null>(null);
  readonly selectedHit = signal<SubjectDetectionHit | null>(null);
  readonly activePreviewHit = computed<SubjectDetectionHit | null>(() => this.selectedHit() || this.hoveredHit());
  readonly fullscreenImgUrl = signal<string | null>(null);
  isSavingSubject = signal<boolean>(false);
  readonly isListsLoading = this.listService.isLoading;
  readonly lists = this.listService.lists;
  readonly listDetails = this.listService.listDetails;
  readonly similarityThreshold = this.listService.similarityThreshold;

  // Search & Filters
  readonly searchControl = new FormControl('');
  readonly searchQuery = signal<string>('');
  readonly showFilters = signal<boolean>(true);
  readonly activeDropdown = signal<string | null>(null);

  // Local draft filters state (matches metadatos temp/apply flow)
  readonly tempSimilarityThreshold = signal<number>(0.85);
  readonly tempAvistamientosFilter = signal<string[]>([]);

  // Applied filter state
  readonly appliedSimilarityThreshold = signal<number>(0.85);
  readonly appliedAvistamientosFilter = signal<string[]>([]);



  readonly subjectDetections = signal<Record<string, { count: number; hits: SubjectDetectionHit[]; loading: boolean; expanded: boolean }>>({});


  readonly filteredLists = computed(() => {
    return this.lists().filter(l => l.list_type === this.listType());
  });

  readonly activeList = computed(() => {
    const activeId = this.selectedListId();
    if (!activeId) return null;
    return this.filteredLists().find(l => l.list_id === activeId) || null;
  });

  readonly filteredListDetails = computed(() => {
    let details = this.listDetails();
    const search = this.searchQuery().trim().toLowerCase();
    const withDetections = this.appliedAvistamientosFilter();
    const detections = this.subjectDetections();

    if (search) {
      details = details.filter(d => {
        const name = d.nombre_asociado?.toLowerCase() || '';
        const plate = d.metadata?.text_placa?.toLowerCase() || '';
        return name.includes(search) || plate.includes(search);
      });
    }

    if (withDetections.length > 0 && withDetections.length < 2) {
      const mode = withDetections[0];
      details = details.filter(d => {
        const count = detections[d.detail_id]?.count || 0;
        return mode === 'with' ? count > 0 : count === 0;
      });
    }

    // Ordenamiento: 1.° Mayor a menor cantidad de avistamientos, 2.° Alfabético por nombre
    return [...details].sort((a, b) => {
      const countA = detections[a.detail_id]?.count || 0;
      const countB = detections[b.detail_id]?.count || 0;

      if (countB !== countA) {
        return countB - countA;
      }

      const nameA = (a.nombre_asociado || a.metadata?.text_placa || '').trim();
      const nameB = (b.nombre_asociado || b.metadata?.text_placa || '').trim();
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base', numeric: true });
    });
  });

  readonly availableAvistamientosOptions = computed<{ key: string; label: string }[]>(() => {
    const details = this.listDetails();
    if (!details || details.length === 0) return [];
    const detections = this.subjectDetections();
    const hasWith = details.some(d => (detections[d.detail_id]?.count || 0) > 0);
    const hasWithout = details.some(d => (detections[d.detail_id]?.count || 0) === 0);
    const opts: { key: string; label: string }[] = [];
    if (hasWith) opts.push({ key: 'with', label: 'Con Avistamientos' });
    if (hasWithout) opts.push({ key: 'without', label: 'Sin Avistamientos' });
    return opts;
  });

  @ViewChild('subjectsGridContainer', { static: false }) subjectsGridContainer?: ElementRef<HTMLDivElement>;

  private resizeSubject = new Subject<number>();
  private resizeSubscription?: Subscription;
  private resizeObserver?: ResizeObserver;

  /** Recalcula columnas cada vez que se redimensiona la ventana del navegador */
  @HostListener('window:resize')
  onWindowResize(): void {
    // Si el grid está en el DOM usamos su ancho real; si no, estimamos.
    if (this.subjectsGridContainer?.nativeElement) {
      this.resizeSubject.next(this.subjectsGridContainer.nativeElement.getBoundingClientRect().width);
    } else {
      this.resizeSubject.next(this.estimateContainerWidth());
    }
  }

  // ── Grid Responsive Columns & Pagination (Consciente de la Cuadrícula) ──────────────
  readonly columns = signal<number>(this.getInitialColumns());
  readonly limit = signal<number>(this.columns() * 10);
  readonly currentPage = signal<number>(1);

  readonly limitOptions = computed<number[]>(() => {
    const cols = this.columns();
    return [cols * 10, cols * 20, cols * 30];
  });

  private estimateContainerWidth(): number {
    if (typeof window === 'undefined') return 800;
    const sidebarWidth = this.sidebarService.isCollapsed() ? 78 : 260;
    const mainWidth = window.innerWidth - sidebarWidth - 48;
    return Math.max(300, Math.floor(mainWidth * 0.66));
  }

  private getInitialColumns(): number {
    const w = this.estimateContainerWidth();
    return Math.max(1, Math.floor((w + 24) / (215 + 24)));
  }

  private adjustColumnsAndLimit(containerWidth: number): void {
    if (containerWidth <= 0) return;
    const newCols = Math.max(1, Math.floor((containerWidth + 24) / (215 + 24)));
    const oldCols = this.columns();
    if (newCols !== oldCols) {
      const currentLimit = this.limit();
      let multiplier = Math.round(currentLimit / oldCols);
      if (multiplier !== 10 && multiplier !== 20 && multiplier !== 30) {
        multiplier = 10;
      }
      this.columns.set(newCols);
      this.limit.set(newCols * multiplier);
      this.currentPage.set(1);
    }
  }

  readonly paginatedListDetails = computed<ListDetail[]>(() => {
    const list = this.filteredListDetails();
    const start = (this.currentPage() - 1) * this.limit();
    const end = start + this.limit();
    return list.slice(start, end);
  });

  readonly totalRecords = computed<number>(() => this.filteredListDetails().length);

  readonly totalPages = computed<number>(() => {
    const total = this.totalRecords();
    const lim = this.limit();
    return total > 0 ? Math.ceil(total / lim) : 1;
  });

  readonly visiblePages = computed<number[]>(() => {
    const current = this.currentPage();
    const total = this.totalPages();
    const pagesToShow = 5;

    let start = Math.max(1, current - 2);
    let end = Math.min(total, current + 2);

    if (current <= 3) {
      end = Math.min(total, pagesToShow);
    }
    if (current >= total - 2) {
      start = Math.max(1, total - pagesToShow + 1);
    }

    const pageArr: number[] = [];
    for (let i = start; i <= end; i++) {
      if (i >= 1 && i <= total) {
        pageArr.push(i);
      }
    }
    return pageArr;
  });

  setPage(page: number): void {
    if (page >= 1 && page <= this.totalPages()) {
      this.currentPage.set(page);
    }
  }

  onLimitChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const newLimit = parseInt(select.value, 10);
    if (!isNaN(newLimit)) {
      this.limit.set(newLimit);
      this.currentPage.set(1);
    }
  }

  onLimitValueChange(val: any): void {
    const newLimit = parseInt(val, 10);
    if (!isNaN(newLimit)) {
      this.limit.set(newLimit);
      this.currentPage.set(1);
    }
  }

  readonly hasActiveFilters = computed(() => {
    const search = this.searchQuery().trim().length || 0;
    const withDetections = this.appliedAvistamientosFilter();
    const threshold = this.appliedSimilarityThreshold();
    return search > 0 || withDetections.length > 0 || threshold !== 0.85;
  });

  readonly hasPendingFilterChanges = computed(() => {
    const arraysEqual = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    return this.tempSimilarityThreshold() !== this.appliedSimilarityThreshold() ||
      !arraysEqual([...this.tempAvistamientosFilter()].sort(), [...this.appliedAvistamientosFilter()].sort());
  });

  constructor() {
    // Sincronizar parámetro de ruta
    this.route.paramMap.subscribe(params => {
      const type = params.get('listType') || 'rostros';
      this.listTypeParam.set(type);
      this.selectedListId.set(null);
      this.currentPage.set(1);
      this.listService.listDetails.set([]);
      this.subjectDetections.set({});
      this.showListModal.set(false);
      this.searchControl.setValue('', { emitEvent: false });
      this.searchQuery.set('');
      this.tempSimilarityThreshold.set(0.85);
      this.tempAvistamientosFilter.set([]);
      this.appliedSimilarityThreshold.set(0.85);
      this.appliedAvistamientosFilter.set([]);
      this.listService.similarityThreshold.set(0.85);
    });

    // Unified search debounce subscriber
    this.searchControl.valueChanges.pipe(
      debounceTime(300)
    ).subscribe(val => {
      this.searchQuery.set(val || '');
      this.currentPage.set(1);
    });
  }

  onImageError(event: Event): void {
    const target = event.target as HTMLElement;
    if (target) {
      target.style.display = 'none';
      const wrapper = target.parentElement;
      if (wrapper) {
        const placeholder = wrapper.querySelector('.subject-card-placeholder') as HTMLElement;
        if (placeholder) {
          placeholder.style.display = 'flex';
        }
      }
    }
  }

  ngOnInit(): void {
    this.listService.isViewActive.set(true);
    this.listService.loadLists().subscribe();
  }

  ngAfterViewInit(): void {
    this.resizeSubscription = this.resizeSubject.pipe(
      debounceTime(150)
    ).subscribe(width => this.adjustColumnsAndLimit(width));

    if (typeof ResizeObserver !== 'undefined' && this.subjectsGridContainer) {
      this.resizeObserver = new ResizeObserver(entries => {
        for (const e of entries) this.resizeSubject.next(e.contentRect.width);
      });
      this.resizeObserver.observe(this.subjectsGridContainer.nativeElement);
    }
  }

  ngOnDestroy(): void {
    this.listService.isViewActive.set(false);
    this.resizeObserver?.disconnect();
    this.resizeSubscription?.unsubscribe();
    if (this.copiedTimeout) {
      clearTimeout(this.copiedTimeout);
    }
  }

  copyRowContent(value: string, uniqueKey: string): void {
    if (!value) return;
    copyToClipboard(value).then(() => {
      this.copiedRowId.set(uniqueKey);
      if (this.copiedTimeout) clearTimeout(this.copiedTimeout);
      this.copiedTimeout = setTimeout(() => {
        this.copiedRowId.set(null);
      }, 2000);
    }).catch(err => {
      console.error('Error al copiar al portapapeles', err);
    });
  }

  onListSelected(listId: string): void {
    this.selectedListId.set(listId || null);
    this.selectedSubjectDetailId.set(null);
    this.selectedSubjectDetailIds.set(new Set());
    this.currentPage.set(1);
    this.searchControl.setValue('', { emitEvent: false });
    this.searchQuery.set('');
    this.tempSimilarityThreshold.set(0.85);
    this.tempAvistamientosFilter.set([]);
    this.appliedSimilarityThreshold.set(0.85);
    this.appliedAvistamientosFilter.set([]);
    this.listService.similarityThreshold.set(0.85);
    if (listId) {
      this.listService.loadListDetails(listId).subscribe(details => {
        const detectionsMap: Record<string, { count: number; hits: SubjectDetectionHit[]; loading: boolean; expanded: boolean }> = {};
        details.forEach(d => {
          detectionsMap[d.detail_id] = { count: 0, hits: [], loading: true, expanded: false };
        });
        this.subjectDetections.set(detectionsMap);

        // Carga agregada batch instantánea desde el índice eventos estrictamente por match_detail.detail_id
        this.listService.loadListEventSummaries(listId).subscribe({
          next: (summaries) => {
            this.subjectDetections.update(current => {
              const updated = { ...current };
              details.forEach(d => {
                const summary = summaries[d.detail_id];
                updated[d.detail_id] = {
                  count: summary?.count || 0,
                  hits: summary?.latestHit ? [summary.latestHit] : [],
                  loading: false,
                  expanded: false
                };
              });
              return updated;
            });
          },
          error: () => {
            this.subjectDetections.update(current => {
              const updated = { ...current };
              details.forEach(d => {
                if (updated[d.detail_id]) {
                  updated[d.detail_id] = { ...updated[d.detail_id], loading: false };
                }
              });
              return updated;
            });
          }
        });
      });
    } else {
      this.listService.listDetails.set([]);
      this.subjectDetections.set({});
    }
  }

  selectSubjectDetail(detailId: string | null): void {
    this.selectedSubjectDetailId.set(detailId);
    // Reset scroll hint and hit selections every time a detail is changed or closed
    this.drawerScrolledToBottom.set(false);
    this.hoveredHit.set(null);
    this.selectedHit.set(null);

    // Cargar historial de eventos completo para el timeline del drawer
    if (detailId) {
      const currentEntry = this.subjectDetections()[detailId];
      if (currentEntry && (currentEntry.count > 1 || currentEntry.hits.length <= 1)) {
        this.subjectDetections.update(curr => {
          const updated = { ...curr };
          if (updated[detailId]) {
            updated[detailId] = { ...updated[detailId], loading: true };
          }
          return updated;
        });

        this.listService.queryDetections(detailId).subscribe({
          next: (hits) => {
            this.subjectDetections.update(curr => {
              const updated = { ...curr };
              updated[detailId] = {
                count: hits.length || currentEntry.count,
                hits: hits,
                loading: false,
                expanded: false
              };
              return updated;
            });
          },
          error: () => {
            this.subjectDetections.update(curr => {
              const updated = { ...curr };
              if (updated[detailId]) {
                updated[detailId] = { ...updated[detailId], loading: false };
              }
              return updated;
            });
          }
        });
      }
    }
  }

  onDrawerScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    this.drawerScrolledToBottom.set(atBottom);
  }

  setHoveredHit(hit: SubjectDetectionHit | null): void {
    if (!this.selectedHit()) {
      this.hoveredHit.set(hit);
    }
  }

  toggleSelectHit(hit: SubjectDetectionHit, event?: Event): void {
    event?.stopPropagation();
    if (this.selectedHit()?.id === hit.id) {
      // Deselect: return to hover mode
      this.selectedHit.set(null);
      this.hoveredHit.set(hit);
    } else {
      // Select new hit: pin it fixed
      this.selectedHit.set(hit);
      this.hoveredHit.set(null);
    }
  }

  extractNameFromFilename(filename: string): string {
    const baseName = filename.substring(0, filename.lastIndexOf('.')) || filename;
    return baseName.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  }

  openAddSubjectModal(): void {
    if (this.listType() === 'face_recognition') {
      this.faceImportDrafts.set([]);
      this.showFloatingAddButton.set(false);
      this.showAddFaceSubjectModal.set(true);
    } else {
      this.subjectName.set('');
      this.subjectOwnerName.set('');
      this.activePlateTab.set('individual');
      this.selectedCsvFile.set(null);
      this.parsedCsvRows.set([]);
      this.isDraggingOverCsv.set(false);
      this.showAddPlateSubjectModal.set(true);
    }
  }

  closeAddFaceSubjectModal(): void {
    if (this.isUploadingFaceSubjects()) return;

    this.faceImportDrafts().forEach(d => {
      if (d.previewUrl && d.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(d.previewUrl);
      }
    });
    this.showAddFaceSubjectModal.set(false);
    this.faceImportDrafts.set([]);
    this.showFloatingAddButton.set(false);
    this.faceImportStep.set('prepare');
    this.successfulUploads.set([]);
    this.failedUploads.set([]);
    this.uploadCurrentIndex.set(0);
    this.uploadTotalCount.set(0);
  }

  closeAddPlateSubjectModal(): void {
    this.showAddPlateSubjectModal.set(false);
    this.subjectName.set('');
    this.subjectOwnerName.set('');
    this.activePlateTab.set('individual');
    this.selectedCsvFile.set(null);
    this.parsedCsvRows.set([]);
    this.isDraggingOverCsv.set(false);
  }

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.addFilesToDraft(input.files);
    }
  }

  private addFilesToDraft(fileList: FileList): void {
    const filesArray = Array.from(fileList);
    const currentDrafts = this.faceImportDrafts();
    const newDrafts: SubjectImportDraft[] = [];

    filesArray.forEach(file => {
      // Evitar duplicados por nombre de archivo y tamaño exacto
      const isDuplicate = currentDrafts.some(d => d.file.name === file.name && d.file.size === file.size) ||
        newDrafts.some(d => d.file.name === file.name && d.file.size === file.size);

      if (!isDuplicate) {
        newDrafts.push({
          file,
          name: this.extractNameFromFilename(file.name),
          previewUrl: URL.createObjectURL(file),
          isEditingName: false
        });
      }
    });

    if (newDrafts.length > 0) {
      this.faceImportDrafts.update(current => [...current, ...newDrafts]);
      this.scrollToBottom();
    }
  }

  scrollToBottom(): void {
    setTimeout(() => {
      const container = document.querySelector('.import-drafts-grid') as HTMLElement;
      if (container) {
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth'
        });
        // Recalcular inmediatamente el estado al disparar el auto-scroll
        const isScrollable = container.scrollHeight > container.clientHeight + 10;
        const isScrolledUp = container.scrollTop < container.scrollHeight - container.clientHeight - 40;
        this.showFloatingAddButton.set(isScrollable && isScrolledUp);
      }
    }, 100);
  }

  checkScrollState(): void {
    setTimeout(() => {
      const el = document.querySelector('.import-drafts-grid') as HTMLElement;
      if (el) {
        const isScrollable = el.scrollHeight > el.clientHeight + 10;
        const isScrolledUp = el.scrollTop < el.scrollHeight - el.clientHeight - 40;
        this.showFloatingAddButton.set(isScrollable && isScrolledUp);
      } else {
        this.showFloatingAddButton.set(false);
      }
    }, 100);
  }

  onDraftsScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const isScrollable = el.scrollHeight > el.clientHeight + 10;
    const isScrolledUp = el.scrollTop < el.scrollHeight - el.clientHeight - 40;
    this.showFloatingAddButton.set(isScrollable && isScrolledUp);
  }

  removeFile(index: number): void {
    this.faceImportDrafts.update(current => {
      const updated = [...current];
      if (updated[index]) {
        if (updated[index].previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(updated[index].previewUrl);
        }
        updated.splice(index, 1);
      }
      return updated;
    });
    this.checkScrollState();
  }

  toggleEditDraftName(index: number): void {
    this.faceImportDrafts.update(current => {
      const updated = [...current];
      if (updated[index]) {
        updated[index] = {
          ...updated[index],
          isEditingName: !updated[index].isEditingName
        };
      }
      return updated;
    });
  }

  cancelEditDraftName(index: number): void {
    this.faceImportDrafts.update(current => {
      const updated = [...current];
      if (updated[index]) {
        updated[index] = {
          ...updated[index],
          isEditingName: false
        };
      }
      return updated;
    });
  }

  updateDraftName(index: number, newName: string): void {
    this.faceImportDrafts.update(current => {
      const updated = [...current];
      if (updated[index]) {
        updated[index] = {
          ...updated[index],
          name: newName.trim(),
          isEditingName: false
        };
      }
      return updated;
    });
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  // Métodos de arrastrar y soltar (Drag and Drop)
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOver.set(false);

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      this.addFilesToDraft(event.dataTransfer.files);
    }
  }

  openEditSubjectModal(detail: ListDetail): void {
    if (this.listType() === 'face_recognition') {
      this.editFaceSubjectName.set(detail.nombre_asociado || '');
      this.selectedEditFaceFile.set(null);
      this.editFaceImagePreviewUrl.set(detail.metadata?.url_img || null);
      this.showEditFaceSubjectModal.set(true);
    } else {
      this.editPlateSubjectPlate.set(detail.metadata?.text_placa || '');
      this.editPlateSubjectName.set(detail.nombre_asociado || '');
      this.showEditPlateSubjectModal.set(true);
    }
  }

  closeEditFaceSubjectModal(): void {
    const preview = this.editFaceImagePreviewUrl();
    if (preview && preview.startsWith('blob:')) {
      URL.revokeObjectURL(preview);
    }
    this.showEditFaceSubjectModal.set(false);
    this.editFaceSubjectName.set('');
    this.selectedEditFaceFile.set(null);
    this.editFaceImagePreviewUrl.set(null);
  }

  closeEditPlateSubjectModal(): void {
    this.showEditPlateSubjectModal.set(false);
    this.editPlateSubjectPlate.set('');
    this.editPlateSubjectName.set('');
  }

  onEditFaceFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.selectedEditFaceFile.set(file);

      const preview = this.editFaceImagePreviewUrl();
      if (preview && preview.startsWith('blob:')) {
        URL.revokeObjectURL(preview);
      }
      this.editFaceImagePreviewUrl.set(URL.createObjectURL(file));
    }
  }

  saveEditFaceSubject(): void {
    const detail = this.selectedSubjectDetail();
    if (!detail) return;

    this.isUpdatingSubject.set(true);
    const listId = this.selectedListId()!;

    const nameChanged = this.editFaceSubjectName().trim() !== (detail.nombre_asociado || '');
    const file = this.selectedEditFaceFile();

    const obs$: import('rxjs').Observable<any>[] = [];
    if (nameChanged) {
      obs$.push(this.listService.updateFaceDetail(detail.detail_id, listId, this.editFaceSubjectName().trim()));
    }
    if (file) {
      obs$.push(this.listService.updateFaceImg(detail.detail_id, file));
    }

    if (obs$.length === 0) {
      this.isUpdatingSubject.set(false);
      this.closeEditFaceSubjectModal();
      return;
    }

    import('rxjs').then(({ forkJoin }) => {
      forkJoin(obs$).subscribe({
        next: () => {
          this.isUpdatingSubject.set(false);
          this.closeEditFaceSubjectModal();
        },
        error: (err) => {
          console.error('Error updating face subject:', err);
          this.isUpdatingSubject.set(false);
          alert('Error al actualizar los datos del sujeto.');
        }
      });
    });
  }

  saveEditPlateSubject(): void {
    const detail = this.selectedSubjectDetail();
    if (!detail) return;

    this.isUpdatingSubject.set(true);
    const listId = this.selectedListId()!;
    const name = this.editPlateSubjectName().trim();
    const plate = this.editPlateSubjectPlate().trim();

    this.listService.updatePlateDetail(detail.detail_id, listId, plate, name).subscribe({
      next: () => {
        this.isUpdatingSubject.set(false);
        this.closeEditPlateSubjectModal();
      },
      error: (err) => {
        console.error('Error updating plate subject:', err);
        this.isUpdatingSubject.set(false);
        alert('Error al actualizar la placa.');
      }
    });
  }

  private formatFaceUploadErrorMessage(err: any): string {
    const rawMsg = (
      typeof err === 'string' ? err :
      (err?.error?.detail || err?.error?.message || err?.message || '')
    ).toString().toLowerCase();

    if (rawMsg.includes('no face detected') || rawMsg.includes('no face') || rawMsg.includes('sin rostro')) {
      return 'No se detectó un rostro válido en la fotografía.';
    }
    if (rawMsg.includes('embedding generation issue') || rawMsg.includes('embedding')) {
      return 'No se pudo generar la huella facial de la fotografía.';
    }
    if (rawMsg.includes('format') || rawMsg.includes('extension') || rawMsg.includes('invalid image')) {
      return 'El formato o la resolución de la imagen no es compatible.';
    }
    if (rawMsg.includes('multiple faces') || rawMsg.includes('more than one face')) {
      return 'Se detectó más de un rostro. Utilice una foto con un único rostro.';
    }
    if (rawMsg.includes('422') || rawMsg.includes('unprocessable')) {
      return 'La imagen no cumple con los requisitos del registro facial.';
    }
    if (rawMsg.includes('500') || rawMsg.includes('server error')) {
      return 'Ocurrió un error en el servidor al analizar el rostro.';
    }

    return 'No se pudo validar el rostro en la fotografía.';
  }

  async saveFaceSubjects(): Promise<void> {
    const listId = this.selectedListId();
    const drafts = this.faceImportDrafts();
    if (!listId || drafts.length === 0) return;

    this.faceImportStep.set('uploading');
    this.isUploadingFaceSubjects.set(true);
    this.isSavingSubject.set(true);
    this.uploadTotalCount.set(drafts.length);
    this.uploadCurrentIndex.set(0);
    this.successfulUploads.set([]);
    this.failedUploads.set([]);

    const successes: FaceUploadResult[] = [];
    const failures: FaceUploadResult[] = [];

    const { firstValueFrom } = await import('rxjs');

    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i];
      this.uploadCurrentIndex.set(i + 1);
      this.uploadCurrentFileName.set(draft.name);

      try {
        const result = await firstValueFrom(
          this.listService.uploadAndAddSubject(listId, '', draft.name, draft.file)
        );
        successes.push({
          file: draft.file,
          name: draft.name,
          previewUrl: draft.previewUrl,
          detailId: result.detail_id
        });
        this.successfulUploads.set([...successes]);
        if (result.detail_id) {
          this.listService.markAsNew(result.detail_id);
        }
      } catch (err: any) {
        console.error(`Error uploading face subject ${draft.name}:`, err);
        failures.push({
          file: draft.file,
          name: draft.name,
          previewUrl: draft.previewUrl,
          errorMessage: this.formatFaceUploadErrorMessage(err)
        });
        this.failedUploads.set([...failures]);
      }
    }

    this.isUploadingFaceSubjects.set(false);
    this.isSavingSubject.set(false);
    this.faceImportStep.set('summary');
  }

  async retryFailedFaceUploads(): Promise<void> {
    const listId = this.selectedListId();
    const toRetry = [...this.failedUploads()];
    if (!listId || toRetry.length === 0) return;

    this.faceImportStep.set('uploading');
    this.isUploadingFaceSubjects.set(true);
    this.isSavingSubject.set(true);
    this.uploadTotalCount.set(toRetry.length);
    this.uploadCurrentIndex.set(0);

    const newFailures: FaceUploadResult[] = [];
    const successes = [...this.successfulUploads()];
    this.failedUploads.set([]);

    const { firstValueFrom } = await import('rxjs');

    for (let i = 0; i < toRetry.length; i++) {
      const draft = toRetry[i];
      this.uploadCurrentIndex.set(i + 1);
      this.uploadCurrentFileName.set(draft.name);

      try {
        const result = await firstValueFrom(
          this.listService.uploadAndAddSubject(listId, '', draft.name, draft.file)
        );
        successes.push({
          file: draft.file,
          name: draft.name,
          previewUrl: draft.previewUrl,
          detailId: result.detail_id
        });
        this.successfulUploads.set([...successes]);
        if (result.detail_id) {
          this.listService.markAsNew(result.detail_id);
        }
      } catch (err: any) {
        console.error(`Retry error uploading face subject ${draft.name}:`, err);
        newFailures.push({
          file: draft.file,
          name: draft.name,
          previewUrl: draft.previewUrl,
          errorMessage: this.formatFaceUploadErrorMessage(err)
        });
        this.failedUploads.set([...newFailures]);
      }
    }

    this.isUploadingFaceSubjects.set(false);
    this.isSavingSubject.set(false);
    this.faceImportStep.set('summary');
  }

  savePlateSubject(): void {
    const listId = this.selectedListId();
    if (!listId || !this.subjectName().trim()) return;

    this.isSavingSubject.set(true);

    this.listService.addPlateSubject(listId, this.subjectName().trim(), this.subjectOwnerName().trim()).subscribe({
      next: () => {
        this.isSavingSubject.set(false);
        this.closeAddPlateSubjectModal();
      },
      error: (err) => {
        console.error('Error adding plate subject to watchlist:', err);
        this.isSavingSubject.set(false);
        alert('Error al agregar la placa a la lista de control.');
      }
    });
  }

  onCsvFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      if (file.name.toLowerCase().endsWith('.csv')) {
        this.selectedCsvFile.set(file);
        this.parseCsv(file);
      } else {
        alert('Por favor selecciona un archivo en formato CSV.');
      }
    }
  }

  onCsvDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOverCsv.set(true);
  }

  onCsvDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOverCsv.set(false);
  }

  onCsvDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDraggingOverCsv.set(false);

    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      const file = event.dataTransfer.files[0];
      if (file.name.toLowerCase().endsWith('.csv')) {
        this.selectedCsvFile.set(file);
        this.parseCsv(file);
      } else {
        alert('Por favor selecciona un archivo en formato CSV.');
      }
    }
  }

  parseCsv(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      if (!text) return;

      const lines = text.split(/\r?\n/);
      const rows: { plate: string; owner: string }[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Soporta comas o punto y coma
        const columns = line.split(/[,;]/);
        if (columns.length > 0) {
          const plate = columns[0].trim().toUpperCase();
          const owner = columns[1] ? columns[1].trim() : '';

          // Saltar la fila de cabecera si existe (ej: "placa", "propietario")
          if (i === 0 && (plate.toLowerCase() === 'placa' || plate.toLowerCase() === 'plate')) {
            continue;
          }

          if (plate) {
            rows.push({ plate, owner });
          }
        }
      }

      this.parsedCsvRows.set(rows);
    };
    reader.readAsText(file);
  }

  removeCsvFile(): void {
    this.selectedCsvFile.set(null);
    this.parsedCsvRows.set([]);
  }

  savePlateSubjectsBulk(): void {
    const listId = this.selectedListId();
    if (!listId || this.parsedCsvRows().length === 0) return;

    this.isSavingSubject.set(true);

    const observables = this.parsedCsvRows().map(row => {
      return this.listService.addPlateSubject(listId, row.plate, row.owner);
    });

    import('rxjs').then(({ forkJoin }) => {
      forkJoin(observables).subscribe({
        next: () => {
          this.isSavingSubject.set(false);
          this.closeAddPlateSubjectModal();
        },
        error: (err) => {
          console.error('Error importing plate subjects from CSV:', err);
          this.isSavingSubject.set(false);
          alert('Error al importar algunos de los registros. Por favor intente de nuevo.');
        }
      });
    });
  }

  openListModal(mode: 'create' | 'edit', list?: List, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.listModalMode.set(mode);
    this.listModalError.set('');
    this.isSavingList.set(false);
    if (mode === 'edit' && list) {
      this.listModalId.set(list.list_id);
      this.listModalName.set(list.name);
      this.listModalDesc.set(list.description || '');
    } else {
      this.listModalId.set('');
      this.listModalName.set('');
      this.listModalDesc.set('');
    }
    this.showListModal.set(true);
  }

  closeListModal(): void {
    this.showListModal.set(false);
    this.listModalId.set('');
    this.listModalName.set('');
    this.listModalDesc.set('');
    this.listModalError.set('');
    this.isSavingList.set(false);
  }

  saveWatchlist(): void {
    const name = this.listModalName().trim();
    const desc = this.listModalDesc().trim();
    if (!name) {
      this.listModalError.set('El nombre de la lista es obligatorio.');
      return;
    }

    // Validación preventiva en frontend de nombres duplicados
    const isDuplicate = this.lists().some(l =>
      l.name.trim().toLowerCase() === name.toLowerCase() &&
      (this.listModalMode() === 'create' || l.list_id !== this.listModalId())
    );
    if (isDuplicate) {
      this.listModalError.set('Ya existe una lista de control con este nombre.');
      return;
    }

    this.listModalError.set('');
    this.isSavingList.set(true);

    if (this.listModalMode() === 'create') {
      const type = this.listType();
      this.listService.createList(name, desc, type).subscribe({
        next: (newList) => {
          this.isSavingList.set(false);
          this.closeListModal();
        },
        error: (err) => {
          this.isSavingList.set(false);
          console.error('Error creating watchlist:', err);
          let errorMsg = 'Error al crear la lista de control.';
          if (err?.error?.detail) {
            errorMsg = typeof err.error.detail === 'string' ? err.error.detail : JSON.stringify(err.error.detail);
          } else if (err?.error?.message) {
            errorMsg = err.error.message;
          } else if (err?.message) {
            errorMsg = err.message;
          }
          this.listModalError.set(errorMsg);
        }
      });
    } else {
      const listId = this.listModalId();
      if (!listId) {
        this.isSavingList.set(false);
        return;
      }
      this.listService.updateList(listId, name, desc, this.listType()).subscribe({
        next: () => {
          this.isSavingList.set(false);
          this.closeListModal();
        },
        error: (err) => {
          this.isSavingList.set(false);
          console.error('Error updating watchlist:', err);
          let errorMsg = 'Error al guardar los cambios de la lista de control.';
          if (err?.error?.detail) {
            errorMsg = typeof err.error.detail === 'string' ? err.error.detail : JSON.stringify(err.error.detail);
          } else if (err?.error?.message) {
            errorMsg = err.error.message;
          } else if (err?.message) {
            errorMsg = err.message;
          }
          this.listModalError.set(errorMsg);
        }
      });
    }
  }

  onDeleteWatchlist(listId: string, event: Event): void {
    event.stopPropagation();
    const list = this.lists().find(l => l.list_id === listId);
    if (list) {
      this.listToDelete.set(list);
      this.showDeleteListModal.set(true);
    }
  }

  closeDeleteListModal(): void {
    this.showDeleteListModal.set(false);
    this.listToDelete.set(null);
  }

  confirmDeleteWatchlist(): void {
    const list = this.listToDelete();
    if (!list) return;

    this.isDeletingList.set(true);
    this.listService.deleteList(list.list_id).subscribe({
      next: () => {
        this.selectedListId.set(null);
        this.subjectDetections.set({});
        this.isDeletingList.set(false);
        this.closeDeleteListModal();
      },
      error: (err) => {
        console.error('Error deleting watchlist:', err);
        this.isDeletingList.set(false);
        this.closeDeleteListModal();
        alert('Error al eliminar la lista de control.');
      }
    });
  }

  toggleSelectSubjectDetail(detailId: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.selectedSubjectDetailIds.update(set => {
      const next = new Set(set);
      if (next.has(detailId)) {
        next.delete(detailId);
      } else {
        next.add(detailId);
      }
      return next;
    });
  }

  isSubjectSelected(detailId: string): boolean {
    return this.selectedSubjectDetailIds().has(detailId);
  }

  selectAllSubjects(): void {
    const allIds = this.filteredListDetails().map(d => d.detail_id);
    this.selectedSubjectDetailIds.set(new Set(allIds));
  }

  clearSubjectSelection(): void {
    this.selectedSubjectDetailIds.set(new Set());
  }

  openDeleteSelectedSubjectsModal(): void {
    if (this.selectedSubjectDetailIds().size > 0) {
      this.showDeleteSubjectModal.set(true);
    }
  }

  closeDeleteSubjectModal(): void {
    this.showDeleteSubjectModal.set(false);
  }

  confirmDeleteSelectedSubjects(): void {
    const idsToDelete = Array.from(this.selectedSubjectDetailIds());
    if (idsToDelete.length === 0) return;

    this.isDeletingSubject.set(true);

    const deleteRequests$ = idsToDelete.map(id => this.listService.deleteSubject(id));

    forkJoin(deleteRequests$).subscribe({
      next: () => {
        this.subjectDetections.update(current => {
          const updated = { ...current };
          idsToDelete.forEach(id => delete updated[id]);
          return updated;
        });
        this.isDeletingSubject.set(false);
        this.selectedSubjectDetailIds.set(new Set());
        this.closeDeleteSubjectModal();
        if (this.selectedSubjectDetailId() && idsToDelete.includes(this.selectedSubjectDetailId()!)) {
          this.selectSubjectDetail(null);
        }
      },
      error: (err) => {
        console.error('Error deleting selected subjects:', err);
        this.isDeletingSubject.set(false);
        this.selectedSubjectDetailIds.set(new Set());
        this.closeDeleteSubjectModal();
      }
    });
  }

  deleteSubject(detailId: string): void {
    const detail = this.listDetails().find(d => d.detail_id === detailId);
    if (detail) {
      this.subjectToDeleteId.set(detailId);
      this.subjectToDeleteName.set(detail.nombre_asociado || detail.metadata?.text_placa || 'Sujeto sin nombre');
      this.showDeleteSubjectModal.set(true);
    }
  }

  confirmDeleteSubject(): void {
    const detailId = this.subjectToDeleteId();
    if (!detailId) return;

    this.isDeletingSubject.set(true);
    this.listService.deleteSubject(detailId).subscribe({
      next: () => {
        this.subjectDetections.update(current => {
          const updated = { ...current };
          delete updated[detailId];
          return updated;
        });
        this.isDeletingSubject.set(false);
        this.closeDeleteSubjectModal();
      },
      error: (err) => {
        console.error('Error deleting subject:', err);
        this.isDeletingSubject.set(false);
        this.closeDeleteSubjectModal();
        alert('Error al eliminar el sujeto de la lista.');
      }
    });
  }

  toggleSubjectDetectionsExpanded(detailId: string): void {
    this.subjectDetections.update(current => {
      const updated = { ...current };
      if (updated[detailId]) {
        updated[detailId] = {
          ...updated[detailId],
          expanded: !updated[detailId].expanded
        };
      }
      return updated;
    });
  }

  onSimilarityThresholdChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = parseFloat(input.value);
    if (!isNaN(val)) {
      this.tempSimilarityThreshold.set(val);
    }
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  toggleFiltersVisibility(): void {
    this.showFilters.update(v => !v);
  }

  toggleDropdown(dropdownName: string, event: Event): void {
    event.stopPropagation();
    if (this.activeDropdown() === dropdownName) {
      this.activeDropdown.set(null);
    } else {
      this.activeDropdown.set(dropdownName);
    }
  }

  @HostListener('document:click')
  closeDropdowns(): void {
    this.activeDropdown.set(null);
  }

  setThresholdPreset(type: 'all' | 'high' | 'veryHigh'): void {
    if (type === 'all') {
      this.tempSimilarityThreshold.set(0.5);
    } else if (type === 'high') {
      this.tempSimilarityThreshold.set(0.7);
    } else if (type === 'veryHigh') {
      this.tempSimilarityThreshold.set(0.9);
    }
  }

  toggleAvistamientosFilter(value: string, event?: Event): void {
    if (event) event.stopPropagation();
    const current = this.tempAvistamientosFilter();
    if (current.includes(value)) {
      this.tempAvistamientosFilter.set(current.filter(v => v !== value));
    } else {
      this.tempAvistamientosFilter.set([...current, value]);
    }
  }

  onResetFilters(): void {
    this.searchControl.setValue('', { emitEvent: true });
    this.tempSimilarityThreshold.set(0.85);
    this.tempAvistamientosFilter.set([]);
    this.appliedSimilarityThreshold.set(0.85);
    this.appliedAvistamientosFilter.set([]);
    this.listService.similarityThreshold.set(0.85);
    this.currentPage.set(1);
  }

  onApplyFilters(): void {
    this.appliedSimilarityThreshold.set(this.tempSimilarityThreshold());
    this.appliedAvistamientosFilter.set([...this.tempAvistamientosFilter()]);
    this.listService.similarityThreshold.set(this.tempSimilarityThreshold());
    this.currentPage.set(1);
  }

  getTipoObjeto(record: SubjectDetectionHit): string {
    return record.tipoObjeto || '';
  }

  getEdad(record: SubjectDetectionHit): string {
    return record.edad || '';
  }

  getGenero(record: SubjectDetectionHit): string {
    return record.genero || '';
  }

  getReconocimiento(record: SubjectDetectionHit): string {
    return record.reconocimiento || '';
  }

  getPosturas(record: SubjectDetectionHit): SubjectDetectionPostura[] {
    return record.posturas || [];
  }

  getColorStyle(color: SubjectDetectionColor): string {
    return `rgb(${color.r}, ${color.g}, ${color.b})`;
  }

  getColorLuminance(r: number, g: number, b: number): number {
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  openFullscreenImage(url: string, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.fullscreenImgUrl.set(url);
  }

  closeFullscreenImage(): void {
    this.fullscreenImgUrl.set(null);
  }

}
