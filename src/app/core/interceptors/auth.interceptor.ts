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
    if (isLoginRequest) {
      const clonedReq = req.clone({ withCredentials: true });
      return next(clonedReq);
    }

    // Buscar la clave estática configurada en el archivo contenedor (solo si no es producción)
    const isDevMode = !AppEnvironment.production;
    const configKey = ApiKeyConfig?.apiKey;
    const hasConfigKey = isDevMode &&
                         configKey &&
                         configKey !== 'REPLACE_WITH_YOUR_JWT_API_KEY' &&
                         configKey !== 'INSERTAR_AQUI_TU_JWT_API_KEY' &&
                         configKey.trim() !== '';

    // Priorizar el token dinámico de sessionStorage (sesión activa). Si no existe, usar la clave estática.
    const localToken = sessionStorage.getItem('auth_token');
    const token = localToken ? localToken : (hasConfigKey ? configKey : null);

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
      headers['X-API-Key'] = token;
      headers['x-api-key'] = token;
    }

    const clonedReq = req.clone({
      withCredentials: true,
      setHeaders: headers
    });
    return next(clonedReq);
  }
  return next(req);
};



