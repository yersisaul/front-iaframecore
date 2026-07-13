import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { vi } from 'vitest';

import { Usuarios } from './usuarios';
import { IUserRepository } from '../../../core/domain/repositories/user.repository';
import { UserService } from '../../../core/services/user.service';
import { PermissionsService } from '../../../core/services/permissions.service';
import { SidebarService } from '../../../core/services/sidebar.service';
import { User } from '../../../core/domain/entities/user.entity';
import { BackendRol, BackendPermiso } from '../../../core/services/permissions.service';

describe('Usuarios', () => {
  let component: Usuarios;
  let fixture: ComponentFixture<Usuarios>;
  let mockUserRepository: any;
  let mockPermissionsService: any;
  let mockSidebarService: any;

  const mockUsersList: User[] = [
    {
      id: 'e4b10fa0-7988-466d-a111-c917b2b73bc5',
      email: 'admin@iaframecore.com',
      name: 'Administrador del Sistema',
      firstName: 'Administrador',
      lastName: 'del Sistema',
      role: 'ADMIN',
      roleId: '73bd9b9e-53da-4901-8bd8-9a127081e61b',
      createdAt: new Date('2026-01-01T08:00:00Z')
    },
    {
      id: '67a7a5cc-98a9-4672-9cc9-5b7d0a68d712',
      email: 'supervisor@iaframecore.com',
      name: 'Supervisor de Turno',
      firstName: 'Supervisor',
      lastName: 'de Turno',
      role: 'SUPERVISOR',
      roleId: 'd597024c-7362-4d41-a96b-a9321b8a0d77',
      createdAt: new Date('2026-02-15T12:30:00Z')
    }
  ];

  const mockRoles: BackendRol[] = [
    {
      rol_id: '73bd9b9e-53da-4901-8bd8-9a127081e61b',
      nombre: 'ADMIN',
      descripcion: 'Acceso total al sistema',
      id_permisos: ['c3d434da-69ad-4ac1-a62f-ea197bfb4e44', '49085747-3dae-43bd-bde7-a78fb9ed5700']
    },
    {
      rol_id: 'custom-role-id',
      nombre: 'INVITADO',
      descripcion: 'Rol de prueba no sistema',
      id_permisos: ['49085747-3dae-43bd-bde7-a78fb9ed5700']
    },
    {
      rol_id: 'd597024c-7362-4d41-a96b-a9321b8a0d77',
      nombre: 'SUPERVISOR',
      descripcion: 'Gestión operativa',
      id_permisos: ['49085747-3dae-43bd-bde7-a78fb9ed5700']
    },
    {
      rol_id: 'e2fc9bc1-ab14-4cd4-8b16-492a2a5e8aec',
      nombre: 'OPERADOR',
      descripcion: 'Solo visualización',
      id_permisos: ['49085747-3dae-43bd-bde7-a78fb9ed5700']
    }
  ];

  const mockPermisos: BackendPermiso[] = [
    { permiso_id: 'c3d434da-69ad-4ac1-a62f-ea197bfb4e44', codigo: 'roles.create', descripcion: 'Crear roles' },
    { permiso_id: '49085747-3dae-43bd-bde7-a78fb9ed5700', codigo: 'users.read', descripcion: 'Consultar usuarios' }
  ];

  let mockUserService: any;

  beforeEach(async () => {
    mockUserRepository = {
      getAll: () => of(mockUsersList),
      getById: (id: string) => of(mockUsersList[0]),
      create: (user: Omit<User, 'id'>) => of({ id: 'new-id', ...user } as User),
      update: (id: string, user: Partial<User>) => of({ id, ...user } as User),
      updatePassword: (userId: string, old: string, newPass: string) => of({ id: userId } as User),
      delete: (id: string) => of(undefined)
    };

    mockUserService = {
      users: signal<User[]>(mockUsersList),
      isLoading: signal(false),
      isViewActive: signal(false),
      newRecordIds: signal(new Set<string>()),
      updatedRecordIds: signal(new Set<string>()),
      deletingRecordIds: signal(new Set<string>()),
      loadUsers: () => of(mockUsersList)
    };

    mockPermissionsService = {
      allRoles: signal<BackendRol[]>(mockRoles),
      availablePermissions: signal<BackendPermiso[]>(mockPermisos),
      activePermissionCodes: signal<Set<string>>(new Set(['roles.create', 'users.read', 'users.create', 'users.update', 'users.delete'])),
      isViewActive: signal(false),
      newRoleIds: signal(new Set<string>()),
      updatedRoleIds: signal(new Set<string>()),
      deletingRoleIds: signal(new Set<string>()),
      hasPermission: (module: string, action: string) => true,
      loadAllRoles: () => of(undefined),
      loadAllPermissions: () => of(undefined),
      updateRolePermissions: (rolId: string, nombre: string, desc: string, perms: string[]) => of(undefined)
    };

    mockSidebarService = {
      isCollapsed: signal(false),
      toggleSidebar: () => {}
    };

    await TestBed.configureTestingModule({
      imports: [Usuarios],
      providers: [
        provideRouter([]),
        { provide: IUserRepository, useValue: mockUserRepository },
        { provide: UserService, useValue: mockUserService },
        { provide: PermissionsService, useValue: mockPermissionsService },
        { provide: SidebarService, useValue: mockSidebarService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Usuarios);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load and set users list on initialization', () => {
    expect(component.users().length).toBe(2);
    expect(component.users()[0].email).toBe('admin@iaframecore.com');
  });

  it('should open register modal with default role (last available)', () => {
    component.openRegisterModal();
    expect(component.showRegisterModal()).toBe(true);
    // Default should be last role in the list (OPERADOR)
    expect(component.registerForm.value.rol_id).toBe('e2fc9bc1-ab14-4cd4-8b16-492a2a5e8aec');
  });

  it('should register user successfully with roleId and reload users list', () => {
    component.openRegisterModal();
    const createSpy = vi.spyOn(mockUserRepository, 'create');
    const loadSpy = vi.spyOn(component, 'loadUsers');

    component.registerForm.setValue({
      email: 'new-user@iaframecore.com',
      nombres: 'Nuevo',
      apellidos: 'Usuario',
      password: 'newpassword123',
      rol_id: 'e2fc9bc1-ab14-4cd4-8b16-492a2a5e8aec'
    });

    component.registerUser();

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      email: 'new-user@iaframecore.com',
      firstName: 'Nuevo',
      lastName: 'Usuario',
      name: 'Nuevo Usuario',
      roleId: 'e2fc9bc1-ab14-4cd4-8b16-492a2a5e8aec',
    }));
    expect(component.showRegisterModal()).toBe(false);
    expect(loadSpy).toHaveBeenCalled();
  });

  it('should open edit modal with correct form values including roleId', () => {
    const userToEdit = mockUsersList[0];
    component.openEditModal(userToEdit);

    expect(component.showEditModal()).toBe(true);
    expect(component.selectedUser()).toEqual(userToEdit);
    expect(component.editForm.value).toEqual({
      email: userToEdit.email,
      nombres: userToEdit.firstName,
      apellidos: userToEdit.lastName,
      rol_id: userToEdit.roleId
    });
  });

  it('should save user updates with roleId and reload users list', () => {
    const userToEdit = mockUsersList[0];
    component.openEditModal(userToEdit);

    mockUserRepository.update = () => of({ ...userToEdit, name: 'Administrador Modificado' });
    const updateSpy = vi.spyOn(mockUserRepository, 'update');
    const loadSpy = vi.spyOn(component, 'loadUsers');

    component.editForm.setValue({
      email: 'admin-mod@iaframecore.com',
      nombres: 'Administrador',
      apellidos: 'Modificado',
      rol_id: '73bd9b9e-53da-4901-8bd8-9a127081e61b'
    });

    component.saveUser();

    expect(updateSpy).toHaveBeenCalledWith(userToEdit.id, expect.objectContaining({
      email: 'admin-mod@iaframecore.com',
      firstName: 'Administrador',
      lastName: 'Modificado',
      name: 'Administrador Modificado',
      roleId: '73bd9b9e-53da-4901-8bd8-9a127081e61b'
    }));
    expect(component.showEditModal()).toBe(false);
    expect(loadSpy).toHaveBeenCalled();
  });

  it('should change password successfully', () => {
    const user = mockUsersList[0];
    component.openPasswordModal(user);

    const changePasswordSpy = vi.spyOn(mockUserRepository, 'updatePassword');

    component.passwordForm.setValue({
      oldPassword: 'current-password',
      newPassword: 'new-secure-password',
      confirmPassword: 'new-secure-password'
    });

    component.changePassword();

    expect(changePasswordSpy).toHaveBeenCalledWith(user.id, 'current-password', 'new-secure-password');
    expect(component.showPasswordModal()).toBe(false);
  });

  it('should delete user and reload user list', () => {
    const user = mockUsersList[0];
    component.openDeleteModal(user);

    const deleteSpy = vi.spyOn(mockUserRepository, 'delete');
    const loadSpy = vi.spyOn(component, 'loadUsers');

    component.deleteUser();

    expect(deleteSpy).toHaveBeenCalledWith(user.id);
    expect(component.showDeleteModal()).toBe(false);
    expect(loadSpy).toHaveBeenCalled();
  });

  it('should toggle sidebar', () => {
    const toggleSpy = vi.spyOn(mockSidebarService, 'toggleSidebar');
    component.toggleSidebar();
    expect(toggleSpy).toHaveBeenCalled();
  });

  it('should filter users by search query', () => {
    component.searchQuery.set('Supervisor');
    expect(component.filteredUsers().length).toBe(1);
    expect(component.filteredUsers()[0].email).toBe('supervisor@iaframecore.com');

    component.searchQuery.set('nonexistent');
    expect(component.filteredUsers().length).toBe(0);
  });

  it('should filter users by role name', () => {
    component.selectedRoleFilter.set('SUPERVISOR');
    expect(component.filteredUsers().length).toBe(1);
    expect(component.filteredUsers()[0].email).toBe('supervisor@iaframecore.com');

    component.selectedRoleFilter.set('ADMIN');
    expect(component.filteredUsers().length).toBe(1);
    expect(component.filteredUsers()[0].email).toBe('admin@iaframecore.com');

    component.selectedRoleFilter.set('TODOS');
    expect(component.filteredUsers().length).toBe(2);
  });

  it('should toggle filters visibility', () => {
    expect(component.showFilters()).toBe(false);
    component.toggleFiltersVisibility();
    expect(component.showFilters()).toBe(true);
  });

  it('should set role filter and close dropdown', () => {
    component.activeDropdown.set('rol');
    component.setRoleFilter('ADMIN');
    expect(component.selectedRoleFilter()).toBe('ADMIN');
    expect(component.activeDropdown()).toBeNull();
  });

  it('should set active tab', () => {
    expect(component.activeTab()).toBe('usuarios');
    component.setTab('roles');
    expect(component.activeTab()).toBe('roles');
  });

  it('should return correct style properties for roles', () => {
    const adminStyle = component.getRoleStyle('ADMIN');
    expect(adminStyle['--role-color']).toContain('211');

    const supervisorStyle = component.getRoleStyle('SUPERVISOR');
    expect(supervisorStyle['--role-color']).toContain('258');

    const customStyle = component.getRoleStyle('INVITADO');
    expect(customStyle['--role-color']).toBeDefined();
  });

  it('should select role for editing and set editing permissions', () => {
    const rolToEdit = mockRoles[1]; // SUPERVISOR
    component.selectRoleForEdit(rolToEdit);
    expect(component.selectedRoleForEdit()).toEqual(rolToEdit);
    expect(component.isPermissionSelected('49085747-3dae-43bd-bde7-a78fb9ed5700')).toBe(true);
    expect(component.isPermissionSelected('c3d434da-69ad-4ac1-a62f-ea197bfb4e44')).toBe(false);
  });

  it('should toggle permissions for role editing and save in real-time', () => {
    component.selectRoleForEdit(mockRoles[1]); // INVITADO (rol editable)
    const updateSpy = vi.spyOn(mockPermissionsService, 'updateRolePermissions');
    const loadRolesSpy = vi.spyOn(mockPermissionsService, 'loadAllRoles');

    component.togglePermissionForRole('c3d434da-69ad-4ac1-a62f-ea197bfb4e44');

    expect(updateSpy).toHaveBeenCalledWith(
      mockRoles[1].rol_id,
      mockRoles[1].nombre,
      mockRoles[1].descripcion,
      expect.arrayContaining(['c3d434da-69ad-4ac1-a62f-ea197bfb4e44'])
    );
    expect(component.isPermissionSelected('c3d434da-69ad-4ac1-a62f-ea197bfb4e44')).toBe(true);
    expect(loadRolesSpy).toHaveBeenCalled();
  });
});
