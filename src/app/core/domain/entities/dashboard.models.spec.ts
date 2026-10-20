import { describe, it, expect } from 'vitest';
import { DashboardMapper, DashboardResponse } from './dashboard.models';

describe('DashboardMapper', () => {
  it('should map backend response with new schema to domain DashboardItem', () => {
    const backendDto: DashboardResponse = {
      dashboard_id: '2c13d010-f456-4c33-9116-525992d44a46',
      url: 'http://grafana.internal/d/1',
      name: 'Métricas de Infraestructura',
      description: 'Monitoreo de CPU y Memoria',
      img_minio_object_name: 'images/dashboards/2026/10/19/ebfd7720-7495-4281-900c-61904a71ac76.png'
    };

    const domain = DashboardMapper.toDomain(backendDto);

    expect(domain.id).toBe('2c13d010-f456-4c33-9116-525992d44a46');
    expect(domain.nombre).toBe('Métricas de Infraestructura');
    expect(domain.name).toBe('Métricas de Infraestructura');
    expect(domain.url).toBe('http://grafana.internal/d/1');
    expect(domain.descripcion).toBe('Monitoreo de CPU y Memoria');
    expect(domain.description).toBe('Monitoreo de CPU y Memoria');
    expect(domain.img_minio_object_name).toBe('images/dashboards/2026/10/19/ebfd7720-7495-4281-900c-61904a71ac76.png');
    expect(domain.url_img).toBe('images/dashboards/2026/10/19/ebfd7720-7495-4281-900c-61904a71ac76.png');
  });

  it('should fallback gracefully to legacy fields if present', () => {
    const legacyDto: any = {
      id: 'legacy-id-123',
      nombre: 'Tablero Legacy',
      url_dashboard: 'http://legacy.url',
      descripcion: 'Detalle legacy',
      url_img: 'dashboards/2024/06/15/old.jpg'
    };

    const domain = DashboardMapper.toDomain(legacyDto);

    expect(domain.id).toBe('legacy-id-123');
    expect(domain.nombre).toBe('Tablero Legacy');
    expect(domain.url).toBe('http://legacy.url');
    expect(domain.descripcion).toBe('Detalle legacy');
    expect(domain.img_minio_object_name).toBe('dashboards/2024/06/15/old.jpg');
    expect(domain.url_img).toBe('dashboards/2024/06/15/old.jpg');
  });

  it('should generate create DTO with new fields and UUID', () => {
    const domainData = {
      nombre: 'Nuevo Dashboard',
      url: 'http://nuevo.dashboard.com',
      descripcion: 'Descripción del nuevo tablero',
      img_minio_object_name: 'images/dashboards/2026/10/19/test.png'
    };

    const createDto = DashboardMapper.toCreateDto(domainData);

    expect(createDto.name).toBe('Nuevo Dashboard');
    expect(createDto.url).toBe('http://nuevo.dashboard.com');
    expect(createDto.description).toBe('Descripción del nuevo tablero');
    expect(createDto.img_minio_object_name).toBe('images/dashboards/2026/10/19/test.png');
    expect(createDto.dashboard_id).toBeDefined();
  });

  it('should generate update DTO for PUT requests with all fields', () => {
    const domainData = {
      id: '5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573',
      name: 'Dashboard Principal',
      url: 'http://localhost:5601/frontend/dashboards/5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573',
      description: 'Dashboard principal para monitoreo de hosts y métricas',
      img_minio_object_name: 'dashboards/2024/06/15/5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573.jpg'
    };

    const updateDto = DashboardMapper.toUpdateDto(domainData);

    expect(updateDto.dashboard_id).toBe('5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573');
    expect(updateDto.name).toBe('Dashboard Principal');
    expect(updateDto.url).toBe('http://localhost:5601/frontend/dashboards/5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573');
    expect(updateDto.description).toBe('Dashboard principal para monitoreo de hosts y métricas');
    expect(updateDto.img_minio_object_name).toBe('dashboards/2024/06/15/5ed8b9e2-75f4-4d18-bcd0-4f62fd2d9573.jpg');
  });

  it('should generate patch DTO for PATCH requests with partial fields', () => {
    const partialData = {
      description: 'Descripción actualizada',
      img_minio_object_name: 'images/dashboards/updated.png'
    };

    const patchDto = DashboardMapper.toPatchDto(partialData);

    expect(patchDto.description).toBe('Descripción actualizada');
    expect(patchDto.img_minio_object_name).toBe('images/dashboards/updated.png');
    expect(patchDto.name).toBeUndefined();
    expect(patchDto.url).toBeUndefined();
  });
});
