import { Observable } from 'rxjs';
import { List, ListDetail } from '../entities/list.models';

export abstract class IListRepository {
  abstract getLists(): Observable<List[]>;
  abstract getListById(listId: string): Observable<List>;
  abstract registerList(list: Partial<List>): Observable<List>;
  abstract deleteList(listId: string): Observable<void>;
  abstract getListDetails(listId: string): Observable<ListDetail[]>;
  abstract getListDetailById(detailId: string): Observable<ListDetail>;
  abstract registerListDetail(detail: Partial<ListDetail>, file?: File): Observable<ListDetail>;
  abstract deleteListDetail(detailId: string): Observable<void>;
  abstract querySubjectDetections(detailId: string): Observable<any[]>;
  abstract queryListEventSummaries(listId: string): Observable<Record<string, { count: number; latestHit?: any }>>;
  abstract updateList(list: List): Observable<List>;
  abstract updateFaceImg(detailId: string, file: File): Observable<ListDetail>;
  abstract updateFaceDetail(detailId: string, listId: string, payload: { nombre_asociado: string }): Observable<ListDetail>;
  abstract updatePlateDetail(detailId: string, listId: string, payload: { nombre_asociado?: string, plate_text: string }): Observable<ListDetail>;
}
