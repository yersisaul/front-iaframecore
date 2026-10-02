import { Observable } from 'rxjs';
import { ReliabilityCommand, ReliabilityCommandQueryParams } from '../entities/reliability-command.models';

export abstract class IReliabilityCommandRepository {
  abstract getCommands(params?: ReliabilityCommandQueryParams): Observable<ReliabilityCommand[]>;
}
