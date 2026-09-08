export const AppEnvironment = {
  production: false,
  version: '1.0.0',
  enableBackendWorkarounds: true,

  // Endpoints relativos del Reverse Proxy (Cero IPs o hostnames en TypeScript)
  apiUrl: '/api',
  minioBaseUrl: '/minio',
  openSearchBaseUrl: '/opensearch',
  wsPath: '/ws/client',
  dashboardDefaultUrl: '/app/dashboards',

  // Clave API opcional para desarrollo local (vacía por defecto; la auth real usa el JWT dinámico de sesión)
  apiKey: ''
};
