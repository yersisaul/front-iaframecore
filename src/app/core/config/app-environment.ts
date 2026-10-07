// Archivo generado automáticamente por generate-env.js
export const AppEnvironment = {
  production: true,

  // Resuelve exclusivamente desde la variable de entorno inyectada en window.__env
  get version(): string | null {
    if (typeof window !== 'undefined' && (window as any).__env && (window as any).__env['APP_VERSION']) {
      return (window as any).__env['APP_VERSION'];
    }
    return null;
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
