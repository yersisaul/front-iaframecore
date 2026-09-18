import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { AppEnvironment } from './app/core/config/app-environment';

function initDebugLogger(): void {
  try {
    const localOverride = typeof window !== 'undefined' ? localStorage.getItem('DEBUG') : null;
    const isDebug = localOverride !== null ? localOverride === 'true' : !!(AppEnvironment as any).debug;

    if (!isDebug) {
      const noop = () => {};
      console.log = noop;
      console.debug = noop;
      console.info = noop;
      console.group = noop;
      console.groupCollapsed = noop;
      console.groupEnd = noop;
    }
  } catch {
    // Evitar fallos si localStorage no está disponible
  }
}

initDebugLogger();

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));

  
