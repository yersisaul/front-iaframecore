import { Component, signal, inject, effect, ElementRef, viewChild } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WebsocketService } from './core/services/websocket.service';
import { AuthTransitionService } from './core/services/auth-transition.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private websocketService = inject(WebsocketService);
  protected readonly authTransitionService = inject(AuthTransitionService);
  protected readonly title = signal('iaframecore');

  private portalCanvas = viewChild<ElementRef<HTMLCanvasElement>>('portalCanvas');

  // Rutas vectoriales nativas precalculadas en Path2D para renderizado GPU en alta resolución
  private readonly darkMaskPath = new Path2D(`
    M -60000 -60000 H 60000 V 60000 H -60000 Z
    M 488.626 166.329 C 523.614 189.284 547.367 203.198 563.895 211.326 C 581.246 219.859 579.648 224.411 560.316 224.762 C 506.388 225.744 476.69 213.901 457.091 195.579 C 441.75 181.239 471.068 154.809 488.626 166.329 Z
  `);

  private readonly wingPath = new Path2D(`
    M 496.348 986.258 C 416.994 975.201 6.37543 896.233 150.32 597.186 C 206.552 480.363 437.643 342.068 543.478 300.412 L 615.907 279.536 C 659.038 264.498 723.375 307.395 658.056 361.082 C 667.835 306.475 663.228 306.764 629.188 308.896 C 614.797 309.798 595.147 311.029 569.099 308.581 C 537.299 326.416 475.705 390.091 465.824 499.682 C 435.045 520.182 407.381 547.111 385.001 579.977 C 297.828 707.995 323.848 877.613 443.118 958.829 C 460.017 970.337 477.882 979.452 496.348 986.258 Z
  `);

  private readonly headPath = new Path2D(`
    M 658.103 361.043 C 658.056 361.105 658.009 361.168 657.961 361.23 C 809.232 340.102 767.849 275.119 685.672 174.855 C 707.443 126.032 611.883 18.8 464.305 22.568 C 316.727 26.3359 159.991 238.178 100.07 343.628 C 110.014 334.993 139.791 314.583 179.354 302.024 C 146.123 322.957 72.7528 381.936 45.1212 450.386 C 15.4734 523.832 -41.2758 768.898 266.587 915.105 C 158.598 858.295 71.6623 760.598 150.32 597.186 C 206.552 480.362 437.643 342.068 543.478 300.412 L 615.907 279.536 C 659.027 264.502 723.344 307.374 658.103 361.043 Z
    M 488.626 166.329 C 523.614 189.284 547.367 203.198 563.895 211.326 C 581.246 219.859 579.648 224.411 560.316 224.762 C 506.388 225.744 476.69 213.901 457.091 195.579 C 441.75 181.239 471.068 154.809 488.626 166.329 Z
  `);

  private readonly bodyPath = new Path2D(`
    M 466.752 499.066 C 435.601 519.641 407.606 546.78 385.001 579.976 C 297.828 707.995 323.847 877.613 443.117 958.829 C 549.693 1031.4 694.663 1008.83 786.511 911.865 C 714.52 941.042 629.749 934.838 560.726 887.837 C 497.246 844.61 460.992 776.348 456.177 705.238 C 470.605 764.819 505.188 818.351 558.177 854.434 C 677.447 935.65 844.803 897.709 931.976 769.69 C 976.061 704.949 991.197 629.569 979.963 560.364 C 999.663 515.273 1007.24 467.385 1003.43 421.406 C 997.11 461.562 982.022 500.987 957.623 536.818 C 869.405 666.371 692.867 699.879 563.314 611.661 C 520.147 582.267 487.643 543.066 466.752 499.066 Z
    M 937.076 677.868 C 960.724 643.139 974.044 604.425 977.727 565.357 C 970.808 580.432 962.519 595.172 952.832 609.397 C 865.659 737.416 698.303 775.357 579.033 694.141 C 552.855 676.315 531.169 654.23 514.186 629.261 C 531.147 673.251 561.194 712.712 603.113 741.257 C 712.839 815.974 862.359 787.593 937.076 677.868 Z
  `);

  private animFrameId: number | null = null;

  constructor() {
    effect(() => {
      if (this.authTransitionService.isZoomTransitioning()) {
        this.runNativeVectorZoom();
      } else {
        if (this.animFrameId !== null) {
          cancelAnimationFrame(this.animFrameId);
          this.animFrameId = null;
        }
        const canvas = this.portalCanvas()?.nativeElement;
        if (canvas) {
          const ctx = canvas.getContext('2d');
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    });
  }

  /**
   * Motor de renderizado vectorial continuo con Canvas2D y aceleración por GPU.
   * Apertura concéntrica del ojo de Azor ultra-fluida que oculta el montaje de la ruta.
   */
  private runNativeVectorZoom(): void {
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    const canvas = this.portalCanvas()?.nativeElement;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    canvas.width = vw * dpr;
    canvas.height = vh * dpr;

    const duration = 1200;
    const startTime = performance.now();

    const params = this.authTransitionService.transformParams();
    const startDy = params.dy || 0;
    const startScale = params.s0 || (92 / Math.min(vw, vh));
    const targetScale = 90;

    const fullSize = Math.min(vw, vh);
    const eyeSvgX = 512.5;
    const eyeSvgY = 192.5;

    // Curva de progresión cinemática con aceleración suave
    const easeProgress = (t: number): number => {
      return Math.pow(t, 2.4);
    };

    const render = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const rawProgress = Math.min(elapsed / duration, 1);
      const eased = easeProgress(rawProgress);

      const curDy = startDy * (1 - eased);
      const curScale = startScale + (targetScale - startScale) * eased;

      // Desvanecimiento suave en los últimos instantes
      let opacity = 1;
      if (rawProgress > 0.82) {
        opacity = Math.max(0, 1 - (rawProgress - 0.82) / 0.18);
      }

      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);
      ctx.globalAlpha = opacity;

      // Posición concéntrica del ojo: siempre centrado horizontalmente en el viewport
      const screenEyeX = vw / 2;
      const screenEyeY = (vh - fullSize) / 2 + fullSize * (eyeSvgY / 1025) + curDy;

      ctx.translate(screenEyeX, screenEyeY);
      ctx.scale(curScale, curScale);
      ctx.translate(-eyeSvgX, -eyeSvgY);

      // 1. Fondo oscuro con apertura transparente en el ojo
      ctx.fillStyle = '#030712';
      ctx.fill(this.darkMaskPath, 'evenodd');

      // 2. Alas azul azor
      ctx.fillStyle = '#5b78a7';
      ctx.fill(this.wingPath);

      // 3. Cabeza y cresta con recorte natural del ojo
      ctx.fillStyle = '#f8fafc';
      ctx.fill(this.headPath, 'evenodd');

      // 4. Cuerpo inferior
      ctx.fillStyle = '#f8fafc';
      ctx.fill(this.bodyPath, 'evenodd');

      ctx.restore();

      if (rawProgress < 1 && this.authTransitionService.isZoomTransitioning()) {
        this.animFrameId = requestAnimationFrame(render);
      } else {
        this.animFrameId = null;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    // Pintar fotograma 0 de inmediato (bloquea la vista del login antes de la navegación)
    render(performance.now());
  }
}
