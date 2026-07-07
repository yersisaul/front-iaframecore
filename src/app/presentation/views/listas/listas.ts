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

  readonly showEditSubjectModal = signal<boolean>(false);
  readonly isUpdatingSubject = signal<boolean>(false);
  readonly editSubjectName = signal<string>('');
  readonly editSubjectPlate = signal<string>('');
  readonly selectedEditFile = signal<File | null>(null);
  readonly editImagePreviewUrl = signal<string | null>(null);

  readonly selectedSubjectDetailId = signal<string | null>(null);
  readonly selectedSubjectDetail = computed(() => {
    const id = this.selectedSubjectDetailId();
    if (!id) return null;
    return this.listDetails().find(d => d.detail_id === id) || null;
  });
  readonly showAddSubjectModal = signal<boolean>(false);
  readonly drawerScrolledToBottom = signal<boolean>(false);
  readonly hoveredHit = signal<SubjectDetectionHit | null>(null);
  readonly subjectName = signal<string>('');
  readonly subjectOwnerName = signal<string>('');
  readonly selectedFile = signal<File | null>(null);
  readonly imagePreviewUrl = signal<string | null>(null);
  isSavingSubject = signal<boolean>(false);
  readonly isListsLoading = this.listService.isLoading;
  readonly lists = this.listService.lists;
  readonly listDetails = this.listService.listDetails;
  readonly similarityThreshold = this.listService.similarityThreshold;
  readonly isSaveDisabled = computed(() => {
    if (this.isSavingSubject()) return true;
    if (!this.subjectName().trim()) return true;
    if (this.listType() === 'face_recognition' && !this.selectedFile()) return true;
    return false;
  });

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

  openAddSubjectModal(): void {
    this.subjectName.set('');
    this.subjectOwnerName.set('');
    this.selectedFile.set(null);
    this.imagePreviewUrl.set(null);
    this.showAddSubjectModal.set(true);
  }

  closeAddSubjectModal(): void {
    const preview = this.imagePreviewUrl();
    if (preview && preview.startsWith('blob:')) {
      URL.revokeObjectURL(preview);
    }
    this.showAddSubjectModal.set(false);
    this.subjectName.set('');
    this.subjectOwnerName.set('');
    this.selectedFile.set(null);
    this.imagePreviewUrl.set(null);
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.selectedFile.set(file);

      const preview = this.imagePreviewUrl();
      if (preview && preview.startsWith('blob:')) {
        URL.revokeObjectURL(preview);
      }
      this.imagePreviewUrl.set(URL.createObjectURL(file));
    }
  }

  openEditSubjectModal(detail: ListDetail): void {
    this.editSubjectName.set(detail.nombre_asociado || '');
    this.editSubjectPlate.set(detail.metadata?.text_placa || '');
    this.selectedEditFile.set(null);
    this.editImagePreviewUrl.set(detail.metadata?.url_img || null);
    this.showEditSubjectModal.set(true);
  }

  closeEditSubjectModal(): void {
    const preview = this.editImagePreviewUrl();
    if (preview && preview.startsWith('blob:')) {
      URL.revokeObjectURL(preview);
    }
    this.showEditSubjectModal.set(false);
    this.editSubjectName.set('');
    this.editSubjectPlate.set('');
    this.selectedEditFile.set(null);
    this.editImagePreviewUrl.set(null);
  }

  onEditFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];
      this.selectedEditFile.set(file);

      const preview = this.editImagePreviewUrl();
      if (preview && preview.startsWith('blob:')) {
        URL.revokeObjectURL(preview);
      }
      this.editImagePreviewUrl.set(URL.createObjectURL(file));
    }
  }

  saveEditSubject(): void {
    const detail = this.selectedSubjectDetail();
    if (!detail) return;

    this.isUpdatingSubject.set(true);
    const listId = this.selectedListId()!;

    if (this.listType() === 'face_recognition') {
      const nameChanged = this.editSubjectName().trim() !== (detail.nombre_asociado || '');
      const file = this.selectedEditFile();

      const obs$: import('rxjs').Observable<any>[] = [];
      if (nameChanged) {
        obs$.push(this.listService.updateFaceDetail(detail.detail_id, this.editSubjectName().trim()));
      }
      if (file) {
        obs$.push(this.listService.updateFaceImg(detail.detail_id, file));
      }

      if (obs$.length === 0) {
        this.isUpdatingSubject.set(false);
        this.closeEditSubjectModal();
        return;
      }

      import('rxjs').then(({ forkJoin }) => {
        forkJoin(obs$).subscribe({
          next: () => {
            this.isUpdatingSubject.set(false);
            this.closeEditSubjectModal();
            this.onListSelected(listId);
          },
          error: (err) => {
            console.error('Error updating face subject:', err);
            this.isUpdatingSubject.set(false);
            alert('Error al actualizar los datos del sujeto.');
          }
        });
      });
    } else {
      const name = this.editSubjectName().trim();
      const plate = this.editSubjectPlate().trim();

      this.listService.updatePlateDetail(detail.detail_id, plate, name).subscribe({
        next: () => {
          this.isUpdatingSubject.set(false);
          this.closeEditSubjectModal();
          this.onListSelected(listId);
        },
        error: (err) => {
          console.error('Error updating plate subject:', err);
          this.isUpdatingSubject.set(false);
          alert('Error al actualizar la placa.');
        }
      });
    }
  }

  saveSubject(): void {
    const listId = this.selectedListId();
    if (!listId || !this.subjectName().trim()) return;

    this.isSavingSubject.set(true);

    if (this.listType() === 'face_recognition') {
      const file = this.selectedFile();
      if (!file) {
        this.isSavingSubject.set(false);
        return;
      }
      this.listService.uploadAndAddSubject(listId, '', this.subjectName().trim(), file).subscribe({
        next: () => {
          this.isSavingSubject.set(false);
          this.closeAddSubjectModal();
          this.onListSelected(listId);
        },
        error: (err) => {
          console.error('Error uploading/adding subject to watchlist:', err);
          this.isSavingSubject.set(false);
          alert('Error al agregar el sujeto a la lista de control.');
        }
      });
    } else {
      // Para LPR: Llamar a addPlateSubject con plateText (subjectName) y ownerName (subjectOwnerName)
      this.listService.addPlateSubject(listId, this.subjectName().trim(), this.subjectOwnerName().trim()).subscribe({
        next: () => {
          this.isSavingSubject.set(false);
          this.closeAddSubjectModal();
          this.onListSelected(listId);
        },
        error: (err) => {
          console.error('Error adding plate subject to watchlist:', err);
          this.isSavingSubject.set(false);
          alert('Error al agregar la placa a la lista de control.');
        }
      });
    }
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
          this.listService.loadLists().subscribe(() => {
            this.onListSelected(newList.list_id);
          });
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

}
