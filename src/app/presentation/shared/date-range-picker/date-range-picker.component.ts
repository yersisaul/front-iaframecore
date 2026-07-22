import { Component, Input, Output, EventEmitter, signal, computed, OnChanges, SimpleChanges, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-date-range-picker',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './date-range-picker.component.html',
  styleUrl: './date-range-picker.component.css'
})
export class DateRangePickerComponent implements OnChanges {
  @Input() timestampDesde: Date | null = null;
  @Input() timestampHasta: Date | null = null;
  @Input() activeDropdown: string | null = null;
  @Input() dropdownName: string = 'fechas';

  @Output() dateRangeChange = new EventEmitter<{ desde: Date | null; hasta: Date | null }>();
  @Output() toggleDropdown = new EventEmitter<string>();

  readonly activeCalendarField = signal<'desde' | 'hasta' | null>(null);
  readonly calendarViewMonth = signal<number>(new Date().getMonth());
  readonly calendarViewYear = signal<number>(new Date().getFullYear());

  readonly activeTimeField = signal<'desde' | 'hasta' | null>(null);
  readonly hoursList = Array.from({ length: 24 }, (_, i) => i);
  readonly minutesList = Array.from({ length: 60 }, (_, i) => i);

  readonly dateDesdeStr = signal<string>('');
  readonly dateHastaStr = signal<string>('');
  readonly timeDesdeStr = signal<string>('00:00');
  readonly timeHastaStr = signal<string>('23:59');

  readonly calendarGrid = computed(() => {
    const month = this.calendarViewMonth();
    const year = this.calendarViewYear();
    const firstDay = new Date(year, month, 1);
    const startDayOfWeek = firstDay.getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();
    const emptyDays = Array.from({ length: startDayOfWeek }, (_, i) => i);
    const days = Array.from({ length: totalDays }, (_, i) => i + 1);
    return { emptyDays, days };
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['timestampDesde'] || changes['timestampHasta']) {
      this.syncDateTimePickerStrings(this.timestampDesde, this.timestampHasta);
    }
  }

  getMonths(): string[] {
    return [
      'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
      'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
    ];
  }

  onToggleDropdown(event: Event): void {
    event.stopPropagation();
    this.toggleDropdown.emit(this.dropdownName);
  }

