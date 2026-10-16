import { SendToApiStatus, validateScheduledActions } from './scheduled-actions-validation.util';

const enableDisable = (analitica: string, seq = '00') => ({
  tipo: `Habilitar/Deshabilitar Analisis-${seq}`,
  accion: { analitica, estado: 'active' }
});

const sendToApi = (endpoint = 'http://10.0.0.5:3010/azor-analytics/reports', id = 'rt-1') => ({
  tipo: 'Enviar a API-00',
  accion: { endpoint, id_report_type: id }
});

describe('validateScheduledActions', () => {
  it('should accept no actions', () => {
    expect(validateScheduledActions(null, {})).toEqual({ invalid: null, pendingSendToApi: false });
    expect(validateScheduledActions({}, {})).toEqual({ invalid: null, pendingSendToApi: false });
  });

  it('should accept valid enable/disable and send-to-api actions', () => {
    const result = validateScheduledActions(
      { '0': enableDisable('an-1'), '1': sendToApi() },
      { '1': 'ok' }
    );
    expect(result).toEqual({ invalid: null, pendingSendToApi: false });
  });

  it('should detect enable/disable actions emitted with the backend type and no target analytic', () => {
    const result = validateScheduledActions({ '0': enableDisable('') }, {});
    expect(result.invalid).toEqual({ key: '0', reason: 'missing-target-analytic' });
  });

  it.each<[SendToApiStatus, string]>([
    ['missing-domain', 'missing-domain'],
    ['invalid-domain', 'invalid-domain'],
    ['unreachable-domain', 'unreachable-domain'],
    ['missing-report-type', 'missing-report-type'],
    ['unknown-report-type', 'unknown-report-type']
  ])('should block a send-to-api action reported as %s', (status, reason) => {
    const result = validateScheduledActions({ '3': sendToApi() }, { '3': status });
    expect(result.invalid).toEqual({ key: '3', reason });
    expect(result.pendingSendToApi).toBe(false);
  });

  it('should mark checking actions as pending without blocking them yet', () => {
    const result = validateScheduledActions({ '0': sendToApi() }, { '0': 'checking' });
    expect(result).toEqual({ invalid: null, pendingSendToApi: true });
  });

  it('should infer the minimum from the payload when a send-to-api action has no reported status', () => {
    expect(validateScheduledActions({ '0': sendToApi('', '') }, {}).invalid?.reason).toBe('missing-domain');
    expect(validateScheduledActions({ '0': sendToApi(undefined, '') }, {}).invalid?.reason).toBe('missing-report-type');
    expect(validateScheduledActions({ '0': sendToApi() }, {}).pendingSendToApi).toBe(true);
  });

  it('should prioritize reasons regardless of action order', () => {
    const result = validateScheduledActions(
      { '0': sendToApi(), '1': sendToApi(), '2': enableDisable('') },
      { '0': 'unknown-report-type', '1': 'missing-domain' }
    );
    expect(result.invalid).toEqual({ key: '2', reason: 'missing-target-analytic' });

    const withoutTarget = validateScheduledActions(
      { '0': sendToApi(), '1': sendToApi() },
      { '0': 'unknown-report-type', '1': 'unreachable-domain' }
    );
    expect(withoutTarget.invalid).toEqual({ key: '1', reason: 'unreachable-domain' });
  });
});
