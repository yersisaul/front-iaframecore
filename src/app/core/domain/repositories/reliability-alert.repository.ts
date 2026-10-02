import { Observable } from 'rxjs';
import { ReliabilityAlert, ReliabilityAlertQueryParams } from '../entities/reliability-alert.models';

export abstract class IReliabilityAlertRepository {
  abstract getAlerts(params?: ReliabilityAlertQueryParams): Observable<ReliabilityAlert[]>;
}