  openCalendarField(field: 'desde' | 'hasta', event: Event): void {
    event.stopPropagation();
    if (this.activeCalendarField() === field) {
      this.activeCalendarField.set(null);
      return;
    }
    const dateStr = field === 'desde' ? this.dateDesdeStr() : this.dateHastaStr();
    if (dateStr) {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[0], 10);
        if (!isNaN(m) && m >= 0 && m <= 11) this.calendarViewMonth.set(m);
        if (!isNaN(y)) this.calendarViewYear.set(y);
      }
    } else {
      this.calendarViewMonth.set(new Date().getMonth());
      this.calendarViewYear.set(new Date().getFullYear());
    }
    this.activeCalendarField.set(field);
    this.activeTimeField.set(null);
  }

  selectCalendarDay(day: number): void {
    const field = this.activeCalendarField();
    if (!field) return;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    if (field === 'desde') {
      this.dateDesdeStr.set(dateStr);
      this._applyDateTimeToFilter('desde');
    } else {
      this.dateHastaStr.set(dateStr);
      this._applyDateTimeToFilter('hasta');
    }
    this.activeCalendarField.set(null);
  }

  isCalendarDaySelected(day: number): boolean {
    const field = this.activeCalendarField();
    if (!field) return false;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const target = `${this.calendarViewYear()}-${pad(this.calendarViewMonth() + 1)}-${pad(day)}`;
    return field === 'desde' ? this.dateDesdeStr() === target : this.dateHastaStr() === target;
  }

  prevCalendarMonth(event: Event): void {
    event.stopPropagation();
    const m = this.calendarViewMonth();
    if (m > 0) {
      this.calendarViewMonth.update(v => v - 1);
    } else {
      this.calendarViewMonth.set(11);
      this.calendarViewYear.update(v => v - 1);
    }
  }

  nextCalendarMonth(event: Event): void {
    event.stopPropagation();
    const m = this.calendarViewMonth();
    if (m < 11) {
      this.calendarViewMonth.update(v => v + 1);
    } else {
      this.calendarViewMonth.set(0);
      this.calendarViewYear.update(v => v + 1);
    }
  }

  openTimePickerField(field: 'desde' | 'hasta', event: Event): void {
    event.stopPropagation();
    if (this.activeTimeField() === field) {
      this.activeTimeField.set(null);
      return;
    }
    this.activeTimeField.set(field);
    this.activeCalendarField.set(null);
  }

  private _getTimeParts(timeStr: string): { hour: number; minute: number } {
    if (!timeStr) return { hour: 0, minute: 0 };
    const parts = timeStr.split(':');
    return { hour: parseInt(parts[0], 10) || 0, minute: parseInt(parts[1], 10) || 0 };
  }

  isTimeHourSelected(h: number): boolean {
    const field = this.activeTimeField();
    if (!field) return false;
    const ts = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    return this._getTimeParts(ts).hour === h;
  }

  isTimeMinuteSelected(m: number): boolean {
    const field = this.activeTimeField();
    if (!field) return false;
    const ts = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    return this._getTimeParts(ts).minute === m;
  }

  selectTimeHour(h: number): void {
    const field = this.activeTimeField();
    if (!field) return;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ts = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    const parts = this._getTimeParts(ts);
    const newTs = `${pad(h)}:${pad(parts.minute)}`;
    if (field === 'desde') { this.timeDesdeStr.set(newTs); this._applyDateTimeToFilter('desde'); }
    else { this.timeHastaStr.set(newTs); this._applyDateTimeToFilter('hasta'); }
  }

  selectTimeMinute(m: number): void {
    const field = this.activeTimeField();
    if (!field) return;
    const pad = (n: number) => n.toString().padStart(2, '0');
    const ts = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    const parts = this._getTimeParts(ts);
    const newTs = `${pad(parts.hour)}:${pad(m)}`;
    if (field === 'desde') { this.timeDesdeStr.set(newTs); this._applyDateTimeToFilter('desde'); }
    else { this.timeHastaStr.set(newTs); this._applyDateTimeToFilter('hasta'); }
  }

  private syncDateTimePickerStrings(desde: Date | null, hasta: Date | null): void {
    const pad = (n: number) => n.toString().padStart(2, '0');
    if (desde) {
      const d = new Date(desde);
      this.dateDesdeStr.set(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      this.timeDesdeStr.set(`${pad(d.getHours())}:${pad(d.getMinutes())}`);
    } else {
      this.dateDesdeStr.set('');
      this.timeDesdeStr.set('00:00');
    }

    if (hasta) {
      const h = new Date(hasta);
      this.dateHastaStr.set(`${h.getFullYear()}-${pad(h.getMonth() + 1)}-${pad(h.getDate())}`);
      this.timeHastaStr.set(`${pad(h.getHours())}:${pad(h.getMinutes())}`);
    } else {
      this.dateHastaStr.set('');
      this.timeHastaStr.set('23:59');
    }
  }

  private _applyDateTimeToFilter(field: 'desde' | 'hasta'): void {
    const dateStr = field === 'desde' ? this.dateDesdeStr() : this.dateHastaStr();
    const timeStr = field === 'desde' ? this.timeDesdeStr() : this.timeHastaStr();
    
    let newDesde = this.timestampDesde ? new Date(this.timestampDesde) : null;
    let newHasta = this.timestampHasta ? new Date(this.timestampHasta) : null;

    if (!dateStr) {
      if (field === 'desde') newDesde = null;
      else newHasta = null;
    } else {
      const parts = dateStr.split('-');
      if (parts.length === 3) {
        const year = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const day = parseInt(parts[2], 10);

        const timeParts = (timeStr || (field === 'desde' ? '00:00' : '23:59')).split(':');
        const hour = parseInt(timeParts[0], 10) || 0;
        const min = parseInt(timeParts[1], 10) || 0;
        const sec = field === 'hasta' ? 59 : 0;

        const date = new Date(year, month, day, hour, min, sec);
        if (!isNaN(date.getTime())) {
          if (field === 'desde') newDesde = date;
          else newHasta = date;
        }
      }
    }

    this.dateRangeChange.emit({ desde: newDesde, hasta: newHasta });
  }

  formatCalendarDateLabel(dateStr: string): string {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    const date = new Date(year, month, day);
    return new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'long' }).format(date);
  }

  setDatePreset(preset: 'today' | '24h' | '7d' | 'clear'): void {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const toDateStr = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const toTimeStr = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    let desde: Date | null = null;
    let hasta: Date | null = null;

    if (preset === 'today') {
      desde = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      this.dateDesdeStr.set(toDateStr(desde));
      this.timeDesdeStr.set('00:00');
      this.dateHastaStr.set('');
      this.timeHastaStr.set('23:59');
    } else if (preset === '24h') {
      desde = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      hasta = now;
      this.dateDesdeStr.set(toDateStr(desde));
      this.timeDesdeStr.set(toTimeStr(desde));
      this.dateHastaStr.set(toDateStr(hasta));
      this.timeHastaStr.set(toTimeStr(hasta));
    } else if (preset === '7d') {
      desde = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      hasta = now;
      this.dateDesdeStr.set(toDateStr(desde));
      this.timeDesdeStr.set(toTimeStr(desde));
      this.dateHastaStr.set(toDateStr(hasta));
      this.timeHastaStr.set(toTimeStr(hasta));
    } else if (preset === 'clear') {
      this.dateDesdeStr.set('');
      this.timeDesdeStr.set('00:00');
      this.dateHastaStr.set('');
      this.timeHastaStr.set('23:59');
    }

    this.dateRangeChange.emit({ desde, hasta });
  }

  @HostListener('document:click')
  closeInnerPopovers(): void {
    this.activeCalendarField.set(null);
    this.activeTimeField.set(null);
  }
}
