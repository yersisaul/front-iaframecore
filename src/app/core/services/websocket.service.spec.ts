import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { WebsocketService } from './websocket.service';
import { WebsocketConnectionService } from './websocket-connection.service';
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

describe('WebsocketService Handlers', () => {
  let service: WebsocketService;
  
  // Spies / Mocks
  let authServiceSpy: any;
  let metadataServiceSpy: any;
  let eventServiceSpy: any;
  let cameraServiceSpy: any;
  let analyticServiceSpy: any;
  let scheduleServiceSpy: any;
  let listServiceSpy: any;
  let userServiceSpy: any;
  let hostServiceSpy: any;
  let permissionsServiceSpy: any;
  let metadataRepoSpy: any;
  let eventRepoSpy: any;
  let userRepoSpy: any;
  let scheduleRepoSpy: any;
  let listRepoSpy: any;
  let websocketConnectionServiceSpy: any;

  beforeEach(() => {
    vi.useFakeTimers();

    authServiceSpy = {
      currentUser: vi.fn().mockReturnValue({ email: 'admin@test.com' })
    };

    metadataServiceSpy = {
      activeIndex: vi.fn().mockReturnValue('personas'),
      records: { update: vi.fn() },
      totalRecords: { update: vi.fn() },
      pageSize: vi.fn().mockReturnValue(24),
      markAsNew: vi.fn(),
      incrementIndexCount: vi.fn(),
      filters: vi.fn().mockReturnValue({ imageSearchUrl: null, imageEmbedding: null })
    };

    eventServiceSpy = {
      records: { update: vi.fn() },
      totalRecords: { update: vi.fn() },
      pageSize: vi.fn().mockReturnValue(24),
      markAsNew: vi.fn(),
      addNewEvent: vi.fn()
    };

    cameraServiceSpy = {
      cameras: vi.fn().mockReturnValue([]),
      activeHostFingerprint: vi.fn().mockReturnValue('host-123'),
      getCamerasByHost: vi.fn().mockReturnValue(of([])),
      updateCameraStatusLocal: vi.fn(),
      deleteCameraLocal: vi.fn(),
      isViewActive: vi.fn().mockReturnValue(true),
      markAsNew: vi.fn(),
      markAsUpdated: vi.fn(),
      markAsDeleting: vi.fn(),
      markAsStatusActive: vi.fn(),
      markAsStatusInactive: vi.fn(),
      migrateHostLocal: vi.fn()
    };

    analyticServiceSpy = {
      analytics: vi.fn().mockReturnValue([]),
      activeHostFingerprint: vi.fn().mockReturnValue('host-123'),
      getAnalyticsByHost: vi.fn().mockReturnValue(of([])),
      updateAnalyticStatusLocal: vi.fn(),
      deleteAnalyticLocal: vi.fn(),
      isViewActive: vi.fn().mockReturnValue(true),
      markAsNew: vi.fn(),
      markAsUpdated: vi.fn(),
      markAsDeleting: vi.fn(),
      markAsStatusActive: vi.fn(),
      markAsStatusInactive: vi.fn(),
      migrateHostLocal: vi.fn()
    };

    scheduleServiceSpy = {
      schedules: vi.fn().mockReturnValue([]),
      getAllSchedules: vi.fn().mockReturnValue(of([])),
      updateScheduleStatusLocal: vi.fn(),
      deleteScheduleLocal: vi.fn(),
      addOrUpdateScheduleLocal: vi.fn(),
      isViewActive: vi.fn().mockReturnValue(true),
      markAsNew: vi.fn(),
      markAsUpdated: vi.fn(),
      markAsDeleting: vi.fn(),
      markAsStatusActive: vi.fn(),
      markAsStatusInactive: vi.fn(),
      migrateHostLocal: vi.fn()
    };

    listServiceSpy = {
      lists: vi.fn().mockReturnValue([]),
      listDetails: vi.fn().mockReturnValue([]),
      activeListId: vi.fn().mockReturnValue('list-999'),
      loadLists: vi.fn().mockReturnValue(of([])),
      loadListDetails: vi.fn().mockReturnValue(of([])),
      deleteListLocal: vi.fn(),
      deleteSubjectLocal: vi.fn(),
      addOrUpdateListLocal: vi.fn(),
      addOrUpdateListDetailLocal: vi.fn(),
      isViewActive: vi.fn().mockReturnValue(true),
      markAsNew: vi.fn(),
      markAsUpdated: vi.fn(),
      markAsDeleting: vi.fn()
    };

    permissionsServiceSpy = {
      isViewActive: vi.fn().mockReturnValue(true),
      allRoles: { update: vi.fn() },
      newRoleIds: vi.fn().mockReturnValue(new Set()),
      updatedRoleIds: vi.fn().mockReturnValue(new Set()),
      deletingRoleIds: vi.fn().mockReturnValue(new Set()),
      markAsNewRole: vi.fn(),
      markAsUpdatedRole: vi.fn(),
      markAsDeletingRole: vi.fn(),
      deleteRoleLocal: vi.fn(),
      addOrUpdateRoleLocal: vi.fn(),
      getRoleById: vi.fn().mockReturnValue(of({ rol_id: 'role-new', nombre: 'NEW_ROLE', descripcion: 'test' })),
      loadAllRoles: vi.fn().mockReturnValue(of(undefined)),
      loadUserPermissions: vi.fn().mockReturnValue(of(undefined))
    };

    userServiceSpy = {
      isViewActive: vi.fn().mockReturnValue(true),
      newRecordIds: vi.fn().mockReturnValue(new Set()),
      updatedRecordIds: vi.fn().mockReturnValue(new Set()),
      deletingRecordIds: vi.fn().mockReturnValue(new Set()),
      addUserLocal: vi.fn(),
      updateUserLocal: vi.fn(),
      deleteUserLocal: vi.fn(),
      markAsNew: vi.fn(),
      markAsUpdated: vi.fn(),
      markAsDeleting: vi.fn()
    };

    hostServiceSpy = {
      isViewActive: vi.fn().mockReturnValue(true),
      newHostIds: vi.fn().mockReturnValue(new Set()),
      updatedHostIds: vi.fn().mockReturnValue(new Set()),
      deletingHostIds: vi.fn().mockReturnValue(new Set()),
      migrateHostLocal: vi.fn(),
      deleteHostLocal: vi.fn(),
      markAsNewHost: vi.fn(),
      markAsUpdatedHost: vi.fn(),
      markAsDeletingHost: vi.fn()
    };

    userRepoSpy = {
      getById: vi.fn().mockReturnValue(of({ id: 'u111', roleId: 'role-new' }))
    };

    scheduleRepoSpy = {
      getById: vi.fn().mockReturnValue(of({ id: 's111', name: 'Sched 1', hostFingerprint: 'h1' }))
    };

    listRepoSpy = {
      getListById: vi.fn().mockReturnValue(of({ list_id: 'l111', name: 'List 1' })),
      getListDetailById: vi.fn().mockReturnValue(of({ detail_id: 'd111', list_id: 'l111', nombre_asociado: 'Name' }))
    };

    metadataRepoSpy = {
      getById: vi.fn().mockReturnValue(of({ id: 'm123' }))
    };

    eventRepoSpy = {
      getById: vi.fn().mockReturnValue(of({ id: 'e456' }))
    };

    websocketConnectionServiceSpy = {
      messages$: new Subject<any>()
    };

    TestBed.configureTestingModule({
      providers: [
        WebsocketService,
        { provide: WebsocketConnectionService, useValue: websocketConnectionServiceSpy },
        { provide: AuthService, useValue: authServiceSpy },
        { provide: MetadataService, useValue: metadataServiceSpy },
        { provide: EventService, useValue: eventServiceSpy },
        { provide: CameraService, useValue: cameraServiceSpy },
        { provide: AnalyticService, useValue: analyticServiceSpy },
        { provide: ScheduleService, useValue: scheduleServiceSpy },
        { provide: ListService, useValue: listServiceSpy },
        { provide: UserService, useValue: userServiceSpy },
        { provide: HostService, useValue: hostServiceSpy },
        { provide: PermissionsService, useValue: permissionsServiceSpy },
        { provide: IMetadataRepository, useValue: metadataRepoSpy },
        { provide: IEventRepository, useValue: eventRepoSpy },
        { provide: IUserRepository, useValue: userRepoSpy },
        { provide: IScheduleRepository, useValue: scheduleRepoSpy },
        { provide: IListRepository, useValue: listRepoSpy }
      ]
    });

    service = TestBed.inject(WebsocketService);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should process "nuevo_metadato" and update local collections & sidebars if active', () => {
    const payload = {
      action: 'nuevo_metadato',
      body: { indice: 'personas', doc_id: 'm123' }
    };

    (service as any).handleMessage(payload);

    expect(metadataServiceSpy.incrementIndexCount).toHaveBeenCalledWith('personas');
    expect(metadataRepoSpy.getById).toHaveBeenCalledWith('personas', 'm123');
  });

  it('should increment metadata count but NOT fetch details if index is inactive', () => {
    metadataServiceSpy.activeIndex.mockReturnValue('vehiculos');
    
    const payload = {
      action: 'nuevo_metadato',
      body: { indice: 'personas', doc_id: 'm123' }
    };

    (service as any).handleMessage(payload);

    expect(metadataServiceSpy.incrementIndexCount).toHaveBeenCalledWith('personas');
    expect(metadataRepoSpy.getById).not.toHaveBeenCalled();
  });

  it('should process "nuevo_evento" and request detailed event from repository', () => {
    const payload = {
      action: 'nuevo_evento',
      body: { doc_id: 'e456' }
    };

    (service as any).handleMessage(payload);

    expect(eventRepoSpy.getById).toHaveBeenCalledWith('e456');
  });

  it('should process "camera_created" and "camera_updated" by triggering a list refresh if active', () => {
    const payload = {
      action: 'camera_created',
      body: { camera_id: 'cam-xyz' }
    };

    (service as any).handleMessage(payload);

    expect(cameraServiceSpy.activeHostFingerprint).toHaveBeenCalled();
    expect(cameraServiceSpy.getCamerasByHost).toHaveBeenCalledWith('host-123');
  });

  it('should ignore "camera_created" if camera view is inactive', () => {
    cameraServiceSpy.isViewActive.mockReturnValue(false);

    const payload = {
      action: 'camera_created',
      body: { camera_id: 'cam-xyz' }
    };

    (service as any).handleMessage(payload);

    expect(cameraServiceSpy.getCamerasByHost).toHaveBeenCalledWith('host-123');
    expect(cameraServiceSpy.markAsNew).not.toHaveBeenCalled();
  });

  it('should process "camera_deleted" strictly in memory with zero network requests if active', () => {
    const payload = {
      action: 'camera_deleted',
      body: { camera_id: 'cam-xyz' }
    };

    (service as any).handleMessage(payload);

    expect(cameraServiceSpy.markAsDeleting).toHaveBeenCalledWith('cam-xyz');
    
    // Fast-forward timers
    vi.runAllTimers();
    expect(cameraServiceSpy.deleteCameraLocal).toHaveBeenCalledWith('cam-xyz');
    expect(cameraServiceSpy.getCamerasByHost).not.toHaveBeenCalled();
  });

  it('should ignore "camera_deleted" if view is inactive', () => {
    cameraServiceSpy.isViewActive.mockReturnValue(false);

    const payload = {
      action: 'camera_deleted',
      body: { camera_id: 'cam-xyz' }
    };

    (service as any).handleMessage(payload);

    expect(cameraServiceSpy.markAsDeleting).not.toHaveBeenCalled();
    expect(cameraServiceSpy.deleteCameraLocal).toHaveBeenCalledWith('cam-xyz');
  });

  it('should process "camera_status" and trigger status update & change flash if active', () => {
    const payload = {
      action: 'camera_status',
      body: { camera_id: 'cam-xyz', estado: 'online' }
    };

    (service as any).handleMessage(payload);

    expect(cameraServiceSpy.updateCameraStatusLocal).toHaveBeenCalledWith('cam-xyz', 'online');
    expect(cameraServiceSpy.markAsStatusActive).toHaveBeenCalledWith('cam-xyz');
    expect(cameraServiceSpy.getCamerasByHost).not.toHaveBeenCalled();
  });

  it('should process "analytic_created" and "analytic_updated" by triggering a list refresh if active', () => {
    const payload = {
      action: 'analytic_updated',
      body: { analytic_id: 'an-789' }
    };

    (service as any).handleMessage(payload);

    expect(analyticServiceSpy.activeHostFingerprint).toHaveBeenCalled();
    expect(analyticServiceSpy.getAnalyticsByHost).toHaveBeenCalledWith('host-123');
  });

  it('should ignore "analytic_updated" if analytic view is inactive', () => {
    analyticServiceSpy.isViewActive.mockReturnValue(false);

    const payload = {
      action: 'analytic_updated',
      body: { analytic_id: 'an-789' }
    };

    (service as any).handleMessage(payload);

    expect(analyticServiceSpy.getAnalyticsByHost).toHaveBeenCalledWith('host-123');
    expect(analyticServiceSpy.markAsUpdated).not.toHaveBeenCalled();
  });

  it('should process "analytic_deleted" strictly in memory with zero network requests if active', () => {
    const payload = {
      action: 'analytic_deleted',
      body: { analytic_id: 'an-789' }
    };

    (service as any).handleMessage(payload);

    expect(analyticServiceSpy.markAsDeleting).toHaveBeenCalledWith('an-789');
    
    vi.runAllTimers();
    expect(analyticServiceSpy.deleteAnalyticLocal).toHaveBeenCalledWith('an-789');
    expect(analyticServiceSpy.getAnalyticsByHost).not.toHaveBeenCalled();
  });

  it('should process "analytic_status" and flash status update if active', () => {
    const payload = {
      action: 'analytic_status',
      body: { analytic_id: 'an-789', status: 'active' }
    };

    (service as any).handleMessage(payload);

    expect(analyticServiceSpy.updateAnalyticStatusLocal).toHaveBeenCalledWith('an-789', 'active');
    expect(analyticServiceSpy.markAsStatusActive).toHaveBeenCalledWith('an-789');
  });

  it('should process "schedule_created" and "schedule_updated" by fetching individual schedule if active', () => {
    const payload = {
      action: 'schedule_created',
      body: { schedule_id: 'sch-555' }
    };

    const mockSchedule = { id: 'sch-555', name: 'New Sched', hostFingerprint: 'host-123' };
    scheduleRepoSpy.getById.mockReturnValue(of(mockSchedule));

    (service as any).handleMessage(payload);

    expect(scheduleRepoSpy.getById).toHaveBeenCalledWith('sch-555');
    expect(scheduleServiceSpy.addOrUpdateScheduleLocal).toHaveBeenCalledWith(mockSchedule);
    expect(scheduleServiceSpy.markAsNew).toHaveBeenCalledWith('sch-555');
  });

  it('should ignore visual updates of "schedule_created" if schedule view is inactive', () => {
    scheduleServiceSpy.isViewActive.mockReturnValue(false);

    const payload = {
      action: 'schedule_created',
      body: { schedule_id: 'sch-555' }
    };

    const mockSchedule = { id: 'sch-555', name: 'New Sched', hostFingerprint: 'host-123' };
    scheduleRepoSpy.getById.mockReturnValue(of(mockSchedule));

    (service as any).handleMessage(payload);

    expect(scheduleRepoSpy.getById).toHaveBeenCalledWith('sch-555');
    expect(scheduleServiceSpy.addOrUpdateScheduleLocal).toHaveBeenCalledWith(mockSchedule);
    expect(scheduleServiceSpy.markAsNew).not.toHaveBeenCalled();
  });

  it('should process "schedule_deleted" strictly in memory with zero network requests if active', () => {
    const payload = {
      action: 'schedule_deleted',
      body: { schedule_id: 'sch-555' }
    };

    (service as any).handleMessage(payload);

    expect(scheduleServiceSpy.markAsDeleting).toHaveBeenCalledWith('sch-555');
    
    vi.runAllTimers();
    expect(scheduleServiceSpy.deleteScheduleLocal).toHaveBeenCalledWith('sch-555');
  });

  it('should process "schedule_status" and flash update if active', () => {
    const payload = {
      action: 'schedule_status',
      body: { schedule_id: 'sch-555', status: 'activo' }
    };

    (service as any).handleMessage(payload);

    expect(scheduleServiceSpy.updateScheduleStatusLocal).toHaveBeenCalledWith('sch-555', 'activo');
    expect(scheduleServiceSpy.markAsStatusActive).toHaveBeenCalledWith('sch-555');
  });

  it('should process "list_created" and "list_updated" by fetching individual list if active', () => {
    const payload = {
      action: 'list_created',
      body: { list_id: 'lst-111' }
    };

    const mockList = { list_id: 'lst-111', name: 'New List' };
    listRepoSpy.getListById.mockReturnValue(of(mockList));

    (service as any).handleMessage(payload);

    expect(listRepoSpy.getListById).toHaveBeenCalledWith('lst-111');
    expect(listServiceSpy.addOrUpdateListLocal).toHaveBeenCalledWith(mockList);
    expect(listServiceSpy.markAsNew).toHaveBeenCalledWith('lst-111');
  });

  it('should ignore visual updates of "list_created" if list view is inactive', () => {
    listServiceSpy.isViewActive.mockReturnValue(false);

    const payload = {
      action: 'list_created',
      body: { list_id: 'lst-111' }
    };

    const mockList = { list_id: 'lst-111', name: 'New List' };
    listRepoSpy.getListById.mockReturnValue(of(mockList));

    (service as any).handleMessage(payload);

    expect(listRepoSpy.getListById).toHaveBeenCalledWith('lst-111');
    expect(listServiceSpy.addOrUpdateListLocal).toHaveBeenCalledWith(mockList);
    expect(listServiceSpy.markAsNew).not.toHaveBeenCalled();
  });

  it('should process "list_deleted" strictly in memory with zero network requests if active', () => {
    const payload = {
      action: 'list_deleted',
      body: { list_id: 'lst-111' }
    };

    (service as any).handleMessage(payload);

    expect(listServiceSpy.markAsDeleting).toHaveBeenCalledWith('lst-111');
    
    vi.runAllTimers();
    expect(listServiceSpy.deleteListLocal).toHaveBeenCalledWith('lst-111');
  });
  it('should process "list_detail_created" / "list_detail_updated" by fetching individual detail and syncing active list detail state', () => {
    const payload = {
      action: 'list_detail_created',
      body: { detail_id: 'det-222' }
    };

    const mockDetail = { detail_id: 'det-222', list_id: 'list-999', nombre_asociado: 'Test' };
    listRepoSpy.getListDetailById.mockReturnValue(of(mockDetail));

    (service as any).handleMessage(payload);

    expect(listRepoSpy.getListDetailById).toHaveBeenCalledWith('det-222');
    expect(listServiceSpy.addOrUpdateListDetailLocal).toHaveBeenCalledWith(mockDetail);
    expect(listServiceSpy.markAsNew).toHaveBeenCalledWith('det-222');
  });

  it('should ignore visual updates of "list_detail_created" if view is inactive', () => {
    listServiceSpy.isViewActive.mockReturnValue(false);

    const payload = {
      action: 'list_detail_created',
      body: { detail_id: 'det-222' }
    };

    const mockDetail = { detail_id: 'det-222', list_id: 'list-999', nombre_asociado: 'Test' };
    listRepoSpy.getListDetailById.mockReturnValue(of(mockDetail));

    (service as any).handleMessage(payload);

    expect(listRepoSpy.getListDetailById).toHaveBeenCalledWith('det-222');
    expect(listServiceSpy.addOrUpdateListDetailLocal).toHaveBeenCalledWith(mockDetail);
    expect(listServiceSpy.markAsNew).not.toHaveBeenCalled();
  });

  it('should process "list_detail_deleted" strictly in memory with zero network requests if active', () => {
    const payload = {
      action: 'list_detail_deleted',
      body: { detail_id: 'det-222' }
    };

    (service as any).handleMessage(payload);

    expect(listServiceSpy.markAsDeleting).toHaveBeenCalledWith('det-222');
    
    vi.runAllTimers();
    expect(listServiceSpy.deleteSubjectLocal).toHaveBeenCalledWith('det-222');
  });

  it('should ignore "nuevo_metadato" document fetch if KNN search is active', () => {
    metadataServiceSpy.activeIndex.mockReturnValue('personas');
    metadataServiceSpy.filters.mockReturnValue({ imageSearchUrl: 'some-image-url', imageEmbedding: null });
    
    const payload = {
      action: 'nuevo_metadato',
      body: { indice: 'personas', doc_id: 'm123' }
    };

    (service as any).handleMessage(payload);

    expect(metadataServiceSpy.incrementIndexCount).toHaveBeenCalledWith('personas');
    expect(metadataRepoSpy.getById).not.toHaveBeenCalled();
  });

  it('should process "user_updated" and sync permissions if user matches', () => {
    authServiceSpy.currentUser.mockReturnValue({ id: 'u111', roleId: 'role-old' });
    userRepoSpy.getById.mockReturnValue(of({ id: 'u111', roleId: 'role-new' }));

    const payload = {
      action: 'user_updated',
      body: { user_id: 'u111' }
    };

    (service as any).handleMessage(payload);

    expect(userRepoSpy.getById).toHaveBeenCalledWith('u111');
    expect(userServiceSpy.updateUserLocal).toHaveBeenCalledWith('u111', expect.any(Object));
    expect(permissionsServiceSpy.loadUserPermissions).toHaveBeenCalledWith('role-new');
  });

  it('should process "role_updated" and sync permissions if role matches', () => {
    authServiceSpy.currentUser.mockReturnValue({ id: 'u111', roleId: 'role-match' });
    const mockRole = { rol_id: 'role-match', nombre: 'ROLE_MATCH', id_permisos: [] };
    permissionsServiceSpy.getRoleById.mockReturnValue(of(mockRole));

    const payload = {
      action: 'role_updated',
      body: { rol_id: 'role-match' }
    };

    (service as any).handleMessage(payload);

    expect(permissionsServiceSpy.getRoleById).toHaveBeenCalledWith('role-match');
    expect(permissionsServiceSpy.addOrUpdateRoleLocal).toHaveBeenCalledWith(mockRole);
    expect(permissionsServiceSpy.loadUserPermissions).toHaveBeenCalledWith('role-match');
  });

  it('should process "user_created" in real time without lists refreshes', () => {
    userRepoSpy.getById.mockReturnValue(of({ id: 'u222', roleId: 'role-x' }));

    const payload = {
      action: 'user_created',
      body: { user_id: 'u222' }
    };

    (service as any).handleMessage(payload);

    expect(userRepoSpy.getById).toHaveBeenCalledWith('u222');
    expect(userServiceSpy.addUserLocal).toHaveBeenCalled();
    expect(userServiceSpy.markAsNew).toHaveBeenCalledWith('u222');
  });

  it('should process "role_created" and add to roles list in memory', () => {
    const mockRole = { rol_id: 'r555', nombre: 'R555', id_permisos: [] };
    permissionsServiceSpy.getRoleById.mockReturnValue(of(mockRole));

    const payload = {
      action: 'role_created',
      body: { rol_id: 'r555' }
    };

    (service as any).handleMessage(payload);

    expect(permissionsServiceSpy.getRoleById).toHaveBeenCalledWith('r555');
    expect(permissionsServiceSpy.addOrUpdateRoleLocal).toHaveBeenCalledWith(mockRole);
    expect(permissionsServiceSpy.markAsNewRole).toHaveBeenCalledWith('r555');
  });

  it('should process "host_migrated" instantly in memory if active view fingerprint is not source host', () => {
    cameraServiceSpy.activeHostFingerprint.mockReturnValue('other-host');
    const payload = {
      action: 'host_migrated',
      body: { old_fingerprint: 'fp-old', new_fingerprint: 'fp-new' }
    };

    (service as any).handleMessage(payload);

    expect(hostServiceSpy.migrateHostLocal).toHaveBeenCalledWith('fp-old', 'fp-new');
    expect(cameraServiceSpy.migrateHostLocal).toHaveBeenCalledWith('fp-old', 'fp-new');
    expect(analyticServiceSpy.migrateHostLocal).toHaveBeenCalledWith('fp-old', 'fp-new');
    expect(scheduleServiceSpy.migrateHostLocal).toHaveBeenCalledWith('fp-old', 'fp-new');
    expect(hostServiceSpy.markAsUpdatedHost).toHaveBeenCalledWith('fp-new');
  });

  it('should delay local "host_migrated" migration if active view fingerprint is source host to allow exit animation', () => {
    cameraServiceSpy.activeHostFingerprint.mockReturnValue('fp-old');
    cameraServiceSpy.cameras.mockReturnValue([{ id: 'c1', hostFingerprint: 'fp-old' }]);
    analyticServiceSpy.analytics.mockReturnValue([{ id: 'a1', hostFingerprint: 'fp-old' }]);

    const payload = {
      action: 'host_migrated',
      body: { old_fingerprint: 'fp-old', new_fingerprint: 'fp-new' }
    };

    (service as any).handleMessage(payload);

    // Should mark as deleting first
    expect(cameraServiceSpy.markAsDeleting).toHaveBeenCalledWith('c1');
    expect(analyticServiceSpy.markAsDeleting).toHaveBeenCalledWith('a1');

    // Should NOT have run migration methods yet
    expect(hostServiceSpy.migrateHostLocal).not.toHaveBeenCalled();

    // Fast-forward timers
    vi.runAllTimers();

    // Now should run migration methods
    expect(hostServiceSpy.migrateHostLocal).toHaveBeenCalledWith('fp-old', 'fp-new');
    expect(cameraServiceSpy.migrateHostLocal).toHaveBeenCalledWith('fp-old', 'fp-new');
    expect(analyticServiceSpy.migrateHostLocal).toHaveBeenCalledWith('fp-old', 'fp-new');
    expect(scheduleServiceSpy.migrateHostLocal).toHaveBeenCalledWith('fp-old', 'fp-new');
    expect(hostServiceSpy.markAsUpdatedHost).toHaveBeenCalledWith('fp-new');
  });

  it('should trigger animated refresh of destination host elements on "host_migrated" if destination host is active', () => {
    cameraServiceSpy.activeHostFingerprint.mockReturnValue('fp-new');

    const payload = {
      action: 'host_migrated',
      body: { old_fingerprint: 'fp-old', new_fingerprint: 'fp-new' }
    };

    (service as any).handleMessage(payload);

    expect(cameraServiceSpy.getCamerasByHost).toHaveBeenCalledWith('fp-new', true);
    expect(analyticServiceSpy.getAnalyticsByHost).toHaveBeenCalledWith('fp-new', true);
    expect(scheduleServiceSpy.getAllSchedules).toHaveBeenCalled();
  });

  it('should process "host_deleted" using transitions in memory', () => {
    const payload = {
      action: 'host_deleted',
      body: { fingerprint: 'fp-del' }
    };

    (service as any).handleMessage(payload);

    expect(hostServiceSpy.markAsDeletingHost).toHaveBeenCalledWith('fp-del');
    vi.runAllTimers();
    expect(hostServiceSpy.deleteHostLocal).toHaveBeenCalledWith('fp-del');
  });
});
