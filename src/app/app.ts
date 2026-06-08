import { Component, signal } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';

import { Roles } from './roles/roles';
import { Usuarios } from './usuarios/usuarios';
import { Login } from './login/login';
import { Nodos } from './nodos/nodos';
import { Horarios } from './horarios/horarios';
import { Metadatos } from './metadatos/metadatos';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, Nodos, Login, Roles, Usuarios, Metadatos],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('iaframecore');
}
