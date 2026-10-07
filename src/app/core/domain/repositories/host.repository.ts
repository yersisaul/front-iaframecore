import { Observable } from 'rxjs';
import { Host, HostMetrics, ReliabilityHostStatusDTO } from '../entities/host.models';

export abstract class IHostRepository {
  abstract getAll(): Observable<Host[]>;
  abstract getHeartbeat(fingerprint: string): Observable<HostMetrics>;
  abstract getInfoModels(fingerprint: string): Observable<any>;
  abstract getReliabilityHosts(): Observable<ReliabilityHostStatusDTO[]>;
  abstract migrateSetup(oldFingerprint: string, newFingerprint: string): Observable<void>;
  abstract allowReenroll(fingerprint: string): Observable<any>;
  abstract delete(fingerprint: string): Observable<void>;
}

