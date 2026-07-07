import { HttpInterceptorFn } from '@angular/common/http';
import { AppEnvironment } from '../config/app-environment';
import { ApiKeyConfig } from '../config/api-key.config';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isRelative = !/^https?:\/\//i.test(req.url);
  const isSameOrigin = typeof window !== 'undefined' && req.url.startsWith(window.location.origin);
  const isInternal = isRelative || isSameOrigin;

  const isApiRequest = isInternal && (
    req.url.startsWith(AppEnvironment.apiUrl) || 
    req.url.includes('/api/') ||
    req.url.startsWith(AppEnvironment.openSearchBaseUrl) ||
    req.url.includes(AppEnvironment.openSearchBaseUrl + '/')
  );
  const isLoginRequest = req.url.includes('/auth/login');


  if (isApiRequest) {
    // Buscar la clave estática configurada en el archivo contenedor (solo si no es producción)
    const isDevMode = !AppEnvironment.production;
    const configKey = ApiKeyConfig?.apiKey;
    const hasConfigKey = isDevMode &&
                         configKey &&
                         configKey !== 'REPLACE_WITH_YOUR_JWT_API_KEY' &&
                         configKey !== 'INSERTAR_AQUI_TU_JWT_API_KEY' &&
                         configKey.trim() !== '';

    // Obtener el token dinámico de sessionStorage (sesión activa)
    const localToken = sessionStorage.getItem('auth_token');

    const headers: Record<string, string> = {};

    // 1. Establecer X-API-Key (siempre priorizar la clave estática configKey para validar contra la API REST)
    if (hasConfigKey) {
      headers['X-API-Key'] = configKey;
      headers['x-api-key'] = configKey;
    } else if (localToken) {
      // Fallback si no hay clave estática
      headers['X-API-Key'] = localToken;
      headers['x-api-key'] = localToken;
    }

    // 2. Establecer Authorization (solo con el token dinámico JWT del usuario logueado)
    if (localToken && !isLoginRequest) {
      headers['Authorization'] = `Bearer ${localToken}`;
    }

    const clonedReq = req.clone({
      withCredentials: true,
      setHeaders: headers
    });
    return next(clonedReq);
  }
  return next(req);
};



