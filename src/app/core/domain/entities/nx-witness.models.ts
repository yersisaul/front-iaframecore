/**
 * Modelos y contratos de TypeScript para la API de cliente de Nx Witness Desktop (window.vms)
 */

export interface NxResource {
  id: string;
  name: string;
  type: string;
  logicalId?: number;
}

export interface NxItemMediaParams {
  speed?: number;
  timestampMs?: number;
  timelineSelection?: any;
  timelineWindow?: any;
}

export interface NxItemParams {
  selected?: boolean;
  focused?: boolean;
  geometry?: any;
  media?: NxItemMediaParams;
}

export interface NxErrorResult {
  code: number;
  description: string;
}

export interface NxItemResult {
  error: NxErrorResult;
  item?: any;
}

export interface NxErrorCode {
  success: number;
  failed: number;
  denied: number;
  invalid_args: number;
}

export interface NxLog {
  info: (msg: string) => void;
  warning: (msg: string) => void;
  error: (msg: string) => void;
  debug: (msg: string) => void;
}

export interface NxResourcesApi {
  resources: () => Promise<NxResource[]>;
  hasMediaStream: (resourceId: string) => Promise<boolean>;
  added?: { connect: (callback: (resource: NxResource) => void) => void };
  removed?: { connect: (callback: (id: string) => void) => void };
}

export interface NxTabApi {
  name?: string;
  addItem: (resourceId: string, params?: NxItemParams) => Promise<NxItemResult>;
  setItemParameters?: (itemId: string, params: NxItemParams) => Promise<NxErrorResult>;
  setItemParams?: (itemId: string, params: NxItemParams) => Promise<NxErrorResult>;
  removeItem?: (itemId: string) => Promise<NxErrorResult>;
  state?: () => Promise<any>;
  saveLayout?: () => Promise<NxErrorResult>;
  syncWith?: (itemId: string) => Promise<NxErrorResult>;
}

export interface NxVmsApi {
  log: NxLog;
  resources: NxResourcesApi;
  tab: NxTabApi;
  ErrorCode: NxErrorCode;
}

declare global {
  interface Window {
    vmsApiInit?: () => Promise<void> | void;
    vms?: NxVmsApi;
    isVmsApiEnabled?: boolean;
  }
}
