import { Component, OnInit, OnDestroy, inject, signal, computed, HostListener } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule, FormControl, ReactiveFormsModule } from '@angular/forms';
import { debounceTime } from 'rxjs/operators';
import { ListService } from '../../../core/services/list.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { List, ListDetail } from '../../../core/domain/entities/list.models';

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
  camara: string;
  timestamp: Date;
  confiabilidad: number;
  imagen: string;
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
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  templateUrl: './listas.html',
  styleUrl: './listas.css'
})
export class Listas implements OnInit, OnDestroy {
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

  readonly showDeleteListModal = signal<boolean>(false);
  readonly listToDelete = signal<List | null>(null);
  readonly isDeletingList = signal<boolean>(false);

  readonly showDeleteSubjectModal = signal<boolean>(false);
  readonly subjectToDeleteId = signal<string | null>(null);
  readonly subjectToDeleteName = signal<string | null>(null);
  readonly isDeletingSubject = signal<boolean>(false);

  // Señales para los modales independientes de creación
  readonly showAddFaceSubjectModal = signal<boolean>(false);
  readonly faceImportDrafts = signal<SubjectImportDraft[]>([]);
  readonly isDraggingOver = signal<boolean>(false);
  readonly showFloatingAddButton = signal<boolean>(false);

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
  readonly fullscreenImgUrl = signal<string | null>(null);
  isSavingSubject = signal<boolean>(false);
  readonly isListsLoading = this.listService.isLoading;
  readonly lists = this.listService.lists;
  readonly listDetails = this.listService.listDetails;
  readonly similarityThreshold = this.listService.similarityThreshold;

  // Search & Filters
  readonly searchControl = new FormControl('');
  readonly searchQuery = signal<string>('');
  readonly showFilters = signal<boolean>(false);
  readonly activeDropdown = signal<string | null>(null);

  // Local draft filters state (matches metadatos temp/apply flow)
  readonly tempSimilarityThreshold = signal<number>(0.85);
  readonly tempAvistamientosFilter = signal<'all' | 'with' | 'without'>('all');

  // Applied filter state
  readonly appliedSimilarityThreshold = signal<number>(0.85);
  readonly appliedAvistamientosFilter = signal<'all' | 'with' | 'without'>('all');



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

    if (search) {
      details = details.filter(d => {
        const name = d.nombre_asociado?.toLowerCase() || '';
        const plate = d.metadata?.text_placa?.toLowerCase() || '';
        return name.includes(search) || plate.includes(search);
      });
    }

    if (withDetections !== 'all') {
      details = details.filter(d => {
        const count = this.subjectDetections()[d.detail_id]?.count || 0;
        return withDetections === 'with' ? count > 0 : count === 0;
      });
    }

