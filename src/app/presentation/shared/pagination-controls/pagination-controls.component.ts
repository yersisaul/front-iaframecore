import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-pagination-controls',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pagination-controls.component.html',
  styleUrl: './pagination-controls.component.css',
  host: {
    '[class.pagination-inline]': 'inline',
    '[class.pagination-floating]': '!inline'
  }
})
export class PaginationControlsComponent {
  @Input() currentPage: number = 1;
  @Input() totalPages: number = 1;
  @Input() totalRecords: number = 1;
  @Input() visiblePages: number[] = [];
  @Input() inline: boolean = false;

  @Output() pageChange = new EventEmitter<number>();

  formatPageNumber(page: number): string {
    if (!page && page !== 0) return '';
    return page.toLocaleString('es-ES');
  }

  getInputWidth(): string {
    const digits = String(this.totalPages || this.currentPage || 1).length;
    const calculatedWidth = Math.max(54, Math.min(110, digits * 10 + 26));
    return `${calculatedWidth}px`;
  }

  setPage(page: number): void {
    if (page >= 1 && page <= this.totalPages && page !== this.currentPage) {
      this.pageChange.emit(page);
    }
  }

  prevPage(): void {
    if (this.currentPage > 1) {
      this.pageChange.emit(this.currentPage - 1);
    }
  }

  nextPage(): void {
    if (this.currentPage < this.totalPages) {
      this.pageChange.emit(this.currentPage + 1);
    }
  }

  onPageInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    input.value = input.value.replace(/[^0-9]/g, '');
  }

  jumpToPage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const val = parseInt(input.value, 10);
    if (!isNaN(val) && val >= 1 && val <= this.totalPages) {
      this.setPage(val);
    }
    input.value = '';
  }
}
