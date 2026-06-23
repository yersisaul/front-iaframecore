import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HostService } from '../../../core/services/host.service';
import { ScheduleService } from '../../../core/services/schedule.service';
import { Schedule } from '../../../core/domain/entities/schedule.models';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

@Component({
  selector: 'app-horarios',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './horarios.html',
  styleUrl: './horarios.css',
})
export class Horarios implements OnInit, OnDestroy {
  private hostService = inject(HostService);
  private scheduleService = inject(ScheduleService);

  readonly allSchedules = signal<Schedule[]>([]);
  readonly isLoading = signal(false);

  // Selector para filtrar por host en la UI
  readonly selectedHostFingerprint = signal<string>('all');
  readonly hostsList = computed(() => this.hostService.hosts());

  // Reloj interno para el estado dinámico "Ejecutando"
  readonly currentTime = signal<Date>(new Date());
  private timerId: any;

  // Lista de horarios filtrada
  readonly filteredSchedules = computed(() => {
    const selected = this.selectedHostFingerprint();
    const list = this.allSchedules();
    if (selected === 'all') {
      return list;
    }
    return list.filter(s => s.hostFingerprint === selected);
  });

  ngOnInit(): void {
    this.loadAllSchedules();

    // Actualizar reloj cada segundo
    this.timerId = setInterval(() => {
      this.currentTime.set(new Date());
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.timerId) {
      clearInterval(this.timerId);
    }
  }

  loadAllSchedules(): void {
    this.isLoading.set(true);
    // Una sola llamada a GET /frontend/schedules/ trae todos los horarios
    this.scheduleService.getAllSchedules().pipe(
      catchError(() => of([]))
    ).subscribe(schedules => {
      this.allSchedules.set(schedules);
      this.isLoading.set(false);
    });
  }

  isScheduleActive(schedule: Schedule): boolean {
    if (schedule.status !== 'activo') {
      return false;
    }
    const now = this.currentTime();
    
    if (schedule.frequency === 'diario') {
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = schedule.start.getHours() * 60 + schedule.start.getMinutes();
      const endMinutes = schedule.end.getHours() * 60 + schedule.end.getMinutes();
      
      if (startMinutes <= endMinutes) {
        return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
      } else {
        return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
      }
    }
    
    return now >= schedule.start && now <= schedule.end;
  }

  filterByHost(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedHostFingerprint.set(select.value);
  }
}
