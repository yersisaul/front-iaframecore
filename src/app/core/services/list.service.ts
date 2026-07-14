import { Injectable, inject, signal } from '@angular/core';
import { Observable, of } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { IListRepository } from '../domain/repositories/list.repository';
import { List, ListDetail } from '../domain/entities/list.models';
import { IStorageRepository } from '../domain/repositories/storage.repository';

export interface DetectionHit {
  id: string;
  camara: string;
  timestamp: Date;
  confiabilidad: number;
  imagen: string;
  tipoObjeto?: string;
  edad?: string;
  genero?: string;
  reconocimiento?: string;
  posturas?: Array<{ postura: string; conteo: number }>;
  colores?: Array<{ colorText: string; r: number; g: number; b: number; porcentaje: number }>;
}

@Injectable({
  providedIn: 'root'
})
export class ListService {
  private listRepository = inject(IListRepository);
  private storageRepository = inject(IStorageRepository);

  readonly lists = signal<List[]>([]);
  readonly listDetails = signal<ListDetail[]>([]);
  readonly isLoading = signal<boolean>(false);
  readonly activeListId = signal<string | null>(null);
  readonly isViewActive = signal<boolean>(false);

  readonly newRecordIds = signal<Set<string>>(new Set());
  readonly updatedRecordIds = signal<Set<string>>(new Set());
  readonly deletingRecordIds = signal<Set<string>>(new Set());

