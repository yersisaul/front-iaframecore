import {
  Component,
  Input,
  Output,
  EventEmitter,
  signal,
  computed,
  HostListener,
  OnInit,
  OnDestroy,
  OnChanges,
  SimpleChanges
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { EventRecord } from '../../../core/domain/entities/event.models';

export interface TimelineRuleMark {
  id: string;
  timeLabel: string;
  leftPct: number;
}

export interface TimelineHoverInfo {
  visible: boolean;
  leftPct: number;
  timeLabel: string;
  eventCount: number;
}

export interface TimelineFlagCluster {
  event: EventRecord;
  leftPct: number;
  color: string;
  count: number;
  events: EventRecord[];
}

@Component({
  selector: 'app-monitoring-timeline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './monitoring-timeline.component.html',
  styleUrl: './monitoring-timeline.component.css'
})
export class MonitoringTimelineComponent implements OnInit, OnDestroy, OnChanges {
  // --- Reactive Signals for Inputs ---
  readonly eventsSignal = signal<EventRecord[]>([]);
  readonly currentTimeSignal = signal<Date>(new Date());
  readonly playbackModeSignal = signal<'live' | 'playback'>('live');
  readonly pausedSignal = signal<boolean>(false);
  readonly playbackWindowEndSignal = signal<Date | null>(null);
  readonly zoomRangeSecondsSignal = signal<number>(86400);
  readonly selectedCameraNamesSignal = signal<Set<string>>(new Set());
  readonly eventSearchQuerySignal = signal<string>('');
  readonly selectedFlagIdSignal = signal<string | null>(null);
  readonly getAnalyticColorFnSignal = signal<(type: string) => string>(() => '#3b82f6');
  readonly liveTickerClockSignal = signal<Date>(new Date());

  @Input() set events(val: EventRecord[] | null | undefined) {
    this.eventsSignal.set(val || []);
  }
  get events(): EventRecord[] {
    return this.eventsSignal();
  }

  @Input() set currentTime(val: Date | null | undefined) {
    if (val) {
      this.currentTimeSignal.set(val);
      if (!this.isEditingTimeSegments) {
        this.syncTimeSegments(val);
      }
      if (!this.isEditingDateSegments) {
        this.syncDateSegments(val);
      }
    }
  }
  get currentTime(): Date {
    return this.currentTimeSignal();
  }

  @Input() set playbackMode(val: 'live' | 'playback') {
    this.playbackModeSignal.set(val || 'live');
  }
  get playbackMode(): 'live' | 'playback' {
    return this.playbackModeSignal();
  }

  @Input() set paused(val: boolean) {
    this.pausedSignal.set(val);
  }
  get paused(): boolean {
    return this.pausedSignal();
  }

  @Input() set playbackWindowEnd(val: Date | null | undefined) {
    this.playbackWindowEndSignal.set(val || null);
  }
  get playbackWindowEnd(): Date | null {
    return this.playbackWindowEndSignal();
  }

  @Input() set zoomRangeSeconds(val: number) {
    this.zoomRangeSecondsSignal.set(val || 86400);
  }
  get zoomRangeSeconds(): number {
    return this.zoomRangeSecondsSignal();
  }

  @Input() set selectedCameraNames(val: Set<string> | null | undefined) {
    this.selectedCameraNamesSignal.set(val || new Set());
  }
  get selectedCameraNames(): Set<string> {
    return this.selectedCameraNamesSignal();
  }

  @Input() set eventSearchQuery(val: string | null | undefined) {
    this.eventSearchQuerySignal.set(val || '');
  }
  get eventSearchQuery(): string {
    return this.eventSearchQuerySignal();
  }

  @Input() set selectedFlagId(val: string | null | undefined) {
    this.selectedFlagIdSignal.set(val || null);
  }
  get selectedFlagId(): string | null {
    return this.selectedFlagIdSignal();
  }

  @Input() set getAnalyticColor(fn: ((type: string) => string) | null | undefined) {
    if (fn) this.getAnalyticColorFnSignal.set(fn);
  }
  get getAnalyticColor(): (type: string) => string {
    return this.getAnalyticColorFnSignal();
  }

  @Input() set liveTickerClock(val: Date | null | undefined) {
    if (val) this.liveTickerClockSignal.set(val);
  }
  get liveTickerClock(): Date {
    return this.liveTickerClockSignal();
  }

  // --- Outputs ---
  @Output() timeChange = new EventEmitter<Date>();
  @Output() playbackModeChange = new EventEmitter<'live' | 'playback'>();
  @Output() pausedChange = new EventEmitter<boolean>();
  @Output() playbackWindowEndChange = new EventEmitter<Date | null>();
  @Output() flagClick = new EventEmitter<{ event: EventRecord; count: number; nativeEvent?: MouseEvent }>();
  @Output() zoomChange = new EventEmitter<number>();
  @Output() toast = new EventEmitter<{ message: string; type: 'success' | 'danger' | 'warning' | 'primary' }>();

  // --- Time & Date Input Segments ---
  readonly hoursSegmentStr = signal<string>('00');
  readonly minutesSegmentStr = signal<string>('00');
  readonly secondsSegmentStr = signal<string>('00');
  private isEditingTimeSegments = false;

  readonly dateDayStr = signal<string>('01');
  readonly dateMonthStr = signal<string>('01');
  readonly dateYearStr = signal<string>('2026');
  private isEditingDateSegments = false;

  // --- Drag & Interaction States ---
  readonly isDraggingTimeline = signal<boolean>(false);
  readonly isSeekingNeedle = signal<boolean>(false);
  private dragStartX = 0;
  private dragStartEndMs = 0;
  private dragTrackWidth = 1000;
  private isRafMovePending = false;
  private pendingMouseMoveEvent: MouseEvent | null = null;

  readonly timelineHoverInfo = signal<TimelineHoverInfo>({
    visible: false,
    leftPct: 0,
    timeLabel: '',
    eventCount: 0
  });

  private tickerTimer: any = null;

  ngOnInit(): void {
    const now = this.currentTimeSignal();
    this.syncTimeSegments(now);
    this.syncDateSegments(now);

    // Live clock ticker fallback if not injected
    this.tickerTimer = setInterval(() => {
      if (this.playbackModeSignal() === 'live') {
        const tick = new Date();
        this.liveTickerClockSignal.set(tick);
        this.currentTimeSignal.set(tick);
        if (!this.isEditingTimeSegments) {
          this.syncTimeSegments(tick);
        }
        if (!this.isEditingDateSegments) {
          this.syncDateSegments(tick);
        }
      }
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.tickerTimer) {
      clearInterval(this.tickerTimer);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['currentTime'] && this.currentTime && !this.isEditingTimeSegments) {
      this.syncTimeSegments(this.currentTime);
      this.syncDateSegments(this.currentTime);
    }
  }

  private syncTimeSegments(date: Date): void {
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.hoursSegmentStr.set(pad(date.getHours()));
    this.minutesSegmentStr.set(pad(date.getMinutes()));
    this.secondsSegmentStr.set(pad(date.getSeconds()));
  }

  private syncDateSegments(date: Date): void {
    const pad = (n: number) => n.toString().padStart(2, '0');
    this.dateDayStr.set(pad(date.getDate()));
    this.dateMonthStr.set(pad(date.getMonth() + 1));
    this.dateYearStr.set(date.getFullYear().toString());
  }

  // --- Computed Timeline Properties ---
  readonly activeDayBounds = computed(() => {
    const d = this.currentTimeSignal();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
    return { start, end };
  });

  readonly timelineRange = computed(() => {
    const bounds = this.activeDayBounds();
    const zoom = Math.min(86400 * 1000, this.zoomRangeSecondsSignal() * 1000);

    const rawEndMs = this.playbackWindowEndSignal() !== null
      ? this.playbackWindowEndSignal()!.getTime()
      : bounds.end.getTime();

    const minEndMs = bounds.start.getTime() + zoom;
    const maxEndMs = bounds.end.getTime();
    const endMs = Math.max(minEndMs, Math.min(maxEndMs, rawEndMs));
    const start = new Date(endMs - zoom);

    return { start, end: new Date(endMs) };
  });

  readonly playheadLeftPct = computed(() => {
    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    const pointerMs = this.currentTimeSignal().getTime();

    if (pointerMs <= startMs) return 0;
    if (pointerMs >= endMs) return 100;

    return ((pointerMs - startMs) / (endMs - startMs)) * 100;
  });

  readonly timeOffsetLabel = computed(() => {
    if (this.playbackModeSignal() === 'live') {
      return 'EN VIVO';
    }
    const nowMs = this.liveTickerClockSignal().getTime();
    const pointerMs = this.currentTimeSignal().getTime();
    const diffSec = Math.max(0, Math.round((nowMs - pointerMs) / 1000));

    if (diffSec < 60) {
      return `-${diffSec}s del En Vivo`;
    }
    if (diffSec < 3600) {
      const m = Math.floor(diffSec / 60);
      const s = diffSec % 60;
      return s > 0 ? `-${m}m ${s}s del En Vivo` : `-${m}m del En Vivo`;
    }
    if (diffSec < 86400) {
      const h = Math.floor(diffSec / 3600);
      const m = Math.floor((diffSec % 3600) / 60);
      return m > 0 ? `-${h}h ${m}m del En Vivo` : `-${h}h del En Vivo`;
    }
    const d = Math.floor(diffSec / 86400);
    return `-${d}d del En Vivo`;
  });

  readonly timelineRuleMarks = computed(() => {
    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    const durationMs = endMs - startMs;
    const zoomSec = this.zoomRangeSecondsSignal();

    const marks: TimelineRuleMark[] = [];
    const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    const oneDayMs = 86400 * 1000;

    if (zoomSec >= 86400 * 2) {
      let stepDays = 1;
      if (zoomSec >= 86400 * 20) stepDays = 5;
      else if (zoomSec >= 86400 * 10) stepDays = 3;
      else if (zoomSec >= 86400 * 4) stepDays = 2;

      const bufferStartMs = startMs - oneDayMs * stepDays * 2;
      const bufferEndMs = endMs + oneDayMs * stepDays * 2;

      const startDate = new Date(bufferStartMs);
      const firstDay = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      let curr = firstDay.getTime();

      while (curr <= bufferEndMs) {
        const dayEpoch = Math.floor(curr / oneDayMs);
        if (dayEpoch % stepDays === 0) {
          const pct = ((curr - startMs) / durationMs) * 100;
          if (pct >= 0 && pct <= 100) {
            const d = new Date(curr);
            marks.push({
              id: `day-${dayEpoch}`,
              timeLabel: `${d.getDate()} ${monthNames[d.getMonth()]}`,
              leftPct: pct
            });
          }
        }
        curr += oneDayMs;
      }
    } else if (zoomSec >= 14400) {
      const stepHours = zoomSec >= 86400 ? 6 : (zoomSec >= 43200 ? 3 : 2);
      const stepMs = stepHours * 3600 * 1000;

      const bufferStartMs = startMs - stepMs * 2;
      const bufferEndMs = endMs + stepMs * 2;

      const startDate = new Date(bufferStartMs);
      const firstHourMs = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), Math.floor(startDate.getHours() / stepHours) * stepHours).getTime();

      let curr = firstHourMs;
      while (curr <= bufferEndMs) {
        const hourEpoch = Math.floor(curr / stepMs);
        const pct = ((curr - startMs) / durationMs) * 100;
        if (pct >= 0 && pct <= 100) {
          const d = new Date(curr);
          let label = '';
          if (d.getHours() === 0) {
            label = `${d.getDate()} ${monthNames[d.getMonth()]}`;
          } else {
            label = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          }
          marks.push({
            id: `hour-${hourEpoch}`,
            timeLabel: label,
            leftPct: pct
          });
        }
        curr += stepMs;
      }
    } else {
      const stepMinutes = zoomSec <= 600 ? 2 : (zoomSec <= 3600 ? 10 : 30);
      const stepMs = stepMinutes * 60 * 1000;

      const bufferStartMs = startMs - stepMs * 2;
      const bufferEndMs = endMs + stepMs * 2;

      const startDate = new Date(bufferStartMs);
      const firstMinMs = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(), startDate.getHours(), Math.floor(startDate.getMinutes() / stepMinutes) * stepMinutes).getTime();

      let curr = firstMinMs;
      while (curr <= bufferEndMs) {
        const minEpoch = Math.floor(curr / stepMs);
        const pct = ((curr - startMs) / durationMs) * 100;
        if (pct >= 0 && pct <= 100) {
          const d = new Date(curr);
          const label = zoomSec <= 600
            ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
          marks.push({
            id: `min-${minEpoch}`,
            timeLabel: label,
            leftPct: pct
          });
        }
        curr += stepMs;
      }
    }

    return marks;
  });

  readonly visibleTimelineFlags = computed<TimelineFlagCluster[]>(() => {
    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    let events = this.eventsSignal();

    if (this.selectedCameraNamesSignal().size > 0) {
      const selectedNames = this.selectedCameraNamesSignal();
      events = events.filter(e => selectedNames.has(e.nombreCamara));
    }

    const search = this.eventSearchQuerySignal().trim().toLowerCase();
    if (search) {
      events = events.filter(e => e.nombreCamara && e.nombreCamara.toLowerCase().includes(search));
    }

    const colorFn = this.getAnalyticColorFnSignal();
    const rawFlags = events
      .filter(e => {
        const t = e.timestampMs || (e.timestampMs = new Date(e.timestamp).getTime());
        return t >= startMs && t <= endMs;
      })
      .map(e => {
        const t = e.timestampMs || (e.timestampMs = new Date(e.timestamp).getTime());
        const pct = ((t - startMs) / (endMs - startMs)) * 100;
        return {
          event: e,
          leftPct: pct,
          color: colorFn(e.analitica)
        };
      })
      .sort((a, b) => a.leftPct - b.leftPct);

    if (rawFlags.length === 0) return [];

    const zoomSec = this.zoomRangeSecondsSignal();
    let clusterThresholdPct = 3.5;
    if (zoomSec <= 300) {
      clusterThresholdPct = 0.05;
    } else if (zoomSec <= 1800) {
      clusterThresholdPct = 0.5;
    } else if (zoomSec <= 7200) {
      clusterThresholdPct = 1.2;
    } else if (zoomSec <= 21600) {
      clusterThresholdPct = 2.2;
    }

    const clusters: TimelineFlagCluster[] = [];
    let currentGroup: typeof rawFlags = [];

    for (const flag of rawFlags) {
      if (currentGroup.length === 0) {
        currentGroup.push(flag);
      } else {
        const firstInGroup = currentGroup[0];
        if (flag.leftPct - firstInGroup.leftPct <= clusterThresholdPct) {
          currentGroup.push(flag);
        } else {
          const avgPct = currentGroup.reduce((sum, item) => sum + item.leftPct, 0) / currentGroup.length;
          const mainEvent = currentGroup[currentGroup.length - 1].event;
          clusters.push({
            event: mainEvent,
            leftPct: avgPct,
            color: currentGroup[0].color,
            count: currentGroup.length,
            events: currentGroup.map(g => g.event)
          });
          currentGroup = [flag];
        }
      }
    }

    if (currentGroup.length > 0) {
      const avgPct = currentGroup.reduce((sum, item) => sum + item.leftPct, 0) / currentGroup.length;
      const mainEvent = currentGroup[currentGroup.length - 1].event;
      clusters.push({
        event: mainEvent,
        leftPct: avgPct,
        color: currentGroup[0].color,
        count: currentGroup.length,
        events: currentGroup.map(g => g.event)
      });
    }

    return clusters;
  });

  isFlagSelected(flag: TimelineFlagCluster): boolean {
    const selId = this.selectedFlagIdSignal();
    if (!selId) return false;
    return flag.event.id === selId || flag.events.some(e => e.id === selId);
  }

  onFlagClicked(eventRecord: EventRecord, count: number, mouseEvent?: MouseEvent): void {
    if (mouseEvent) {
      mouseEvent.stopPropagation();
      mouseEvent.preventDefault();
    }
    this.flagClick.emit({ event: eventRecord, count, nativeEvent: mouseEvent });
  }

  // --- Transport Controls ---
  togglePlayPause(): void {
    if (this.playbackModeSignal() === 'live') {
      const now = new Date();
      this.playbackWindowEndSignal.set(now);
      this.playbackWindowEndChange.emit(now);
      this.currentTimeSignal.set(now);
      this.timeChange.emit(now);
      this.playbackModeSignal.set('playback');
      this.playbackModeChange.emit('playback');
      this.pausedSignal.set(true);
      this.pausedChange.emit(true);
      this.toast.emit({ message: '⏸️ Modo Pausa activado', type: 'primary' });
    } else {
      this.setLiveMode();
    }
  }

  setLiveMode(): void {
    const now = new Date();
    this.playbackModeSignal.set('live');
    this.playbackModeChange.emit('live');
    this.pausedSignal.set(false);
    this.pausedChange.emit(false);
    this.playbackWindowEndSignal.set(null);
    this.playbackWindowEndChange.emit(null);
    this.currentTimeSignal.set(now);
    this.timeChange.emit(now);
    this.syncTimeSegments(now);
    this.toast.emit({ message: '⚡ Transmisión En Vivo reanudada', type: 'success' });
  }

  backwardEvent(): void {
    let events = this.eventsSignal();
    if (events.length === 0) return;

    if (this.selectedCameraNamesSignal().size > 0) {
      const selectedNames = this.selectedCameraNamesSignal();
      events = events.filter(e => selectedNames.has(e.nombreCamara));
      if (events.length === 0) return;
    }

    const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const currentFlagId = this.selectedFlagIdSignal();

    let targetIdx = -1;
    if (currentFlagId !== null) {
      const currentIdx = sorted.findIndex(e => e.id === currentFlagId);
      if (currentIdx > 0) targetIdx = currentIdx - 1;
      else if (currentIdx === 0) targetIdx = 0;
    } else {
      const pointerMs = this.currentTimeSignal().getTime();
      const prevEvents = sorted.filter(e => new Date(e.timestamp).getTime() <= pointerMs);
      if (prevEvents.length > 0) {
        targetIdx = sorted.findIndex(e => e.id === prevEvents[prevEvents.length - 1].id);
      } else {
        targetIdx = 0;
      }
    }

    if (targetIdx >= 0 && targetIdx < sorted.length) {
      this.onFlagClicked(sorted[targetIdx], 1);
    }
  }

  forwardEvent(): void {
    if (this.playbackModeSignal() === 'live') return;

    let events = this.eventsSignal();
    if (events.length === 0) {
      this.setLiveMode();
      return;
    }

    if (this.selectedCameraNamesSignal().size > 0) {
      const selectedNames = this.selectedCameraNamesSignal();
      events = events.filter(e => selectedNames.has(e.nombreCamara));
      if (events.length === 0) {
        this.setLiveMode();
        return;
      }
    }

    const sorted = [...events].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    const currentFlagId = this.selectedFlagIdSignal();

    let targetIdx = -1;
    if (currentFlagId !== null) {
      const currentIdx = sorted.findIndex(e => e.id === currentFlagId);
      if (currentIdx >= 0) targetIdx = currentIdx + 1;
    } else {
      const pointerMs = this.currentTimeSignal().getTime();
      const nextEvents = sorted.filter(e => new Date(e.timestamp).getTime() > pointerMs);
      if (nextEvents.length > 0) {
        targetIdx = sorted.findIndex(e => e.id === nextEvents[0].id);
      }
    }

    if (targetIdx < 0 || targetIdx >= sorted.length) {
      this.setLiveMode();
      return;
    }

    this.onFlagClicked(sorted[targetIdx], 1);
  }

  // --- Timeline Scrubbing and Mouse Interactions ---
  onTimelineMouseDown(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const target = (event.currentTarget || event.target) as HTMLElement;
    const wrapper = target ? (target.closest('.timeline-slider-wrapper') as HTMLElement) : null;
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect();
      if (rect.width > 0) {
        this.dragTrackWidth = rect.width;
      }
    }

    if (event.button === 2 || event.button === 1) {
      this.isDraggingTimeline.set(true);
      document.body.classList.add('is-timeline-dragging');
      this.dragStartX = event.clientX;
      const range = this.timelineRange();
      this.dragStartEndMs = range.end.getTime();

      const suppressContextMenu = (e: Event) => { e.preventDefault(); };
      document.addEventListener('contextmenu', suppressContextMenu, { capture: true, once: true });
    } else if (event.button === 0) {
      this.isSeekingNeedle.set(true);
      document.body.classList.add('is-timeline-dragging');
      this.seekNeedleToEvent(event);
    }
  }

  @HostListener('window:mousemove', ['$event'])
  onWindowMouseMove(event: MouseEvent): void {
    if (!this.isDraggingTimeline() && !this.isSeekingNeedle()) return;
    event.preventDefault();

    this.pendingMouseMoveEvent = event;
    if (!this.isRafMovePending) {
      this.isRafMovePending = true;
      requestAnimationFrame(() => {
        this.isRafMovePending = false;
        if (this.pendingMouseMoveEvent) {
          this.processTimelineMouseMove(this.pendingMouseMoveEvent);
        }
      });
    }
  }

  private processTimelineMouseMove(event: MouseEvent): void {
    if (this.isDraggingTimeline()) {
      const deltaX = event.clientX - this.dragStartX;
      const durationMs = Math.min(86400 * 1000, this.zoomRangeSecondsSignal() * 1000);
      const width = this.dragTrackWidth > 0 ? this.dragTrackWidth : window.innerWidth;
      const deltaMs = - (deltaX / width) * durationMs;

      const bounds = this.activeDayBounds();
      const minEndMs = bounds.start.getTime() + durationMs;
      const maxEndMs = bounds.end.getTime();
      const newEndMs = Math.max(minEndMs, Math.min(maxEndMs, this.dragStartEndMs + deltaMs));
      const nextWindowEnd = new Date(newEndMs);

      this.playbackWindowEndSignal.set(nextWindowEnd);
      this.playbackWindowEndChange.emit(nextWindowEnd);
    } else if (this.isSeekingNeedle()) {
      this.seekNeedleToEvent(event);
    }
  }

  @HostListener('window:mouseup')
  onTimelineMouseUp(): void {
    if (this.isDraggingTimeline()) {
      this.isDraggingTimeline.set(false);
      document.body.classList.remove('is-timeline-dragging');
    }
    if (this.isSeekingNeedle()) {
      this.isSeekingNeedle.set(false);
      document.body.classList.remove('is-timeline-dragging');
    }
  }

  private seekNeedleToEvent(event: MouseEvent): void {
    const durationMs = Math.min(86400 * 1000, this.zoomRangeSecondsSignal() * 1000);
    const width = this.dragTrackWidth > 0 ? this.dragTrackWidth : window.innerWidth;

    const trackElem = (document.querySelector('.timeline-ruler-track') || document.querySelector('.timeline-slider-wrapper')) as HTMLElement;
    const rect = trackElem ? trackElem.getBoundingClientRect() : null;
    const left = rect ? rect.left : 0;
    const trackWidth = rect ? rect.width : width;

    const mouseX = Math.max(0, Math.min(event.clientX - left, trackWidth));
    const pct = trackWidth > 0 ? mouseX / trackWidth : 0;

    const range = this.timelineRange();
    const bounds = this.activeDayBounds();
    const now = new Date();
    const nowMs = now.getTime();
    const rawTargetMs = range.start.getTime() + durationMs * pct;

    const targetMs = Math.max(bounds.start.getTime(), Math.min(nowMs, rawTargetMs));
    const targetDate = new Date(targetMs);

    if (nowMs - targetMs < 1000 && this.playbackModeSignal() === 'live') {
      return;
    }

    if (this.playbackModeSignal() === 'live') {
      if (this.playbackWindowEndSignal() === null) {
        this.playbackWindowEndSignal.set(new Date());
        this.playbackWindowEndChange.emit(new Date());
      }
      this.playbackModeSignal.set('playback');
      this.playbackModeChange.emit('playback');
      this.pausedSignal.set(true);
      this.pausedChange.emit(true);
    }

    this.isEditingTimeSegments = false;
    this.isEditingDateSegments = false;
    this.syncTimeSegments(targetDate);
    this.syncDateSegments(targetDate);

    this.currentTimeSignal.set(targetDate);
    this.timeChange.emit(targetDate);
  }

  onTimelineMouseMove(event: MouseEvent): void {
    const trackElem = (document.querySelector('.timeline-ruler-track') || event.currentTarget) as HTMLElement;
    if (!trackElem) return;

    const rect = trackElem.getBoundingClientRect();
    const mouseX = Math.max(0, Math.min(event.clientX - rect.left, rect.width));
    const pct = rect.width > 0 ? (mouseX / rect.width) * 100 : 0;

    const range = this.timelineRange();
    const startMs = range.start.getTime();
    const endMs = range.end.getTime();
    const targetMs = startMs + ((endMs - startMs) * (pct / 100));
    const hoverDate = new Date(targetMs);

    const pad = (n: number) => n.toString().padStart(2, '0');
    const timeLabel = `${pad(hoverDate.getHours())}:${pad(hoverDate.getMinutes())}:${pad(hoverDate.getSeconds())}`;

    // Count events near hover point
    const thresholdMs = (this.zoomRangeSecondsSignal() * 1000) * 0.02;
    const nearbyEvents = this.eventsSignal().filter(e => {
      const t = e.timestampMs || (e.timestampMs = new Date(e.timestamp).getTime());
      return Math.abs(t - targetMs) <= thresholdMs;
    });

    this.timelineHoverInfo.set({
      visible: true,
      leftPct: pct,
      timeLabel,
      eventCount: nearbyEvents.length
    });
  }

  onTimelineMouseLeave(): void {
    this.timelineHoverInfo.update(h => ({ ...h, visible: false }));
  }

  onTimelineWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY > 0 ? 1 : -1;
    const zoomSteps = [60, 300, 900, 1800, 3600, 7200, 14400, 28800, 43200, 86400];
    const current = this.zoomRangeSecondsSignal();
    let idx = zoomSteps.findIndex(s => s >= current);
    if (idx === -1) idx = zoomSteps.length - 1;

    const nextIdx = Math.max(0, Math.min(zoomSteps.length - 1, idx + delta));
    const nextSec = zoomSteps[nextIdx];
    if (nextSec !== current) {
      this.zoomRangeSecondsSignal.set(nextSec);
      this.zoomChange.emit(nextSec);
    }
  }

  // --- Clock Segment Edit Handlers ---
  onSegmentFocus(): void {
    this.isEditingTimeSegments = true;
  }

  onSegmentBlur(segment: 'h' | 'm' | 's'): void {
    this.isEditingTimeSegments = false;
    this.applyTimeSegments();
  }

  onHoursSegmentInput(val: string, nextInput?: HTMLInputElement): void {
    const clean = val.replace(/\D/g, '').slice(0, 2);
    this.hoursSegmentStr.set(clean);
    if (clean.length === 2 && nextInput) {
      nextInput.focus();
      nextInput.select();
    }
    if (clean.length === 2) {
      this.applyTimeSegments();
    }
  }

  onMinutesSegmentInput(val: string, nextInput?: HTMLInputElement): void {
    const clean = val.replace(/\D/g, '').slice(0, 2);
    this.minutesSegmentStr.set(clean);
    if (clean.length === 2 && nextInput) {
      nextInput.focus();
      nextInput.select();
    }
    if (clean.length === 2) {
      this.applyTimeSegments();
    }
  }

  onSecondsSegmentInput(val: string): void {
    const clean = val.replace(/\D/g, '').slice(0, 2);
    this.secondsSegmentStr.set(clean);
    if (clean.length === 2) {
      this.applyTimeSegments();
    }
  }

  onSegmentKeydown(event: KeyboardEvent, currentVal: string, prevInput?: HTMLInputElement, nextInput?: HTMLInputElement): void {
    if (event.key === 'ArrowRight' && nextInput) {
      event.preventDefault();
      nextInput.focus();
      nextInput.select();
    } else if (event.key === 'ArrowLeft' && prevInput) {
      event.preventDefault();
      prevInput.focus();
      prevInput.select();
    }
  }

  private applyTimeSegments(): void {
    let h = parseInt(this.hoursSegmentStr(), 10);
    let m = parseInt(this.minutesSegmentStr(), 10);
    let s = parseInt(this.secondsSegmentStr(), 10);

    if (isNaN(h) || h < 0) h = 0;
    if (h > 23) h = 23;
    if (isNaN(m) || m < 0) m = 0;
    if (m > 59) m = 59;
    if (isNaN(s) || s < 0) s = 0;
    if (s > 59) s = 59;

    const pad = (n: number) => n.toString().padStart(2, '0');
    this.hoursSegmentStr.set(pad(h));
    this.minutesSegmentStr.set(pad(m));
    this.secondsSegmentStr.set(pad(s));

    const curr = this.currentTimeSignal();
    const updated = new Date(curr.getFullYear(), curr.getMonth(), curr.getDate(), h, m, s);
    const now = new Date();

    if (updated.getTime() > now.getTime()) {
      this.currentTimeSignal.set(now);
      this.timeChange.emit(now);
      this.setLiveMode();
      return;
    }

    if (this.playbackModeSignal() === 'live') {
      this.playbackModeSignal.set('playback');
      this.playbackModeChange.emit('playback');
      this.pausedSignal.set(true);
      this.pausedChange.emit(true);
      this.playbackWindowEndSignal.set(new Date());
      this.playbackWindowEndChange.emit(new Date());
    }

    this.currentTimeSignal.set(updated);
    this.timeChange.emit(updated);
  }

  // --- Date Segment Edit Handlers ---
  onDateSegmentFocus(): void {
    this.isEditingDateSegments = true;
  }

  onDateSegmentBlur(segment: 'd' | 'm' | 'y'): void {
    this.isEditingDateSegments = false;
    this.applyDateSegments();
  }

  onDaySegmentInput(val: string, nextInput?: HTMLInputElement): void {
    const clean = val.replace(/\D/g, '').slice(0, 2);
    this.dateDayStr.set(clean);
    if (clean.length === 2 && nextInput) {
      nextInput.focus();
      nextInput.select();
    }
    if (clean.length === 2) {
      this.applyDateSegments();
    }
  }

  onMonthSegmentInput(val: string, nextInput?: HTMLInputElement): void {
    const clean = val.replace(/\D/g, '').slice(0, 2);
    this.dateMonthStr.set(clean);
    if (clean.length === 2 && nextInput) {
      nextInput.focus();
      nextInput.select();
    }
    if (clean.length === 2) {
      this.applyDateSegments();
    }
  }

  onYearSegmentInput(val: string): void {
    const clean = val.replace(/\D/g, '').slice(0, 4);
    this.dateYearStr.set(clean);
    if (clean.length === 4) {
      this.applyDateSegments();
    }
  }

  onDateSegmentKeydown(event: KeyboardEvent, currentVal: string, prevInput?: HTMLInputElement, nextInput?: HTMLInputElement): void {
    if (event.key === 'ArrowRight' && nextInput) {
      event.preventDefault();
      nextInput.focus();
      nextInput.select();
    } else if (event.key === 'ArrowLeft' && prevInput) {
      event.preventDefault();
      prevInput.focus();
      prevInput.select();
    }
  }

  private applyDateSegments(): void {
    let d = parseInt(this.dateDayStr(), 10);
    let m = parseInt(this.dateMonthStr(), 10);
    let y = parseInt(this.dateYearStr(), 10);

    if (isNaN(y) || y < 2000) y = new Date().getFullYear();
    if (isNaN(m) || m < 1) m = 1;
    if (m > 12) m = 12;

    const daysInMonth = new Date(y, m, 0).getDate();
    if (isNaN(d) || d < 1) d = 1;
    if (d > daysInMonth) d = daysInMonth;

    const pad = (n: number) => n.toString().padStart(2, '0');
    this.dateDayStr.set(pad(d));
    this.dateMonthStr.set(pad(m));
    this.dateYearStr.set(y.toString());

    const curr = this.currentTimeSignal();
    const updated = new Date(y, m - 1, d, curr.getHours(), curr.getMinutes(), curr.getSeconds());
    const now = new Date();

    if (updated.getTime() > now.getTime()) {
      this.currentTimeSignal.set(now);
      this.timeChange.emit(now);
      this.setLiveMode();
      return;
    }

    if (this.playbackModeSignal() === 'live') {
      this.playbackModeSignal.set('playback');
      this.playbackModeChange.emit('playback');
      this.pausedSignal.set(true);
      this.pausedChange.emit(true);
      const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
      this.playbackWindowEndSignal.set(dayEnd);
      this.playbackWindowEndChange.emit(dayEnd);
    }

    this.currentTimeSignal.set(updated);
    this.timeChange.emit(updated);
  }
}
