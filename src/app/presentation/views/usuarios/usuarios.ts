import { Component, OnInit, OnDestroy, inject, signal, computed, HostListener, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { GetUsersUseCase } from '../../../core/domain/use-cases/get-users.use-case';
import { CreateUserUseCase } from '../../../core/domain/use-cases/create-user.use-case';
import { UpdateUserUseCase } from '../../../core/domain/use-cases/update-user.use-case';
import { UpdateUserPasswordUseCase } from '../../../core/domain/use-cases/update-user-password.use-case';
import { DeleteUserUseCase } from '../../../core/domain/use-cases/delete-user.use-case';
import { UserService } from '../../../core/services/user.service';
import { PermissionsService, BackendRol, BackendPermiso } from '../../../core/services/permissions.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { User } from '../../../core/domain/entities/user.entity';

@Component({
  selector: 'app-usuarios',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './usuarios.html',
  styleUrl: './usuarios.css',
})
export class Usuarios implements OnInit, OnDestroy {
  private getUsersUseCase = inject(GetUsersUseCase);
  private createUserUseCase = inject(CreateUserUseCase);
  private updateUserUseCase = inject(UpdateUserUseCase);
  private updateUserPasswordUseCase = inject(UpdateUserPasswordUseCase);
  private deleteUserUseCase = inject(DeleteUserUseCase);
  public userService = inject(UserService);
  public permissionsService = inject(PermissionsService);
  public sidebarService = inject(SidebarService);
  private fb = inject(FormBuilder);

  readonly users = this.userService.users;
  readonly isLoading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);

  // Tab navigation
  readonly activeTab = signal<'usuarios' | 'roles'>('usuarios');

  readonly isSidebarCollapsed = this.sidebarService.isCollapsed;
  readonly searchQuery = signal<string>('');
  readonly selectedRoleFilter = signal<string>('TODOS');
  readonly showFilters = signal<boolean>(false);
  readonly activeDropdown = signal<string | null>(null);

  // Roles disponibles cargados dinámicamente desde el backend
  readonly availableRoles = this.permissionsService.allRoles;

  // Estado de edición de permisos (tab Roles)
  readonly selectedRoleForEdit = signal<BackendRol | null>(null);
  readonly rolePermissionsEditing = signal<Set<string>>(new Set());
  readonly isSavingRole = signal<boolean>(false);

  // Agrupamiento y jerarquía de permisos
  readonly expandedGroups = signal<Set<string>>(new Set());

  private readonly resourceNames: Record<string, string> = {
    'users': 'Gestión de Usuarios',
    'roles': 'Gestión de Roles',
    'hosts': 'Gestión de Nodos / Servidores',
    'cameras': 'Gestión de Cámaras',
    'analytics': 'Gestión de Analíticas',
    'schedules': 'Gestión de Horarios',
    'lists': 'Listas de Control',
    'list_details': 'Sujetos en Listas de Control'
  };

  readonly groupedPermissions = computed(() => {
    const rawPermissions = this.permissionsService.availablePermissions();
    if (!rawPermissions || rawPermissions.length === 0) return [];

    const groupsMap = new Map<string, { read: any; others: any[] }>();

    rawPermissions.forEach(p => {
      const parts = p.codigo.split('.');
      const resource = parts[0];
      const action = parts[1];

      if (!groupsMap.has(resource)) {
        groupsMap.set(resource, { read: null, others: [] });
      }

      const group = groupsMap.get(resource)!;
      if (action === 'read') {
        group.read = p;
      } else {
        group.others.push(p);
      }
    });

    return Array.from(groupsMap.entries()).map(([resource, group]) => {
      const actionOrder = ['create', 'update', 'delete'];
      group.others.sort((a, b) => {
        const actionA = a.codigo.split('.')[1];
        const actionB = b.codigo.split('.')[1];
        return actionOrder.indexOf(actionA) - actionOrder.indexOf(actionB);
      });

      return {
        resource,
        displayName: this.resourceNames[resource] || resource,
        read: group.read,
        others: group.others
      };
    }).sort((a, b) => {
      const resourceOrder = ['hosts', 'cameras', 'analytics', 'schedules', 'lists', 'list_details', 'users', 'roles'];
      const idxA = resourceOrder.indexOf(a.resource);
      const idxB = resourceOrder.indexOf(b.resource);
      return idxA - idxB;
    });
  });

  constructor() {
    // Sincronizar matriz de permisos de la interfaz en tiempo real cuando allRoles cambia por WebSocket
    effect(() => {
      const selected = this.selectedRoleForEdit();
      if (!selected) return;

      const roles = this.permissionsService.allRoles();
      const updatedRole = roles.find(r => r.rol_id === selected.rol_id);
      if (updatedRole) {
        const currentSet = this.rolePermissionsEditing();
        const incomingSet = new Set(updatedRole.id_permisos);

        // Filtrar permisos virtualmente desactivados
        let disabledVirtuals: string[] = [];
        if (updatedRole.descripcion && updatedRole.descripcion.includes(' || disabled:')) {
          const parts = updatedRole.descripcion.split(' || disabled:');
          if (parts[1]) {
            disabledVirtuals = parts[1].split(',').map(s => s.trim().toLowerCase());
          }
        }

        const allPerms = this.permissionsService.availablePermissions();
        disabledVirtuals.forEach(code => {
          const match = allPerms.find(p => p.codigo.toLowerCase() === code);
          if (match) {
            incomingSet.delete(match.permiso_id);
          }
        });

        // Verificar si los conjuntos de permisos difieren
        let isDifferent = currentSet.size !== incomingSet.size;
        if (!isDifferent) {
          for (const item of incomingSet) {
            if (!currentSet.has(item)) {
              isDifferent = true;
              break;
            }
          }
        }

        if (isDifferent) {
          this.rolePermissionsEditing.set(incomingSet);
          this.selectedRoleForEdit.set(updatedRole);
        }
      }
    }, { allowSignalWrites: true });

    // Sincronizar pestaña activa en base a los permisos del usuario en tiempo real
    effect(() => {
      const hasUsersRead = this.permissionsService.hasPermission('Usuarios', 'ver');
      const hasRolesRead = this.permissionsService.hasPermission('Roles', 'ver');
      
      const currentTab = this.activeTab();
      if (currentTab === 'usuarios' && !hasUsersRead && hasRolesRead) {
        this.activeTab.set('roles');
      } else if (currentTab === 'roles' && !hasRolesRead && hasUsersRead) {
        this.activeTab.set('usuarios');
      }
    }, { allowSignalWrites: true });
  }

  toggleSidebar(): void {
    this.sidebarService.toggleSidebar();
  }

  toggleFiltersVisibility(event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
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
    this.showFilters.set(false);
  }

  setRoleFilter(role: string): void {
    this.selectedRoleFilter.set(role);
    this.activeDropdown.set(null);
  }

  setTab(tab: 'usuarios' | 'roles'): void {
    this.activeTab.set(tab);
    if (tab === 'roles' && this.availableRoles().length === 0) {
      this.permissionsService.loadAllRoles().subscribe();
    }
    if (tab === 'roles' && this.permissionsService.availablePermissions().length === 0) {
      this.permissionsService.loadAllPermissions().subscribe();
    }
  }

  readonly enrichedUsers = computed(() => {
    const roles = this.availableRoles();
    return this.users().map(u => {
      const matchingRol = roles.find(r => r.rol_id === u.roleId);
      return {
        ...u,
        role: matchingRol ? matchingRol.nombre.toUpperCase() : ''
      };
    });
  });

  readonly filteredUsers = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const role = this.selectedRoleFilter();
    const filtered = this.enrichedUsers().filter(u => {
      const matchesQuery = !query ||
        (u.name || '').toLowerCase().includes(query) ||
        (u.firstName || '').toLowerCase().includes(query) ||
        (u.lastName || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query);
      const matchesRole = role === 'TODOS' || u.role === role;
      return matchesQuery && matchesRole;
    });
    return [...filtered].sort((a, b) => {
      const roleCompare = (a.role || '').localeCompare(b.role || '');
      if (roleCompare !== 0) return roleCompare;
      return (a.name || '').localeCompare(b.name || '');
    });
  });

  getRoleStyle(role: string): Record<string, string> {
    const upper = (role || '').toUpperCase().trim();
    if (!upper) {
      return {
        '--role-color': '#64748b',
        '--role-bg': 'rgba(100, 116, 139, 0.12)',
        '--role-border': 'rgba(100, 116, 139, 0.2)'
      };
    }

    let hue = 210;
    let saturation = 65;
    let lightness = 50;

    if (upper === 'ADMIN') {
      hue = 211;
      saturation = 100;
      lightness = 50;
    } else if (upper === 'SUPERVISOR') {
      hue = 258;
      saturation = 90;
      lightness = 66;
    } else if (upper === 'OPERADOR') {
      hue = 158;
      saturation = 82;
      lightness = 47;
    } else {
      // Generación determinista para roles personalizados
      let hash = 0;
      for (let i = 0; i < upper.length; i++) {
        hash = upper.charCodeAt(i) + ((hash << 5) - hash);
      }
      hue = Math.abs(hash) % 360;
    }

    return {
      '--role-color': `hsl(${hue}, ${saturation}%, ${lightness}%)`,
      '--role-bg': `hsla(${hue}, ${saturation}%, ${lightness}%, 0.12)`,
      '--role-border': `hsla(${hue}, ${saturation}%, ${lightness}%, 0.2)`
    };
  }

  // Modal States
  readonly showRegisterModal = signal<boolean>(false);
  readonly showEditModal = signal<boolean>(false);
  readonly showPasswordModal = signal<boolean>(false);
  readonly showDeleteModal = signal<boolean>(false);
  readonly showCreateRoleModal = signal<boolean>(false);
  readonly selectedUser = signal<User | null>(null);
  readonly isSaving = signal<boolean>(false);
  readonly showDeleteRoleModal = signal<boolean>(false);
  readonly roleToDelete = signal<BackendRol | null>(null);
  readonly isDeletingRole = signal<boolean>(false);

  // Forms
  registerForm!: FormGroup;
  editForm!: FormGroup;
  passwordForm!: FormGroup;
  createRoleForm!: FormGroup;

  // Feedback Toast
  readonly toastMessage = signal<string | null>(null);
  readonly toastType = signal<'success' | 'error' | null>(null);
  private toastTimeoutId: any;

  ngOnInit(): void {
    this.userService.isViewActive.set(true);
    this.permissionsService.isViewActive.set(true);
    this.initForms();
    this.loadUsers();
    // Cargar roles y permisos para la UI dinámica
    if (this.availableRoles().length === 0) {
      this.permissionsService.loadAllRoles().subscribe();
    }
    if (this.permissionsService.availablePermissions().length === 0) {
      this.permissionsService.loadAllPermissions().subscribe();
    }
  }

  ngOnDestroy(): void {
    this.userService.isViewActive.set(false);
    this.permissionsService.isViewActive.set(false);
  }

  private initForms(): void {
    this.registerForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      nombres: ['', [Validators.required, Validators.minLength(2)]],
      apellidos: ['', [Validators.required, Validators.minLength(2)]],
      password: ['', [Validators.required, Validators.minLength(6)]],
      rol_id: ['', [Validators.required]]
    });

    this.editForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      nombres: ['', [Validators.required, Validators.minLength(2)]],
      apellidos: ['', [Validators.required, Validators.minLength(2)]],
      rol_id: ['', [Validators.required]]
    });

    this.passwordForm = this.fb.group({
      oldPassword: ['', [Validators.required]],
      newPassword: ['', [Validators.required, Validators.minLength(6)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordsMatchValidator });

    this.createRoleForm = this.fb.group({
      nombre: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9_]+$/)]],
      descripcion: ['', [Validators.required]]
    });
  }

  private passwordsMatchValidator(g: FormGroup) {
    const newPass = g.get('newPassword')?.value;
    const confirmPass = g.get('confirmPassword')?.value;
    return newPass === confirmPass ? null : { mismatch: true };
  }

  loadUsers(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.userService.loadUsers().subscribe({
      next: () => {
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error loading users:', err);
        this.errorMessage.set('No se pudieron cargar los usuarios.');
        this.isLoading.set(false);
      }
    });
  }

  // Register User Operations
  openRegisterModal(): void {
    // Default: último rol de la lista (típicamente el de menor privilegio)
    const defaultRolId = this.availableRoles().length > 0
      ? this.availableRoles()[this.availableRoles().length - 1].rol_id
      : '';
    this.registerForm.reset({ rol_id: defaultRolId });
    this.showRegisterModal.set(true);
  }

  closeRegisterModal(): void {
    this.showRegisterModal.set(false);
  }

  registerUser(): void {
    if (this.registerForm.invalid) {
      this.registerForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    const formVal = this.registerForm.value;

    // El use case espera un User con roleId (UUID del rol seleccionado)
    const newUser = {
      email: formVal.email,
      firstName: formVal.nombres,
      lastName: formVal.apellidos,
      name: `${formVal.nombres} ${formVal.apellidos}`.trim(),
      role: '', // El backend resolverá el nombre del rol
      roleId: formVal.rol_id,
      password: formVal.password,
      createdAt: new Date()
    };

    this.createUserUseCase.execute(newUser).subscribe({
      next: () => {
        this.showToast('Usuario registrado con éxito', 'success');
        this.closeRegisterModal();
        this.isSaving.set(false);
      },
      error: (err) => {
        console.error('Error registering user:', err);
        const detailMsg = err.error?.detail?.[0]?.msg || 'Error al registrar al nuevo usuario.';
        this.showToast(detailMsg, 'error');
        this.isSaving.set(false);
      }
    });
  }

  // Edit User Operations
  openEditModal(user: User): void {
    this.selectedUser.set(user);
    this.editForm.reset({
      email: user.email,
      nombres: user.firstName || '',
      apellidos: user.lastName || '',
      rol_id: user.roleId || ''
    });
    this.showEditModal.set(true);
  }

  closeEditModal(): void {
    this.showEditModal.set(false);
    this.selectedUser.set(null);
  }

  saveUser(): void {
    if (this.editForm.invalid || !this.selectedUser()) return;

    this.isSaving.set(true);
    const formVal = this.editForm.value;
    const updatedFields: Partial<User> = {
      email: formVal.email,
      firstName: formVal.nombres,
      lastName: formVal.apellidos,
      name: `${formVal.nombres} ${formVal.apellidos}`.trim(),
      roleId: formVal.rol_id,
      role: '' // El backend resolverá el nombre del rol
    };

    const userId = this.selectedUser()!.id;
    this.updateUserUseCase.execute(userId, updatedFields).subscribe({
      next: () => {
        this.showToast('Usuario actualizado con éxito', 'success');
        this.closeEditModal();
        this.isSaving.set(false);
      },
      error: (err) => {
        console.error('Error updating user:', err);
        this.showToast('Error al actualizar datos del usuario.', 'error');
        this.isSaving.set(false);
      }
    });
  }

  // Password Operations
  openPasswordModal(user: User): void {
    this.selectedUser.set(user);
    this.passwordForm.reset();
    this.showPasswordModal.set(true);
  }

  closePasswordModal(): void {
    this.showPasswordModal.set(false);
    this.selectedUser.set(null);
  }

  changePassword(): void {
    if (this.passwordForm.invalid || !this.selectedUser()) return;

    this.isSaving.set(true);
    const formVal = this.passwordForm.value;
    const userId = this.selectedUser()!.id;

    this.updateUserPasswordUseCase.execute(userId, formVal.oldPassword, formVal.newPassword).subscribe({
      next: () => {
        this.showToast('Contraseña cambiada con éxito', 'success');
        this.closePasswordModal();
        this.isSaving.set(false);
      },
      error: (err) => {
        console.error('Error changing password:', err);
        const detailMsg = err.error?.detail?.[0]?.msg || 'La contraseña actual es incorrecta.';
        this.showToast(detailMsg, 'error');
        this.isSaving.set(false);
      }
    });
  }

  // Delete User Operations
  openDeleteModal(user: User): void {
    this.selectedUser.set(user);
    this.showDeleteModal.set(true);
  }

  closeDeleteModal(): void {
    this.showDeleteModal.set(false);
    this.selectedUser.set(null);
  }

  deleteUser(): void {
    const userToDelete = this.selectedUser();
    if (!userToDelete) return;

    this.isSaving.set(true);
    this.deleteUserUseCase.execute(userToDelete.id).subscribe({
      next: () => {
        this.showToast('Usuario eliminado con éxito', 'success');
        this.closeDeleteModal();
        this.isSaving.set(false);
      },
      error: (err) => {
        console.error('Error deleting user:', err);
        this.showToast('No se pudo eliminar al usuario.', 'error');
        this.isSaving.set(false);
      }
    });
  }

  // Delete Role Operations
  openDeleteRoleModal(rol: BackendRol, event: Event): void {
    event.stopPropagation();
    this.roleToDelete.set(rol);
    this.showDeleteRoleModal.set(true);
  }

  closeDeleteRoleModal(): void {
    this.showDeleteRoleModal.set(false);
    this.roleToDelete.set(null);
  }

  deleteRoleSubmit(): void {
    const rol = this.roleToDelete();
    if (!rol) return;

    this.isDeletingRole.set(true);
    this.permissionsService.deleteRole(rol.rol_id).subscribe({
      next: () => {
        this.showToast('Rol eliminado con éxito', 'success');
        this.closeDeleteRoleModal();
        this.isDeletingRole.set(false);
        // Limpiar selección si el rol eliminado era el seleccionado para editar
        if (this.selectedRoleForEdit()?.rol_id === rol.rol_id) {
          this.clearRoleSelection();
        }
      },
      error: (err) => {
        console.error('Error deleting role:', err);
        const errMsg = err.error?.detail || 'No se pudo eliminar el rol.';
        this.showToast(errMsg, 'error');
        this.isDeletingRole.set(false);
      }
    });
  }

  // ============================================================
  // Gestión de permisos de roles (tab Roles)
  // ============================================================

  selectRoleForEdit(rol: BackendRol): void {
    this.selectedRoleForEdit.set(rol);
    
    const currentSet = new Set(rol.id_permisos);
    let disabledVirtuals: string[] = [];
    if (rol.descripcion && rol.descripcion.includes(' || disabled:')) {
      const parts = rol.descripcion.split(' || disabled:');
      if (parts[1]) {
        disabledVirtuals = parts[1].split(',').map(s => s.trim().toLowerCase());
      }
    }

    const allPerms = this.permissionsService.availablePermissions();
    disabledVirtuals.forEach(code => {
      const match = allPerms.find(p => p.codigo.toLowerCase() === code);
      if (match) {
        currentSet.delete(match.permiso_id);
      }
    });

    this.rolePermissionsEditing.set(currentSet);
  }

  isSystemRole(roleName: string): boolean {
    if (!roleName) return false;
    return ['ADMIN', 'SUPERVISOR', 'OPERADOR'].includes(roleName.trim().toUpperCase());
  }
 
  getActivePermissionsCount(rol: BackendRol): number {
    const rawPerms = rol.id_permisos;
    if (!rawPerms || rawPerms.length === 0) return 0;
 
    let disabledVirtuals: string[] = [];
    if (rol.descripcion && rol.descripcion.includes(' || disabled:')) {
      const parts = rol.descripcion.split(' || disabled:');
      if (parts[1]) {
        disabledVirtuals = parts[1].split(',').map(s => s.trim().toLowerCase());
      }
    }
 
    const allPerms = this.permissionsService.availablePermissions();
    let count = 0;
    rawPerms.forEach(pId => {
      const match = allPerms.find(p => p.permiso_id === pId);
      if (match && match.codigo) {
        if (!disabledVirtuals.includes(match.codigo.toLowerCase())) {
          count++;
        }
      }
    });
    return count;
  }

  clearRoleSelection(): void {
    this.selectedRoleForEdit.set(null);
    this.rolePermissionsEditing.set(new Set());
    this.expandedGroups.set(new Set());
  }

  isGroupExpanded(resource: string): boolean {
    return this.expandedGroups().has(resource);
  }

  toggleGroupExpansion(resource: string): void {
    this.expandedGroups.update(s => {
      const next = new Set(s);
      if (next.has(resource)) {
        next.delete(resource);
      } else {
        next.add(resource);
      }
      return next;
    });
  }

  isPermissionSelected(permisoId: string): boolean {
    return this.rolePermissionsEditing().has(permisoId);
  }

  isListsReadActive(): boolean {
    const listsReadPerm = this.permissionsService.availablePermissions().find(p => p.codigo === 'lists.read');
    return listsReadPerm ? this.rolePermissionsEditing().has(listsReadPerm.permiso_id) : false;
  }
 
  isCamerasReadActive(): boolean {
    const camerasReadPerm = this.permissionsService.availablePermissions().find(p => p.codigo === 'cameras.read');
    return camerasReadPerm ? this.rolePermissionsEditing().has(camerasReadPerm.permiso_id) : false;
  }

  togglePermissionForRole(permisoId: string, isReadPermission: boolean = false, resourcePrefix?: string): void {
    const rol = this.selectedRoleForEdit();
    if (!rol || this.isSystemRole(rol.nombre)) return;

    // Calcular el nuevo conjunto de permisos
    const currentPermisos = new Set(this.rolePermissionsEditing());
    const isAdding = !currentPermisos.has(permisoId);

    if (isAdding) {
      currentPermisos.add(permisoId);
      // Si activamos el permiso de lectura, expandir automáticamente el grupo
      if (isReadPermission && resourcePrefix) {
        this.expandedGroups.update(s => {
          const next = new Set(s);
          next.add(resourcePrefix);
          return next;
        });
      }
    } else {
      currentPermisos.delete(permisoId);

      // Si se desactiva el permiso de consulta (read), se desactivan en cascada todos los demás
      if (isReadPermission && resourcePrefix) {
        const rawPermissions = this.permissionsService.availablePermissions();
        rawPermissions.forEach(p => {
          if (p.codigo.startsWith(resourcePrefix + '.')) {
            currentPermisos.delete(p.permiso_id);
          }
        });

        // Regla de negocio especial: si se desactiva listas.read, también se desactiva list_details en cascada
        if (resourcePrefix === 'lists') {
          rawPermissions.forEach(p => {
            if (p.codigo.startsWith('list_details.')) {
              currentPermisos.delete(p.permiso_id);
            }
          });
          // También colapsar list_details en la UI
          this.expandedGroups.update(s => {
            const next = new Set(s);
            next.delete('list_details');
            return next;
          });
        }
 
        // Regla de negocio especial: si se desactiva cameras.read, también se desactiva analytics en cascada
        if (resourcePrefix === 'cameras') {
          rawPermissions.forEach(p => {
            if (p.codigo.startsWith('analytics.')) {
              currentPermisos.delete(p.permiso_id);
            }
          });
          // También colapsar analytics en la UI
          this.expandedGroups.update(s => {
            const next = new Set(s);
            next.delete('analytics');
            return next;
          });
        }

        // Colapsar el panel en la UI
        this.expandedGroups.update(s => {
          const next = new Set(s);
          next.delete(resourcePrefix);
          return next;
        });
      }
    }
    // Actualizar el estado local de forma optimista
    this.rolePermissionsEditing.set(currentPermisos);

    // Obtener la descripción limpia (sin metadata de virtuals)
    let cleanDesc = rol.descripcion || '';
    if (cleanDesc.includes(' || disabled:')) {
      cleanDesc = cleanDesc.split(' || disabled:')[0];
    }

    const allPerms = this.permissionsService.availablePermissions();
    const usersReadPerm = allPerms.find(p => p.codigo.toLowerCase() === 'users.read');
    const rolesReadPerm = allPerms.find(p => p.codigo.toLowerCase() === 'roles.read');

    const disabledVirtuals: string[] = [];
    const physicalPermisos = new Set(currentPermisos);

    if (usersReadPerm) {
      if (!currentPermisos.has(usersReadPerm.permiso_id)) {
        disabledVirtuals.push('users.read');
      }
      physicalPermisos.add(usersReadPerm.permiso_id);
    }
    if (rolesReadPerm) {
      if (!currentPermisos.has(rolesReadPerm.permiso_id)) {
        disabledVirtuals.push('roles.read');
      }
      physicalPermisos.add(rolesReadPerm.permiso_id);
    }

    const finalDesc = disabledVirtuals.length > 0
      ? `${cleanDesc} || disabled:${disabledVirtuals.join(',')}`
      : cleanDesc;

    const physicalPermisosList = Array.from(physicalPermisos);

    // Guardar en el backend inmediatamente en tiempo real
    this.permissionsService.updateRolePermissions(
      rol.rol_id,
      rol.nombre,
      finalDesc,
      physicalPermisosList
    ).subscribe({
      next: () => {
        this.showToast('Permisos actualizados con éxito', 'success');
        this.isSavingRole.set(false);
      },
      error: (err) => {
        console.error('Error updating role permission in real-time:', err);
        this.showToast('Error al actualizar el permiso.', 'error');
        // Revertir el estado local en caso de error
        this.selectRoleForEdit(rol);
      }
    });
  }

  onHeaderClick(group: any): void {
    const rol = this.selectedRoleForEdit();
    if (!rol) return;
    if (group.resource === 'list_details' && !this.isListsReadActive()) return;
    if (group.resource === 'analytics' && !this.isCamerasReadActive()) return;
    this.toggleGroupExpansion(group.resource);
  }

  getResourceIcon(resource: string): string {
    const icons: Record<string, string> = {
      'users': 'icon-usuarios',
      'roles': 'icon-usuarios',
      'hosts': 'icon-nodos',
      'cameras': 'icon-camara',
      'analytics': 'icon-camara',
      'schedules': 'icon-horarios',
      'lists': 'icon-listas',
      'list_details': 'icon-listas'
    };
    return icons[resource] || 'icon-usuarios';
  }

  getResourceColor(resource: string): string {
    const colors: Record<string, string> = {
      'users': '#0d6efd',
      'roles': '#4f46e5',
      'hosts': '#10b981',
      'cameras': '#8b5cf6',
      'analytics': '#d946ef',
      'schedules': '#f59e0b',
      'lists': '#ec4899',
      'list_details': '#f43f5e'
    };
    return colors[resource] || '#64748b';
  }

  openCreateRoleModal(): void {
    this.createRoleForm.reset({
      nombre: '',
      descripcion: ''
    });
    this.showCreateRoleModal.set(true);
  }

  closeCreateRoleModal(): void {
    this.showCreateRoleModal.set(false);
  }

  createRoleSubmit(): void {
    if (this.createRoleForm.invalid) return;

    this.isSaving.set(true);
    const { nombre, descripcion } = this.createRoleForm.value;
    const permissions: string[] = [];

    // Agregar físicamente los permisos requeridos para inicializar sin bloqueos 403
    const allPerms = this.permissionsService.availablePermissions();
    const usersReadPerm = allPerms.find(p => p.codigo.toLowerCase() === 'users.read');
    const rolesReadPerm = allPerms.find(p => p.codigo.toLowerCase() === 'roles.read');
    if (usersReadPerm) permissions.push(usersReadPerm.permiso_id);
    if (rolesReadPerm) permissions.push(rolesReadPerm.permiso_id);

    this.permissionsService.createRole(nombre, descripcion, permissions).subscribe({
      next: () => {
        this.showToast('Rol creado con éxito', 'success');
        this.closeCreateRoleModal();
        this.isSaving.set(false);
      },
      error: (err) => {
        console.error('Error creating role:', err);
        this.showToast('Error al crear el rol.', 'error');
        this.isSaving.set(false);
      }
    });
  }

  // Helpers
  onSearchChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.searchQuery.set(input.value);
  }

  private showToast(msg: string, type: 'success' | 'error'): void {
    if (this.toastTimeoutId) {
      clearTimeout(this.toastTimeoutId);
    }
    this.toastMessage.set(msg);
    this.toastType.set(type);
    this.toastTimeoutId = setTimeout(() => {
      this.toastMessage.set(null);
      this.toastType.set(null);
    }, 4000);
  }
}
