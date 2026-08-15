import { Observable } from 'rxjs';
import { Host, HostMetrics } from '../entities/host.models';

export abstract class IHostRepository {
  abstract getAll(): Observable<Host[]>;
  abstract getHeartbeat(fingerprint: string): Observable<HostMetrics>;
  abstract getInfoModels(fingerprint: string): Observable<any>;
  abstract migrateSetup(oldFingerprint: string, newFingerprint: string): Observable<void>;
  abstract delete(fingerprint: string): Observable<void>;
}
