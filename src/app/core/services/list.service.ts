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
}
