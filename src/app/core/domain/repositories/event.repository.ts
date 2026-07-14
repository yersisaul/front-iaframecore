import { Observable } from 'rxjs';
import { EventFilters, EventRecord, EventFilterOptions } from '../entities/event.models';

export interface EventSearchResult {
  records: EventRecord[];
  total: number;
  filterOptions: EventFilterOptions;
}

export abstract class IEventRepository {
  abstract search(
    filters: EventFilters,
    page: number,
    pageSize: number
  ): Observable<EventSearchResult>;
  abstract getById(docId: string): Observable<EventRecord>;
}
