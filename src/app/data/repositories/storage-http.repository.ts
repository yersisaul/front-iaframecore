import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { IStorageRepository, UploadResult } from '../../core/domain/repositories/storage.repository';
import { AppEnvironment } from '../../core/config/app-environment';

@Injectable({
  providedIn: 'root'
})
export class StorageHttpRepository implements IStorageRepository {
  private readonly apiUrl = `${AppEnvironment.apiUrl}/storage/upload`;

  constructor(private http: HttpClient) {}

  uploadImage(category: string, file: File): Observable<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<any>(`${this.apiUrl}/${category}`, formData).pipe(
      map(res => {
        return {
          url: res.url || res.url_img || '',
          embedding: res.embedding || []
        };
      })
    );
  }
}
