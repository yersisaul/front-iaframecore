import { Component, signal, computed, inject, ElementRef, ViewChild, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { PageHeaderComponent } from '../../shared/page-header/page-header.component';
import { EmptyStateComponent } from '../../shared/empty-state/empty-state.component';
import { ConfirmDeleteModalComponent } from '../../shared/confirm-delete-modal/confirm-delete-modal.component';
import { IDashboardRepository } from '../../../core/domain/repositories/dashboard.repository';
import { IStorageRepository } from '../../../core/domain/repositories/storage.repository';
import { DashboardItem, DashboardMapper } from '../../../core/domain/entities/dashboard.models';
import { DashboardService } from '../../../core/services/dashboard.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { MetadataMapper } from '../../../data/mappers/metadata.mapper';

@Component({
  selector: 'app-dashboard-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PageHeaderComponent,
    EmptyStateComponent,
    ConfirmDeleteModalComponent
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard implements OnInit, OnDestroy {
  private sanitizer = inject(DomSanitizer);
  private dashboardRepo = inject(IDashboardRepository);
  private storageRepo = inject(IStorageRepository);
  readonly dashboardService = inject(DashboardService);
  readonly permissionsService = inject(PermissionsService);

  @ViewChild('embeddedIframe', { static: false }) embeddedIframe!: ElementRef<HTMLIFrameElement>;

  // Lista de dashboards y estado de carga delegados al servicio reactivo (sincronizado con WebSocket)
  readonly dashboards = this.dashboardService.dashboards;
  readonly isLoading = this.dashboardService.isLoading;
  readonly selectedDashboard = this.dashboardService.selectedDashboard;

  // Estados del lienzo / iframe embebido
  readonly isIframeLoading = signal<boolean>(false);
  readonly hasIframeError = signal<boolean>(false);
  readonly isFullscreen = signal<boolean>(false);

  // Estados del modal Crear / Editar
  readonly showModal = signal<boolean>(false);
  readonly isEditMode = signal<boolean>(false);
  readonly editingId = signal<string | null>(null);
  readonly formNombre = signal<string>('');
  readonly formUrl = signal<string>('');
  readonly formDescripcion = signal<string>('');
  readonly formUrlImg = signal<string | null>(null);
  readonly selectedImageFile = signal<File | null>(null);
  readonly imagePreviewUrl = signal<string | null>(null);
  readonly formError = signal<string | null>(null);
  readonly isSaving = signal<boolean>(false);

  // Estados del modal de confirmación de eliminación
  readonly showDeleteModal = signal<boolean>(false);
  readonly deletingItem = signal<DashboardItem | null>(null);
  readonly isDeleting = signal<boolean>(false);

  // Estado de copia de URL para tarjetas
  readonly copiedDashboardId = signal<string | null>(null);
  private copyTimeoutId?: any;

  // Estados para animación de redimensionamiento de tarjeta a lienzo iframe (Morph transition)
  readonly isMorphing = signal<boolean>(false);
  readonly morphDirection = signal<'opening' | 'closing' | null>(null);
  readonly morphItem = signal<DashboardItem | null>(null);
  readonly morphStyle = signal<{ [key: string]: string }>({});
  readonly clickedCardId = signal<string | null>(null);
  private savedCardRect: DOMRect | null = null;

  /**
   * Normaliza la URL para garantizar protocolo válido y resolver rutas relativas
   */
  normalizeUrl(raw: string): string {
    let trimmed = (raw || '').trim();
    if (!trimmed) return 'about:blank';
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      if (trimmed.startsWith('/')) {
        trimmed = typeof window !== 'undefined' ? `${window.location.origin}${trimmed}` : trimmed;
      } else {
        trimmed = `http://${trimmed}`;
      }
    }
    return trimmed;
  }

  // URL Sanitizada para el <iframe> activo
  readonly safeCurrentUrl = computed<SafeResourceUrl>(() => {
    const active = this.selectedDashboard();
    if (!active?.url) return this.sanitizer.bypassSecurityTrustResourceUrl('about:blank');
    const normalized = this.normalizeUrl(active.url);
    return this.sanitizer.bypassSecurityTrustResourceUrl(normalized);
  });

  private iframeLoadingTimeoutId?: any;

  ngOnInit(): void {
    this.dashboardService.isViewActive.set(true);
    this.loadDashboards();
  }

  ngOnDestroy(): void {
    this.dashboardService.isViewActive.set(false);
    if (this.iframeLoadingTimeoutId) {
      clearTimeout(this.iframeLoadingTimeoutId);
    }
  }

  /**
   * Carga la lista de dashboards desde el endpoint GET /frontend/dashboards/
   */
  loadDashboards(): void {
    if (!this.permissionsService.hasPermission('Dashboard', 'ver')) {
      return;
    }
    this.dashboardService.loadDashboards().subscribe({
      error: (err) => console.error('Error al cargar dashboards:', err)
    });
  }

  /**
   * Selecciona un dashboard con animación de redimensionamiento fluido desde la tarjeta hacia el lienzo
   */
  selectDashboard(item: DashboardItem, event?: MouseEvent): void {
    if (this.isMorphing()) return;

    const cardElement = event ? ((event.target as HTMLElement).closest('.dashboard-item-card') as HTMLElement) : null;
    const viewContainer = (cardElement?.closest('.dashboard-view-container') || document.querySelector('.dashboard-view-container')) as HTMLElement;

    if (cardElement && viewContainer && typeof window !== 'undefined') {
      const cardRect = cardElement.getBoundingClientRect();
      const containerRect = viewContainer.getBoundingClientRect();
      this.savedCardRect = cardRect;
      this.clickedCardId.set(item.id);

      const targetTop = Math.max(16, containerRect.top + 16);
      const targetLeft = containerRect.left + 16;
      const targetWidth = containerRect.width - 32;
      const targetHeight = containerRect.height - 32;

      this.morphItem.set(item);
      this.morphDirection.set('opening');
      this.isMorphing.set(true);

      // Paso 1: Posicionar el morph exactamente sobre la tarjeta clickeada
      this.morphStyle.set({
        position: 'fixed',
        top: `${cardRect.top}px`,
        left: `${cardRect.left}px`,
        width: `${cardRect.width}px`,
        height: `${cardRect.height}px`,
        borderRadius: '14px',
        zIndex: '1500',
        transition: 'none'
      });

      // Paso 2: Animar hacia el tamaño completo del lienzo
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.morphStyle.set({
            position: 'fixed',
            top: `${targetTop}px`,
            left: `${targetLeft}px`,
            width: `${targetWidth}px`,
            height: `${targetHeight}px`,
            borderRadius: '14px',
            zIndex: '1500',
            transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)'
          });
        });
      });

      // Paso 3: Consolidar estado final al culminar la animación
      setTimeout(() => {
        this.selectedDashboard.set(item);
        this.hasIframeError.set(false);
        this.setIframeLoading(true);
        this.isMorphing.set(false);
        this.morphDirection.set(null);
      }, 410);

    } else {
      this.selectedDashboard.set(item);
      this.hasIframeError.set(false);
      this.setIframeLoading(true);
    }
  }

  /**
   * Sale del dashboard activo con animación inversa encogiéndose de vuelta a la tarjeta original
   */
  exitDashboard(): void {
    if (this.isMorphing()) return;

    const activeItem = this.selectedDashboard();
    const viewContainer = document.querySelector('.dashboard-view-container') as HTMLElement;
    const browserCard = document.querySelector('.dashboard-browser-card') as HTMLElement;

    if (activeItem && this.savedCardRect && viewContainer && browserCard && typeof window !== 'undefined') {
      const cardRect = this.savedCardRect;
      const currentRect = browserCard.getBoundingClientRect();

      this.morphItem.set(activeItem);
      this.morphDirection.set('closing');
      this.isMorphing.set(true);

      // Posición inicial del morph (igual al lienzo actual)
      this.morphStyle.set({
        position: 'fixed',
        top: `${currentRect.top}px`,
        left: `${currentRect.left}px`,
        width: `${currentRect.width}px`,
        height: `${currentRect.height}px`,
        borderRadius: '14px',
        zIndex: '1500',
        transition: 'none'
      });

      // Ocultar iframe para mostrar la grilla
      this.selectedDashboard.set(null);
      this.isFullscreen.set(false);
      this.hasIframeError.set(false);
      this.setIframeLoading(false);

      // Animar encogimiento hacia las coordenadas de la tarjeta original
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          this.morphStyle.set({
            position: 'fixed',
            top: `${cardRect.top}px`,
            left: `${cardRect.left}px`,
            width: `${cardRect.width}px`,
            height: `${cardRect.height}px`,
            borderRadius: '14px',
            zIndex: '1500',
            transition: 'all 0.36s cubic-bezier(0.16, 1, 0.3, 1)',
            opacity: '0.92'
          });
        });
      });

      // Restaurar estado
      setTimeout(() => {
        this.isMorphing.set(false);
        this.morphDirection.set(null);
        this.morphItem.set(null);
        this.clickedCardId.set(null);
        this.savedCardRect = null;
      }, 370);

    } else {
      this.selectedDashboard.set(null);
      this.isFullscreen.set(false);
      this.hasIframeError.set(false);
      this.setIframeLoading(false);
      this.clickedCardId.set(null);
      this.savedCardRect = null;
    }
  }

  private setIframeLoading(loading: boolean): void {
    this.isIframeLoading.set(loading);
    if (this.iframeLoadingTimeoutId) {
      clearTimeout(this.iframeLoadingTimeoutId);
      this.iframeLoadingTimeoutId = null;
    }
    if (loading && typeof window !== 'undefined') {
      this.iframeLoadingTimeoutId = setTimeout(() => {
        this.isIframeLoading.set(false);
      }, 5000);
    }
  }

  /**
   * Abre el modal para crear un nuevo dashboard
   */
  openCreateModal(): void {
    if (!this.permissionsService.hasPermission('Dashboard', 'crear')) return;
    this.isEditMode.set(false);
    this.editingId.set(null);
    this.formNombre.set('');
    this.formUrl.set('');
    this.formDescripcion.set('');
    this.formUrlImg.set(null);
    this.selectedImageFile.set(null);
    this.imagePreviewUrl.set(null);
    this.formError.set(null);
    this.showModal.set(true);
  }

  /**
   * Abre el modal para editar un dashboard existente
   */
  openEditModal(item: DashboardItem, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    if (!this.permissionsService.hasPermission('Dashboard', 'editar')) return;
    this.isEditMode.set(true);
    this.editingId.set(item.id);
    this.formNombre.set(item.nombre);
    this.formUrl.set(item.url);
    this.formDescripcion.set(item.descripcion || '');
    this.formUrlImg.set(item.url_img || null);
    this.selectedImageFile.set(null);
    this.imagePreviewUrl.set(item.url_img ? this.getSanitizedImg(item.url_img) : null);
    this.formError.set(null);
    this.showModal.set(true);
  }

  /**
   * Cierra el modal de creación/edición
   */
  closeModal(): void {
    if (this.isSaving()) return;
    this.showModal.set(false);
    this.formError.set(null);
    this.formUrlImg.set(null);
    this.selectedImageFile.set(null);
    this.imagePreviewUrl.set(null);
  }

  /**
   * Maneja la selección local de un archivo de imagen en el modal (sin subir de inmediato)
   */
  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];

    if (!file.type.startsWith('image/')) {
      this.formError.set('El archivo seleccionado debe ser una imagen válida (JPG, PNG, WebP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.formError.set('La imagen no debe superar los 5 MB de tamaño.');
      return;
    }

    this.formError.set(null);
    this.selectedImageFile.set(file);

    // Generar vista previa local en memoria para feedback instantáneo
    const reader = new FileReader();
    reader.onload = () => {
      this.imagePreviewUrl.set(reader.result as string);
    };
    reader.readAsDataURL(file);
  }

  /**
   * Elimina la imagen seleccionada o existente en el formulario
   */
  removeSelectedImage(): void {
    this.selectedImageFile.set(null);
    this.imagePreviewUrl.set(null);
    this.formUrlImg.set(null);
  }

  /**
   * Sanitiza la URL para enrutamiento proxy con /minio/
   */
  getSanitizedImg(url: string | null | undefined): string {
    return MetadataMapper.sanitizeImageUrl(url || '');
  }

  /**
   * Fallback si una imagen de tarjeta falla al cargar
   */
  onCardImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    if (img) {
      img.style.display = 'none';
      const parent = img.parentElement;
      const placeholder = parent?.querySelector('.dashboard-preview-placeholder') as HTMLElement;
      if (placeholder) {
        placeholder.style.display = 'flex';
      }
    }
  }

  private backdropMouseDownTarget: EventTarget | null = null;

  onBackdropMouseDown(event: MouseEvent): void {
    if (event.button === 0) {
      this.backdropMouseDownTarget = event.target;
    }
  }

  onBackdropMouseUp(event: MouseEvent): void {
    if (
      event.button === 0 &&
      this.backdropMouseDownTarget === event.currentTarget &&
      event.target === event.currentTarget
    ) {
      this.closeModal();
    }
    this.backdropMouseDownTarget = null;
  }

  /**
   * Guarda o actualiza el dashboard (ejecuta primero el upload si hay imagen pendiente)
   */
  saveDashboard(): void {
    const nombre = this.formNombre().trim();
    let url = this.formUrl().trim();
    const descripcion = this.formDescripcion().trim();

    if (!nombre) {
      this.formError.set('Por favor ingresa un nombre para el dashboard.');
      return;
    }
    if (!url) {
      this.formError.set('Por favor ingresa la dirección URL del dashboard.');
      return;
    }

    // Normalizar URL básica si no incluye protocolo y no es ruta relativa
    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
      url = `http://${url}`;
    }

    if (this.isEditMode()) {
      if (!this.permissionsService.hasPermission('Dashboard', 'editar')) {
        this.formError.set('No tienes permisos para editar dashboards.');
        return;
      }
      const id = this.editingId();
      if (!id) {
        this.formError.set('ID de dashboard inválido.');
        return;
      }
    } else {
      if (!this.permissionsService.hasPermission('Dashboard', 'crear')) {
        this.formError.set('No tienes permisos para crear dashboards.');
        return;
      }
    }

    this.isSaving.set(true);
    this.formError.set(null);

    const pendingFile = this.selectedImageFile();

    // Tarea en serie 1: Subir imagen al endpoint /frontend/extra/upload/dashboard solo al confirmar guardar
    if (pendingFile) {
      this.storageRepo.uploadImage('dashboard', pendingFile).subscribe({
        next: (uploadRes) => {
          const finalUrlImg = uploadRes.url || null;
          this.executeSaveDashboard(nombre, url, descripcion, finalUrlImg);
        },
        error: (err) => {
          console.error('Error al subir imagen del dashboard:', err);
          this.formError.set(err?.error?.detail || 'Error al subir la imagen del dashboard. Intenta de nuevo.');
          this.isSaving.set(false);
        }
      });
    } else {
      // Sin archivo nuevo: conservar la imagen previa (o null si fue removida)
      this.executeSaveDashboard(nombre, url, descripcion, this.formUrlImg());
    }
  }

  /**
   * Tarea en serie 2: Persistir datos del dashboard con url_img
   */
  private executeSaveDashboard(nombre: string, url: string, descripcion: string, urlImg: string | null): void {
    if (this.isEditMode()) {
      const id = this.editingId()!;
      const patchDto = DashboardMapper.toPatchDto({
        nombre,
        url,
        descripcion: descripcion || null,
        url_img: urlImg
      });

      this.dashboardRepo.patch(id, patchDto).subscribe({
        next: (updated) => {
          this.dashboardService.addOrUpdateDashboardLocal(updated);
          this.isSaving.set(false);
          this.closeModal();
        },
        error: (err) => {
          console.error('Error al actualizar dashboard:', err);
          this.formError.set(err?.error?.detail || 'Error al actualizar el dashboard.');
          this.isSaving.set(false);
        }
      });
    } else {
      const createDto = DashboardMapper.toCreateDto({
        nombre,
        url,
        descripcion: descripcion || null,
        url_img: urlImg
      });

      this.dashboardRepo.create(createDto).subscribe({
        next: (created) => {
          this.dashboardService.addOrUpdateDashboardLocal(created);
          this.isSaving.set(false);
          this.closeModal();
        },
        error: (err) => {
          console.error('Error al registrar dashboard:', err);
          this.formError.set(err?.error?.detail || 'Error al registrar el dashboard.');
          this.isSaving.set(false);
        }
      });
    }
  }

  /**
   * Abre modal para confirmar eliminación de un dashboard
   */
  confirmDelete(item: DashboardItem, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    if (!this.permissionsService.hasPermission('Dashboard', 'eliminar')) return;
    this.deletingItem.set(item);
    this.showDeleteModal.set(true);
  }

  /**
   * Cancela la eliminación
   */
  cancelDelete(): void {
    if (this.isDeleting()) return;
    this.showDeleteModal.set(false);
    this.deletingItem.set(null);
  }

  /**
   * Ejecuta la eliminación (DELETE /frontend/dashboards/{dashboard_id})
   */
  executeDelete(): void {
    const item = this.deletingItem();
    if (!item) return;
    if (!this.permissionsService.hasPermission('Dashboard', 'eliminar')) {
      this.showDeleteModal.set(false);
      return;
    }

    this.isDeleting.set(true);
    this.dashboardRepo.delete(item.id).subscribe({
      next: () => {
        this.dashboardService.deleteDashboardLocal(item.id);
        if (this.selectedDashboard()?.id === item.id) {
          this.exitDashboard();
        }
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.deletingItem.set(null);
      },
      error: (err) => {
        console.error('Error al eliminar dashboard:', err);
        this.isDeleting.set(false);
        this.showDeleteModal.set(false);
        this.deletingItem.set(null);
      }
    });
  }

  /**
   * Alterna pantalla completa para el lienzo
   */
  toggleFullscreen(): void {
    this.isFullscreen.update(f => !f);
  }

  /**
   * Copia la URL de un dashboard al portapapeles con confirmación visual
   */
  copyDashboardUrl(url: string, id: string, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    const target = this.normalizeUrl(url);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(target).then(() => {
        this.setCopiedState(id);
      }).catch(() => {
        this.fallbackCopy(target, id);
      });
    } else {
      this.fallbackCopy(target, id);
    }
  }

  private setCopiedState(id: string): void {
    this.copiedDashboardId.set(id);
    if (this.copyTimeoutId) {
      clearTimeout(this.copyTimeoutId);
    }
    this.copyTimeoutId = setTimeout(() => {
      this.copiedDashboardId.set(null);
    }, 2000);
  }

  private fallbackCopy(text: string, id: string): void {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      this.setCopiedState(id);
    } catch {}
  }

  /**
   * Abre la URL en una nueva pestaña del navegador
   */
  openExternal(url?: string, event?: MouseEvent): void {
    if (event) {
      event.stopPropagation();
    }
    const raw = url || this.selectedDashboard()?.url;
    if (!raw) return;
    const targetUrl = this.normalizeUrl(raw);
    if (typeof window !== 'undefined') {
      window.open(targetUrl, '_blank');
    }
  }

  /**
   * Eventos del iframe
   */
  onIframeLoad(): void {
    this.setIframeLoading(false);
  }

  onIframeError(): void {
    this.setIframeLoading(false);
  }
}
