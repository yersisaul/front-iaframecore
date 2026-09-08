import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { Sidebar } from './sidebar';

import { provideHttpClient } from '@angular/common/http';
import { IAuthRepository } from '../../../core/domain/repositories/auth.repository';
import { AuthHttpRepository } from '../../../data/repositories/auth-http.repository';
import { IMetadataRepository } from '../../../core/domain/repositories/metadata.repository';
import { OpenSearchRepository } from '../../../data/repositories/opensearch.repository';
import { IEventRepository } from '../../../core/domain/repositories/event.repository';
import { EventHttpRepository } from '../../../data/repositories/event-http.repository';
import { ICameraRepository } from '../../../core/domain/repositories/camera.repository';
import { CameraHttpRepository } from '../../../data/repositories/camera-http.repository';
import { WebsocketService } from '../../../core/services/websocket.service';

describe('Sidebar', () => {
  let component: Sidebar;
  let fixture: ComponentFixture<Sidebar>;

  const mockWebsocketService = {
    isWebRtcActive: vi.fn().mockReturnValue(false),
    sendWebRtcStart: vi.fn(),
    sendWebRtcStop: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: signal(false)
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Sidebar],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        { provide: IAuthRepository, useClass: AuthHttpRepository },
        { provide: IMetadataRepository, useClass: OpenSearchRepository },
        { provide: IEventRepository, useClass: EventHttpRepository },
        { provide: ICameraRepository, useClass: CameraHttpRepository },
        { provide: WebsocketService, useValue: mockWebsocketService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(Sidebar);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
