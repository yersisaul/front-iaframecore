import { Component, signal, inject } from '@angular/core';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { AuthTransitionService, TransitionTransformParams } from '../../../core/services/auth-transition.service';
import { LoginRequestDTO } from '../../../data/repositories/dtos/login-request.dto';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private authTransitionService = inject(AuthTransitionService);

  loginForm: FormGroup;

  // Estados locales de la vista
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly showPassword = signal(false);

  constructor() {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]]
    });
  }

  togglePasswordVisibility(): void {
    this.showPassword.update(show => !show);
  }

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    const credentials: LoginRequestDTO = this.loginForm.value;

    this.authService.login(credentials).subscribe({
      next: () => {
        this.isLoading.set(false);

        // Capturar la posición y tamaño exactos del logo del encabezado del login
        const logoEl = document.querySelector('.login-brand-logo') as SVGElement | null;
        const rect = logoEl?.getBoundingClientRect();

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const fullSize = Math.min(vw, vh);

        const targetWidth = (rect && rect.width > 0) ? rect.width : 92;
        const targetHeight = (rect && rect.height > 0) ? rect.height : 92;
        const targetTop = (rect && rect.top > 0) ? rect.top : vh * 0.28;

        const scale0 = targetWidth / fullSize;

        // El logo siempre está perfectamente centrado en el eje horizontal (dx = 0)
        // Calculamos únicamente el desplazamiento vertical para coincidir con la posición del ojo
        const fullEyeY = (vh - fullSize) / 2 + fullSize * (192.5 / 1025);
        const targetEyeY = targetTop + targetHeight * (192.5 / 1025);
        const deltaY = targetEyeY - fullEyeY;

        const params: TransitionTransformParams = {
          dx: 0, // Fijo en 0 para evitar cualquier salto lateral hacia el sidebar
          dy: deltaY,
          s0: scale0
        };

        // Iniciar la máscara de transición fluida y opaca
        this.authTransitionService.startEyeZoomTransition(params, 1200);
        setTimeout(() => {
          this.router.navigate(['/dashboard']);
        }, 60);
      },
      error: (err) => {
        this.isLoading.set(false);
        if (err.status === 401) {
          this.errorMessage.set('Correo o contraseña incorrectos.');
        } else {
          this.errorMessage.set('Ocurrió un error en el servidor. Inténtelo más tarde.');
        }
      }
    });
  }
}
