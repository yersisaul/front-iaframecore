import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-filter-actions',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './filter-actions.component.html',
  styleUrl: './filter-actions.component.css'
})
export class FilterActionsComponent {
  @Input() hasActiveFilters: boolean = false;
  @Input() hasPendingChanges: boolean = false;
  @Input() resetLabel: string = 'Limpiar Filtros';
  @Input() applyLabel: string = 'Aplicar Filtros';

  @Output() reset = new EventEmitter<void>();
  @Output() apply = new EventEmitter<void>();
}
