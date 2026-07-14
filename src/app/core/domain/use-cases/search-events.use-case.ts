import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { EventFilters } from '../entities/event.models';
import { IEventRepository, EventSearchResult } from '../repositories/event.repository';

@Injectable({
  providedIn: 'root'
})
export class SearchEventsUseCase {
  constructor(private eventRepository: IEventRepository) {}

  execute(
    filters: EventFilters,
    page: number,
    pageSize: number
  ): Observable<EventSearchResult> {
    return this.eventRepository.search(filters, page, pageSize);
  }
}
