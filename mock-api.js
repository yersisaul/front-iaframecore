const http = require('http');

// Funciones auxiliares para vectores y similitud de coseno
function generateNormalizedVector(dimensions = 512) {
  const vec = Array.from({ length: dimensions }, () => Math.random() * 2 - 1);
  const norm = Math.sqrt(vec.reduce((sum, val) => sum + val * val, 0));
  return norm === 0 ? vec : vec.map(v => v / norm);
}

function dotProduct(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

// Historial del último patrón de imagen subido
let lastUploadedImage = {
  url: '',
  embedding: null
};

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

const dbHosts = Array.from({ length: 25 }, (_, i) => {
  const idNum = i + 1;
  const isEven = idNum % 2 === 0;
  const isThird = idNum % 3 === 0;
  return {
    host_id: `e1d13fa0-8988-466d-a111-c917b2b73b${idNum.toString(16).padStart(2, '0')}`,
    fingerprint: `host-fingerprint-${idNum.toString().padStart(3, '0')}`,
    hostname: `Server-Node-${idNum.toString().padStart(2, '0')}`,
    ip_address: `192.168.1.${100 + idNum}`,
    version: '1.4.2',
    status: isEven ? 'active' : 'inactive',
    hw_info: {
      machine_id: `mach-uuid-${idNum.toString().padStart(3, '0')}`,
      mac: `00:1A:2B:3C:4D:${idNum.toString(16).toUpperCase().padStart(2, '0')}`,
      system: isThird ? 'Windows' : 'Linux',
      release: isThird ? 'Windows Server 2022' : 'Ubuntu 22.04 LTS',
      arch: 'x86_64',
      total_ram: idNum % 4 === 0 ? '16 GB' : (idNum % 4 === 1 ? '32 GB' : (idNum % 4 === 2 ? '64 GB' : '128 GB'))
    },
    gpu_info: isEven ? {
      GPU: 'NVIDIA',
      model: isThird ? 'RTX 4090' : 'A100 Tensor Core',
      total_memory: isThird ? '24 GB' : '80 GB',
      compute_capability: '8.9'
    } : null,
    license: {
      tipo: isEven ? 'permanente' : 'temporal',
      emision: '2026-06-09T17:46:14.635956',
      features: {
        'Aglomeracion': 30,
        'Cruce de Linea': 3,
        'Objeto en area': 30,
        'Control de aforo': 30,
        'Analisis de trafico': 30,
        'Objeto fuera de area': 30,
        'Personas con objetos': 30,
        'Vigilancia de Objeto': 30,
        'Vigilancia vehicular': 30,
        'Comportamiento humano': 30,
        'Medicion de velocidad': 30,
        'Permanencia de objeto': 30,
        'Reconocimiento facial': 1,
        'Cercania entre objetos': 30,
        'Reconocimiento de placas': 2,
        'Gestion de estacionamientos': 30
      },
      expiracion: isEven ? undefined : '2026-09-07T17:46:14.635956'
    }
  };
});

// Cámaras, Horarios y Analíticas simulados vinculados a los Hosts
const dbCameras = [];
const dbAnalytics = [];
const dbSchedules = [];

dbHosts.forEach((host, i) => {
  const hostFp = host.fingerprint;
  
  // 2 Cámaras por cada Host
  const cam1 = {
    camera_id: `cam-uuid-${(i * 2 + 1).toString().padStart(3, '0')}`,
    camera_name: `Camara-${(i * 2 + 1).toString().padStart(2, '0')}-${host.hostname}`,
    fingerprint_host: hostFp,
    stream_type: 'RTSP',
    status: 'active',
    decoder: 'h264',
    location: { 
      lat: -12.046374 + (Math.random() * 0.1 - 0.05), 
      lon: -77.042793 + (Math.random() * 0.1 - 0.05) 
    },
    created_at: new Date('2026-03-01T10:00:00Z').toISOString()
  };
  
  const cam2 = {
    camera_id: `cam-uuid-${(i * 2 + 2).toString().padStart(3, '0')}`,
    camera_name: `Camara-${(i * 2 + 2).toString().padStart(2, '0')}-${host.hostname}`,
    fingerprint_host: hostFp,
    stream_type: 'RTSP',
    status: i % 3 === 0 ? 'inactive' : 'active',
    decoder: 'h265',
    location: { 
      lat: -12.046374 + (Math.random() * 0.1 - 0.05), 
      lon: -77.042793 + (Math.random() * 0.1 - 0.05) 
    },
    created_at: new Date('2026-03-05T14:30:00Z').toISOString()
  };
  
  dbCameras.push(cam1, cam2);

  // 1 Analítica por Host (alternando tipos)
  const analytic = {
    analytic_id: `analytic-uuid-${(i + 1).toString().padStart(3, '0')}`,
    fingerprint_host: hostFp,
    analytic_type: i % 2 === 0 ? 'face_recognition' : 'license_plate_recognition',
    analytic_status: 'active',
    target_cameras: [
      { camera_id: cam1.camera_id, camera_name: cam1.camera_name },
      { camera_id: cam2.camera_id, camera_name: cam2.camera_name }
    ],
    detection_classes: i % 2 === 0 
      ? [{ class_index: 0, class_name: 'face' }] 
      : [{ class_index: 1, class_name: 'license_plate' }],
    parameters: { min_confidence: 0.75 },
    geometric_objects: {},
    acciones: {}
  };
  dbAnalytics.push(analytic);

  // 1 Horario por Host
  const schedule = {
    schedule_id: `sched-uuid-${(i + 1).toString().padStart(3, '0')}`,
    nombre: `Horario-${host.hostname}`,
    fingerprint_host: hostFp,
    analytics_ids: [{ id_analytic: analytic.analytic_id }],
    timestamp_inicio: new Date('2026-01-01T08:00:00Z').toISOString(),
    timestamp_fin: new Date('2026-12-31T20:00:00Z').toISOString(),
    frecuencia: 'diario',
    estado: 'activo'
  };
  dbSchedules.push(schedule);
});

// Listas de Control y Detalles simulados
const dbLists = [
  {
    list_id: 'list-uuid-face-001',
    name: 'Lista VIP de Rostros',
    description: 'Personas de acceso preferente o VIP.',
    list_type: 'RF'
  },
  {
    list_id: 'list-uuid-face-002',
    name: 'Lista Negra de Rostros',
    description: 'Sujetos no autorizados en el recinto.',
    list_type: 'RF'
  },
  {
    list_id: 'list-uuid-plate-001',
    name: 'Lista VIP de Placas',
    description: 'Vehículos autorizados para ingreso libre.',
    list_type: 'LPR'
  }
];

const dbListDetails = [
  {
    detail_id: 'detail-uuid-001',
    list_id: 'list-uuid-face-001',
    fingerprint_host: '',
    nombre_asociado: 'Juan Pérez',
    embedding: generateNormalizedVector(512),
    metadata: {
      url_img: 'https://randomuser.me/api/portraits/men/32.jpg'
    }
  },
  {
    detail_id: 'detail-uuid-002',
    list_id: 'list-uuid-face-001',
    fingerprint_host: '',
    nombre_asociado: 'María López',
    embedding: generateNormalizedVector(512),
    metadata: {
      url_img: 'https://randomuser.me/api/portraits/women/44.jpg'
    }
  },
  {
    detail_id: 'detail-uuid-003',
    list_id: 'list-uuid-plate-001',
    fingerprint_host: '',
    nombre_asociado: 'Carlos Gómez',
    embedding: generateNormalizedVector(512),
    metadata: {
      url_img: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=120&h=120&fit=crop',
      text_placa: 'ABC-1234'
    }
  }
];

// Documentos simulados de OpenSearch (para la vista de Metadatos)
const dbOpenSearchDocs = {
  personas: [],
  vehiculos: [],
  rostros: [],
  otros: []
};

const cameraNames = dbCameras.map(c => c.camera_name);

// Generar registros de personas
for (let i = 1; i <= 35; i++) {
  dbOpenSearchDocs.personas.push({
    _id: `person-doc-${i.toString().padStart(3, '0')}`,
    _score: 1.0,
    _source: {
      camara: cameraNames[i % cameraNames.length],
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      confiabilidad: 0.6 + (Math.random() * 0.38),
      ruta_imagen_remota: `https://images.unsplash.com/photo-${i % 2 === 0 ? '1506794778202-cad84cf45f1d' : '1544005313-94ddf0286df2'}?w=400&h=300&fit=crop`,
      tipo_objeto: i % 4 === 0 ? 'persona' : (i % 2 === 0 ? 'ciclista' : 'peatón'),
      edad: i % 3 === 0 ? 'adulto' : (i % 3 === 1 ? 'joven' : 'anciano'),
      genero: i % 2 === 0 ? 'masculino' : 'femenino',
      colores: [
        { color_text: i % 2 === 0 ? 'azul' : 'rojo', r: i % 2 === 0 ? 0 : 255, g: 0, b: i % 2 === 0 ? 255 : 0, porcentaje: 0.6 },
        { color_text: 'negro', r: 0, g: 0, b: 0, porcentaje: 0.4 }
      ],
      posturas: [
        { postura: i % 2 === 0 ? 'caminando' : 'parado', conteo: 1 }
      ],
      embedding: generateNormalizedVector(512)
    }
  });
}

// Generar registros de vehículos
for (let i = 1; i <= 35; i++) {
  dbOpenSearchDocs.vehiculos.push({
    _id: `vehicle-doc-${i.toString().padStart(3, '0')}`,
    _score: 1.0,
    _source: {
      camara: cameraNames[i % cameraNames.length],
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      confiabilidad: 0.6 + (Math.random() * 0.38),
      ruta_imagen_remota: `https://images.unsplash.com/photo-${i % 2 === 0 ? '1503376780353-7e6692767b70' : '1533473359331-0135ef1b58bf'}?w=400&h=300&fit=crop`,
      tipo_objeto: i % 3 === 0 ? 'auto' : (i % 3 === 1 ? 'camioneta' : 'motocicleta'),
      colores: [
        { color_text: i % 2 === 0 ? 'gris' : 'blanco', r: i % 2 === 0 ? 128 : 255, g: i % 2 === 0 ? 128 : 255, b: i % 2 === 0 ? 128 : 255, porcentaje: 0.7 },
        { color_text: 'negro', r: 0, g: 0, b: 0, porcentaje: 0.3 }
      ],
      reconocimiento: i % 3 !== 0 ? `P${i}X-${234 + i}` : '', // Texto de la placa
      embedding: generateNormalizedVector(512)
    }
  });
}

// Generar registros de rostros
const faceNames = ['Juan Pérez', 'María López', 'Carlos Gómez', 'José Rodríguez', 'Ana Martínez'];
for (let i = 1; i <= 35; i++) {
  dbOpenSearchDocs.rostros.push({
    _id: `face-doc-${i.toString().padStart(3, '0')}`,
    _score: 1.0,
    _source: {
      camara: cameraNames[i % cameraNames.length],
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      confiabilidad: 0.6 + (Math.random() * 0.38),
      ruta_imagen_remota: `https://randomuser.me/api/portraits/${i % 2 === 0 ? 'men' : 'women'}/${15 + i}.jpg`,
      edad: i % 3 === 0 ? 'joven' : (i % 3 === 1 ? 'adulto' : 'anciano'),
      genero: i % 2 === 0 ? 'masculino' : 'femenino',
      colores: [
        { color_text: 'blanco', r: 255, g: 255, b: 255, porcentaje: 1.0 }
      ],
      reconocimiento: i % 4 === 0 ? faceNames[i % faceNames.length] : '', // Nombre reconocido
      embedding: generateNormalizedVector(512)
    }
  });
}

// Generar registros de otros objetos
for (let i = 1; i <= 20; i++) {
  dbOpenSearchDocs.otros.push({
    _id: `other-doc-${i.toString().padStart(3, '0')}`,
    _score: 1.0,
    _source: {
      camara: cameraNames[i % cameraNames.length],
      timestamp: new Date(Date.now() - i * 3600000).toISOString(),
      confiabilidad: 0.5 + (Math.random() * 0.45),
      ruta_imagen_remota: `https://picsum.photos/400/300?random=${300 + i}`,
      tipo_objeto: i % 2 === 0 ? 'mochila' : 'maleta',
      colores: [
        { color_text: i % 2 === 0 ? 'azul' : 'negro', r: 0, g: 0, b: i % 2 === 0 ? 255 : 0, porcentaje: 1.0 }
      ],
      embedding: generateNormalizedVector(512)
    }
  });
}

// Almacén de sesiones en memoria
const activeSessions = new Map();

const PORT = 3000;

const server = http.createServer((req, res) => {
  // Configurar CORS
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

  // Helper para leer body JSON
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

    // Normalizar la ruta eliminando prefijos de proxy (/api o /opensearch)
    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let pathname = urlObj.pathname;
    let isOpenSearch = false;

    if (pathname.startsWith('/api')) {
      pathname = pathname.substring(4);
    } else if (pathname.startsWith('/opensearch')) {
      pathname = pathname.substring(11);
      isOpenSearch = true;
    }

    // En caso de que no tenga prefijo en el request directo, detectar OpenSearch
    if (!isOpenSearch && (pathname.startsWith('/_cat') || pathname.startsWith('/personas') || pathname.startsWith('/vehiculos') || pathname.startsWith('/rostros') || pathname.startsWith('/otros'))) {
      isOpenSearch = true;
    }

    console.log(`[MockServer] ${req.method} Normalized Path: ${pathname} (OpenSearch=${isOpenSearch})`);

    // ========================================================
    // SECCIÓN: RUTAS OPENSEARCH MOCK
    // ========================================================
    if (isOpenSearch) {
      // 1. GET /_cat/indices?format=json
      if (pathname.startsWith('/_cat/indices') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { health: 'green', status: 'open', index: 'personas', uuid: 'p1', pri: '1', rep: '0', 'docs.count': String(dbOpenSearchDocs.personas.length), 'docs.deleted': '0', 'store.size': '256kb', 'pri.store.size': '256kb' },
          { health: 'green', status: 'open', index: 'vehiculos', uuid: 'v1', pri: '1', rep: '0', 'docs.count': String(dbOpenSearchDocs.vehiculos.length), 'docs.deleted': '0', 'store.size': '312kb', 'pri.store.size': '312kb' },
          { health: 'green', status: 'open', index: 'rostros', uuid: 'r1', pri: '1', rep: '0', 'docs.count': String(dbOpenSearchDocs.rostros.length), 'docs.deleted': '0', 'store.size': '420kb', 'pri.store.size': '420kb' },
          { health: 'green', status: 'open', index: 'otros', uuid: 'o1', pri: '1', rep: '0', 'docs.count': String(dbOpenSearchDocs.otros.length), 'docs.deleted': '0', 'store.size': '128kb', 'pri.store.size': '128kb' }
        ]));
        return;
      }

      // 2. GET /{index}/_count
      const countMatch = pathname.match(/^\/([^\/]+)\/_count$/);
      if (countMatch && req.method === 'GET') {
        const index = countMatch[1];
        const docs = dbOpenSearchDocs[index] || [];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ count: docs.length }));
        return;
      }

      // 3. POST /{index}/_search
      const searchMatch = pathname.match(/^\/([^\/]+)\/_search$/);
      if (searchMatch && req.method === 'POST') {
        const index = searchMatch[1];
        let docs = dbOpenSearchDocs[index] || [];

        // Filtros simulados sobre la colección
        let mustFilters = [];
        if (parsedBody.query?.bool?.filter) {
          mustFilters = parsedBody.query.bool.filter;
        } else if (parsedBody.query?.knn?.embedding?.filter?.bool?.filter) {
          mustFilters = parsedBody.query.knn.embedding.filter.bool.filter;
        }

        mustFilters.forEach(f => {
          if (f.terms) {
            if (f.terms.tipo_objeto) {
              const vals = f.terms.tipo_objeto;
              docs = docs.filter(d => vals.includes(d._source.tipo_objeto));
            }
            if (f.terms.camara) {
              const vals = f.terms.camara;
              docs = docs.filter(d => vals.includes(d._source.camara));
            }
          }
          if (f.term) {
            if (f.term.edad) docs = docs.filter(d => d._source.edad === f.term.edad);
            if (f.term.genero) docs = docs.filter(d => d._source.genero === f.term.genero);
            if (f.term.reconocimiento) docs = docs.filter(d => d._source.reconocimiento === f.term.reconocimiento);
          }
          if (f.exists && f.exists.field === 'reconocimiento') {
            docs = docs.filter(d => !!d._source.reconocimiento);
          }
          if (f.bool && f.bool.must_not && f.bool.must_not.exists && f.bool.must_not.exists.field === 'reconocimiento') {
            docs = docs.filter(d => !d._source.reconocimiento);
          }
          if (f.range) {
            if (f.range.confiabilidad) {
              const { gte, lte } = f.range.confiabilidad;
              if (gte !== undefined) docs = docs.filter(d => d._source.confiabilidad >= gte);
              if (lte !== undefined) docs = docs.filter(d => d._source.confiabilidad <= lte);
            }
            if (f.range.timestamp) {
              const { gte, lte } = f.range.timestamp;
              if (gte) docs = docs.filter(d => new Date(d._source.timestamp) >= new Date(gte));
              if (lte) docs = docs.filter(d => new Date(d._source.timestamp) <= new Date(lte));
            }
          }
          if (f.nested) {
            if (f.nested.path === 'colores') {
              const terms = f.nested.query?.terms?.['colores.color_text'];
              if (terms) {
                docs = docs.filter(d => Array.isArray(d._source.colores) && d._source.colores.some(c => terms.includes(c.color_text)));
              }
            }
            if (f.nested.path === 'posturas') {
              const terms = f.nested.query?.terms?.['posturas.postura'];
              if (terms) {
                docs = docs.filter(d => Array.isArray(d._source.posturas) && d._source.posturas.some(p => terms.includes(p.postura)));
              }
            }
          }
          if (f.multi_match && f.multi_match.query) {
            const queryStr = f.multi_match.query.toLowerCase();
            docs = docs.filter(d => 
              String(d._id).toLowerCase().includes(queryStr) || 
              String(d._source.camara).toLowerCase().includes(queryStr) || 
              String(d._source.reconocimiento || '').toLowerCase().includes(queryStr) || 
              String(d._source.tipo_objeto || '').toLowerCase().includes(queryStr)
            );
          }
        });

        // Simular cálculo de score para búsqueda KNN y blending para matches realistas
        let knnVector = parsedBody.query?.knn?.embedding?.vector;
        let hits = docs.map((doc, idx) => {
          let docCopy = JSON.parse(JSON.stringify(doc));
          let score = 1.0;
          if (knnVector) {
            if (idx === 0) {
              // 95% de similitud para el primer match
              docCopy._source.embedding = knnVector;
              score = 0.95;
              if (lastUploadedImage.embedding && lastUploadedImage.url) {
                // Si la consulta es similar al vector cargado, mostramos la imagen real
                docCopy._source.ruta_imagen_remota = lastUploadedImage.url;
              }
            } else if (idx === 1) {
              // 88% de similitud para el segundo match
              docCopy._source.embedding = docCopy._source.embedding.map((v, i) => 0.85 * knnVector[i] + 0.15 * v);
              score = 0.88;
            } else if (idx === 2) {
              // 79% de similitud para el tercer match
              docCopy._source.embedding = docCopy._source.embedding.map((v, i) => 0.70 * knnVector[i] + 0.30 * v);
              score = 0.79;
            } else if (idx === 3) {
              // 68% de similitud para el cuarto match
              docCopy._source.embedding = docCopy._source.embedding.map((v, i) => 0.55 * knnVector[i] + 0.45 * v);
              score = 0.68;
            } else {
              score = dotProduct(knnVector, docCopy._source.embedding);
              score = Math.max(0.1, Math.min(0.45, Math.abs(score) + 0.1));
            }
          }
          docCopy._score = score;
          return docCopy;
        });

        // Ordenar hits
        if (knnVector) {
          hits.sort((a, b) => b._score - a._score);
        } else {
          hits.sort((a, b) => new Date(b._source.timestamp) - new Date(a._source.timestamp));
        }

        // Paginación y corte
        const from = parsedBody.from || 0;
        const size = parsedBody.size || 20;
        const paginatedHits = hits.slice(from, from + size);

        // Armar Agregaciones
        const tipoObjetoCounts = {};
        const edadCounts = {};
        const generoCounts = {};
        const camaraCounts = {};
        const recCounts = {};
        const colorCounts = {};
        const postureCounts = {};
        let confMin = 1.0;
        let confMax = 0.0;

        hits.forEach(d => {
          const s = d._source;
          if (s.tipo_objeto) tipoObjetoCounts[s.tipo_objeto] = (tipoObjetoCounts[s.tipo_objeto] || 0) + 1;
          if (s.edad) edadCounts[s.edad] = (edadCounts[s.edad] || 0) + 1;
          if (s.genero) generoCounts[s.genero] = (generoCounts[s.genero] || 0) + 1;
          if (s.camara) camaraCounts[s.camara] = (camaraCounts[s.camara] || 0) + 1;
          if (s.reconocimiento) recCounts[s.reconocimiento] = (recCounts[s.reconocimiento] || 0) + 1;
          if (Array.isArray(s.colores)) {
            s.colores.forEach(c => { if (c.color_text) colorCounts[c.color_text] = (colorCounts[c.color_text] || 0) + 1; });
          }
          if (Array.isArray(s.posturas)) {
            s.posturas.forEach(p => { if (p.postura) postureCounts[p.postura] = (postureCounts[p.postura] || 0) + 1; });
          }
          if (s.confiabilidad !== undefined) {
            if (s.confiabilidad < confMin) confMin = s.confiabilidad;
            if (s.confiabilidad > confMax) confMax = s.confiabilidad;
          }
        });

        const aggregations = {
          tipo_objeto_vals: { buckets: Object.keys(tipoObjetoCounts).map(k => ({ key: k, doc_count: tipoObjetoCounts[k] })) },
          edad_vals: { buckets: Object.keys(edadCounts).map(k => ({ key: k, doc_count: edadCounts[k] })) },
          genero_vals: { buckets: Object.keys(generoCounts).map(k => ({ key: k, doc_count: generoCounts[k] })) },
          camara_vals: { buckets: Object.keys(camaraCounts).map(k => ({ key: k, doc_count: camaraCounts[k] })) },
          reconocimiento_vals: { buckets: Object.keys(recCounts).map(k => ({ key: k, doc_count: recCounts[k] })) },
          colores_agg: { color_vals: { buckets: Object.keys(colorCounts).map(k => ({ key: k, doc_count: colorCounts[k] })) } },
          posturas_agg: { postura_vals: { buckets: Object.keys(postureCounts).map(k => ({ key: k, doc_count: postureCounts[k] })) } },
          confiabilidad_stats: { min: confMin === 1.0 ? 0 : confMin, max: confMax === 0.0 ? 1 : confMax }
        };

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          hits: {
            total: { value: hits.length, relation: 'eq' },
            max_score: knnVector ? (hits[0]?._score || 1.0) : 1.0,
            hits: paginatedHits
          },
          aggregations
        }));
        return;
      }
    }

    // ========================================================
    // SECCIÓN: RUTAS API MOCK (Normalizadas)
    // ========================================================

    // ---- RUTA: POST /auth/login ----
    if (pathname === '/auth/login' && req.method === 'POST') {
      const { usuario, password } = parsedBody; // frontend envía usuario/password en DTO
      const user = dbUsuarios.find(u => u.usuario === usuario && u.contrasena === password);

      if (user) {
        const sessionId = Math.random().toString(36).substring(2) + Date.now().toString(36);
        activeSessions.set(sessionId, user);

        res.setHeader('Set-Cookie', [
          `session=${sessionId}; HttpOnly; Path=/; SameSite=Lax`,
          `XSRF-TOKEN=csrf-mock-token-abc123; Path=/; SameSite=Lax`
        ]);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          access_token: 'mock-jwt-token-xyz',
          token_type: 'bearer',
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
        res.end(JSON.stringify({ detail: 'Usuario o contraseña incorrectos' }));
      }
      return;
    }

    // ---- RUTA: GET /auth/session ----
    if (pathname === '/auth/session' && req.method === 'GET') {
      const sessionId = cookies['session'];
      const user = activeSessions.get(sessionId);

      if (user) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          user_id: user.user_id,
          usuario: user.usuario,
          nombre: user.nombre,
          rol: user.rol,
          created_at: user.created_at
        }));
      } else {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'No autorizado / Sesión expirada' }));
      }
      return;
    }

    // ---- RUTA: POST /auth/logout ----
    if (pathname === '/auth/logout' && req.method === 'POST') {
      const sessionId = cookies['session'];
      if (sessionId) {
        activeSessions.delete(sessionId);
      }
      res.setHeader('Set-Cookie', [
        'session=; HttpOnly; Path=/; Max-Age=0',
        'XSRF-TOKEN=; Path=/; Max-Age=0'
      ]);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // ---- RUTA: GET /users ----
    if (pathname === '/users' && req.method === 'GET') {
      const safeUsers = dbUsuarios.map(({ contrasena, ...rest }) => rest);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(safeUsers));
      return;
    }

    // ---- RUTA: GET /frontend/hosts/ ----
    if ((pathname === '/frontend/hosts/' || pathname === '/frontend/hosts') && req.method === 'GET') {
      const page = parseInt(urlObj.searchParams.get('page') || '1', 10);
      const limit = parseInt(urlObj.searchParams.get('limit') || '20', 10);
      const search = urlObj.searchParams.get('search') || '';
      const status = urlObj.searchParams.get('status') || '';
      
      let filtered = [...dbHosts];
      if (search) {
        filtered = filtered.filter(h => h.hostname.toLowerCase().includes(search.toLowerCase()) || h.ip_address.includes(search));
      }
      if (status && status !== 'all') {
        filtered = filtered.filter(h => h.status === status);
      }

      const startIndex = (page - 1) * limit;
      const paginated = filtered.slice(startIndex, startIndex + limit);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        items: paginated,
        total: filtered.length
      }));
      return;
    }

    // ---- RUTA: GET /frontend/hosts/heartbeat/{fingerprint} ----
    const heartbeatHostMatch = pathname.match(/^\/frontend\/hosts\/heartbeat\/([^\/]+)$/);
    if (heartbeatHostMatch && req.method === 'GET') {
      const hostFp = heartbeatHostMatch[1];
      const hostExists = dbHosts.some(h => h.fingerprint === hostFp);
      if (hostExists) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          last_seen: new Date().toISOString(),
          metrics: {
            cpu: Number((Math.random() * 30 + 10).toFixed(1)),
            gpu: Number((Math.random() * 20).toFixed(1)),
            vram: Number((Math.random() * 40 + 20).toFixed(1)),
            memory: Number((Math.random() * 20 + 70).toFixed(1))
          }
        }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Nodo no encontrado' }));
      }
      return;
    }

    // ---- RUTA: POST /frontend/hosts/migrate_setup ----
    if (pathname === '/frontend/hosts/migrate_setup' && req.method === 'POST') {
      const { old_fingerprint, new_fingerprint } = parsedBody;
      if (!old_fingerprint || !new_fingerprint) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Faltan parámetros old_fingerprint o new_fingerprint' }));
        return;
      }

      // Migrar cámaras
      dbCameras.forEach(cam => {
        if (cam.fingerprint_host === old_fingerprint) {
          cam.fingerprint_host = new_fingerprint;
        }
      });

      // Migrar analíticas
      dbAnalytics.forEach(an => {
        if (an.fingerprint_host === old_fingerprint) {
          an.fingerprint_host = new_fingerprint;
        }
      });

      // Migrar horarios (schedules)
      dbSchedules.forEach(sch => {
        if (sch.fingerprint_host === old_fingerprint) {
          sch.fingerprint_host = new_fingerprint;
        }
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // ---- RUTA: GET /frontend/cameras/{fingerprint_host} ----
    const camsHostMatch = pathname.match(/^\/frontend\/cameras\/([^\/]+)$/);
    if (camsHostMatch && req.method === 'GET') {
      const hostFp = camsHostMatch[1];
      const cams = dbCameras.filter(c => c.fingerprint_host === hostFp);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cams));
      return;
    }

    // ---- RUTA: POST /frontend/cameras/update/{camera_id} ----
    const updateCamMatch = pathname.match(/^\/frontend\/cameras\/update\/([^\/]+)$/);
    if (updateCamMatch && req.method === 'POST') {
      const cameraId = updateCamMatch[1];
      const index = dbCameras.findIndex(c => c.camera_id === cameraId);
      if (index !== -1) {
        if (parsedBody.camera_name) dbCameras[index].camera_name = parsedBody.camera_name;
        if (parsedBody.location) dbCameras[index].location = parsedBody.location;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbCameras[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Cámara no encontrada' }));
      }
      return;
    }

    // ---- RUTA: DELETE /frontend/cameras/delete/{camera_id} ----
    const deleteCamMatch = pathname.match(/^\/frontend\/cameras\/delete\/([^\/]+)$/);
    if (deleteCamMatch && req.method === 'DELETE') {
      const cameraId = deleteCamMatch[1];
      const index = dbCameras.findIndex(c => c.camera_id === cameraId);
      if (index !== -1) {
        dbCameras.splice(index, 1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Cámara no encontrada' }));
      }
      return;
    }

    // ---- RUTA: POST /cameras/update/ (legacy) ----
    if (pathname === '/cameras/update/' && req.method === 'POST') {
      const index = dbCameras.findIndex(c => c.camera_id === parsedBody.camera_id);
      if (index !== -1) {
        dbCameras[index] = { ...dbCameras[index], ...parsedBody };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbCameras[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Cámara no encontrada' }));
      }
      return;
    }


    // ---- RUTA: GET /frontend/analytics/{fingerprint_host} ----
    const analyticsHostMatch = pathname.match(/^\/frontend\/analytics\/([^\/]+)$/);
    if (analyticsHostMatch && req.method === 'GET') {
      const hostFp = analyticsHostMatch[1];
      const analytics = dbAnalytics.filter(a => a.fingerprint_host === hostFp);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(analytics));
      return;
    }

    // ---- RUTA: POST /frontend/analytics/update_status/{analytic_id} ----
    const updateAnalyticMatch = pathname.match(/^\/frontend\/analytics\/update_status\/([^\/]+)$/);
    if (updateAnalyticMatch && req.method === 'POST') {
      const analyticId = updateAnalyticMatch[1];
      const index = dbAnalytics.findIndex(a => a.analytic_id === analyticId);
      if (index !== -1) {
        dbAnalytics[index].analytic_status = parsedBody.status || 'inactive';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbAnalytics[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Analítica no encontrada' }));
      }
      return;
    }

    // ---- RUTA: DELETE /frontend/analytics/{analytic_id} ----
    const deleteAnalyticMatch = pathname.match(/^\/frontend\/analytics\/([^\/]+)$/);
    if (deleteAnalyticMatch && req.method === 'DELETE') {
      const analyticId = deleteAnalyticMatch[1];
      const index = dbAnalytics.findIndex(a => a.analytic_id === analyticId);
      if (index !== -1) {
        dbAnalytics.splice(index, 1);
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Analítica no encontrada' }));
      }
      return;
    }

    // ---- RUTA: GET /frontend/schedules/ ----
    if ((pathname === '/frontend/schedules/' || pathname === '/frontend/schedules') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dbSchedules));
      return;
    }

    // ---- RUTA: POST /frontend/schedules/create ----
    if (pathname === '/frontend/schedules/create' && req.method === 'POST') {
      const newSched = {
        schedule_id: `sched-uuid-${Math.random().toString(36).substring(2, 7)}`,
        nombre: parsedBody.nombre || 'Nuevo Horario',
        fingerprint_host: parsedBody.fingerprint_host || '',
        analytics_ids: parsedBody.analytics_ids || [],
        timestamp_inicio: parsedBody.timestamp_inicio || new Date().toISOString(),
        timestamp_fin: parsedBody.timestamp_fin || new Date().toISOString(),
        frecuencia: parsedBody.frecuencia || 'diario',
        estado: parsedBody.estado || 'activo'
      };
      dbSchedules.push(newSched);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newSched));
      return;
    }

    // ---- RUTA: PUT /frontend/schedules/update/{schedule_id} ----
    const updateSchedMatch = pathname.match(/^\/frontend\/schedules\/update\/([^\/]+)$/);
    if (updateSchedMatch && req.method === 'PUT') {
      const schedId = updateSchedMatch[1];
      const index = dbSchedules.findIndex(s => s.schedule_id === schedId);
      if (index !== -1) {
        dbSchedules[index] = { ...dbSchedules[index], ...parsedBody, schedule_id: schedId };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbSchedules[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Horario no encontrado' }));
      }
      return;
    }

    // ---- RUTA: POST /frontend/schedules/update_state/{schedule_id} ----
    const updateSchedStateMatch = pathname.match(/^\/frontend\/schedules\/update_state\/([^\/]+)$/);
    if (updateSchedStateMatch && req.method === 'POST') {
      const schedId = updateSchedStateMatch[1];
      const index = dbSchedules.findIndex(s => s.schedule_id === schedId);
      if (index !== -1) {
        dbSchedules[index].estado = parsedBody.status || 'inactivo';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbSchedules[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Horario no encontrado' }));
      }
      return;
    }

    // ---- RUTA: DELETE /frontend/schedules/delete/{schedule_id} ----
    const deleteSchedMatch = pathname.match(/^\/frontend\/schedules\/delete\/([^\/]+)$/);
    if (deleteSchedMatch && req.method === 'DELETE') {
      const schedId = deleteSchedMatch[1];
      const index = dbSchedules.findIndex(s => s.schedule_id === schedId);
      if (index !== -1) {
        dbSchedules.splice(index, 1);
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Horario no encontrado' }));
      }
      return;
    }

    // ---- RUTA: GET /frontend/lists / GET /lists ----
    if ((pathname === '/frontend/lists/' || pathname === '/frontend/lists' || pathname === '/lists') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dbLists));
      return;
    }

    // ---- RUTA: GET /frontend/lists/{list_id} ----
    const getListMatch = pathname.match(/^\/frontend\/lists\/([^\/]+)$/);
    if (getListMatch && req.method === 'GET') {
      const listId = getListMatch[1];
      const list = dbLists.find(l => l.list_id === listId);
      if (list) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(list));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Lista no encontrada' }));
      }
      return;
    }

    // ---- RUTA: POST /frontend/lists/register / POST /lists/register ----
    if ((pathname === '/frontend/lists/register' || pathname === '/lists/register') && req.method === 'POST') {
      const newList = {
        list_id: `list-uuid-${Math.random().toString(36).substring(2, 7)}`,
        name: parsedBody.name,
        description: parsedBody.description || '',
        list_type: parsedBody.list_type
      };
      dbLists.push(newList);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newList));
      return;
    }

    // ---- RUTA: POST /frontend/lists/update / POST /lists/update ----
    if ((pathname === '/frontend/lists/update' || pathname === '/lists/update') && req.method === 'POST') {
      const index = dbLists.findIndex(l => l.list_id === parsedBody.list_id);
      if (index !== -1) {
        dbLists[index] = { ...dbLists[index], ...parsedBody };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbLists[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Lista no encontrada' }));
      }
      return;
    }

    // ---- RUTA: DELETE /frontend/lists/delete/{id} / DELETE /lists/delete/{id} ----
    const deleteListMatch = pathname.match(/^\/(?:frontend\/)?lists\/delete\/([^\/]+)$/);
    if (deleteListMatch && req.method === 'DELETE') {
      const listId = deleteListMatch[1];
      const index = dbLists.findIndex(l => l.list_id === listId);
      if (index !== -1) {
        dbLists.splice(index, 1);
        // También eliminar los detalles de esa lista
        for (let i = dbListDetails.length - 1; i >= 0; i--) {
          if (dbListDetails[i].list_id === listId) {
            dbListDetails.splice(i, 1);
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Lista no encontrada' }));
      }
      return;
    }

    // ---- RUTA: GET /frontend/list_details / GET /list_details ----
    if ((pathname === '/frontend/list_details/' || pathname === '/frontend/list_details' || pathname === '/list_details') && req.method === 'GET') {
      const listId = urlObj.searchParams.get('list_id');
      const details = listId ? dbListDetails.filter(d => d.list_id === listId) : dbListDetails;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(details));
      return;
    }

    // ---- RUTA: GET /frontend/list_details/get/{detail_id} ----
    const getDetailMatch = pathname.match(/^\/frontend\/list_details\/get\/([^\/]+)$/);
    if (getDetailMatch && req.method === 'GET') {
      const detailId = getDetailMatch[1];
      const detail = dbListDetails.find(d => d.detail_id === detailId);
      if (detail) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(detail));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Detalle no encontrado' }));
      }
      return;
    }

    // ---- RUTA FALLBACK: GET /list_details/{list_id} ----
    const listDetailsParamMatch = pathname.match(/^\/list_details\/([^\/]+)$/);
    if (listDetailsParamMatch && req.method === 'GET') {
      const listId = listDetailsParamMatch[1];
      const details = dbListDetails.filter(d => d.list_id === listId);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(details));
      return;
    }

    // ---- RUTA: POST /frontend/list_details/register_face / POST /list_details/register_face ----
    if ((pathname === '/frontend/list_details/register_face' || pathname === '/list_details/register_face') && req.method === 'POST') {
      const newDetail = {
        detail_id: `detail-uuid-${Math.random().toString(36).substring(2, 7)}`,
        list_id: parsedBody.list_id || urlObj.searchParams.get('list_id') || 'list-uuid-face-001',
        fingerprint_host: parsedBody.fingerprint_host || '',
        nombre_asociado: parsedBody.nombre_asociado || 'Sujeto Nuevo',
        embedding: parsedBody.embedding || generateNormalizedVector(512),
        metadata: parsedBody.metadata || { url_img: 'https://randomuser.me/api/portraits/men/10.jpg' }
      };
      dbListDetails.push(newDetail);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newDetail));
      return;
    }

    // ---- RUTA: POST /frontend/list_details/register_plate / POST /list_details/register_plate ----
    if ((pathname === '/frontend/list_details/register_plate' || pathname === '/list_details/register_plate') && req.method === 'POST') {
      const newDetail = {
        detail_id: `detail-uuid-${Math.random().toString(36).substring(2, 7)}`,
        list_id: parsedBody.list_id || urlObj.searchParams.get('list_id') || 'list-uuid-plate-001',
        fingerprint_host: parsedBody.fingerprint_host || '',
        nombre_asociado: parsedBody.nombre_asociado || 'Propietario Nuevo',
        embedding: parsedBody.embedding || generateNormalizedVector(512),
        metadata: {
          url_img: 'https://images.unsplash.com/photo-1503376780353-7e6692767b70?w=120&h=120&fit=crop',
          text_placa: parsedBody.plate_text || 'XYZ-999'
        }
      };
      dbListDetails.push(newDetail);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newDetail));
      return;
    }

    // ---- RUTA: POST /list_details/register (legacy) ----
    if (pathname === '/list_details/register' && req.method === 'POST') {
      const newDetail = {
        detail_id: `detail-uuid-${Math.random().toString(36).substring(2, 7)}`,
        list_id: parsedBody.list_id,
        fingerprint_host: parsedBody.fingerprint_host || '',
        nombre_asociado: parsedBody.nombre_asociado,
        embedding: parsedBody.embedding || Array.from({ length: 512 }, () => Math.random() * 2 - 1),
        metadata: parsedBody.metadata || {}
      };
      dbListDetails.push(newDetail);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newDetail));
      return;
    }

    // ---- RUTA: DELETE /frontend/list_details/delete/{id} / DELETE /list_details/delete/{id} ----
    const deleteDetailMatch = pathname.match(/^\/(?:frontend\/)?list_details\/delete\/([^\/]+)$/);
    if (deleteDetailMatch && req.method === 'DELETE') {
      const detailId = deleteDetailMatch[1];
      const index = dbListDetails.findIndex(d => d.detail_id === detailId);
      if (index !== -1) {
        dbListDetails.splice(index, 1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Detalle de lista no encontrado' }));
      }
      return;
    }
    // ---- RUTA: POST /storage/upload/{category} ----
    if (pathname.startsWith('/storage/upload/') && req.method === 'POST') {
      const category = pathname.substring(16);
      const mockVector = generateNormalizedVector(512);
      const mockUrl = `https://picsum.photos/400/300?random=${Math.floor(Math.random() * 1000)}`;
      lastUploadedImage = {
        url: mockUrl,
        embedding: mockVector
      };
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        url: mockUrl,
        embedding: mockVector
      }));
      return;
    }
    // ---- RUTA: POST /frontend/extra/search_faces_by_img ----
    if (pathname === '/frontend/extra/search_faces_by_img' && req.method === 'POST') {
      const results = [
        {
          confiabilidad: 0.92,
          edad: "Adulto",
          genero: "masculino",
          reconocimiento: "Juan Perez",
          camara: "Av. Javier prado",
          timestamp: new Date().toISOString(),
          url_img: "https://randomuser.me/api/portraits/men/10.jpg",
          permanencia: 45.2
        },
        {
          confiabilidad: 0.81,
          edad: "Adulto",
          genero: "femenino",
          reconocimiento: "Maria Gomez",
          camara: "Caminos del inca",
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          url_img: "https://randomuser.me/api/portraits/women/44.jpg",
          permanencia: 120.0
        },
        {
          confiabilidad: 0.68,
          edad: "Joven",
          genero: "masculino",
          reconocimiento: "Desconocido",
          camara: "Mall del Sur",
          timestamp: new Date(Date.now() - 7200000).toISOString(),
          url_img: "https://randomuser.me/api/portraits/men/32.jpg",
          permanencia: null
        }
      ];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results));
      return;
    }
    // ---- RUTA NO ENCONTRADA ----
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Ruta [${req.method}] ${pathname} no encontrada en servidor mock.` }));
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
