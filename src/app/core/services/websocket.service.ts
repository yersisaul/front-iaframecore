import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
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
import { IScheduleRepository } from '../domain/repositories/schedule.repository';
import { IListRepository } from '../domain/repositories/list.repository';
import { WebsocketConnectionService } from './websocket-connection.service';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  private authService = inject(AuthService);
  private router = inject(Router);
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
  private scheduleRepository = inject(IScheduleRepository);
  private listRepository = inject(IListRepository);

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
      const indexName = body.indice || msg.indice;
      const docId = body.doc_id || msg.doc_id;
      if (!indexName || !docId) return;

      console.log(`[WebSocket] Nuevo metadato indexado en: ${indexName} (ID: ${docId})`);
      
      // Incrementar el contador global del índice reactivamente
      this.metadataService.incrementIndexCount(indexName);

      // Si el índice del metadato coincide con el activo en pantalla y no hay KNN activo, recargar los detalles
      const hasKnnActive = !!(this.metadataService.filters()?.imageSearchUrl || this.metadataService.filters()?.imageEmbedding);
      if (this.metadataService.isViewActive() && this.metadataService.activeIndex() === indexName && !hasKnnActive) {
        console.log(`[WebSocket] Consultando OpenSearch para metadato en vivo del índice activo "${indexName}"`);
        this.metadataRepository.getById(indexName, docId).subscribe({
          next: (newRecord) => {
            const isFirstPage = this.metadataService.currentPage() === 1;
            if (isFirstPage) {
              this.metadataService.records.update(list => {
                if (list.some(r => r.id === newRecord.id)) return list;
                const nextList = [newRecord, ...list];
                return nextList.slice(0, this.metadataService.pageSize());
              });
              this.metadataService.totalRecords.update(n => n + 1);
              this.metadataService.markAsNew(newRecord.id);
            } else {
              this.metadataService.totalRecords.update(n => n + 1);
            }
          },
          error: (err) => {
            console.error('[WebSocket] Error al cargar nuevo metadato individual desde OpenSearch:', err);
          }
        });
      }

    } else if (action === 'nuevo_evento') {
      const docId = body.doc_id || msg.doc_id;
      if (!docId) return;

      console.log(`[WebSocket] Nuevo evento registrado con ID: ${docId}`);

      if (this.eventService.isViewActive()) {
        // Consultar OpenSearch para obtener la alarma/evento completa
        this.eventRepository.getById(docId).subscribe({
          next: (newEvent) => {
            this.eventService.addNewEvent(newEvent);
          },
          error: (err) => {
            console.error('[WebSocket] No se pudo obtener el evento para actualización en vivo:', err);
          }
        });
      }

    } else if (action === 'camera_created' || action === 'camera_updated') {
      const cameraId = body.camera_id || msg.camera_id || body.id || msg.id;
      if (!cameraId) return;
      console.log(`[WebSocket] Cámara creada/actualizada: ${cameraId}`);
      
      if (this.cameraService.isViewActive()) {
        const host = this.cameraService.activeHostFingerprint();
        if (host) {
          const isUpdate = this.cameraService.cameras().some(c => c.id === cameraId);
          this.cameraService.getCamerasByHost(host).subscribe({
            next: () => {
              if (isUpdate) {
                this.cameraService.markAsUpdated(cameraId);
              } else {
                this.cameraService.markAsNew(cameraId);
              }
            }
          });
        } else {
          // Vista "Todas las cámaras"
          const isUpdate = this.cameraService.cameras().some(c => c.id === cameraId);
          this.cameraService.getAllCameras().subscribe({
            next: () => {
              if (isUpdate) {
                this.cameraService.markAsUpdated(cameraId);
              } else {
                this.cameraService.markAsNew(cameraId);
              }
            }
          });
        }
      }

    } else if (action === 'camera_deleted') {
      const cameraId = body.camera_id || msg.camera_id || body.id || msg.id;
      if (!cameraId) return;
      console.log(`[WebSocket] Cámara eliminada localmente: ${cameraId}`);
      if (this.cameraService.isViewActive()) {
        this.cameraService.markAsDeleting(cameraId);
        setTimeout(() => {
          this.cameraService.deleteCameraLocal(cameraId);
        }, 450);
      } else {
        this.cameraService.deleteCameraLocal(cameraId);
      }

    } else if (action === 'camera_status') {
      const cameraId = body.camera_id || msg.camera_id || body.id || msg.id;
      const estado = body.estado || msg.estado || body.status || msg.status;
      if (!cameraId || !estado) return;
      console.log(`[WebSocket] Cambio de estado de cámara: ${cameraId} -> ${estado}`);
      this.cameraService.updateCameraStatusLocal(cameraId, estado);
      if (this.cameraService.isViewActive()) {
        if (estado === 'online' || estado === 'activo') {
          this.cameraService.markAsStatusActive(cameraId);
        } else {
          this.cameraService.markAsStatusInactive(cameraId);
        }
      }

    } else if (action === 'analytic_created' || action === 'analytic_updated') {
      const analyticId = body.analytic_id || msg.analytic_id || body.id || msg.id;
      if (!analyticId) return;
      console.log(`[WebSocket] Analítica creada/actualizada: ${analyticId}`);
      
      if (this.analyticService.isViewActive()) {
        const host = this.analyticService.activeHostFingerprint();
        if (host) {
          const isUpdate = this.analyticService.analytics().some(a => a.id === analyticId);
          this.analyticService.getAnalyticsByHost(host).subscribe({
            next: () => {
              if (isUpdate) {
                this.analyticService.markAsUpdated(analyticId);
              } else {
                this.analyticService.markAsNew(analyticId);
              }
            }
          });
        } else {
          // Vista "Todas las cámaras" (analíticas globales)
          const isUpdate = this.analyticService.analytics().some(a => a.id === analyticId);
          this.analyticService.getAllAnalytics().subscribe({
            next: () => {
              if (isUpdate) {
                this.analyticService.markAsUpdated(analyticId);
              } else {
                this.analyticService.markAsNew(analyticId);
              }
            }
          });
        }
      }

    } else if (action === 'analytic_deleted') {
      const analyticId = body.analytic_id || msg.analytic_id || body.id || msg.id;
      if (!analyticId) return;
      console.log(`[WebSocket] Analítica eliminada localmente: ${analyticId}`);
      if (this.analyticService.isViewActive()) {
        this.analyticService.markAsDeleting(analyticId);
        setTimeout(() => {
          this.analyticService.deleteAnalyticLocal(analyticId);
        }, 450);
      } else {
        this.analyticService.deleteAnalyticLocal(analyticId);
      }

    } else if (action === 'analytic_status') {
      const analyticId = body.analytic_id || msg.analytic_id || body.id || msg.id;
      const status = body.status || msg.status || body.estado || msg.estado;
      if (!analyticId || !status) return;
      console.log(`[WebSocket] Cambio de estado de analítica: ${analyticId} -> ${status}`);
      this.analyticService.updateAnalyticStatusLocal(analyticId, status);
      if (this.analyticService.isViewActive()) {
        if (status === 'active' || status === 'online') {
          this.analyticService.markAsStatusActive(analyticId);
        } else {
          this.analyticService.markAsStatusInactive(analyticId);
        }
      }

    } else if (action === 'schedule_created' || action === 'schedule_updated') {
      const scheduleId = body.schedule_id || msg.schedule_id || body.id || msg.id;
      if (!scheduleId) return;
      console.log(`[WebSocket] Horario creado/actualizado: ${scheduleId}`);
      
      if (this.scheduleService.isViewActive()) {
        const isUpdate = this.scheduleService.schedules().some(s => s.id === scheduleId);
        this.scheduleRepository.getById(scheduleId).subscribe({
          next: (schedule) => {
            this.scheduleService.addOrUpdateScheduleLocal(schedule);
            if (isUpdate) {
              this.scheduleService.markAsUpdated(scheduleId);
            } else {
              this.scheduleService.markAsNew(scheduleId);
            }
          },
          error: (err) => {
            console.error('[WebSocket] Error al cargar horario individual:', err);
          }
        });
      }

    } else if (action === 'schedule_deleted') {
      const scheduleId = body.schedule_id || msg.schedule_id || body.id || msg.id;
      if (!scheduleId) return;
      console.log(`[WebSocket] Horario eliminado localmente: ${scheduleId}`);
      if (this.scheduleService.isViewActive()) {
        this.scheduleService.markAsDeleting(scheduleId);
        setTimeout(() => {
          this.scheduleService.deleteScheduleLocal(scheduleId);
        }, 450);
      } else {
        this.scheduleService.deleteScheduleLocal(scheduleId);
      }

    } else if (action === 'schedule_status') {
      const scheduleId = body.schedule_id || msg.schedule_id || body.id || msg.id;
      let status = body.status || msg.status || body.estado || msg.estado;
      if (!scheduleId || !status) return;

      // Mapear de 'active'/'inactive' (backend) a 'activo'/'inactivo' (frontend)
      if (status === 'active') {
        status = 'activo';
      } else if (status === 'inactive') {
        status = 'inactivo';
      }

      console.log(`[WebSocket] Cambio de estado de horario: ${scheduleId} -> ${status}`);
      this.scheduleService.updateScheduleStatusLocal(scheduleId, status as 'activo' | 'inactivo');
      if (this.scheduleService.isViewActive()) {
        if (status === 'activo') {
          this.scheduleService.markAsStatusActive(scheduleId);
        } else {
          this.scheduleService.markAsStatusInactive(scheduleId);
        }
      }

    } else if (action === 'list_created' || action === 'list_updated') {
      const listId = body.list_id || msg.list_id || body.id || msg.id;
      if (!listId) return;
      console.log(`[WebSocket] Lista de control creada/actualizada: ${listId}`);
      
      if (this.listService.isViewActive()) {
        const isUpdate = this.listService.lists().some(l => l.list_id === listId);
        this.listRepository.getListById(listId).subscribe({
          next: (newList) => {
            this.listService.addOrUpdateListLocal(newList);
            if (isUpdate) {
              this.listService.markAsUpdated(listId);
            } else {
              this.listService.markAsNew(listId);
            }
          },
          error: (err) => {
            console.error('[WebSocket] Error al cargar lista individual:', err);
          }
        });
      }

    } else if (action === 'list_deleted') {
      const listId = body.list_id || msg.list_id || body.id || msg.id;
      if (!listId) return;
      console.log(`[WebSocket] Lista de control eliminada localmente: ${listId}`);
      if (this.listService.isViewActive()) {
        this.listService.markAsDeleting(listId);
        setTimeout(() => {
          this.listService.deleteListLocal(listId);
        }, 450);
      } else {
        this.listService.deleteListLocal(listId);
      }

    } else if (action === 'list_detail_created' || action === 'list_detail_updated') {
      const detailId = body.detail_id || msg.detail_id || body.id || msg.id;
      if (!detailId) return;
      console.log(`[WebSocket] Sujeto de lista creado/actualizado: ${detailId}`);
      
      if (this.listService.isViewActive()) {
        const activeList = this.listService.activeListId();
        if (activeList) {
          const isUpdate = this.listService.listDetails().some(d => d.detail_id === detailId);
          this.listRepository.getListDetailById(detailId).subscribe({
            next: (detail) => {
              if (detail.list_id === activeList) {
                this.listService.addOrUpdateListDetailLocal(detail);
                if (isUpdate) {
                  this.listService.markAsUpdated(detailId);
                } else {
                  this.listService.markAsNew(detailId);
                }
              }
            },
            error: (err) => {
              console.error('[WebSocket] Error al cargar detalle de lista individual:', err);
            }
          });
        }
      }

    } else if (action === 'list_detail_deleted') {
      const detailId = body.detail_id || msg.detail_id || body.id || msg.id;
      if (!detailId) return;
      console.log(`[WebSocket] Sujeto de lista eliminado localmente: ${detailId}`);
      if (this.listService.isViewActive()) {
        this.listService.markAsDeleting(detailId);
        setTimeout(() => {
          this.listService.deleteSubjectLocal(detailId);
        }, 450);
      } else {
        this.listService.deleteSubjectLocal(detailId);
      }

    } else if (action === 'user_created') {
      const userId = body.user_id || msg.user_id || body.usuario_id || msg.usuario_id || body.id || msg.id;
      if (!userId) return;
      console.log(`[WebSocket] Usuario creado recibido: ${userId}`);
      
      if (this.userService.isViewActive()) {
        this.userRepository.getAll().subscribe({
          next: (usersList) => {
            this.userService.users.set(usersList);
            this.userService.markAsNew(userId);
          },
          error: (err) => {
            console.error('[WebSocket] Error al recargar lista de usuarios tras creación:', err);
          }
        });
      }

    } else if (action === 'user_updated') {
      const userId = body.user_id || msg.user_id || body.usuario_id || msg.usuario_id || body.id || msg.id;
      if (!userId) return;
      console.log(`[WebSocket] Usuario actualizado recibido: ${userId}`);
      
      const currentUser = this.authService.currentUser();
      this.userRepository.getAll().subscribe({
        next: (usersList) => {
          if (this.userService.isViewActive()) {
            this.userService.users.set(usersList);
            this.userService.markAsUpdated(userId);
          }

          // Encontrar si el usuario modificado en la lista (por UUID) coincide con el correo o ID del usuario actual
          const updatedUser = usersList.find(u => u.id === userId);
          const isCurrentUser = currentUser && (
            userId === currentUser.id ||
            (updatedUser && updatedUser.email === currentUser.email)
          );

          if (isCurrentUser && updatedUser && updatedUser.roleId) {
            console.log(`[WebSocket] Mi usuario ha sido modificado en caliente (Email: ${updatedUser.email}). Sincronizando permisos para rol ID: ${updatedUser.roleId}`);
            
            // Sincronizar el ID real (UUID) y rolId del usuario actual en la señal
            this.authService.currentUser.set({
              ...currentUser,
              id: updatedUser.id, // Sincroniza el ID a UUID real
              roleId: updatedUser.roleId,
              name: updatedUser.name || currentUser.name,
              email: updatedUser.email || currentUser.email
            });

            // Actualizar sesión persistente en sessionStorage
            const userJson = sessionStorage.getItem('auth_user');
            if (userJson) {
              const parsed = JSON.parse(userJson);
              parsed.id = updatedUser.id; // Sincroniza el ID a UUID real
              parsed.roleId = updatedUser.roleId;
              parsed.name = updatedUser.name || parsed.name;
              parsed.email = updatedUser.email || parsed.email;
              sessionStorage.setItem('auth_user', JSON.stringify(parsed));
            }

            // Cargar los permisos del nuevo rol (lo cual a su vez chequeará el acceso de la ruta activa)
            this.permissionsService.loadUserPermissions(updatedUser.roleId).subscribe();
          }
        },
        error: (err) => {
          console.error('[WebSocket] Error al recargar lista de usuarios tras actualización:', err);
        }
      });

    } else if (action === 'user_deleted') {
      const userId = body.user_id || msg.user_id || body.usuario_id || msg.usuario_id || body.id || msg.id;
      if (!userId) return;
      console.log(`[WebSocket] Usuario eliminado recibido: ${userId}`);

      const currentUser = this.authService.currentUser();
      const isCurrentUser = currentUser && (
        userId === currentUser.id ||
        currentUser.email === userId
      );

      if (isCurrentUser) {
        console.warn('[WebSocket] El usuario actual ha sido eliminado. Forzando logout.');
        this.authService.logout().subscribe({
          next: () => {
            this.router.navigate(['/login']);
          },
          error: () => {
            this.router.navigate(['/login']);
          }
        });
      }

      if (this.userService.isViewActive()) {
        this.userService.markAsDeleting(userId);
        setTimeout(() => {
          this.userService.deleteUserLocal(userId);
        }, 450);
      } else {
        this.userService.deleteUserLocal(userId);
      }

    } else if (action === 'role_created') {
      const rolId = body.rol_id || msg.rol_id || body.id || msg.id;
      if (!rolId) return;
      console.log(`[WebSocket] Rol creado recibido: ${rolId}`);
      
      if (this.permissionsService.isViewActive()) {
        this.permissionsService.loadAllRoles().subscribe({
          next: () => {
            this.permissionsService.markAsNewRole(rolId);
          },
          error: (err) => {
            console.error('[WebSocket] Error al recargar lista de roles tras creación:', err);
          }
        });
      }

    } else if (action === 'role_updated') {
      const rolId = body.rol_id || msg.rol_id || body.id || msg.id;
      if (!rolId) return;
      console.log(`[WebSocket] Rol actualizado recibido: ${rolId}`);
      
      const currentUser = this.authService.currentUser();
      if (this.permissionsService.isViewActive() || (currentUser && currentUser.roleId === rolId)) {
        this.permissionsService.loadAllRoles().subscribe({
          next: () => {
            if (this.permissionsService.isViewActive()) {
              this.permissionsService.markAsUpdatedRole(rolId);
            }

            // Sincronizar permisos del usuario logueado si coincide
            if (currentUser && currentUser.roleId === rolId) {
              console.log(`[WebSocket] El rol del usuario actual ha sido modificado. Sincronizando permisos.`);
              this.permissionsService.loadUserPermissions(rolId).subscribe();
            }
          },
          error: (err) => {
            console.error('[WebSocket] Error al recargar lista de roles tras actualización:', err);
          }
        });
      }

    } else if (action === 'role_deleted') {
      const rolId = body.rol_id || msg.rol_id || body.id || msg.id;
      if (!rolId) return;
      console.log(`[WebSocket] Rol eliminado recibido: ${rolId}`);
      if (this.permissionsService.isViewActive()) {
        this.permissionsService.markAsDeletingRole(rolId);
        setTimeout(() => {
          this.permissionsService.deleteRoleLocal(rolId);
        }, 450);
      } else {
        this.permissionsService.deleteRoleLocal(rolId);
      }

    } else if (action === 'host_migrated') {
      const oldFingerprint = body.old_fingerprint || msg.old_fingerprint;
      const newFingerprint = body.new_fingerprint || msg.new_fingerprint;
      if (!oldFingerprint || !newFingerprint) return;

      console.log(`[WebSocket] Host migrado: ${oldFingerprint} -> ${newFingerprint}`);
      
      const activeFp = this.cameraService.activeHostFingerprint();

      if (activeFp === oldFingerprint) {
        // Animar salida de cámaras y analíticas en host origen
        const oldCameras = this.cameraService.cameras().filter(c => c.hostFingerprint === oldFingerprint);
        oldCameras.forEach(c => this.cameraService.markAsDeleting(c.id));

        const oldAnalytics = this.analyticService.analytics().filter(a => a.hostFingerprint === oldFingerprint);
        oldAnalytics.forEach(a => this.analyticService.markAsDeleting(a.id));

        setTimeout(() => {
          this.hostService.migrateHostLocal(oldFingerprint, newFingerprint);
          this.cameraService.migrateHostLocal(oldFingerprint, newFingerprint);
          this.analyticService.migrateHostLocal(oldFingerprint, newFingerprint);
          this.scheduleService.migrateHostLocal(oldFingerprint, newFingerprint);
          if (this.hostService.isViewActive()) {
            this.hostService.markAsUpdatedHost(newFingerprint);
          }
        }, 450);
      } else {
        this.hostService.migrateHostLocal(oldFingerprint, newFingerprint);
        this.cameraService.migrateHostLocal(oldFingerprint, newFingerprint);
        this.analyticService.migrateHostLocal(oldFingerprint, newFingerprint);
        this.scheduleService.migrateHostLocal(oldFingerprint, newFingerprint);
        if (this.hostService.isViewActive()) {
          this.hostService.markAsUpdatedHost(newFingerprint);
        }
      }

      // Si la vista del host destino está activa, recargar y animar la entrada de los nuevos elementos
      if (activeFp === newFingerprint) {
        this.cameraService.getCamerasByHost(newFingerprint, true).subscribe();
        this.analyticService.getAnalyticsByHost(newFingerprint, true).subscribe();
        this.scheduleService.getAllSchedules().subscribe();
      }

    } else if (action === 'host_deleted') {
      const fingerprint = body.fingerprint || msg.fingerprint || body.fingerprint_host || msg.fingerprint_host;
      if (!fingerprint) return;

      console.log(`[WebSocket] Host eliminado: ${fingerprint}`);
      if (this.hostService.isViewActive()) {
        this.hostService.markAsDeletingHost(fingerprint);
        setTimeout(() => {
          this.hostService.deleteHostLocal(fingerprint);
        }, 450);
      } else {
        this.hostService.deleteHostLocal(fingerprint);
      }
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
