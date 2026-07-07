import { Injectable, inject } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from './auth.service';
import { MetadataService } from './metadata.service';
import { EventService } from './event.service';
import { CameraService } from './camera.service';
import { AnalyticService } from './analytic.service';
import { ScheduleService } from './schedule.service';
import { ListService } from './list.service';
import { UserService } from './user.service';
import { HostService } from './host.service';
import { PermissionsService } from './permissions.service';
import { IMetadataRepository } from '../domain/repositories/metadata.repository';
import { IEventRepository } from '../domain/repositories/event.repository';
import { IUserRepository } from '../domain/repositories/user.repository';
import { WebsocketConnectionService } from './websocket-connection.service';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private authService = inject(AuthService);
  private metadataService = inject(MetadataService);
  private eventService = inject(EventService);
  private cameraService = inject(CameraService);
  private analyticService = inject(AnalyticService);
  private scheduleService = inject(ScheduleService);
  private listService = inject(ListService);
  private userService = inject(UserService);
  private hostService = inject(HostService);
  private permissionsService = inject(PermissionsService);

  private metadataRepository = inject(IMetadataRepository);
  private eventRepository = inject(IEventRepository);
  private userRepository = inject(IUserRepository);

  private connectionService = inject(WebsocketConnectionService);
  private subscription: Subscription | null = null;

  constructor() {
    // Suscribirse al flujo asíncrono de mensajes de conexión
    this.subscription = this.connectionService.messages$.subscribe(msg => {
      this.handleMessage(msg);
    });
  }

  private handleMessage(msg: any): void {
    if (!msg || !msg.action) return;

    const action = msg.action;
    const body = msg.body || {};

    console.log(`[WebSocket Handler] Mensaje recibido del servidor:`, msg);

    if (action === 'nuevo_metadato') {
      const indexName = body.indice;
      const docId = body.doc_id;
      if (!indexName || !docId) return;

      console.log(`[WebSocket] Nuevo metadato indexado en: ${indexName} (ID: ${docId})`);
      
      // Incrementar el contador global del índice reactivamente
      this.metadataService.incrementIndexCount(indexName);

      // Si el índice del metadato coincide con el activo en pantalla y no hay KNN activo, recargar los detalles
      const hasKnnActive = !!(this.metadataService.filters()?.imageSearchUrl || this.metadataService.filters()?.imageEmbedding);
      if (this.metadataService.activeIndex() === indexName && !hasKnnActive) {
        console.log(`[WebSocket] Consultando OpenSearch para metadato en vivo del índice activo "${indexName}"`);
        this.metadataRepository.getById(indexName, docId).subscribe({
          next: (newRecord) => {
            this.metadataService.records.update(r => {
              const limit = this.metadataService.pageSize();
              const updated = [newRecord, ...r];
              return updated.slice(0, limit);
            });
            this.metadataService.totalRecords.update(t => t + 1);
            this.metadataService.markAsNew(newRecord.id);
          },
          error: (err) => {
            console.error('[WebSocket] No se pudo obtener el metadato para actualización en vivo:', err);
          }
        });
      } else {
        console.log(`[WebSocket] Documento de metadato omitido para evitar sobrecarga de red y memoria (índice inactivo: "${indexName}")`);
      }

    } else if (action === 'nuevo_evento') {
      const docId = body.doc_id;
      if (!docId) return;

      console.log(`[WebSocket] Nuevo evento registrado con ID: ${docId}`);

      // Consultar OpenSearch para obtener la alarma/evento completa
      this.eventRepository.getById(docId).subscribe({
        next: (newEvent) => {
          this.eventService.addNewEvent(newEvent);
        },
        error: (err) => {
          console.error('[WebSocket] No se pudo obtener el evento para actualización en vivo:', err);
        }
      });

    } else if (action === 'camera_created' || action === 'camera_updated') {
      const cameraId = body.camera_id;
      if (!cameraId) return;
      console.log(`[WebSocket] Cámara creada/actualizada: ${cameraId}`);
      const host = this.cameraService.activeHostFingerprint();
      if (host) {
        const isUpdate = this.cameraService.cameras().some(c => c.id === cameraId);
        this.cameraService.getCamerasByHost(host).subscribe({
          next: () => {
            if (this.cameraService.isViewActive()) {
              if (isUpdate) {
                this.cameraService.markAsUpdated(cameraId);
              } else {
                this.cameraService.markAsNew(cameraId);
              }
            }
          }
        });
      }

    } else if (action === 'camera_deleted') {
      const cameraId = body.camera_id;
      if (!cameraId) return;
      console.log(`[WebSocket] Cámara eliminada localmente: ${cameraId}`);
      if (this.cameraService.isViewActive()) {
        this.cameraService.markAsDeleting(cameraId);
        setTimeout(() => {
          this.cameraService.deleteCameraLocal(cameraId);
        }, 400);
      } else {
        this.cameraService.deleteCameraLocal(cameraId);
      }

    } else if (action === 'camera_status') {
      const cameraId = body.camera_id;
      const estado = body.estado;
      if (!cameraId || !estado) return;
      console.log(`[WebSocket] Cambio de estado de cámara: ${cameraId} -> ${estado}`);
      this.cameraService.updateCameraStatusLocal(cameraId, estado);
      if (this.cameraService.isViewActive()) {
        this.cameraService.markAsUpdated(cameraId);
      }

    } else if (action === 'analytic_created' || action === 'analytic_updated') {
      const analyticId = body.analytic_id;
      if (!analyticId) return;
      console.log(`[WebSocket] Analítica creada/actualizada: ${analyticId}`);
      const host = this.analyticService.activeHostFingerprint();
      if (host) {
        const isUpdate = this.analyticService.analytics().some(a => a.id === analyticId);
        this.analyticService.getAnalyticsByHost(host).subscribe({
          next: () => {
            if (this.analyticService.isViewActive()) {
              if (isUpdate) {
                this.analyticService.markAsUpdated(analyticId);
              } else {
                this.analyticService.markAsNew(analyticId);
              }
            }
          }
        });
      }

    } else if (action === 'analytic_deleted') {
      const analyticId = body.analytic_id;
      if (!analyticId) return;
      console.log(`[WebSocket] Analítica eliminada localmente: ${analyticId}`);
      if (this.analyticService.isViewActive()) {
        this.analyticService.markAsDeleting(analyticId);
        setTimeout(() => {
          this.analyticService.deleteAnalyticLocal(analyticId);
        }, 400);
      } else {
        this.analyticService.deleteAnalyticLocal(analyticId);
      }

    } else if (action === 'analytic_status') {
      const analyticId = body.analytic_id;
      const status = body.status;
      if (!analyticId || !status) return;
      console.log(`[WebSocket] Cambio de estado de analítica: ${analyticId} -> ${status}`);
      this.analyticService.updateAnalyticStatusLocal(analyticId, status);
      if (this.analyticService.isViewActive()) {
        this.analyticService.markAsUpdated(analyticId);
      }

    } else if (action === 'schedule_created' || action === 'schedule_updated') {
      const scheduleId = body.schedule_id;
      if (!scheduleId) return;
      console.log(`[WebSocket] Horario creado/actualizado: ${scheduleId}`);
      const isUpdate = this.scheduleService.schedules().some(s => s.id === scheduleId);
      this.scheduleService.getAllSchedules().subscribe({
        next: () => {
          if (this.scheduleService.isViewActive()) {
            if (isUpdate) {
              this.scheduleService.markAsUpdated(scheduleId);
            } else {
              this.scheduleService.markAsNew(scheduleId);
            }
          }
        }
      });

    } else if (action === 'schedule_deleted') {
      const scheduleId = body.schedule_id;
      if (!scheduleId) return;
      console.log(`[WebSocket] Horario eliminado localmente: ${scheduleId}`);
      if (this.scheduleService.isViewActive()) {
        this.scheduleService.markAsDeleting(scheduleId);
        setTimeout(() => {
          this.scheduleService.deleteScheduleLocal(scheduleId);
        }, 400);
      } else {
        this.scheduleService.deleteScheduleLocal(scheduleId);
      }

    } else if (action === 'schedule_status') {
      const scheduleId = body.schedule_id;
      const status = body.status;
      if (!scheduleId || !status) return;
      console.log(`[WebSocket] Cambio de estado de horario: ${scheduleId} -> ${status}`);
      this.scheduleService.updateScheduleStatusLocal(scheduleId, status);
      if (this.scheduleService.isViewActive()) {
        this.scheduleService.markAsUpdated(scheduleId);
      }

    } else if (action === 'list_created' || action === 'list_updated') {
      const listId = body.list_id;
      if (!listId) return;
      console.log(`[WebSocket] Lista de control creada/actualizada: ${listId}`);
      const isUpdate = this.listService.lists().some(l => l.list_id === listId);
      this.listService.loadLists().subscribe({
        next: () => {
          if (this.listService.isViewActive()) {
            if (isUpdate) {
              this.listService.markAsUpdated(listId);
            } else {
              this.listService.markAsNew(listId);
            }
          }
        }
      });

    } else if (action === 'list_deleted') {
      const listId = body.list_id;
      if (!listId) return;
      console.log(`[WebSocket] Lista de control eliminada localmente: ${listId}`);
      if (this.listService.isViewActive()) {
        this.listService.markAsDeleting(listId);
        setTimeout(() => {
          this.listService.deleteListLocal(listId);
        }, 400);
      } else {
        this.listService.deleteListLocal(listId);
      }

    } else if (action === 'list_detail_created' || action === 'list_detail_updated') {
      const detailId = body.detail_id;
      if (!detailId) return;
      console.log(`[WebSocket] Sujeto de lista creado/actualizado: ${detailId}`);
      const activeList = this.listService.activeListId();
      if (activeList) {
        const isUpdate = this.listService.listDetails().some(d => d.detail_id === detailId);
        this.listService.loadListDetails(activeList).subscribe({
          next: () => {
            if (this.listService.isViewActive()) {
              if (isUpdate) {
                this.listService.markAsUpdated(detailId);
              } else {
                this.listService.markAsNew(detailId);
              }
            }
          }
        });
      }

    } else if (action === 'list_detail_deleted') {
      const detailId = body.detail_id;
      if (!detailId) return;
      console.log(`[WebSocket] Sujeto de lista eliminado localmente: ${detailId}`);
      if (this.listService.isViewActive()) {
        this.listService.markAsDeleting(detailId);
        setTimeout(() => {
          this.listService.deleteSubjectLocal(detailId);
        }, 400);
      } else {
        this.listService.deleteSubjectLocal(detailId);
      }

    } else if (action === 'user_created') {
      const userId = body.user_id;
      if (!userId) return;
      console.log(`[WebSocket] Usuario creado recibido: ${userId}`);
      this.userRepository.getById(userId).subscribe({
        next: (newUser) => {
          this.userService.addUserLocal(newUser);
          if (this.userService.isViewActive()) {
            this.userService.markAsNew(newUser.id);
          }
        },
        error: (err) => {
          console.error('[WebSocket] Error al cargar nuevo usuario por ID:', err);
        }
      });

    } else if (action === 'user_updated') {
      const userId = body.user_id || body.usuario_id || body.id;
      if (!userId) return;
      console.log(`[WebSocket] Usuario actualizado recibido: ${userId}`);
      this.userRepository.getById(userId).subscribe({
        next: (updatedUser) => {
          this.userService.updateUserLocal(userId, updatedUser);
          if (this.userService.isViewActive()) {
            this.userService.markAsUpdated(userId);
          }

          // Refrescar permisos del usuario actual si es el mismo
          const currentUser = this.authService.currentUser();
          if (currentUser && (userId === currentUser.id) && updatedUser.roleId) {
            console.log(`[WebSocket] Mi usuario ha sido modificado. Sincronizando permisos.`);
            this.permissionsService.loadUserPermissions(updatedUser.roleId).subscribe();
          }
        },
        error: (err) => {
          console.error('[WebSocket] Error al cargar usuario actualizado por ID:', err);
        }
      });

    } else if (action === 'user_deleted') {
      const userId = body.user_id || body.usuario_id || body.id;
      if (!userId) return;
      console.log(`[WebSocket] Usuario eliminado recibido: ${userId}`);
      if (this.userService.isViewActive()) {
        this.userService.markAsDeleting(userId);
        setTimeout(() => {
          this.userService.deleteUserLocal(userId);
        }, 1000);
      } else {
        this.userService.deleteUserLocal(userId);
      }

    } else if (action === 'role_created') {
      const rolId = body.rol_id || body.id;
      if (!rolId) return;
      console.log(`[WebSocket] Rol creado recibido: ${rolId}`);
      this.permissionsService.loadAllRoles().subscribe({
        next: () => {
          if (this.permissionsService.isViewActive()) {
            this.permissionsService.markAsNewRole(rolId);
          }
        },
        error: (err) => {
          console.error('[WebSocket] Error al recargar roles tras creación:', err);
        }
      });

    } else if (action === 'role_updated') {
      const rolId = body.rol_id || body.id;
      if (!rolId) return;
      console.log(`[WebSocket] Rol actualizado recibido: ${rolId}`);
      this.permissionsService.loadAllRoles().subscribe({
        next: () => {
          if (this.permissionsService.isViewActive()) {
            this.permissionsService.markAsUpdatedRole(rolId);
          }

          // Sincronizar permisos del usuario logueado si coincide
          const currentUser = this.authService.currentUser();
          if (currentUser && currentUser.roleId === rolId) {
            console.log(`[WebSocket] El rol del usuario actual ha sido modificado. Sincronizando permisos.`);
            this.permissionsService.loadUserPermissions(rolId).subscribe();
          }
        },
        error: (err) => {
          console.error('[WebSocket] Error al recargar roles tras actualización:', err);
        }
      });

    } else if (action === 'role_deleted') {
      const rolId = body.rol_id || body.id;
      if (!rolId) return;
      console.log(`[WebSocket] Rol eliminado recibido: ${rolId}`);
      if (this.permissionsService.isViewActive()) {
        this.permissionsService.markAsDeletingRole(rolId);
        setTimeout(() => {
          this.permissionsService.deleteRoleLocal(rolId);
        }, 1000);
      } else {
        this.permissionsService.deleteRoleLocal(rolId);
      }

    } else if (action === 'host_migrated') {
      const oldFingerprint = body.old_fingerprint;
      const newFingerprint = body.new_fingerprint;
      if (!oldFingerprint || !newFingerprint) return;

      console.log(`[WebSocket] Host migrado: ${oldFingerprint} -> ${newFingerprint}`);
      this.hostService.migrateHostLocal(oldFingerprint, newFingerprint);
      this.hostService.markAsUpdatedHost(newFingerprint);

    } else if (action === 'host_deleted') {
      const fingerprint = body.fingerprint;
      if (!fingerprint) return;

      console.log(`[WebSocket] Host eliminado: ${fingerprint}`);
      this.hostService.markAsDeletingHost(fingerprint);
      setTimeout(() => {
        this.hostService.deleteHostLocal(fingerprint);
      }, 1000);
    }
  }

  // Método para cerrar manualmente la suscripción si es necesario
  destroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
}
