import { Injectable, signal, inject, Injector } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { AppEnvironment } from '../config/app-environment';
import { forkJoin, Observable, of } from 'rxjs';
import { tap, map, catchError } from 'rxjs/operators';

// Interfaz para un permiso del backend
export interface BackendPermiso {
  permiso_id: string;
  codigo: string;
  descripcion: string;
}

// Interfaz para un rol del backend
export interface BackendRol {
  rol_id: string;
  nombre: string;
  descripcion: string;
  id_permisos: string[];
}

@Injectable({
  providedIn: 'root'
})
export class PermissionsService {
  private injector = inject(Injector);
  private http = inject(HttpClient);

  private get authService(): AuthService {
    return this.injector.get(AuthService);
  }

  // Set de códigos de permisos activos del usuario actual (ej: 'cameras.read', 'users.create')
  readonly activePermissionCodes = signal<Set<string>>(this.loadCachedPermissions());

  // Todos los permisos disponibles en el sistema (cargados desde el backend)
  readonly availablePermissions = signal<BackendPermiso[]>([]);

  // Todos los roles disponibles en el sistema (cargados desde el backend)
  readonly allRoles = signal<BackendRol[]>([]);

  readonly isViewActive = signal<boolean>(false);
  readonly newRoleIds = signal<Set<string>>(new Set());
  readonly updatedRoleIds = signal<Set<string>>(new Set());
  readonly deletingRoleIds = signal<Set<string>>(new Set());