    return details;
  });

  readonly hasActiveFilters = computed(() => {
    const search = this.searchQuery().trim().length || 0;
    const withDetections = this.appliedAvistamientosFilter();
    const threshold = this.appliedSimilarityThreshold();
    return search > 0 || withDetections !== 'all' || threshold !== 0.85;
  });

  readonly hasPendingFilterChanges = computed(() => {
    return this.tempSimilarityThreshold() !== this.appliedSimilarityThreshold() ||
           this.tempAvistamientosFilter() !== this.appliedAvistamientosFilter();
  });

  constructor() {
    // Sincronizar parámetro de ruta
    this.route.paramMap.subscribe(params => {
      const type = params.get('listType') || 'rostros';
      this.listTypeParam.set(type);
      this.selectedListId.set(null);
      this.listService.listDetails.set([]);
      this.subjectDetections.set({});
      this.showListModal.set(false);
      this.searchControl.setValue('', { emitEvent: false });
      this.searchQuery.set('');
      this.tempSimilarityThreshold.set(0.85);
      this.tempAvistamientosFilter.set('all');
      this.appliedSimilarityThreshold.set(0.85);
      this.appliedAvistamientosFilter.set('all');
      this.listService.similarityThreshold.set(0.85);
    });

    // Unified search debounce subscriber
    this.searchControl.valueChanges.pipe(
      debounceTime(300)
    ).subscribe(val => {
      this.searchQuery.set(val || '');
    });
  }

  ngOnInit(): void {
    this.listService.isViewActive.set(true);
    this.listService.loadLists().subscribe();
  }

  ngOnDestroy(): void {
    this.listService.isViewActive.set(false);
  }

  onListSelected(listId: string): void {
    this.selectedListId.set(listId || null);
    this.selectedSubjectDetailId.set(null);
    this.searchControl.setValue('', { emitEvent: false });
    this.searchQuery.set('');
    this.tempSimilarityThreshold.set(0.85);
    this.tempAvistamientosFilter.set('all');
    this.appliedSimilarityThreshold.set(0.85);
    this.appliedAvistamientosFilter.set('all');
    this.listService.similarityThreshold.set(0.85);
    if (listId) {
      this.listService.loadListDetails(listId).subscribe(details => {
        const detectionsMap: Record<string, { count: number; hits: SubjectDetectionHit[]; loading: boolean; expanded: boolean }> = {};
        details.forEach(d => {
          detectionsMap[d.detail_id] = { count: 0, hits: [], loading: true, expanded: false };
          
          if (this.listType() === 'face_recognition') {
            this.listService.queryDetections(d.nombre_asociado, d.metadata?.['document_id']).subscribe({
              next: (hits) => {
                this.subjectDetections.update(current => {
                  const updated = { ...current };
                  updated[d.detail_id] = {
                    count: hits.length,
                    hits: hits,
                    loading: false,
                    expanded: false
                  };
                  return updated;
                });
              },
              error: () => {
                this.subjectDetections.update(current => {
                  const updated = { ...current };
                  updated[d.detail_id] = {
                    count: 0,
                    hits: [],
                    loading: false,
                    expanded: false
                  };
                  return updated;
                });
              }
            });
          } else {
            const queryPlaca = d.metadata?.text_placa || d.nombre_asociado;
            this.listService.queryPlateDetections(queryPlaca, d.metadata?.['document_id']).subscribe({
              next: (hits) => {
                this.subjectDetections.update(current => {
                  const updated = { ...current };
                  updated[d.detail_id] = {
                    count: hits.length,
                    hits: hits,
                    loading: false,
                    expanded: false
                  };
                  return updated;
                });
              },
              error: () => {
                this.subjectDetections.update(current => {
                  const updated = { ...current };
                  updated[d.detail_id] = {
                    count: 0,
                    hits: [],
                    loading: false,
                    expanded: false
                  };
                  return updated;
                });
              }
            });
          }
        });
        this.subjectDetections.set(detectionsMap);
      });
    } else {
      this.listService.listDetails.set([]);
      this.subjectDetections.set({});
    }
  }

  selectSubjectDetail(detailId: string | null): void {
    this.selectedSubjectDetailId.set(detailId);
    // Reset scroll hint every time a new detail is opened
    this.drawerScrolledToBottom.set(false);
  }

  onDrawerScroll(event: Event): void {
    const el = event.target as HTMLElement;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
    this.drawerScrolledToBottom.set(atBottom);
  }

  setHoveredHit(hit: SubjectDetectionHit | null): void {
    this.hoveredHit.set(hit);
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
    this.faceImportDrafts().forEach(d => {
      if (d.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(d.previewUrl);
      }
    });
    this.showAddFaceSubjectModal.set(false);
    this.faceImportDrafts.set([]);
    this.showFloatingAddButton.set(false);
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

  saveFaceSubjects(): void {
    const listId = this.selectedListId();
    if (!listId || this.faceImportDrafts().length === 0) return;

    this.isSavingSubject.set(true);

    const observables = this.faceImportDrafts().map(draft => {
      return this.listService.uploadAndAddSubject(listId, '', draft.name, draft.file);
    });

    import('rxjs').then(({ forkJoin }) => {
      forkJoin(observables).subscribe({
        next: () => {
          this.isSavingSubject.set(false);
          this.closeAddFaceSubjectModal();
        },
        error: (err) => {
          console.error('Error importing face subjects:', err);
          this.isSavingSubject.set(false);
          alert('Error al importar algunos de los sujetos. Por favor intente de nuevo.');
        }
      });
    });
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
  }

  saveWatchlist(): void {
    const name = this.listModalName().trim();
    const desc = this.listModalDesc().trim();
    if (!name) return;

    if (this.listModalMode() === 'create') {
      const type = this.listType();
      this.listService.createList(name, desc, type).subscribe({
        next: (newList) => {
          this.closeListModal();
        },
        error: (err) => {
          console.error('Error creating watchlist:', err);
          alert('Error al crear la lista de control.');
        }
      });
    } else {
      const listId = this.listModalId();
      if (!listId) return;
      this.listService.updateList(listId, name, desc, this.listType()).subscribe({
        next: () => {
          this.closeListModal();
        },
        error: (err) => {
          console.error('Error updating watchlist:', err);
          alert('Error al guardar los cambios de la lista de control.');
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

  deleteSubject(detailId: string): void {
    const detail = this.listDetails().find(d => d.detail_id === detailId);
    if (detail) {
      this.subjectToDeleteId.set(detailId);
      this.subjectToDeleteName.set(detail.nombre_asociado || detail.metadata?.text_placa || 'Sujeto sin nombre');
      this.showDeleteSubjectModal.set(true);
    }
  }

  closeDeleteSubjectModal(): void {
    this.showDeleteSubjectModal.set(false);
    this.subjectToDeleteId.set(null);
    this.subjectToDeleteName.set(null);
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

  selectAvistamientosFilter(value: 'all' | 'with' | 'without'): void {
    this.tempAvistamientosFilter.set(value);
    this.activeDropdown.set(null);
  }

  onResetFilters(): void {
    this.searchControl.setValue('', { emitEvent: true });
    this.tempSimilarityThreshold.set(0.85);
    this.tempAvistamientosFilter.set('all');
    this.appliedSimilarityThreshold.set(0.85);
    this.appliedAvistamientosFilter.set('all');
    this.listService.similarityThreshold.set(0.85);
  }

  onApplyFilters(): void {
    this.appliedSimilarityThreshold.set(this.tempSimilarityThreshold());
    this.appliedAvistamientosFilter.set(this.tempAvistamientosFilter());
    this.listService.similarityThreshold.set(this.tempSimilarityThreshold());
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
