import { Injectable, signal } from '@angular/core';

export interface TransitionTransformParams {
  dx: number;
  dy: number;
  s0: number;
}

@Injectable({
  providedIn: 'root'
})
export class AuthTransitionService {
  /**
   * Indica si la transición visual del ojo de Azor está activa.
   */
  readonly isZoomTransitioning = signal(false);

  /**
   * Parámetros de transformación inicial calculados para coincidir al píxel con el logo del login.
   */
  readonly transformParams = signal<TransitionTransformParams>({ dx: 0, dy: 0, s0: 0.09 });

  /**
   * Inicia la secuencia de transición en alta resolución vectorial con final dinámico y fluido.
   * @param params Parámetros geométricos iniciales (desplazamiento y escala inicial).
   * @param durationMs Duración de la animación en milisegundos (1200ms).
   * @param onComplete Callback opcional al finalizar la animación.
   */
  startEyeZoomTransition(params?: TransitionTransformParams, durationMs: number = 1200, onComplete?: () => void): void {
    if (params) {
      this.transformParams.set(params);
    }
    this.isZoomTransitioning.set(true);

    setTimeout(() => {
      this.isZoomTransitioning.set(false);
      if (onComplete) {
        onComplete();
      }
    }, durationMs);
  }
}
