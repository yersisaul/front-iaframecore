import { Observable } from 'rxjs';
import { List, ListDetail } from '../entities/list.models';

export abstract class IListRepository {
  abstract getLists(): Observable<List[]>;
  abstract registerList(list: Partial<List>): Observable<List>;
  abstract deleteList(listId: string): Observable<void>;
  abstract getListDetails(listId: string): Observable<ListDetail[]>;
  abstract registerListDetail(detail: Partial<ListDetail>, file?: File): Observable<ListDetail>;
  abstract deleteListDetail(detailId: string): Observable<void>;
  abstract querySubjectDetections(subjectName: string, type: 'face' | 'plate', documentId?: string): Observable<any[]>;
  abstract updateList(list: List): Observable<List>;
}
