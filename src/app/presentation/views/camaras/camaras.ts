import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-camaras',
  imports: [RouterLink],
  templateUrl: './camaras.html',
  styleUrl: './camaras.css'
})
export class Camaras implements OnInit {
  private route = inject(ActivatedRoute);
  readonly hostId = signal<string | null>(null);

  ngOnInit(): void {
    this.hostId.set(this.route.snapshot.paramMap.get('hostId'));
  }
}
