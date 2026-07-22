import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-confirm-delete-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './confirm-delete-modal.component.html',
  styleUrl: './confirm-delete-modal.component.css'
})
export class ConfirmDeleteModalComponent {
  @Input() show: boolean = false;
  @Input() title: string = 'Confirmar eliminación';
  @Input() itemName: string = '';
  @Input() messagePrefix: string = '¿Estás seguro de que deseas eliminar permanentemente ';
  @Input() messageSuffix: string = '? Esta acción no se puede deshacer.';
  @Input() confirmText: string = 'Eliminar';
  @Input() cancelText: string = 'Cancelar';
  @Input() isDeleting: boolean = false;

  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();

  onCancel(): void {
    if (!this.isDeleting) {
      this.cancel.emit();
    }
  }

  onConfirm(): void {
    if (!this.isDeleting) {
      this.confirm.emit();
    }
  }
}
