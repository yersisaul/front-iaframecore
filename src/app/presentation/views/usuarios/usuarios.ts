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
    return this.enrichedUsers().filter(u => {
      const matchesQuery = !query ||
        (u.name || '').toLowerCase().includes(query) ||
        (u.firstName || '').toLowerCase().includes(query) ||
        (u.lastName || '').toLowerCase().includes(query) ||
        (u.email || '').toLowerCase().includes(query);
      const matchesRole = role === 'TODOS' || u.role === role;
      return matchesQuery && matchesRole;
    });
  });

  getRoleBadgeClass(role: string): string {
    const upper = (role || '').toUpperCase();
    if (upper === 'ADMIN') return 'role-admin';
    if (upper === 'SUPERVISOR') return 'role-supervisor';
    if (upper === 'OPERADOR') return 'role-operador';
    return 'role-default';
  }

  /**
   * Devuelve la clase CSS para la card de usuario según el nombre del rol.
   */
  getRoleCardClass(role: string): string {
    const upper = (role || '').toUpperCase();
    if (upper === 'ADMIN') return 'admin-card';
    if (upper === 'SUPERVISOR') return 'supervisor-card';
    if (upper === 'OPERADOR') return 'operador-card';
    return '';
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
        this.loadUsers();
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
        this.loadUsers();
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
        this.loadUsers();
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
        this.permissionsService.loadAllRoles().subscribe();
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
    this.rolePermissionsEditing.set(new Set(rol.id_permisos));
  }

  isSystemRole(roleName: string): boolean {
    if (!roleName) return false;
    return ['ADMIN', 'SUPERVISOR', 'OPERADOR'].includes(roleName.trim().toUpperCase());
  }

  clearRoleSelection(): void {
    this.selectedRoleForEdit.set(null);
    this.rolePermissionsEditing.set(new Set());
  }

  isPermissionSelected(permisoId: string): boolean {
    return this.rolePermissionsEditing().has(permisoId);
  }

  togglePermissionForRole(permisoId: string): void {
    const rol = this.selectedRoleForEdit();
    if (!rol || this.isSystemRole(rol.nombre)) return;

    // Calcular el nuevo conjunto de permisos
    const currentPermisos = new Set(this.rolePermissionsEditing());
    if (currentPermisos.has(permisoId)) {
      currentPermisos.delete(permisoId);
    } else {
      currentPermisos.add(permisoId);
    }
    const newPermisos = Array.from(currentPermisos);

    // Actualizar el estado local de forma optimista
    this.rolePermissionsEditing.set(currentPermisos);

    // Guardar en el backend inmediatamente en tiempo real
    this.permissionsService.updateRolePermissions(
      rol.rol_id,
      rol.nombre,
      rol.descripcion,
      newPermisos
    ).subscribe({
      next: () => {
        this.showToast(`Permiso actualizado con éxito`, 'success');
        // Recargar la lista global de roles para sincronizar estados
        this.permissionsService.loadAllRoles().subscribe();
      },
      error: (err) => {
        console.error('Error updating role permission in real-time:', err);
        this.showToast('Error al actualizar el permiso.', 'error');
        // Revertir el estado local optimista ante un error de red
        this.rolePermissionsEditing.update(current => {
          const reverted = new Set(current);
          if (reverted.has(permisoId)) {
            reverted.delete(permisoId);
          } else {
            reverted.add(permisoId);
          }
          return reverted;
        });
      }
    });
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

    this.permissionsService.createRole(nombre, descripcion, permissions).subscribe({
      next: () => {
        this.showToast('Rol creado con éxito', 'success');
        this.closeCreateRoleModal();
        this.isSaving.set(false);
        this.permissionsService.loadAllRoles().subscribe();
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
