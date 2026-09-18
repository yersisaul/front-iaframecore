import { Pipe, PipeTransform, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MediaFileService } from '../../../core/services/media-file.service';

@Pipe({
  name: 'mediaUrl',
  standalone: true
})
export class MediaUrlPipe implements PipeTransform {
  private mediaFileService = inject(MediaFileService);

  transform(objectName: string | null | undefined): Observable<string> {
    return this.mediaFileService.getFileUrl(objectName);
  }
}
