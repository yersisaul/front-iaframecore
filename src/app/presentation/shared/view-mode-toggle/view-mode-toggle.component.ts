import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-view-mode-toggle',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './view-mode-toggle.component.html',
  styleUrl: './view-mode-toggle.component.css'
})
export class ViewModeToggleComponent {
  @Input() viewMode: 'cards' | 'list' = 'cards';
  @Output() viewModeChange = new EventEmitter<'cards' | 'list'>();

  setMode(mode: 'cards' | 'list'): void {
    if (this.viewMode !== mode) {
      this.viewMode = mode;
      this.viewModeChange.emit(mode);
    }
  }
}
