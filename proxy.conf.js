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

const apiTarget = getEnvValue('API_HOST');
const openSearchTarget = getEnvValue('OPENSEARCH_HOST');
const minioTarget = getEnvValue('MINIO_PUBLIC_URL') || apiTarget;
const jwtSecret = getEnvValue('JWT_SECRET_KEY');
const openSearchUser = getEnvValue('OPENSEARCH_USER');
const openSearchPassword = getEnvValue('OPENSEARCH_PASSWORD');

const openSearchAuthHeader = (openSearchUser && openSearchPassword)
  ? 'Basic ' + Buffer.from(`${openSearchUser}:${openSearchPassword}`).toString('base64')
  : null;

const wsTarget = apiTarget ? apiTarget.replace(/^http/, 'ws') : '';

if (!apiTarget || !openSearchTarget) {
  console.error('❌ Error: API_HOST u OPENSEARCH_HOST no están definidos en el archivo .env.');
  process.exit(1);
}

console.log(`=========================================`);
console.log(`🔌 Cargando proxy desde variables de entorno:`);
console.log(`   - /api        -> ${apiTarget} (Auth x-api-key: ${jwtSecret ? 'habilitada' : 'ninguna'})`);
console.log(`   - /opensearch -> ${openSearchTarget} (Basic Auth: ${openSearchAuthHeader ? 'habilitada (' + openSearchUser + ')' : 'ninguna'})`);
console.log(`   - /minio      -> ${minioTarget}`);
console.log(`   - /ws         -> ${wsTarget} (WebSocket)`);
console.log(`=========================================`);

const dynamicCorsBypass = {
  changeOrigin: true,
  secure: false,
  onProxyReq: (proxyReq, req, res) => {
    // Si la petición original tiene un Origin, lo mantenemos en la subida para no romper firmas
    if (req.headers.origin) {
      proxyReq.setHeader('Origin', req.headers.origin);
    }
  },
  onProxyRes: (proxyRes, req, res) => {
    // Reescribimos las cabeceras de respuesta al vuelo para que el navegador siempre las acepte
    if (req.headers.origin) {
      proxyRes.headers['access-control-allow-origin'] = req.headers.origin;
      proxyRes.headers['access-control-allow-credentials'] = 'true';
      proxyRes.headers['access-control-allow-headers'] = 'Origin, X-Requested-With, Content-Type, Accept, Authorization, apikey, x-api-key, X-API-Key';
      proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    }
  }
};

module.exports = {
  "/api": {
    ...dynamicCorsBypass,
    "target": apiTarget,
    "pathRewrite": {
      "^/api": ""
    },
    onProxyReq: (proxyReq, req, res) => {
      if (req.headers.origin) {
        proxyReq.setHeader('Origin', req.headers.origin);
      }
      if (jwtSecret) {
        proxyReq.setHeader('x-api-key', jwtSecret);
        proxyReq.setHeader('X-API-Key', jwtSecret);
      }
    }
  },
  "/minio": {
    ...dynamicCorsBypass,
    "target": minioTarget,
    "pathRewrite": {
      "^/minio": ""
    }
  },
  "/opensearch": {
    ...dynamicCorsBypass,
    "target": openSearchTarget,
    "pathRewrite": {
      "^/opensearch": ""
    },
    "logLevel": "warn",
    onProxyReq: (proxyReq, req, res) => {
      if (req.headers.origin) {
        proxyReq.setHeader('Origin', req.headers.origin);
      }
      if (openSearchAuthHeader) {
        proxyReq.setHeader('Authorization', openSearchAuthHeader);
      }
    }
  },
  "/ws": {
    "target": wsTarget,
    "secure": false,
    "changeOrigin": true,
    "ws": true,
    "logLevel": "debug",
    "headers": {
      "Origin": apiTarget
    },
    configure: (proxy, options) => {
      proxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
        console.log(`\n🔌 [Proxy WS Configure] Conexión detectada a las: ${new Date().toISOString()}`);
        console.log(`   - IP Cliente: ${req.socket.remoteAddress}:${req.socket.remotePort}`);
        console.log(`   - URL: ${req.url}`);
        console.log(`   - User-Agent: ${req.headers['user-agent']}`);
        console.log(`   - Origin: ${req.headers['origin'] || 'N/A'}\n`);
      });
      proxy.on('open', (proxySocket) => {
        console.log('🔌 [Proxy WS Configure] Canal WebSocket abierto');
      });
      proxy.on('error', (err, req, res) => {
        if (err && (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' || err.code === 'EPIPE')) {
          // Desconexión habitual del cliente por recarga de pestaña o cambio de ruta
          return;
        }
        console.error('❌ [Proxy WS Configure Error]', err);
      });
    }
  }
};
