const http = require('http');

// Simulación de la tabla "usuarios" en PostgreSQL con el esquema exacto de SQLAlchemy
const dbUsuarios = [
  {
    user_id: 'e4b10fa0-7988-466d-a111-c917b2b73bc5',
    usuario: 'admin',
    nombre: 'Administrador del Sistema',
    contrasena: 'admin123', // En producción se debe usar hashing (e.g. bcrypt)
    rol: 'administrador',
    created_at: new Date('2026-01-01T08:00:00Z').toISOString()
  },
  {
    user_id: '67a7a5cc-98a9-4672-9cc9-5b7d0a68d712',
    usuario: 'operador',
    nombre: 'Operador de Control',
    contrasena: 'op123456',
    rol: 'operador',
    created_at: new Date('2026-02-15T12:30:00Z').toISOString()
  }
];

// Almacén de sesiones en memoria
const activeSessions = new Map();

const PORT = 3000;

const server = http.createServer((req, res) => {
  // Configurar CORS por si se accede directamente
  res.setHeader('Access-Control-Allow-Origin', 'http://localhost:4200');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-XSRF-TOKEN');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Parsear cookies del request
  const cookies = {};
  const rc = req.headers.cookie;
  if (rc) {
    rc.split(';').forEach(cookie => {
      const parts = cookie.split('=');
      cookies[parts.shift().trim()] = decodeURI(parts.join('='));
    });
  }

  // Helper para leer el body JSON
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    let parsedBody = {};
    if (body) {
      try {
        parsedBody = JSON.parse(body);
      } catch (e) {
        // Ignorar errores de parseo
      }
    }

    console.log(`[MockServer] ${req.method} ${req.url}`);

    // ---- RUTA: POST /api/auth/login ----
    if (req.url === '/api/auth/login' && req.method === 'POST') {
      const { username, contrasena } = parsedBody;
      const user = dbUsuarios.find(u => u.usuario === username && u.contrasena === contrasena);

      if (user) {
        const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        activeSessions.set(sessionId, user);

        // Envío de cookies: 
        // 1. "session" que es HttpOnly (seguridad XSS)
        // 2. "XSRF-TOKEN" leíble para la mitigación CSRF de Angular
        res.setHeader('Set-Cookie', [
          `session=${sessionId}; HttpOnly; Path=/; SameSite=Lax`,
          `XSRF-TOKEN=csrf-mock-token-abc123; Path=/; SameSite=Lax`
        ]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          user: {
            user_id: user.user_id,
            usuario: user.usuario,
            nombre: user.nombre,
            rol: user.rol,
            created_at: user.created_at
          }
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Usuario o contraseña incorrectos' }));
      }
      return;
    }

    // ---- RUTA: GET /api/auth/session ----
    if (req.url === '/api/auth/session' && req.method === 'GET') {
      const sessionId = cookies['session'];
      const user = activeSessions.get(sessionId);

      if (user) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          user: {
            user_id: user.user_id,
            usuario: user.usuario,
            nombre: user.nombre,
            rol: user.rol,
            created_at: user.created_at
          }
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No autorizado / Sesión expirada' }));
      }
      return;
    }

    // ---- RUTA: POST /api/auth/logout ----
    if (req.url === '/api/auth/logout' && req.method === 'POST') {
      // Validar CSRF
      const xsrfToken = req.headers['x-xsrf-token'];
      if (!xsrfToken || xsrfToken !== 'csrf-mock-token-abc123') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'CSRF token validation failed.' }));
        return;
      }

      const sessionId = cookies['session'];
      if (sessionId) {
        activeSessions.delete(sessionId);
      }

      // Limpiar cookies
      res.setHeader('Set-Cookie', [
        'session=; HttpOnly; Path=/; Max-Age=0',
        'XSRF-TOKEN=; Path=/; Max-Age=0'
      ]);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // ---- RUTA: GET /api/users ----
    if (req.url === '/api/users' && req.method === 'GET') {
      // Validar si el usuario está autenticado
      const sessionId = cookies['session'];
      const user = activeSessions.get(sessionId);

      if (!user) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No autorizado' }));
        return;
      }

      // Retornar la lista completa de usuarios sin contraseñas
      const safeUsers = dbUsuarios.map(({ contrasena, ...rest }) => rest);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(safeUsers));
      return;
    }

    // ---- RUTA NO ENCONTRADA ----
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint no encontrado en el servidor simulado' }));
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Servidor Backend de Simulación Iniciado Correctamente`);
  console.log(` Escuchando en: http://localhost:${PORT}`);
  console.log(`=======================================================`);
  console.log(`Usuarios Registrados para Pruebas:`);
  dbUsuarios.forEach(u => {
    console.log(` - Usuario: '${u.usuario}' | Clave: '${u.contrasena}' | Rol: '${u.rol}'`);
  });
  console.log(`=======================================================`);
});
