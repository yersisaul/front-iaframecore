// Proxy dinámico hacia Azor Panel para `ng serve` (equivalente a /azor-proxy de nginx.conf.template).
// /azor-proxy/{http|https}/{host}/{puerto}/others/report-types[/{id}]
// - Exige sesión válida del panel: valida el JWT contra GET {API_HOST}/frontend/permisos/
// - Solo GET, POST y PATCH sobre la ruta fija de report-types
// - Inyecta la X-API-Key de integración y no reenvía Authorization ni Cookie del usuario
const http = require('http');
const https = require('https');

const AZOR_PROXY_RE = /^\/azor-proxy\/(https?)\/([A-Za-z0-9.\-]+|\[[0-9A-Fa-f:.]+\])\/(\d{1,5})\/(others\/report-types(?:\/[A-Za-z0-9_\-]+)?)(\?.*)?$/;
const ALLOWED_METHODS = ['GET', 'POST', 'PATCH'];
const CONNECT_TIMEOUT_MS = 5000;
const RESPONSE_TIMEOUT_MS = 15000;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** Petición HTTP(S) con timeout de conexión corto; acepta certificados propios (igual que proxy_ssl_verify off). */
function request(url, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.request(url, { method, headers, rejectUnauthorized: false }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode || 502, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });

    const connectTimer = setTimeout(() => req.destroy(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })), CONNECT_TIMEOUT_MS);
    req.on('socket', socket => {
      if (socket.connecting) socket.once('connect', () => clearTimeout(connectTimer));
      else clearTimeout(connectTimer);
    });
    req.setTimeout(RESPONSE_TIMEOUT_MS, () => req.destroy(Object.assign(new Error('response timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', err => { clearTimeout(connectTimer); reject(err); });
    req.on('close', () => clearTimeout(connectTimer));

    if (body && body.length) req.write(body);
    req.end();
  });
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...extraHeaders });
  res.end(JSON.stringify(payload));
}

function createAzorDevProxy({ apiTarget, jwtSecret, azorToken }) {
  async function isSessionValid(authorization) {
    if (!authorization) return false;
    const headers = { Authorization: authorization };
    if (jwtSecret) headers['x-api-key'] = jwtSecret;
    const res = await request(`${apiTarget.replace(/\/+$/, '')}/frontend/permisos/`, { headers });
    return res.status >= 200 && res.status < 300;
  }

  /** Atiende la petición por completo. Se usa como `bypass` del proxy de Vite. */
  return async function handle(req, res) {
    try {
      const match = AZOR_PROXY_RE.exec(req.url || '');
      if (!match || !ALLOWED_METHODS.includes(req.method)) {
        return sendJson(res, 403, { detail: 'Ruta o método no permitido en el proxy de Azor Panel' });
      }

      if (!(await isSessionValid(req.headers['authorization']))) {
        return sendJson(res, 401, { detail: 'Sesión inválida o expirada' }, {
          'X-Azor-Proxy-Auth': 'denied',
          'Access-Control-Expose-Headers': 'X-Azor-Proxy-Auth'
        });
      }

      const [, scheme, host, port, path, query = ''] = match;
      const target = `${scheme}://${host}:${port}/${path}${query}`;
      const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : null;

      const headers = { Accept: req.headers['accept'] || 'application/json' };
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
      if (body) headers['Content-Length'] = String(body.length);
      if (azorToken) headers['X-API-Key'] = azorToken;

      let upstream;
      try {
        upstream = await request(target, { method: req.method, headers, body });
      } catch (err) {
        // Igual que nginx: 504 si no responde a tiempo, 502 si no se pudo conectar
        const status = err && err.code === 'ETIMEDOUT' ? 504 : 502;
        return sendJson(res, status, { detail: `No se pudo conectar con ${scheme}://${host}:${port}` });
      }

      const passHeaders = {};
      if (upstream.headers['content-type']) passHeaders['Content-Type'] = upstream.headers['content-type'];
      res.writeHead(upstream.status, passHeaders);
      res.end(upstream.body);
    } catch (err) {
      console.error('❌ [azor-dev-proxy]', err);
      if (!res.headersSent) sendJson(res, 500, { detail: 'Error interno del proxy de Azor Panel' });
      else res.end();
    }
  };
}

module.exports = { createAzorDevProxy, AZOR_PROXY_RE };
