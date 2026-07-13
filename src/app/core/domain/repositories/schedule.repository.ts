import { Observable } from 'rxjs';
import { Schedule } from '../entities/schedule.models';

export abstract class IScheduleRepository {
  abstract getAll(): Observable<Schedule[]>;
  abstract getById(scheduleId: string): Observable<Schedule>;
  abstract register(dto: any): Observable<any>;
  abstract update(scheduleId: string, dto: any): Observable<any>;
  abstract updateState(scheduleId: string, status: 'activo' | 'inactivo'): Observable<any>;
  abstract delete(scheduleId: string): Observable<any>;
}