  markAsNew(id: string): void {
    this.newRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.newRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  markAsUpdated(id: string): void {
    this.updatedRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.updatedRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  markAsDeleting(id: string): void {
    this.deletingRecordIds.update(s => new Set([...s, id]));
    setTimeout(() => {
      this.deletingRecordIds.update(s => { const next = new Set(s); next.delete(id); return next; });
    }, 1000);
  }

  // Configurable similarity threshold for vector similarity matching (default 0.85)
  readonly similarityThreshold = signal<number>(0.85);

  loadLists(): Observable<List[]> {
    this.isLoading.set(true);
    return this.listRepository.getLists().pipe(
      tap(items => {
        this.lists.set(items);
        this.isLoading.set(false);
      }),
      catchError(err => {
        console.error('Error loading watchlists:', err);
        this.lists.set([]);
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  createList(name: string, description: string, listType: string = 'face_recognition'): Observable<List> {
    this.isLoading.set(true);
    const newList: Partial<List> = {
      name,
      description,
      list_type: listType
    };
    return this.listRepository.registerList(newList).pipe(
      tap(() => {
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }

  updateList(listId: string, name: string, description: string, listType: string): Observable<List> {
    this.isLoading.set(true);
    const updatedList: List = {
      list_id: listId,
      name,
      description,
      list_type: listType
    };
    return this.listRepository.updateList(updatedList).pipe(
      tap(res => {
        this.lists.update(current => current.map(l => l.list_id === listId ? res : l));
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }

  deleteList(listId: string): Observable<void> {
    this.isLoading.set(true);
    return this.listRepository.deleteList(listId).pipe(
      tap(() => {
        this.lists.update(current => current.filter(l => l.list_id !== listId));
        this.listDetails.set([]);
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }

  loadListDetails(listId: string): Observable<ListDetail[]> {
    this.isLoading.set(true);
    this.activeListId.set(listId);
    return this.listRepository.getListDetails(listId).pipe(
      tap(details => {
        this.listDetails.set(details);
        this.isLoading.set(false);
      }),
      catchError(err => {
        console.error('Error loading watchlist details:', err);
        this.listDetails.set([]);
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  uploadAndAddSubject(listId: string, hostId: string, name: string, file: File): Observable<ListDetail> {
    this.isLoading.set(true);
    const detail: Partial<ListDetail> = {
      list_id: listId,
      nombre_asociado: name,
      fingerprint_host: hostId
    };
    return this.listRepository.registerListDetail(detail, file).pipe(
      tap(registeredDetail => {
        this.listDetails.update(current => [...current, registeredDetail]);
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }

  addPlateSubject(listId: string, plateText: string, ownerName?: string): Observable<ListDetail> {
    this.isLoading.set(true);
    const detail: Partial<ListDetail> = {
      list_id: listId,
      nombre_asociado: ownerName || '',
      fingerprint_host: '',
      embedding: [],
      metadata: {
        text_placa: plateText
      }
    };
    return this.listRepository.registerListDetail(detail).pipe(
      tap(registeredDetail => {
        this.listDetails.update(current => [...current, registeredDetail]);
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }

  deleteSubject(detailId: string): Observable<void> {
    this.isLoading.set(true);
    return this.listRepository.deleteListDetail(detailId).pipe(
      tap(() => {
        this.listDetails.update(current => current.filter(d => d.detail_id !== detailId));
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }

  /**
   * Queries OpenSearch for past face matches of the subject name.
   */
  queryDetections(subjectName: string, documentId?: string): Observable<DetectionHit[]> {
    return this.listRepository.querySubjectDetections(subjectName, 'face', documentId);
  }

  /**
   * Queries OpenSearch for past plate matches of the plate text.
   */
  queryPlateDetections(plateText: string, documentId?: string): Observable<DetectionHit[]> {
    return this.listRepository.querySubjectDetections(plateText, 'plate', documentId);
  }

  /**
   * Registers a subject to a control list using an existing metadata record from OpenSearch.
   */
  registerSubjectFromRecord(listId: string, name: string, record: any, listType: 'face_recognition' | 'plate_recognition'): Observable<ListDetail> {
    this.isLoading.set(true);
    const detail: Partial<ListDetail> = {
      list_id: listId,
      nombre_asociado: name || (listType === 'plate_recognition' ? 'Propietario no registrado' : ''),
      fingerprint_host: '', // Global scope
      embedding: [],
      metadata: {
        url_img: record.imagenRemota,
        document_id: record.id,
        ...(listType === 'plate_recognition' ? { text_placa: record.reconocimiento } : {})
      }
    };

    return this.listRepository.registerListDetail(detail).pipe(
      tap(newDetail => {
        this.listDetails.update(current => [...current, newDetail]);
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }

  deleteListLocal(listId: string): void {
    this.lists.update(current => current.filter(l => l.list_id !== listId));
    if (this.activeListId() === listId) {
      this.listDetails.set([]);
    }
  }

  addOrUpdateListLocal(list: List): void {
    this.lists.update(arr => {
      const idx = arr.findIndex(l => l.list_id === list.list_id);
      if (idx !== -1) {
        const updated = [...arr];
        updated[idx] = list;
        return updated;
      }
      return [...arr, list];
    });
  }

  addOrUpdateListDetailLocal(detail: ListDetail): void {
    this.listDetails.update(arr => {
      const idx = arr.findIndex(d => d.detail_id === detail.detail_id);
      if (idx !== -1) {
        const updated = [...arr];
        updated[idx] = detail;
        return updated;
      }
      return [...arr, detail];
    });
  }

  deleteSubjectLocal(detailId: string): void {
    this.listDetails.update(current => current.filter(d => d.detail_id !== detailId));
  }

  updateFaceImg(detailId: string, file: File): Observable<ListDetail> {
    this.isLoading.set(true);
    return this.listRepository.updateFaceImg(detailId, file).pipe(
      tap(res => {
        this.listDetails.update(current => current.map(d => d.detail_id === detailId ? { ...d, metadata: { ...d.metadata, url_img: res.metadata?.url_img } } : d));
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }

  updateFaceDetail(detailId: string, listId: string, nombreAsociado: string): Observable<ListDetail> {
    this.isLoading.set(true);
    return this.listRepository.updateFaceDetail(detailId, listId, { nombre_asociado: nombreAsociado }).pipe(
      tap(res => {
        this.listDetails.update(current => current.map(d => d.detail_id === detailId ? { ...d, nombre_asociado: res.nombre_asociado } : d));
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }

  updatePlateDetail(detailId: string, listId: string, plateText: string, nombreAsociado?: string): Observable<ListDetail> {
    this.isLoading.set(true);
    return this.listRepository.updatePlateDetail(detailId, listId, { nombre_asociado: nombreAsociado, plate_text: plateText }).pipe(
      tap(res => {
        this.listDetails.update(current => current.map(d => d.detail_id === detailId ? { 
          ...d, 
          nombre_asociado: res.nombre_asociado,
          metadata: { ...d.metadata, text_placa: res.metadata?.text_placa }
        } : d));
        this.isLoading.set(false);
      }),
      catchError(err => {
        this.isLoading.set(false);
        throw err;
      })
    );
  }
}
