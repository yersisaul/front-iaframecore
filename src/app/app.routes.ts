import { Routes } from '@angular/router';

import { Login } from './presentation/views/login/login';
import { DashboardLayout } from './presentation/layouts/dashboard-layout/dashboard-layout';
import { Usuarios } from './presentation/views/usuarios/usuarios';
import { Nodos } from './presentation/views/nodos/nodos';
import { Horarios } from './presentation/views/horarios/horarios';
import { Metadatos } from './presentation/views/metadatos/metadatos';
import { Camaras } from './presentation/views/camaras/camaras';
import { Listas } from './presentation/views/listas/listas';
import { Eventos } from './presentation/views/eventos/eventos';
import { Monitoreo } from './presentation/views/monitoreo/monitoreo';
import { authGuard } from './presentation/guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: '/dashboard', pathMatch: 'full' }, // Redirige a dashboard por defecto
    { path: 'login', component: Login },
    {
        path: 'dashboard', // Ruta protegida para el dashboard
        component: DashboardLayout,
        canActivate: [authGuard],
        canActivateChild: [authGuard], // Valida permisos en rutas hijas al navegar directamente
        children: [
            { path: '', redirectTo: 'nodos', pathMatch: 'full' }, // Redirección por defecto
            { path: 'usuarios', component: Usuarios, data: { permissions: ['users.read', 'roles.read'], anyPermission: true } },
            { path: 'nodos', component: Nodos, data: { permissions: ['hosts.read'] } },
            { path: 'nodos/:hostId/camaras', component: Camaras, data: { permissions: ['cameras.read'] } },
            { path: 'camaras', component: Camaras, data: { permissions: ['cameras.read'] } },
            { path: 'horarios', component: Horarios, data: { permissions: ['schedules.read'] } },
            { path: 'metadatos', redirectTo: 'metadatos/personas', pathMatch: 'full' },
            { path: 'metadatos/:indexName', component: Metadatos },
            { path: 'listas', redirectTo: 'listas/rostros', pathMatch: 'full' },
            { path: 'listas/:listType', component: Listas, data: { permissions: ['lists.read'] } },
            { path: 'eventos', component: Eventos },
            { path: 'monitoreo', component: Monitoreo }
        ]
    },
    { path: '**', redirectTo: '/dashboard' } // Redirige a dashboard para cualquier ruta no definida
];