  markAsNewRole(id: string): void {
    this.newRoleIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRoleIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 2000);
  }

  markAsUpdatedRole(id: string): void {
    this.updatedRoleIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.updatedRoleIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 2000);
  }

  markAsDeletingRole(id: string): void {
    this.deletingRoleIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.deletingRoleIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  deleteRoleLocal(id: string): void {
    this.allRoles.update(roles => roles.filter(r => r.rol_id !== id));
  }

  private loadCachedPermissions(): Set<string> {
    try {
      const cached = localStorage.getItem('azor_active_permissions');
      if (cached) {
        return new Set(JSON.parse(cached));
      }
    } catch (e) {
      console.error('Error loading cached permissions:', e);
    }
    return new Set();
  }

  /**
   * Carga los permisos del usuario basándose en su rol_id.
   * Resuelve dinámicamente el nombre del rol y actualiza currentUser.
   */
  loadUserPermissions(rolId: string): Observable<void> {
    if (!rolId) {
      this.clearPermissions();
      return of(undefined);
    }

    return forkJoin({
      roles: this.http.get<BackendRol[]>(`${AppEnvironment.apiUrl}/frontend/roles/`),
      permisos: this.http.get<BackendPermiso[]>(`${AppEnvironment.apiUrl}/frontend/permisos/`)
    }).pipe(
      map(({ roles, permisos }) => {
        const userRole = roles.find(r => r.rol_id === rolId);
        if (!userRole) {
          this.clearPermissions();
          return;
        }

        // Construir el set de códigos de permiso activos
        const codes = new Set<string>();
        userRole.id_permisos.forEach((pId: string) => {
          const match = permisos.find(p => p.permiso_id === pId);
          if (match && match.codigo) {
            codes.add(match.codigo.toLowerCase());
          }
        });
        
        this.activePermissionCodes.set(codes);
        localStorage.setItem('azor_active_permissions', JSON.stringify(Array.from(codes)));

        // Cachear todos los permisos y roles disponibles para la UI
        this.availablePermissions.set(permisos);
        this.allRoles.set(roles);

        // Resolver y actualizar el nombre del rol dinámicamente
        const roleName = userRole.nombre.toUpperCase();
        const currentUser = this.authService.currentUser();
        if (currentUser) {
          this.authService.currentUser.set({
            ...currentUser,
            role: roleName
          });
          const userJson = sessionStorage.getItem('auth_user');
          if (userJson) {
            const parsed = JSON.parse(userJson);
            parsed.role = roleName;
            sessionStorage.setItem('auth_user', JSON.stringify(parsed));
          }
        }
      }),
      catchError(err => {
        console.error('Error loading dynamic permissions:', err);
        this.clearPermissions();
        return of(undefined);
      })
    );
  }

  /**
   * Carga todos los permisos del sistema desde el backend.
   */
  loadAllPermissions(): Observable<void> {
    return this.http.get<BackendPermiso[]>(`${AppEnvironment.apiUrl}/frontend/permisos/`).pipe(
      tap(permisos => this.availablePermissions.set(permisos)),
      map(() => undefined),
      catchError(err => {
        console.error('Error loading all permissions:', err);
        return of(undefined);
      })
    );
  }

  /**
   * Carga todos los roles del sistema desde el backend.
   */
  loadAllRoles(): Observable<void> {
    return this.http.get<BackendRol[]>(`${AppEnvironment.apiUrl}/frontend/roles/`).pipe(
      tap(roles => this.allRoles.set(roles)),
      map(() => undefined),
      catchError(err => {
        console.error('Error loading all roles:', err);
        return of(undefined);
      })
    );
  }

  /**
   * Actualiza los permisos de un rol en el backend.
   * PUT /frontend/roles/{rol_id}
   */
  updateRolePermissions(rolId: string, rolNombre: string, rolDescripcion: string, id_permisos: string[]): Observable<void> {
    const payload = {
      nombre: rolNombre,
      descripcion: rolDescripcion,
      id_permisos
    };
    return this.http.put<BackendRol>(`${AppEnvironment.apiUrl}/frontend/roles/${rolId}`, payload).pipe(
      tap(updatedRole => {
        // Actualizar el estado local con el rol modificado
        this.allRoles.update(roles =>
          roles.map(r => r.rol_id === rolId ? updatedRole : r)
        );
      }),
      map(() => undefined),
      catchError(err => {
        console.error('Error updating role permissions:', err);
        throw err;
      })
    );
  }

  /**
   * Crea un nuevo rol en el backend.
   * POST /frontend/roles/
   */
  createRole(nombre: string, descripcion: string, id_permisos: string[]): Observable<BackendRol> {
    const payload = {
      nombre,
      descripcion,
      id_permisos
    };
    return this.http.post<BackendRol>(`${AppEnvironment.apiUrl}/frontend/roles/`, payload).pipe(
      tap(newRole => {
        // Agregar el nuevo rol a la señal local
        this.allRoles.update(roles => [...roles, newRole]);
      }),
      catchError(err => {
        console.error('Error creating role:', err);
        throw err;
      })
    );
  }

  /**
   * Elimina un rol del backend.
   * DELETE /frontend/roles/{rol_id}
   */
  deleteRole(rolId: string): Observable<void> {
    return this.http.delete<void>(`${AppEnvironment.apiUrl}/frontend/roles/${rolId}`).pipe(
      tap(() => {
        // Remover el rol de la señal local
        this.allRoles.update(roles => roles.filter(r => r.rol_id !== rolId));
      }),
      map(() => undefined),
      catchError(err => {
        console.error('Error deleting role:', err);
        throw err;
      })
    );
  }

  clearPermissions(): void {
    localStorage.removeItem('azor_active_permissions');
    this.activePermissionCodes.set(new Set());
  }

  /**
   * Asigna todos los permisos posibles al usuario de API Key (modo desarrollo).
   * Se llama solo cuando se usa una API Key estática, no con login real.
   */
  setAdminPermissions(): void {
    // Lista de todos los códigos de permiso conocidos del sistema
    const allCodes = [
      'roles.create', 'roles.read', 'roles.update', 'roles.delete',
      'users.create', 'users.read', 'users.update', 'users.delete',
      'hosts.read', 'hosts.update', 'hosts.delete',
      'cameras.read', 'cameras.update', 'cameras.delete',
      'analytics.create', 'analytics.read', 'analytics.update', 'analytics.delete',
      'schedules.create', 'schedules.read', 'schedules.update', 'schedules.delete',
      'lists.create', 'lists.read', 'lists.update', 'lists.delete',
      'list_details.create', 'list_details.read', 'list_details.update', 'list_details.delete'
    ];
    const codes = new Set<string>(allCodes);
    this.activePermissionCodes.set(codes);
    localStorage.setItem('azor_active_permissions', JSON.stringify(Array.from(codes)));
  }

  /**
   * Traduce módulo + acción del frontend a código de permiso del backend.
   * Ejemplo: ('Cámaras', 'editar') → 'cameras.update'
   */
  mapToPermissionCode(module: string, action: string): string {
    let act = action.toLowerCase();
    // Acciones del frontend → verbos del backend
    if (act === 'agregar' || act === 'crear') act = 'create';
    if (act === 'modificar' || act === 'actualizar' || act === 'editar') act = 'update';
    if (act === 'activar_desactivar') act = 'update'; // El backend usa .update para el toggle de estado
    if (act === 'eliminar') act = 'delete';
    if (act === 'ver') act = 'read'; // El backend usa .read, no .view

    // Módulos del frontend → recursos del backend
    let mod = module.toLowerCase();
    if (mod === 'usuarios') mod = 'users';
    if (mod === 'hosts') mod = 'hosts';
    if (mod === 'cámaras' || mod === 'camaras') mod = 'cameras';
    if (mod === 'analíticas' || mod === 'analiticas') mod = 'analytics';
    if (mod === 'horarios') mod = 'schedules';
    if (mod === 'listas') mod = 'lists';
    if (mod === 'detalles listas' || mod === 'detalles_listas') mod = 'list_details';
    // Nota: 'eventos', 'dashboard' y 'configuración' no tienen permisos en el backend — son rutas públicas

    return `${mod}.${act}`;
  }

  hasPermission(module: string, action: string): boolean {
    const user = this.authService.currentUser();
    if (!user) return false;

    // ADMIN (roles.create es exclusivo de ADMIN) tiene acceso total
    if (this.activePermissionCodes().has('roles.create')) {
      return true;
    }

    const code = this.mapToPermissionCode(module, action);
    return this.activePermissionCodes().has(code);
  }

  getRoleById(rolId: string): Observable<BackendRol> {
    return this.http.get<BackendRol>(`${AppEnvironment.apiUrl}/frontend/roles/${rolId}`);
  }
}
