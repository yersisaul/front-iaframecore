// Archivo generado automáticamente por generate-env.js
export const AppEnvironment = {
  production: true,

  // Versión dinámica: resuelve en tiempo de ejecución (Docker/window.__env) con fallback a compilación
  get version(): string | null {
    if (typeof window !== 'undefined' && (window as any).__env && (window as any).__env['APP_VERSION'] !== undefined) {
      return (window as any).__env['APP_VERSION'];
    }
    return '2.0.0';
  },

  debug: true,

  enableBackendWorkarounds: true,

  // Todas las URLs pasan por el reverse proxy de Nginx.
  // NO colocar hosts/IPs de clientes aquí.
  apiUrl: '/api',
  minioBaseUrl: '/minio',
  openSearchBaseUrl: '/opensearch',
  wsPath: '/ws/client',

  dashboardDefaultUrl: '/app/dashboards',

  // La API Key se inyecta exclusivamente por Nginx.
  apiKey: ''

};
