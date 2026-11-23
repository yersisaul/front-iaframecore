import { HttpErrorResponse } from '@angular/common/http';
import { describe, it, expect } from 'vitest';
import { classifyFaceUploadError, extractErrorDetailText } from './face-upload-error.util';

describe('face-upload-error.util', () => {
  describe('extractErrorDetailText', () => {
    it('extracts FastAPI string detail and Pydantic array detail', () => {
      const strErr = new HttpErrorResponse({ status: 422, error: { detail: 'No face detected' } });
      expect(extractErrorDetailText(strErr)).toBe('No face detected');

      const pydanticErr = new HttpErrorResponse({
        status: 422,
        error: { detail: [{ loc: ['body', 'file'], msg: 'Multiple faces detected', type: 'value_error' }] }
      });
      expect(extractErrorDetailText(pydanticErr)).toBe('Multiple faces detected');
    });
  });

  describe('classifyFaceUploadError', () => {
    it('classifies 422 "no face detected" as validation_rejected without reconciliation', () => {
      const err = new HttpErrorResponse({ status: 422, error: { detail: 'No face detected in image' } });
      const result = classifyFaceUploadError(err);

      expect(result.category).toBe('validation_rejected');
      expect(result.shouldReconcile).toBe(false);
      expect(result.userMessage).toBe('No se detectó un rostro válido en la fotografía.');
    });

    it('classifies 422 Pydantic array with multiple faces and embedding error accurately', () => {
      const multiFaceErr = new HttpErrorResponse({
        status: 422,
        error: { detail: [{ msg: 'Multiple faces detected in frame' }] }
      });
      expect(classifyFaceUploadError(multiFaceErr)).toEqual({
        category: 'validation_rejected',
        shouldReconcile: false,
        userMessage: 'Se detectó más de un rostro. Utilice una foto con un único rostro.',
        httpStatus: 422
      });

      const embErr = new HttpErrorResponse({
        status: 400,
        error: { detail: 'Embedding generation issue' }
      });
      expect(classifyFaceUploadError(embErr)).toEqual({
        category: 'validation_rejected',
        shouldReconcile: false,
        userMessage: 'No se pudo generar la huella facial de la fotografía.',
        httpStatus: 400
      });
    });

    it('classifies 413 and 415 as validation_rejected without reconciliation', () => {
      const largeErr = new HttpErrorResponse({ status: 413, error: { detail: 'Payload Too Large' } });
      expect(classifyFaceUploadError(largeErr)).toEqual({
        category: 'validation_rejected',
        shouldReconcile: false,
        userMessage: 'La imagen supera el tamaño máximo permitido por el servidor.',
        httpStatus: 413
      });

      const mediaErr = new HttpErrorResponse({ status: 415, error: { detail: 'Unsupported media type' } });
      expect(classifyFaceUploadError(mediaErr)).toEqual({
        category: 'validation_rejected',
        shouldReconcile: false,
        userMessage: 'El formato o la resolución de la imagen no es compatible.',
        httpStatus: 415
      });
    });

    it('classifies 409 as conflict and 401/403 as auth_error without reconciliation', () => {
      expect(classifyFaceUploadError(new HttpErrorResponse({ status: 409 }))).toEqual({
        category: 'conflict',
        shouldReconcile: false,
        userMessage: 'Este sujeto ya se encuentra registrado en la lista.',
        httpStatus: 409
      });

      expect(classifyFaceUploadError(new HttpErrorResponse({ status: 401 }))).toEqual({
        category: 'auth_error',
        shouldReconcile: false,
        userMessage: 'No tienes permisos o tu sesión expiró para registrar rostros.',
        httpStatus: 401
      });

      expect(classifyFaceUploadError(new HttpErrorResponse({ status: 403 }))).toEqual({
        category: 'auth_error',
        shouldReconcile: false,
        userMessage: 'No tienes permisos o tu sesión expiró para registrar rostros.',
        httpStatus: 403
      });
    });

    it('classifies 500, 504, 0 (network), 2xx parse error, and unknown JS errors as indeterminate with reconciliation and never claims invalid face', () => {
      const cases = [
        new HttpErrorResponse({ status: 500, error: { detail: 'Internal database failure' } }),
        new HttpErrorResponse({ status: 504, statusText: 'Gateway Timeout' }),
        new HttpErrorResponse({ status: 0, statusText: 'Unknown Error' }),
        new HttpErrorResponse({
          status: 201,
          error: { error: new SyntaxError('Unexpected token'), text: 'OK' }
        }),
        new TypeError("Cannot read properties of null (reading 'detail_id')")
      ];

      for (const err of cases) {
        const result = classifyFaceUploadError(err);
        expect(result.category).toBe('indeterminate');
        expect(result.shouldReconcile).toBe(true);
        expect(result.userMessage).not.toContain('No se pudo validar el rostro');
      }

      expect(classifyFaceUploadError(cases[0]).userMessage).toContain('HTTP 500');
    });
  });
});

