import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-empty-state',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './empty-state.component.html',
  styleUrl: './empty-state.component.css'
})
export class EmptyStateComponent {
  @Input() title: string = 'No se encontraron resultados';
  @Input() description: string = 'Intenta ajustar los términos de búsqueda o restablecer los filtros para ver más resultados.';
  @Input() iconClass: string = 'icon-search';
  @Input() actionText: string = 'Restablecer Filtros';
  @Input() showAction: boolean = true;

  @Output() action = new EventEmitter<void>();

  onAction(): void {
    this.action.emit();
  }
}
