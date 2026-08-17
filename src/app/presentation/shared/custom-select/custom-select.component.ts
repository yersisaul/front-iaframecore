import {
  Component, Input, Output, EventEmitter, signal, computed,
  ElementRef, HostListener, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';

export interface SelectOption {
  label: string;
  value: any;
}

@Component({
  selector: 'app-custom-select',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './custom-select.component.html',
  styleUrl: './custom-select.component.css'
})
export class CustomSelectComponent {
  private elementRef = inject(ElementRef);

  @Input({ required: true }) set options(val: (string | number | SelectOption)[]) {
    this.normalizedOptions.set(
      (val || []).map(opt => {
        if (typeof opt === 'object' && opt !== null && 'value' in opt) {
          return opt as SelectOption;
        }
        return { label: String(opt), value: opt };
      })
    );
  }

  @Input() set value(val: any) {
    this.selectedValue.set(val);
  }

  @Input() placeholder: string = 'Seleccionar';
  @Input() labelPrefix: string = '';
  @Input() labelSuffix: string = '';
  @Input() disabled: boolean = false;
  @Input() size: 'sm' | 'md' | 'lg' = 'sm';

  @Output() valueChange = new EventEmitter<any>();

  readonly normalizedOptions = signal<SelectOption[]>([]);
  readonly selectedValue = signal<any>(null);
  readonly isOpen = signal<boolean>(false);

  readonly selectedOption = computed(() => {
    const val = this.selectedValue();
    if (val === null || val === undefined) return null;
    return this.normalizedOptions().find(opt => String(opt.value) === String(val)) || null;
  });

  readonly displayLabel = computed(() => {
    const selected = this.selectedOption();
    if (selected) {
      return `${this.labelPrefix}${selected.label}${this.labelSuffix}`;
    }
    const rawVal = this.selectedValue();
    if (rawVal !== null && rawVal !== undefined && rawVal !== '') {
      return `${this.labelPrefix}${rawVal}${this.labelSuffix}`;
    }
    return this.placeholder;
  });

  isSelected(optValue: any): boolean {
    const val = this.selectedValue();
    if (val === null || val === undefined) return false;
    return String(optValue) === String(val);
  }

  toggleOpen(event: MouseEvent): void {
    event.stopPropagation();
    if (this.disabled) return;
    this.isOpen.update(v => !v);
  }

  selectOption(opt: SelectOption, event: MouseEvent): void {
    event.stopPropagation();
    this.selectedValue.set(opt.value);
    this.valueChange.emit(opt.value);
    this.isOpen.set(false);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.elementRef.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.isOpen.set(false);
  }
}
