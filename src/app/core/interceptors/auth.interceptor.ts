import { HttpInterceptorFn } from '@angular/common/http';
import { AppEnvironment } from '../config/app-environment';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const isApiRequest = req.url.startsWith(AppEnvironment.apiUrl);

  if (isApiRequest) {
    const clonedReq = req.clone({ withCredentials: true });
    return next(clonedReq);
  }
  return next(req);
};



