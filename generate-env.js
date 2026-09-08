const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const configDir = path.join(__dirname, 'src', 'app', 'core', 'config');
const appEnvPath = path.join(configDir, 'app-environment.ts');

function getEnvValue(key) {
  if (process.env[key]) return process.env[key];
  if (!fs.existsSync(envPath)) return null;
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
  return null;
}

const apiTarget = getEnvValue('API_HOST');
if (!apiTarget) {
  console.error('❌ Error: API_HOST no está definido en el archivo .env ni en las variables de entorno.');
  process.exit(1);
}

const jwtKey = getEnvValue('JWT_SECRET_KEY') || '';
const dashboardPath = getEnvValue('DASHBOARD_DEFAULT_PATH') || '/app/dashboards';
const normalizedPath = dashboardPath.startsWith('/') ? dashboardPath : '/' + dashboardPath;

const appEnvContent = `export const AppEnvironment = {
  production: false,
  version: '1.0.0',
  enableBackendWorkarounds: true,

  // Endpoints relativos del Reverse Proxy (Cero IPs o hostnames en TypeScript)
  apiUrl: '/api',
  minioBaseUrl: '/minio',
  openSearchBaseUrl: '/opensearch',
  wsPath: '/ws/client',
  dashboardDefaultUrl: '${normalizedPath}',

  // Clave API opcional para desarrollo local (vacía por defecto; la auth real usa el JWT dinámico de sesión)
  apiKey: '${jwtKey}'
};
`;

if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

fs.writeFileSync(appEnvPath, appEnvContent, 'utf8');
console.log('✅ src/app/core/config/app-environment.ts actualizado exitosamente desde .env (Cero IPs en TypeScript)');
