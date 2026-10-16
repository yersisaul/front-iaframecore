/**
 * Estado de una acción "Enviar a API", reportado por su componente (send-to-api-action):
 * - ok:                   dominio verificado y tipo de reporte existente en ese dominio
 * - missing-domain:       no se ingresó dominio
 * - invalid-domain:       el dominio no tiene un formato válido
 * - checking:             el dominio se está escribiendo o verificando
 * - unreachable-domain:   el dominio no respondió (ni por http ni por https)
 * - missing-report-type:  no se seleccionó tipo de reporte
 * - unknown-report-type:  el tipo de reporte no existe en ese dominio
 */
export type SendToApiStatus =
  | 'ok'
  | 'missing-domain'
  | 'invalid-domain'
  | 'checking'
  | 'unreachable-domain'
  | 'missing-report-type'
  | 'unknown-report-type';

export type InvalidScheduledActionReason =
  | 'missing-target-analytic'
  | 'missing-domain'
  | 'invalid-domain'
  | 'unreachable-domain'
  | 'missing-report-type'
  | 'unknown-report-type';

export interface InvalidScheduledAction {
  /** Clave de la acción en el objeto de acciones (coincide con data-action-index en el builder). */
  key: string;
  reason: InvalidScheduledActionReason;
}

export interface ScheduledActionsValidation {
  /** Primera acción inválida según la prioridad de las razones, o null si todas son válidas. */
  invalid: InvalidScheduledAction | null;
  /** Hay acciones "Enviar a API" cuyo dominio aún se está escribiendo o verificando. */
  pendingSendToApi: boolean;
}

const REASON_PRIORITY: InvalidScheduledActionReason[] = [
  'missing-target-analytic',
  'missing-domain',
  'invalid-domain',
  'unreachable-domain',
  'missing-report-type',
  'unknown-report-type'
];

function isEnableDisableAction(tipo: string): boolean {
  // El builder emite "Habilitar/Deshabilitar Analisis-NN" para activar y desactivar
  return tipo.includes('habilitar/deshabilitar') || tipo.startsWith('activar analisis') || tipo.startsWith('desactivar analisis');
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

/**
 * Valida las acciones programadas (payload.acciones) antes de guardar una analítica.
 * - Activar / Desactivar análisis: requieren analítica objetivo.
 * - Enviar a API: requiere dominio verificado y un tipo de reporte existente en ese dominio.
 *   Su estado lo aporta cada componente de la acción; si no hay estado, se infiere lo mínimo del payload.
 */
export function validateScheduledActions(
  actions: Record<string, any> | null | undefined,
  sendToApiStatuses: Record<string, SendToApiStatus>
): ScheduledActionsValidation {
  const found: InvalidScheduledAction[] = [];
  let pendingSendToApi = false;

  Object.entries(actions || {}).forEach(([key, act]) => {
    const tipo = String(act?.tipo || '').toLowerCase();

    if (isEnableDisableAction(tipo)) {
      if (isBlank(act?.accion?.analitica)) {
        found.push({ key, reason: 'missing-target-analytic' });
      }
      return;
    }

    if (tipo.startsWith('enviar a api')) {
      const status: SendToApiStatus = sendToApiStatuses[key]
        ?? (isBlank(act?.accion?.endpoint) ? 'missing-domain' : isBlank(act?.accion?.id_report_type) ? 'missing-report-type' : 'checking');
      if (status === 'checking') {
        pendingSendToApi = true;
      } else if (status !== 'ok') {
        found.push({ key, reason: status });
      }
    }
  });

  const invalid = REASON_PRIORITY
    .map(reason => found.find(item => item.reason === reason))
    .find((item): item is InvalidScheduledAction => !!item) || null;

  return { invalid, pendingSendToApi };
}
