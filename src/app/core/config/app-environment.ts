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

  // Clave API administrada de forma segura por el Reverse Proxy (proxy.conf.js en dev, Nginx en prod)
  apiKey: ''
};
