export const AppEnvironment = {
  production: true,
  version: '1.0.0',

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
