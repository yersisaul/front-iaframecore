import { Observable } from 'rxjs';

export interface UploadResult {
  url: string;
  embedding: number[];
}

export abstract class IStorageRepository {
  abstract uploadImage(category: string, file: File): Observable<UploadResult>;
}
