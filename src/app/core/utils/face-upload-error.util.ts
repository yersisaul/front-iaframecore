export type FaceUploadErrorCategory =
  | 'validation_rejected'
  | 'conflict'
  | 'auth_error'
  | 'indeterminate';

export interface ClassifiedFaceUploadError {
  category: FaceUploadErrorCategory;
  shouldReconcile: boolean;
  userMessage: string;
  httpStatus?: number;
}

/**
 * Extrae el texto legible de detalle desde un error HTTP, de FastAPI/Pydantic o nativo.
 */
export function extractErrorDetailText(err: unknown): string {
  if (typeof err === 'string') {
    return err;
  }
  if (!err || typeof err !== 'object') {
    return '';
  }

  const anyErr = err as Record<string, any>;
  const detail = anyErr['error']?.detail;

  if (typeof detail === 'string') {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          return item.msg || JSON.stringify(item);
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (detail && typeof detail === 'object') {
    return detail.message || JSON.stringify(detail);
  }

  if (typeof anyErr['error']?.message === 'string') {
    return anyErr['error'].message;
  }
  if (typeof anyErr['error'] === 'string') {
    return anyErr['error'];
  }
  if (typeof anyErr['message'] === 'string') {
    return anyErr['message'];
  }

  return '';
}

function extractHttpStatus(err: unknown): number | undefined {
  if (err && typeof err === 'object' && typeof (err as Record<string, any>)['status'] === 'number') {
    return (err as Record<string, any>)['status'];
  }
  return undefined;
}

function mapValidationMessage(status: number, lowerDetail: string): string {
  if (status === 413 || lowerDetail.includes('too large') || lowerDetail.includes('payload')) {
    return 'La imagen supera el tamaño máximo permitido por el servidor.';
  }
  if (lowerDetail.includes('no face detected') || lowerDetail.includes('no face') || lowerDetail.includes('sin rostro')) {
    return 'No se detectó un rostro válido en la fotografía.';
  }
  if (lowerDetail.includes('multiple faces') || lowerDetail.includes('more than one face')) {
    return 'Se detectó más de un rostro. Utilice una foto con un único rostro.';
  }
  if (lowerDetail.includes('embedding generation issue') || lowerDetail.includes('embedding')) {
    return 'No se pudo generar la huella facial de la fotografía.';
  }
  if (
    status === 415 ||
    lowerDetail.includes('format') ||
    lowerDetail.includes('extension') ||
    lowerDetail.includes('invalid image') ||
    lowerDetail.includes('unsupported media')
  ) {
    return 'El formato o la resolución de la imagen no es compatible.';
  }

  return 'La imagen no cumple con los requisitos del registro facial.';
}

/**
 * Clasifica errores del endpoint de registro facial distinguiendo rechazos de dominio
 * frente a fallos indeterminados (5xx, red, timeout o parseo) que requieren reconciliación.
 */
export function classifyFaceUploadError(err: unknown): ClassifiedFaceUploadError {
  const status = extractHttpStatus(err);
  const rawDetail = extractErrorDetailText(err);
  const lower = rawDetail.toLowerCase();
  const errName = err && typeof err === 'object' ? String((err as Record<string, any>)['name'] || '') : '';

  if (status === 400 || status === 413 || status === 415 || status === 422) {
    return {
      category: 'validation_rejected',
      shouldReconcile: false,
      userMessage: mapValidationMessage(status, lower),
      httpStatus: status
    };
  }

  if (status === 409) {
    return {
      category: 'conflict',
      shouldReconcile: false,
      userMessage: 'Este sujeto ya se encuentra registrado en la lista.',
      httpStatus: 409
    };
  }

  if (status === 401 || status === 403) {
    return {
      category: 'auth_error',
      shouldReconcile: false,
      userMessage: 'No tienes permisos o tu sesión expiró para registrar rostros.',
      httpStatus: status
    };
  }

  if (status !== undefined && status >= 200 && status < 300) {
    return {
      category: 'indeterminate',
      shouldReconcile: true,
      userMessage: 'La respuesta del servidor no pudo interpretarse y no se confirmó el registro.',
      httpStatus: status
    };
  }

  if (status === 504 || errName === 'TimeoutError' || lower.includes('timeout')) {
    return {
      category: 'indeterminate',
      shouldReconcile: true,
      userMessage: 'El servidor tardó demasiado en responder y no se confirmó el registro.',
      httpStatus: status
    };
  }

  if (status === 0) {
    return {
      category: 'indeterminate',
      shouldReconcile: true,
      userMessage: 'No se pudo establecer conexión con el servidor para confirmar el registro.',
      httpStatus: 0
    };
  }

  if (status !== undefined && status >= 500) {
    return {
      category: 'indeterminate',
      shouldReconcile: true,
      userMessage: `Ocurrió un error interno en el servidor (HTTP ${status}) y no se confirmó el registro.`,
      httpStatus: status
    };
  }

  return {
    category: 'indeterminate',
    shouldReconcile: true,
    userMessage: 'Ocurrió un error inesperado al procesar la solicitud.',
    httpStatus: status
  };
}

