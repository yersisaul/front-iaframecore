import { Component, OnInit, input, signal, computed, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReliabilityCommandService } from '../../../core/services/reliability-command.service';
import { ReliabilityCommand } from '../../../core/domain/entities/reliability-command.models';
import { copyToClipboard } from '../../../core/utils/clipboard.util';

@Component({
  selector: 'app-analytic-command-terminal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './analytic-command-terminal.component.html',
  styleUrl: './analytic-command-terminal.component.css'
})
export class AnalyticCommandTerminalComponent implements OnInit {
  private commandService = inject(ReliabilityCommandService);

  readonly analyticId = input<string | null>(null);
  readonly hostFingerprint = input<string | null>(null);
  readonly autoLoad = input<boolean>(true);
  readonly compact = input<boolean>(true);
  readonly refreshTrigger = input<number>(0);

  constructor() {
    effect(() => {
      const trigger = this.refreshTrigger();
      if (trigger > 0) {
        this.loadCommands();
      }
    });
  }

  readonly commands = signal<ReliabilityCommand[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly expandedJsonId = signal<string | null>(null);
  readonly copiedId = signal<string | null>(null);
  readonly statusFilter = signal<string>('all'); // 'all' | 'FAILED' | 'SUCCESS' | 'IN_PROGRESS'
  readonly isTerminalExpanded = signal<boolean>(false); // Colapsado por defecto

  toggleTerminalExpanded(): void {
    this.isTerminalExpanded.update(prev => !prev);
  }

  readonly filteredCommands = computed(() => {
    const list = this.commands();
    const filter = this.statusFilter();
    if (filter === 'all') return list;
    if (filter === 'FAILED') {
      return list.filter(c => c.status?.toUpperCase() === 'FAILED');
    }
    if (filter === 'SUCCESS') {
      return list.filter(c => {
        const st = c.status?.toUpperCase();
        return st === 'ACKED' || st === 'APPLIED' || st === 'VERIFIED';
      });
    }
    if (filter === 'IN_PROGRESS') {
      return list.filter(c => {
        const st = c.status?.toUpperCase();
        return st !== 'FAILED' && st !== 'ACKED' && st !== 'APPLIED' && st !== 'VERIFIED';
      });
    }
    return list.filter(c => c.status?.toUpperCase() === filter);
  });

  readonly counts = computed(() => {
    const list = this.commands();
    let failed = 0;
    let success = 0;
    let inProgress = 0;

    list.forEach(c => {
      const st = c.status?.toUpperCase() || '';
      if (st === 'FAILED') failed++;
      else if (st === 'ACKED' || st === 'APPLIED' || st === 'VERIFIED') success++;
      else inProgress++;
    });

    return {
      total: list.length,
      failed,
      success,
      inProgress
    };
  });

  readonly latestCommand = computed(() => {
    const list = this.commands();
    return list.length > 0 ? list[0] : null;
  });

  ngOnInit(): void {
    if (this.autoLoad()) {
      this.loadCommands();
    }
  }

  loadCommands(): void {
    const analytic = this.analyticId();
    const host = this.hostFingerprint();

    if (!analytic && !host) return;

    this.isLoading.set(true);
    this.error.set(null);

    const queryParams: any = { limit: 50 };
    if (analytic) queryParams.analytic_id = analytic;
    if (host) queryParams.fingerprint_host = host;

    this.commandService.getCommands(queryParams).subscribe({
      next: (data) => {
        this.commands.set(data);
        this.isLoading.set(false);
      },
      error: (err) => {
        console.error('Error fetching reliability commands:', err);
        this.error.set('No se pudieron cargar los registros de comandos.');
        this.isLoading.set(false);
      }
    });
  }

  toggleJsonDetails(id: string, event?: Event): void {
    if (event) event.stopPropagation();
    this.expandedJsonId.update(current => current === id ? null : id);
  }

  copyContent(text: string, uniqueId: string, event?: Event): void {
    if (event) event.stopPropagation();
    if (!text) return;
    copyToClipboard(text).then(() => {
      this.copiedId.set(uniqueId);
      setTimeout(() => {
        if (this.copiedId() === uniqueId) {
          this.copiedId.set(null);
        }
      }, 2000);
    }).catch(err => console.error('Error copying to clipboard:', err));
  }

  formatJson(obj: any): string {
    try {
      return JSON.stringify(obj, null, 2);
    } catch {
      return String(obj);
    }
  }

  getStatusClass(status: string): string {
    return this.commandService.getStatusBadgeClass(status);
  }
}
