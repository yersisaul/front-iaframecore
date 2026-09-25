import { Routes } from '@angular/router';
import { authGuard } from './presentation/guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: '/dashboard', pathMatch: 'full' },
    { 
        path: 'login', 
        loadComponent: () => import('./presentation/views/login/login').then(m => m.Login) 
    },
    {
        path: 'dashboard',
        loadComponent: () => import('./presentation/layouts/dashboard-layout/dashboard-layout').then(m => m.DashboardLayout),
        canActivate: [authGuard],
        canActivateChild: [authGuard],
        children: [
            { path: '', redirectTo: 'nodos', pathMatch: 'full' },
            { 
                path: 'dashboards', 
                loadComponent: () => import('./presentation/views/dashboard/dashboard').then(m => m.Dashboard), 
                data: { permissions: ['dashboard.read'] } 
            },
            { 
                path: 'usuarios', 
                loadComponent: () => import('./presentation/views/usuarios/usuarios').then(m => m.Usuarios), 
                data: { permissions: ['users.read', 'roles.read'], anyPermission: true } 
            },
            { 
                path: 'nodos', 
                loadComponent: () => import('./presentation/views/nodos/nodos').then(m => m.Nodos), 
                data: { permissions: ['hosts.read'] } 
            },
            { 
                path: 'nodos/:hostId/camaras', 
                loadComponent: () => import('./presentation/views/camaras/camaras').then(m => m.Camaras), 
                data: { permissions: ['cameras.read'] } 
            },
            { 
                path: 'camaras', 
                loadComponent: () => import('./presentation/views/camaras/camaras').then(m => m.Camaras), 
                data: { permissions: ['cameras.read'] } 
            },
            { 
                path: 'horarios', 
                loadComponent: () => import('./presentation/views/horarios/horarios').then(m => m.Horarios), 
                data: { permissions: ['schedules.read'] } 
            },
            { path: 'metadatos', redirectTo: 'metadatos/personas', pathMatch: 'full' },
            { 
                path: 'metadatos/:indexName', 
                loadComponent: () => import('./presentation/views/metadatos/metadatos').then(m => m.Metadatos) 
            },
            { path: 'listas', redirectTo: 'listas/rostros', pathMatch: 'full' },
            { 
                path: 'listas/:listType', 
                loadComponent: () => import('./presentation/views/listas/listas').then(m => m.Listas), 
                data: { permissions: ['lists.read'] } 
            },
            { 
                path: 'eventos', 
                loadComponent: () => import('./presentation/views/eventos/eventos').then(m => m.Eventos) 
            },
            { 
                path: 'monitoreo', 
                loadComponent: () => import('./presentation/views/monitoreo/monitoreo').then(m => m.Monitoreo) 
            }
        ]
    },
    { path: '**', redirectTo: '/dashboard' }
];
