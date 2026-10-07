const fs = require('fs');
const path = require('path');

const configDir = path.join(__dirname, 'src', 'app', 'core', 'config');
const appEnvPath = path.join(configDir, 'app-environment.ts');
const envPath = path.join(__dirname, '.env');

function getEnvValue(key) {
  if (process.env[key]) {
    return process.env[key];
  }

  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('=');
      if (parts[0].trim() === key) {
        return parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      }
    }
  }

  return null;
}

// Este valor NO debe ser necesario durante el build.
// Las URLs reales se resolverán en runtime mediante Nginx.
const dashboardPath =
  getEnvValue('DASHBOARD_DEFAULT_PATH') || '/app/dashboards';

const isDebug = getEnvValue('DEBUG') === 'true';
const appVersion = getEnvValue('APP_VERSION');

const normalizedPath = dashboardPath.startsWith('/')
  ? dashboardPath
  : '/' + dashboardPath;

const appEnvContent = `// Archivo generado automáticamente por generate-env.js
export const AppEnvironment = {
  production: true,

  // Resuelve exclusivamente desde la variable de entorno inyectada en window.__env
  get version(): string | null {
    if (typeof window !== 'undefined' && (window as any).__env && (window as any).__env['APP_VERSION']) {
      return (window as any).__env['APP_VERSION'];
    }
    return null;
  },

  debug: ${isDebug},

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

// Sincronizar también public/assets/env.js con la variable local detectada
const publicAssetsDir = path.join(__dirname, 'public', 'assets');
const envJsPath = path.join(publicAssetsDir, 'env.js');
if (!fs.existsSync(publicAssetsDir)) {
  fs.mkdirSync(publicAssetsDir, { recursive: true });
}
const envJsContent = `// Archivo generado automáticamente por generate-env.js desde la variable APP_VERSION de .env
(function (window) {
  window.__env = window.__env || {};
  window.__env.APP_VERSION = ${appVersion ? JSON.stringify(appVersion) : 'null'};
})(this);
`;
fs.writeFileSync(envJsPath, envJsContent, 'utf8');

console.log(
  '✅ app-environment.ts y assets/env.js generados correctamente con la versión de la variable.'
);

console.log(
  'ℹ️ Las URLs del cliente serán configuradas por Nginx en runtime.'
);