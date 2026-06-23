const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

function getEnvValue(key) {
  // Primero intentamos del entorno del sistema operativo
  if (process.env[key]) return process.env[key];
  
  // Si no, del archivo .env
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

const apiTarget = getEnvValue('API_TARGET');
const openSearchTarget = getEnvValue('OPENSEARCH_TARGET');

if (!apiTarget || !openSearchTarget) {
  console.error('❌ Error: API_TARGET u OPENSEARCH_TARGET no están definidos en el archivo .env.');
  process.exit(1);
}

console.log(`=========================================`);
console.log(`🔌 Cargando proxy desde variables de entorno:`);
console.log(`   - /api        -> ${apiTarget}`);
console.log(`   - /opensearch -> ${openSearchTarget}`);
console.log(`=========================================`);

module.exports = {
  "/api": {
    "target": apiTarget,
    "secure": false,
    "changeOrigin": true,
    "pathRewrite": {
      "^/api": ""
    }
  },
  "/opensearch": {
    "target": openSearchTarget,
    "secure": false,
    "changeOrigin": true,
    "pathRewrite": {
      "^/opensearch": ""
    },
    "logLevel": "warn"
  }
};
