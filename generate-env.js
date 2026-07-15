const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const configDir = path.join(__dirname, 'src', 'app', 'core', 'config');
const configPath = path.join(configDir, 'api-key.config.ts');

function getEnvValue(key) {
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

const jwtKey = getEnvValue('JWT_SECRET_KEY') || 'PLACEHOLDER_JWT_SECRET_KEY';
const apiTarget = getEnvValue('API_HOST') || 'http://localhost:8000';

if (!jwtKey) {
  console.error('❌ Error: JWT_SECRET_KEY no está definido en el archivo .env.');
  process.exit(1);
}

const fileContent = `export const ApiKeyConfig = {
  apiKey: '${jwtKey}'
};
`;

const wsTarget = apiTarget.replace(/^http/, 'ws');
const wsConfigContent = `export const WebsocketConfig = {
  wsUrl: '${wsTarget}'
};
`;

if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

fs.writeFileSync(configPath, fileContent, 'utf8');
console.log('✅ src/app/core/config/api-key.config.ts generado exitosamente desde .env');

const wsConfigPath = path.join(configDir, 'websocket.config.ts');
fs.writeFileSync(wsConfigPath, wsConfigContent, 'utf8');
console.log('✅ src/app/core/config/websocket.config.ts generado exitosamente desde .env');
