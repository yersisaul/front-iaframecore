import { Routes } from '@angular/router';

import { Login } from './login/login';
import { DashboardLayout } from './layouts/dashboard-layout/dashboard-layout';
import { Roles } from './roles/roles';
import { Usuarios } from './usuarios/usuarios';
import { Nodos } from './nodos/nodos';
import { Horarios } from './horarios/horarios';
import { Metadatos } from './metadatos/metadatos';

export const routes: Routes = [
    { path: '', redirectTo: '/login', pathMatch: 'full' }, // Redirige a login por defecto
    { path: 'login', component: Login },
    {
        path: 'dashboard', // Ruta protegida para el dashboard
        component: DashboardLayout,
        children: [
            { path: 'roles', component: Roles },
            { path: 'usuarios', component: Usuarios },
            { path: 'nodos', component: Nodos },
            { path: 'horarios', component: Horarios },
            { path: 'metadatos', component: Metadatos }
        ]
    },
    { path: '**', redirectTo: '/login' } // Redirige a login para cualquier ruta no definida
];
