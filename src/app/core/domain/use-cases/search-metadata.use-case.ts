import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { IMetadataRepository, MetadataSearchResult } from '../repositories/metadata.repository';
import { MetaIndexName } from '../entities/metadata.models';
import { MetaFilterState } from '../entities/metadata.filters.models';

@Injectable({
  providedIn: 'root'
})
export class SearchMetadataUseCase {
  constructor(private metadataRepository: IMetadataRepository) {}

  execute(
    index: MetaIndexName,
    filters: MetaFilterState,
    page: number,
    pageSize: number
  ): Observable<MetadataSearchResult> {
    return this.metadataRepository.search(index, filters, page, pageSize);
  }
}
