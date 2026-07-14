import { Component, signal, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WebsocketService } from './core/services/websocket.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private websocketService = inject(WebsocketService);
  protected readonly title = signal('iaframecore');
}
