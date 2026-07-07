import { Routes } from '@angular/router';

import { Login } from './presentation/views/login/login';
import { DashboardLayout } from './presentation/layouts/dashboard-layout/dashboard-layout';
import { Usuarios } from './presentation/views/usuarios/usuarios';
import { Nodos } from './presentation/views/nodos/nodos';
import { Horarios } from './presentation/views/horarios/horarios';
import { Metadatos } from './presentation/views/metadatos/metadatos';
import { Camaras } from './presentation/views/camaras/camaras';
import { TodasCamaras } from './presentation/views/todas-camaras/todas-camaras';
import { Listas } from './presentation/views/listas/listas';
import { Eventos } from './presentation/views/eventos/eventos';
import { authGuard } from './presentation/guards/auth.guard';

export const routes: Routes = [
    { path: '', redirectTo: '/login', pathMatch: 'full' }, // Redirige a login por defecto
    { path: 'login', component: Login },
    {
        path: 'dashboard', // Ruta protegida para el dashboard
        component: DashboardLayout,
        canActivate: [authGuard],
        canActivateChild: [authGuard], // Valida permisos en rutas hijas al navegar directamente
        children: [
            { path: '', redirectTo: 'nodos', pathMatch: 'full' }, // Redirección por defecto
            // Protegida por permiso: cualquier rol con users.read puede acceder, no solo ADMIN
            { path: 'usuarios', component: Usuarios, data: { permissions: ['users.read'] } },
            { path: 'nodos', component: Nodos },
            { path: 'nodos/:hostId/camaras', component: Camaras },
            { path: 'camaras', component: TodasCamaras },
            { path: 'horarios', component: Horarios },
            { path: 'metadatos', redirectTo: 'metadatos/personas', pathMatch: 'full' },
            { path: 'metadatos/:indexName', component: Metadatos },
            { path: 'listas', redirectTo: 'listas/rostros', pathMatch: 'full' },
            { path: 'listas/:listType', component: Listas },
            { path: 'eventos', component: Eventos }
        ]
    },
    { path: '**', redirectTo: '/login' } // Redirige a login para cualquier ruta no definida
];
