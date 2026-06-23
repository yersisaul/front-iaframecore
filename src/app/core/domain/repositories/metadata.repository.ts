import { Observable } from 'rxjs';
import { MetaIndexName, MetaRecord, MetaIndexInfo, MetaRostro } from '../entities/metadata.models';
import { MetaFilterState, MetaFilterOptions } from '../entities/metadata.filters.models';

export interface MetadataSearchResult {
  records: MetaRecord[];
  total: number;
  filterOptions: MetaFilterOptions;
}

export abstract class IMetadataRepository {
  abstract getAvailableIndices(): Observable<MetaIndexInfo[]>;
  abstract search(
    index: MetaIndexName,
    filters: MetaFilterState,
    page: number,
    pageSize: number
  ): Observable<MetadataSearchResult>;
  abstract searchFacesByImage(file: File, size: number): Observable<MetaRostro[]>;
}
