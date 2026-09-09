const fs = require('fs');
const path = require('path');

const configDir = path.join(__dirname, 'src', 'app', 'core', 'config');
const appEnvPath = path.join(configDir, 'app-environment.ts');

function getEnvValue(key) {
  if (process.env[key]) {
    return process.env[key];
  }

  return null;
}

// Este valor NO debe ser necesario durante el build.
// Las URLs reales se resolverán en runtime mediante Nginx.
const dashboardPath =
  getEnvValue('DASHBOARD_DEFAULT_PATH') || '/app/dashboards';

const normalizedPath = dashboardPath.startsWith('/')
  ? dashboardPath
  : '/' + dashboardPath;

const appEnvContent = `export const AppEnvironment = {
  production: true,
  version: '1.0.0',

  enableBackendWorkarounds: true,

  // Todas las URLs pasan por el reverse proxy de Nginx.
  // NO colocar hosts/IPs de clientes aquí.
  apiUrl: '/api',
  minioBaseUrl: '/minio',
  openSearchBaseUrl: '/opensearch',
  wsPath: '/ws/client',

  dashboardDefaultUrl: '${normalizedPath}',

  // La API Key se inyecta exclusivamente por Nginx.
  apiKey: ''

};
`;

if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

fs.writeFileSync(appEnvPath, appEnvContent, 'utf8');

console.log(
  '✅ app-environment.ts generado correctamente.'
);

console.log(
  'ℹ️ Las URLs del cliente serán configuradas por Nginx en runtime.'
);