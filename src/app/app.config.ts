import { ApplicationConfig, APP_INITIALIZER, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors, withXsrfConfiguration } from '@angular/common/http';

import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';
import { AuthService } from './core/services/auth.service';

// Repositories
import { IUserRepository } from './core/domain/repositories/user.repository';
import { UserHttpRepository } from './data/repositories/user-http.repository';
import { IMetadataRepository } from './core/domain/repositories/metadata.repository';
import { OpenSearchRepository } from './data/repositories/opensearch.repository';
import { IHostRepository } from './core/domain/repositories/host.repository';
import { HostHttpRepository } from './data/repositories/host-http.repository';
import { ICameraRepository } from './core/domain/repositories/camera.repository';
import { CameraHttpRepository } from './data/repositories/camera-http.repository';
import { IScheduleRepository } from './core/domain/repositories/schedule.repository';
import { ScheduleHttpRepository } from './data/repositories/schedule-http.repository';
import { IAuthRepository } from './core/domain/repositories/auth.repository';
import { AuthHttpRepository } from './data/repositories/auth-http.repository';
import { IAnalyticRepository } from './core/domain/repositories/analytic.repository';
import { AnalyticHttpRepository } from './data/repositories/analytic-http.repository';
import { IStorageRepository } from './core/domain/repositories/storage.repository';
import { StorageHttpRepository } from './data/repositories/storage-http.repository';
import { IListRepository } from './core/domain/repositories/list.repository';
import { ListHttpRepository } from './data/repositories/list-http.repository';
import { IEventRepository } from './core/domain/repositories/event.repository';
import { EventHttpRepository } from './data/repositories/event-http.repository';

export function initializeApp(authService: AuthService) {
  return () => authService.checkSession();
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(
      withInterceptors([authInterceptor, errorInterceptor]),
      withXsrfConfiguration({
        cookieName: 'XSRF-TOKEN',
        headerName: 'X-XSRF-TOKEN'
      })
    ),
    {
      provide: APP_INITIALIZER,
      useFactory: initializeApp,
      deps: [AuthService],
      multi: true
    },
    { provide: IUserRepository, useClass: UserHttpRepository },
    { provide: IMetadataRepository, useClass: OpenSearchRepository },
    { provide: IHostRepository, useClass: HostHttpRepository },
    { provide: ICameraRepository, useClass: CameraHttpRepository },
    { provide: IScheduleRepository, useClass: ScheduleHttpRepository },
    { provide: IAuthRepository, useClass: AuthHttpRepository },
    { provide: IAnalyticRepository, useClass: AnalyticHttpRepository },
    { provide: IStorageRepository, useClass: StorageHttpRepository },
    { provide: IListRepository, useClass: ListHttpRepository },
    { provide: IEventRepository, useClass: EventHttpRepository }
  ]
};

