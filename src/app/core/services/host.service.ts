import { Injectable, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { Host, HostMetrics } from '../domain/entities/host.models';
import { IHostRepository } from '../domain/repositories/host.repository';

export interface HostFilterOptions {
  os: string[];
  arch: string[];
  gpu: string[];
  vram: string[];
  version: string[];
}

export interface HostFilterParams {
  search?: string;
  status?: string;
  os?: string;
  arch?: string;
  gpu?: string;
  vram?: string;
  version?: string;
}

@Injectable({
  providedIn: 'root'
})
export class HostService {
  /** All hosts loaded from the backend (unfiltered, used for client-side filtering) */
  readonly allHosts = signal<Host[]>([]);
  /** Backward-compat alias kept for components that only need the current page slice */
  readonly hosts = signal<Host[]>([]);
  readonly totalItems = signal(0);

  readonly isViewActive = signal<boolean>(false);
  readonly newHostIds = signal<Set<string>>(new Set());
  readonly updatedHostIds = signal<Set<string>>(new Set());
  readonly deletingHostIds = signal<Set<string>>(new Set());

  markAsNewHost(id: string): void {
    this.newHostIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newHostIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 2000);
  }

  markAsUpdatedHost(id: string): void {
    this.updatedHostIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.updatedHostIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 2000);
  }

  markAsDeletingHost(id: string): void {
    this.deletingHostIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.deletingHostIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  deleteHostLocal(fingerprint: string): void {
    this.allHosts.update(hosts => hosts.filter(h => h.fingerprint !== fingerprint));
  }

  migrateHostLocal(oldFingerprint: string, newFingerprint: string): void {
    this.allHosts.update(hosts => 
      hosts.map(h => {
        if (h.fingerprint === oldFingerprint) {
          return { ...h, fingerprint: newFingerprint };
        }
        return h;
      })
    );
  }

  constructor(private hostRepository: IHostRepository) {}

  /**
   * Loads ALL hosts from the backend in a single request.
   * Client-side filtering and pagination is applied by the component.
   */
  loadAllHosts(): Observable<Host[]> {
    return this.hostRepository.getAll().pipe(
      tap(items => {
        this.allHosts.set(items);
        this.hosts.set(items);
        this.totalItems.set(items.length);
      }),
      catchError(() => {
        this.allHosts.set([]);
        this.hosts.set([]);
        this.totalItems.set(0);
        return of([]);
      })
    );
  }

  /**
   * Legacy method kept for backward compatibility with Horarios view.
   * Use loadAllHosts() for the Nodos view.
   */
  getHosts(page: number, limit: number, filters?: HostFilterParams): Observable<Host[]> {
    return this.loadAllHosts();
  }

  /**
   * Builds available filter option lists from the already-loaded allHosts signal.
   * Call this after loadAllHosts() has resolved.
   */
  buildFilterOptions(): HostFilterOptions {
    const items = this.allHosts();
    const osSet = new Set<string>();
    const archSet = new Set<string>();
    const gpuSet = new Set<string>();
    const vramSet = new Set<string>();
    const versionSet = new Set<string>();

    items.forEach(h => {
      if (h.hwInfo?.system) osSet.add(h.hwInfo.system);
      if (h.hwInfo?.arch) archSet.add(h.hwInfo.arch);
      if (h.gpuInfo?.model) gpuSet.add(h.gpuInfo.model);
      if (h.gpuInfo?.totalMemory) vramSet.add(h.gpuInfo.totalMemory);
      if (h.version) versionSet.add(h.version);
    });

    return {
      os: Array.from(osSet).sort(),
      arch: Array.from(archSet).sort(),
      gpu: Array.from(gpuSet).sort(),
      vram: Array.from(vramSet).sort(),
      version: Array.from(versionSet).sort()
    };
  }

  /**
   * @deprecated Use buildFilterOptions() after loadAllHosts() instead.
   */
  getHostFilterOptions(): Observable<HostFilterOptions> {
    return of(this.buildFilterOptions());
  }

  getHeartbeat(fingerprint: string): Observable<HostMetrics> {
    return this.hostRepository.getHeartbeat(fingerprint);
  }

  updateHostMetrics(fingerprint: string, metrics: HostMetrics | null, status?: string): void {
    this.allHosts.update(hosts => 
      hosts.map(h => {
        if (h.fingerprint === fingerprint) {
          const updated: Host = { ...h };
          if (status !== undefined) {
            updated.status = status;
          }
          if (metrics !== undefined) {
            if (metrics === null) {
              const lastSeenVal = h.metrics?.lastSeen || null;
              if (lastSeenVal) {
                updated.metrics = {
                  lastSeen: lastSeenVal,
                  cpu: null as any,
                  gpu: null as any,
                  vram: null as any,
                  memory: null as any
                };
              } else {
                updated.metrics = null;
              }
            } else {
              updated.metrics = metrics;
            }
          }
          return updated;
        }
        return h;
      })
    );
  }

  migrateSetup(oldFingerprint: string, newFingerprint: string): Observable<void> {
    return this.hostRepository.migrateSetup(oldFingerprint, newFingerprint).pipe(
      tap(() => {
        this.loadAllHosts().subscribe();
      })
    );
  }
}
