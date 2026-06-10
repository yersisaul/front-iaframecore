import { Routes } from '@angular/router';

import { Login } from './presentation/views/login/login';
import { DashboardLayout } from './presentation/layouts/dashboard-layout/dashboard-layout';
import { Roles } from './presentation/views/roles/roles';
import { Usuarios } from './presentation/views/usuarios/usuarios';
import { Nodos } from './presentation/views/nodos/nodos';
import { Horarios } from './presentation/views/horarios/horarios';
import { Metadatos } from './presentation/views/metadatos/metadatos';
import { Camaras } from './presentation/views/camaras/camaras';
import { authGuard } from './presentation/guards/auth.guard';
import { AppRole } from './core/domain/entities/role.enum';

export const routes: Routes = [
    { path: '', redirectTo: '/login', pathMatch: 'full' }, // Redirige a login por defecto
    { path: 'login', component: Login },
    {
        path: 'dashboard', // Ruta protegida para el dashboard
        component: DashboardLayout,
        canActivate: [authGuard],
        canActivateChild: [authGuard], // Valida roles en rutas hijas al navegar directamente
        children: [
            { path: '', redirectTo: 'nodos', pathMatch: 'full' }, // Redirección por defecto
            { path: 'roles', component: Roles, data: { roles: [AppRole.ADMIN] } },
            { path: 'usuarios', component: Usuarios, data: { roles: [AppRole.ADMIN] } },
            { path: 'nodos', component: Nodos },
            { path: 'nodos/:hostId/camaras', component: Camaras },
            { path: 'horarios', component: Horarios },
            { path: 'metadatos', component: Metadatos }
        ]
    },
    { path: '**', redirectTo: '/login' } // Redirige a login para cualquier ruta no definida
];

