import {
  Component,
  inject,
  signal,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy
} from '@angular/core';
import { Subscription } from 'rxjs';
import { ReliabilityAlertService } from '../../../core/services/reliability-alert.service';

@Component({
  selector: 'app-reliability-alert-widget',
  standalone: true,
  imports: [],
  templateUrl: './reliability-alert-widget.component.html',
  styleUrl: './reliability-alert-widget.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ReliabilityAlertWidgetComponent implements OnInit, OnDestroy {
  readonly alertService = inject(ReliabilityAlertService);

  readonly isRinging = signal<boolean>(false);
  private ringTimeout: any = null;
  private alertSubscription?: Subscription;

  readonly unresolvedCount = this.alertService.unresolvedCount;

  ngOnInit(): void {
    // Escuchar nuevas alertas para disparar la animación de tintineo (shake) en la campana
    this.alertSubscription = this.alertService.alertReceived$.subscribe(() => {
      this.isRinging.set(true);
      if (this.ringTimeout) clearTimeout(this.ringTimeout);
      this.ringTimeout = setTimeout(() => {
        this.isRinging.set(false);
        this.ringTimeout = null;
      }, 2000);
    });
  }

  ngOnDestroy(): void {
    this.alertSubscription?.unsubscribe();
    if (this.ringTimeout) clearTimeout(this.ringTimeout);
  }

  onTriggerClick(): void {
    this.alertService.openModal(null);
  }
}
