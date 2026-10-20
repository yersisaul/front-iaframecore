import '@angular/compiler';
import { Injector } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { of } from 'rxjs';
import { DashboardHttpRepository } from './dashboard-http.repository';
import { AppEnvironment } from '../../core/config/app-environment';
import { DashboardCreateRequest, DashboardUpdateRequest } from '../../core/domain/entities/dashboard.models';

describe('DashboardHttpRepository', () => {
  let repository: DashboardHttpRepository;
  let mockHttp: {
    get: any;
    post: any;
    put: any;
    patch: any;
    delete: any;
  };
  const baseUrl = `${AppEnvironment.apiUrl}/frontend/dashboards`;

  beforeEach(() => {
    mockHttp = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn()
    };

    const injector = Injector.create({
      providers: [
        { provide: HttpClient, useValue: mockHttp },
        DashboardHttpRepository
      ]
    });

    repository = injector.get(DashboardHttpRepository);
  });

  it('GET /frontend/dashboards/ - should fetch all dashboards and map to domain items', async () => {
    const mockBackendResponse = [
      {
        dashboard_id: '2c13d010-f456-4c33-9116-525992d44a46',
        url: 'asd.com',
        name: 'dsasad',
        description: 'asd',
        img_minio_object_name: 'images/dashboards/2026/10/19/ebfd7720-7495-4281-900c-61904a71ac76.png'
      }
    ];

    mockHttp.get.mockReturnValue(of(mockBackendResponse));

    repository.getAll().subscribe(items => {
      expect(items.length).toBe(1);
      expect(items[0].id).toBe('2c13d010-f456-4c33-9116-525992d44a46');
      expect(items[0].nombre).toBe('dsasad');
      expect(items[0].name).toBe('dsasad');
      expect(items[0].descripcion).toBe('asd');
      expect(items[0].description).toBe('asd');
      expect(items[0].img_minio_object_name).toBe('images/dashboards/2026/10/19/ebfd7720-7495-4281-900c-61904a71ac76.png');
    });

    expect(mockHttp.get).toHaveBeenCalledWith(`${baseUrl}/`);
  });

  it('GET /frontend/dashboards/{dashboard_id} - should fetch single dashboard by ID', () => {
    const dashId = '5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573';
    const mockBackendResponse = {
      dashboard_id: dashId,
      name: 'Dashboard Principal',
      url: 'http://localhost:5601/frontend/dashboards/5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573',
      description: 'Dashboard principal para monitoreo de hosts y métricas',
      img_minio_object_name: 'dashboards/2024/06/15/5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573.jpg'
    };

    mockHttp.get.mockReturnValue(of(mockBackendResponse));

    repository.getById(dashId).subscribe(item => {
      expect(item.id).toBe(dashId);
      expect(item.nombre).toBe('Dashboard Principal');
      expect(item.img_minio_object_name).toBe('dashboards/2024/06/15/5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573.jpg');
    });

    expect(mockHttp.get).toHaveBeenCalledWith(`${baseUrl}/${dashId}`);
  });

  it('POST /frontend/dashboards/ - should send new payload and return mapped domain item', () => {
    const payload: DashboardCreateRequest = {
      dashboard_id: '2c13d010-f456-4c33-9116-525992d44a46',
      name: 'dsasad',
      url: 'asd.com',
      description: 'asd',
      img_minio_object_name: 'images/dashboards/2026/10/19/ebfd7720-7495-4281-900c-61904a71ac76.png'
    };

    const mockBackendResponse = {
      dashboard_id: '2c13d010-f456-4c33-9116-525992d44a46',
      name: 'dsasad',
      url: 'asd.com',
      description: 'asd',
      img_minio_object_name: 'images/dashboards/2026/10/19/ebfd7720-7495-4281-900c-61904a71ac76.png'
    };

    mockHttp.post.mockReturnValue(of(mockBackendResponse));

    repository.create(payload).subscribe(created => {
      expect(created.id).toBe('2c13d010-f456-4c33-9116-525992d44a46');
      expect(created.nombre).toBe('dsasad');
      expect(created.img_minio_object_name).toBe('images/dashboards/2026/10/19/ebfd7720-7495-4281-900c-61904a71ac76.png');
    });

    expect(mockHttp.post).toHaveBeenCalledWith(`${baseUrl}/`, payload);
  });

  it('PUT /frontend/dashboards/{dashboard_id} - should update full dashboard via update()', () => {
    const dashId = '5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573';
    const updatePayload: DashboardUpdateRequest = {
      dashboard_id: dashId,
      name: 'Dashboard Actualizado',
      url: 'http://localhost:5601/frontend/dashboards/updated',
      description: 'Nueva descripción',
      img_minio_object_name: 'dashboards/2024/06/15/updated.jpg'
    };

    const mockBackendResponse = {
      dashboard_id: dashId,
      name: 'Dashboard Actualizado',
      url: 'http://localhost:5601/frontend/dashboards/updated',
      description: 'Nueva descripción',
      img_minio_object_name: 'dashboards/2024/06/15/updated.jpg'
    };

    mockHttp.put.mockReturnValue(of(mockBackendResponse));

    repository.update(dashId, updatePayload).subscribe(updated => {
      expect(updated.id).toBe(dashId);
      expect(updated.nombre).toBe('Dashboard Actualizado');
      expect(updated.img_minio_object_name).toBe('dashboards/2024/06/15/updated.jpg');
    });

    expect(mockHttp.put).toHaveBeenCalledWith(`${baseUrl}/${dashId}`, updatePayload);
  });

  it('PATCH /frontend/dashboards/{dashboard_id} - should partially update dashboard via patch()', () => {
    const dashId = '5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573';
    const patchPayload = {
      description: 'Descripción editada parcialmente'
    };

    const mockBackendResponse = {
      dashboard_id: dashId,
      name: 'Dashboard Original',
      url: 'http://localhost:5601/frontend/dashboards/original',
      description: 'Descripción editada parcialmente',
      img_minio_object_name: 'dashboards/2024/06/15/5ed8b9e2.jpg'
    };

    mockHttp.patch.mockReturnValue(of(mockBackendResponse));

    repository.patch(dashId, patchPayload).subscribe(updated => {
      expect(updated.id).toBe(dashId);
      expect(updated.descripcion).toBe('Descripción editada parcialmente');
    });

    expect(mockHttp.patch).toHaveBeenCalledWith(`${baseUrl}/${dashId}`, patchPayload);
  });

  it('DELETE /frontend/dashboards/{dashboard_id} - should delete dashboard', () => {
    const dashId = '5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573';
    mockHttp.delete.mockReturnValue(of(null));

    repository.delete(dashId).subscribe();

    expect(mockHttp.delete).toHaveBeenCalledWith(`${baseUrl}/${dashId}`);
  });
});
