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
    rol_id: '73bd9b9e-53da-4901-8bd8-9a127081e61b',
    created_at: new Date('2026-01-01T08:00:00Z').toISOString()
  },
  {
    user_id: '67a7a5cc-98a9-4672-9cc9-5b7d0a68d712',
    usuario: 'operador',
    nombre: 'Operador de Control',
    contrasena: 'op123456',
    rol_id: 'd597024c-7362-4d41-a96b-a9321b8a0d77',
    created_at: new Date('2026-02-15T12:30:00Z').toISOString()
  }
];

const dbPermisos = [
  // Roles
  { permiso_id: 'c3d434da-69ad-4ac1-a62f-ea197bfb4e44', codigo: 'roles.create', descripcion: 'Crear roles' },
  { permiso_id: 'f8b19d93-50b8-4d46-b390-c212fed02e74', codigo: 'roles.read', descripcion: 'Consultar roles' },
  { permiso_id: '40568360-d296-4555-a55f-492b8c48ce18', codigo: 'roles.update', descripcion: 'Editar roles' },
  { permiso_id: '1bf2b38b-42a1-4762-b8b1-4fad8e3404a0', codigo: 'roles.delete', descripcion: 'Eliminar roles' },
  // Usuarios
  { permiso_id: '13b229dc-dedd-4fd1-b35d-ada91943860d', codigo: 'users.create', descripcion: 'Crear usuario' },
  { permiso_id: '49085747-3dae-43bd-bde7-a78fb9ed5700', codigo: 'users.read', descripcion: 'Consultar usuarios' },
  { permiso_id: 'd67f5f76-8ea4-4b1b-822c-74e4e848a48f', codigo: 'users.update', descripcion: 'Editar usuario' },
  { permiso_id: '48cfc80f-f7d5-4ce5-b252-6c702504623d', codigo: 'users.delete', descripcion: 'Eliminar usuario' },
  // Hosts
  { permiso_id: '7fd341f6-88ee-459a-9630-ab13d3071096', codigo: 'hosts.read', descripcion: 'Consultar hosts' },
  { permiso_id: '327495e2-5ff5-4f11-89fe-b56623ea2ec7', codigo: 'hosts.update', descripcion: 'Editar host' },
  { permiso_id: '7d4eb63a-4243-4cde-ba85-849b1849a792', codigo: 'hosts.delete', descripcion: 'Eliminar host' },
  // Cámaras
  { permiso_id: '1f52266b-82ca-4c8d-a659-a090b800c122', codigo: 'cameras.read', descripcion: 'Consultar cámaras' },
  { permiso_id: 'd8a72de3-a1f8-452a-850e-523d33dcfb2a', codigo: 'cameras.update', descripcion: 'Editar cámara' },
  { permiso_id: '5b3fdd36-d9cb-429b-a8ba-be4b8e467216', codigo: 'cameras.delete', descripcion: 'Eliminar cámara' },
  // Analíticas
  { permiso_id: '4c330660-73a1-4358-95b1-fab115d24d2b', codigo: 'analytics.create', descripcion: 'Crear analítica' },
  { permiso_id: '3f468734-193e-4f38-95ca-56617abf9014', codigo: 'analytics.read', descripcion: 'Consultar analíticas' },
  { permiso_id: '4ab8e5e4-e4d4-4b7e-a013-a7f6bfb58781', codigo: 'analytics.update', descripcion: 'Editar/Activar analítica' },
  { permiso_id: 'c8b9b9e1-3f4d-4b7e-a013-a7f6bfb58783', codigo: 'analytics.delete', descripcion: 'Eliminar analítica' },
  // Horarios
  { permiso_id: 'b1c2d3e4-f5a6-7b8c-9d0e-1f2a3b4c5d6e', codigo: 'schedules.create', descripcion: 'Crear horario' },
  { permiso_id: 'c2d3e4f5-a6b7-8c9d-0e1f-2a3b4c5d6e7f', codigo: 'schedules.read', descripcion: 'Consultar horarios' },
  { permiso_id: 'd3e4f5a6-b7c8-9d0e-1f2a-3b4c5d6e7f8a', codigo: 'schedules.update', descripcion: 'Editar horario' },
  { permiso_id: 'e4f5a6b7-c8d9-0e1f-2a3b-4c5d6e7f8a9b', codigo: 'schedules.delete', descripcion: 'Eliminar horario' },
  // Listas
  { permiso_id: 'f5a6b7c8-d9e0-1f2a-3b4c-5d6e7f8a9b0c', codigo: 'lists.create', descripcion: 'Crear lista' },
  { permiso_id: 'a6b7c8d9-e0f1-2a3b-4c5d-6e7f8a9b0c1d', codigo: 'lists.read', descripcion: 'Consultar listas' },
  { permiso_id: 'b7c8d9e0-f1a2-3b4c-5d6e-7f8a9b0c1d2e', codigo: 'lists.update', descripcion: 'Editar lista' },
  { permiso_id: 'c8d9e0f1-a2b3-4c5d-6e7f-8a9b0c1d2e3f', codigo: 'lists.delete', descripcion: 'Eliminar lista' },
  // Detalles de Listas
  { permiso_id: 'd9e0f1a2-b3c4-5d6e-7f8a-9b0c1d2e3f4a', codigo: 'list_details.create', descripcion: 'Crear detalle de lista' },
  { permiso_id: 'e0f1a2b3-c4d5-6e7f-8a9b-0c1d2e3f4a5b', codigo: 'list_details.read', descripcion: 'Consultar detalles de lista' },
  { permiso_id: 'f1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c', codigo: 'list_details.update', descripcion: 'Editar detalle de lista' },
  { permiso_id: 'a2b3c4d5-e6f7-8a9b-0c1d-2e3f4a5b6c7d', codigo: 'list_details.delete', descripcion: 'Eliminar detalle de lista' }
];

const dbRoles = [
  {
    rol_id: '73bd9b9e-53da-4901-8bd8-9a127081e61b',
    nombre: 'ADMIN',
    descripcion: 'Acceso total al sistema',
    id_permisos: dbPermisos.map(p => p.permiso_id)
  },
  {
    rol_id: 'd597024c-7362-4d41-a96b-a9321b8a0d77',
    nombre: 'SUPERVISOR',
    descripcion: 'Gestión operativa',
    id_permisos: [
      '49085747-3dae-43bd-bde7-a78fb9ed5700', // users.read
      '7fd341f6-88ee-459a-9630-ab13d3071096', // hosts.read
      '1f52266b-82ca-4c8d-a659-a090b800c122', // cameras.read
      'd8a72de3-a1f8-452a-850e-523d33dcfb2a', // cameras.update
      '3f468734-193e-4f38-95ca-56617abf9014', // analytics.read
      '4ab8e5e4-e4d4-4b7e-a013-a7f6bfb58781', // analytics.update
      'b1c2d3e4-f5a6-7b8c-9d0e-1f2a3b4c5d6e', // schedules.create
      'c2d3e4f5-a6b7-8c9d-0e1f-2a3b4c5d6e7f', // schedules.read
      'd3e4f5a6-b7c8-9d0e-1f2a-3b4c5d6e7f8a', // schedules.update
      'e4f5a6b7-c8d9-0e1f-2a3b-4c5d6e7f8a9b', // schedules.delete
      'a6b7c8d9-e0f1-2a3b-4c5d-6e7f8a9b0c1d', // lists.read
      'b7c8d9e0-f1a2-3b4c-5d6e-7f8a9b0c1d2e', // lists.update
      'e0f1a2b3-c4d5-6e7f-8a9b-0c1d2e3f4a5b', // list_details.read
      'f1a2b3c4-d5e6-7f8a-9b0c-1d2e3f4a5b6c'  // list_details.update
    ]
  },
  {
    rol_id: 'e2fc9bc1-ab14-4cd4-8b16-492a2a5e8aec',
    nombre: 'OPERADOR',
    descripcion: 'Solo visualización y control básico',
    id_permisos: [
      '49085747-3dae-43bd-bde7-a78fb9ed5700', // users.read
      '7fd341f6-88ee-459a-9630-ab13d3071096', // hosts.read
      '1f52266b-82ca-4c8d-a659-a090b800c122', // cameras.read
      '3f468734-193e-4f38-95ca-56617abf9014', // analytics.read
      '4ab8e5e4-e4d4-4b7e-a013-a7f6bfb58781', // analytics.update (activar/desactivar)
      'c2d3e4f5-a6b7-8c9d-0e1f-2a3b4c5d6e7f', // schedules.read
      'a6b7c8d9-e0f1-2a3b-4c5d-6e7f8a9b0c1d', // lists.read
      'e0f1a2b3-c4d5-6e7f-8a9b-0c1d2e3f4a5b'  // list_details.read
    ]
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

  // Analíticas para cam1
  const analytic1 = {
    analytic_id: `analytic-uuid-${(i * 2 + 1).toString().padStart(3, '0')}`,
    fingerprint_host: hostFp,
    analytic_type: i % 2 === 0 ? 'face_recognition' : 'intrusion_detection',
    analytic_status: 'active',
    target_cameras: [
      { camera_id: cam1.camera_id, camera_name: cam1.camera_name }
    ],
    detection_classes: i % 2 === 0 
      ? [{ class_index: 0, class_name: 'face' }] 
      : [{ class_index: 10, class_name: 'person' }],
    parameters: { min_confidence: 0.75 },
    geometric_objects: {},
    acciones: {}
  };
  
  // Analíticas para cam2
  const analytic2 = {
    analytic_id: `analytic-uuid-${(i * 2 + 2).toString().padStart(3, '0')}`,
    fingerprint_host: hostFp,
    analytic_type: i % 2 === 0 ? 'license_plate_recognition' : 'people_counting',
    analytic_status: 'active',
    target_cameras: [
      { camera_id: cam2.camera_id, camera_name: cam2.camera_name }
    ],
    detection_classes: i % 2 === 0 
      ? [{ class_index: 1, class_name: 'license_plate' }] 
      : [{ class_index: 11, class_name: 'person' }],
    parameters: { min_confidence: 0.75 },
    geometric_objects: {},
    acciones: {}
  };
  dbAnalytics.push(analytic1, analytic2);

});

// Horarios globales heredados por todos los hosts
dbSchedules.push(
  {
    schedule_id: 'sched-uuid-001',
    nombre: 'Horario Comercial Diurno',
    fingerprint_host: '',
    analytics_ids: dbAnalytics.slice(0, 2).map(a => ({ id_analytic: a.analytic_id })),
    timestamp_inicio: new Date('2026-01-01T08:00:00Z').toISOString(),
    timestamp_fin: new Date('2026-01-01T20:00:00Z').toISOString(),
    frecuencia: 'diario',
    estado: 'activo'
  },
  {
    schedule_id: 'sched-uuid-002',
    nombre: 'Horario Nocturno Controlado',
    fingerprint_host: '',
    analytics_ids: dbAnalytics.slice(2, 4).map(a => ({ id_analytic: a.analytic_id })),
    timestamp_inicio: new Date('2026-01-01T20:00:00Z').toISOString(),
    timestamp_fin: new Date('2026-01-02T06:00:00Z').toISOString(),
    frecuencia: 'diario',
    estado: 'activo'
  },
  {
    schedule_id: 'sched-uuid-003',
    nombre: 'Horario Fin de Semana Completo',
    fingerprint_host: '',
    analytics_ids: [],
    timestamp_inicio: new Date('2026-01-03T00:00:00Z').toISOString(),
    timestamp_fin: new Date('2026-01-04T23:59:00Z').toISOString(),
    frecuencia: 'semanal',
    estado: 'activo'
  }
);

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
  otros: [],
  eventos: []
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

// Generar registros de eventos
const analiticas = ['Detección de Intrusion', 'Cruce de Línea', 'Control de Aforo', 'Permanencia de Objetos', 'Análisis de Tráfico'];
const objetos = ['Persona', 'Auto', 'Camion', 'Motocicleta', 'Bicicleta'];
const detalles = [
  'Persona ha cruzado la línea en sentido Entrada',
  'Vehículo estacionado en área prohibida',
  'Control de aforo: superado límite máximo',
  'Objeto sospechoso detectado cerca del perímetro',
  'Camion ha cruzado la linea en sentido De B a A'
];

for (let i = 1; i <= 35; i++) {
  const analitica = analiticas[i % analiticas.length];
  const objeto = objetos[i % objetos.length];
  const detalle = detalles[i % detalles.length];
  dbOpenSearchDocs.eventos.push({
    _id: `event-doc-${i.toString().padStart(3, '0')}`,
    _score: 1.0,
    _source: {
      timestamp: new Date(Date.now() - i * 1800000).toISOString(),
      hora: Math.floor(Math.random() * 24),
      dia_semana: ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'][new Date(Date.now() - i * 1800000).getDay()],
      dia_mes: new Date(Date.now() - i * 1800000).getDate(),
      mes: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'][new Date(Date.now() - i * 1800000).getMonth()],
      nombre_camara: cameraNames[i % cameraNames.length],
      id_camara: `camara-id-${i}`,
      analitica: analitica,
      location: {
        lon: (-76.975727 - (Math.random() * 0.05)).toFixed(6),
        lat: (-12.126308 + (Math.random() * 0.05)).toFixed(6)
      },
      objeto: objeto,
      detalle_evento: detalle,
      url_img: `https://images.unsplash.com/photo-${i % 2 === 0 ? '1488590528505-98d2b5aba04b' : '1518770660439-4636190af475'}?w=400&h=300&fit=crop`,
      conteo_aforo: analitica === 'Control de Aforo' ? Math.floor(Math.random() * 50) + 10 : null,
      tiempo_permanencia: analitica === 'Permanencia de Objetos' ? parseFloat((Math.random() * 120 + 10).toFixed(2)) : null,
      objetos_en_area: analitica === 'Permanencia de Objetos' ? Math.floor(Math.random() * 10) + 1 : null,
      espacios_libres: analitica === 'Análisis de Tráfico' ? Math.floor(Math.random() * 15) : null,
      direccion: i % 2 === 0 ? 'Entrada' : 'Salida',
      id_report_type: ""
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
        try {
          const params = new URLSearchParams(body);
          parsedBody = {};
          for (const [key, value] of params.entries()) {
            parsedBody[key] = value;
          }
        } catch (e2) {}
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
    if (!isOpenSearch && (pathname.startsWith('/_cat') || pathname.startsWith('/personas') || pathname.startsWith('/vehiculos') || pathname.startsWith('/rostros') || pathname.startsWith('/otros') || pathname.startsWith('/eventos'))) {
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
            if (f.terms.nombre_camara) {
              const vals = f.terms.nombre_camara;
              docs = docs.filter(d => vals.includes(d._source.nombre_camara));
            }
            if (f.terms.analitica) {
              const vals = f.terms.analitica;
              docs = docs.filter(d => vals.includes(d._source.analitica));
            }
            if (f.terms.objeto) {
              const vals = f.terms.objeto;
              docs = docs.filter(d => vals.includes(d._source.objeto));
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
            if (index === 'eventos') {
              docs = docs.filter(d => 
                String(d._id).toLowerCase().includes(queryStr) || 
                String(d._source.nombre_camara).toLowerCase().includes(queryStr) || 
                String(d._source.objeto || '').toLowerCase().includes(queryStr) || 
                String(d._source.detalle_evento || '').toLowerCase().includes(queryStr) ||
                String(d._source.analitica || '').toLowerCase().includes(queryStr)
              );
            } else {
              docs = docs.filter(d => 
                String(d._id).toLowerCase().includes(queryStr) || 
                String(d._source.camara).toLowerCase().includes(queryStr) || 
                String(d._source.reconocimiento || '').toLowerCase().includes(queryStr) || 
                String(d._source.tipo_objeto || '').toLowerCase().includes(queryStr)
              );
            }
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
        if (index === 'eventos') {
          const camaraCounts = {};
          const analiticaCounts = {};
          const objetoCounts = {};
          hits.forEach(d => {
            const s = d._source;
            if (s.nombre_camara) camaraCounts[s.nombre_camara] = (camaraCounts[s.nombre_camara] || 0) + 1;
            if (s.analitica) analiticaCounts[s.analitica] = (analiticaCounts[s.analitica] || 0) + 1;
            if (s.objeto) objetoCounts[s.objeto] = (objetoCounts[s.objeto] || 0) + 1;
          });

          const aggregations = {
            camara_vals: { buckets: Object.keys(camaraCounts).map(k => ({ key: k, doc_count: camaraCounts[k] })) },
            analitica_vals: { buckets: Object.keys(analiticaCounts).map(k => ({ key: k, doc_count: analiticaCounts[k] })) },
            objeto_vals: { buckets: Object.keys(objetoCounts).map(k => ({ key: k, doc_count: objetoCounts[k] })) }
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            hits: {
              total: { value: hits.length, relation: 'eq' },
              max_score: 1.0,
              hits: paginatedHits
            },
            aggregations
          }));
          return;
        }

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
          usuario: user.usuario,
          rol_id: user.rol_id
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

    // ---- RUTA: GET /frontend/users/ ----
    if ((pathname === '/frontend/users/' || pathname === '/frontend/users') && req.method === 'GET') {
      // Enriquecer cada usuario con el nombre del rol para la UI
      const enriched = dbUsuarios.map(u => {
        const rol = dbRoles.find(r => r.rol_id === u.rol_id);
        return {
          user_id: u.user_id,
          email: u.usuario,
          nombres: u.nombre.split(' ')[0] || u.nombre,
          apellidos: u.nombre.split(' ').slice(1).join(' ') || '',
          rol_id: u.rol_id,
          created_at: u.created_at
        };
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(enriched));
      return;
    }

    // ---- RUTA: POST /frontend/users/ ----
    if ((pathname === '/frontend/users/' || pathname === '/frontend/users') && req.method === 'POST') {
      const newUser = {
        user_id: `user-${Math.random().toString(36).substring(2, 10)}`,
        usuario: parsedBody.email || '',
        nombre: `${parsedBody.nombres || ''} ${parsedBody.apellidos || ''}`.trim(),
        contrasena: parsedBody.password || '',
        rol_id: parsedBody.rol_id || dbRoles[dbRoles.length - 1].rol_id,
        created_at: new Date().toISOString()
      };
      dbUsuarios.push(newUser);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        user_id: newUser.user_id,
        email: newUser.usuario,
        nombres: parsedBody.nombres || '',
        apellidos: parsedBody.apellidos || '',
        rol_id: newUser.rol_id,
        created_at: newUser.created_at
      }));
      return;
    }

    // ---- RUTA: PUT /frontend/users/{user_id} ----
    const putUserMatch = pathname.match(/^\/frontend\/users\/([^\/]+)$/);
    if (putUserMatch && req.method === 'PUT') {
      const userId = putUserMatch[1];
      const idx = dbUsuarios.findIndex(u => u.user_id === userId);
      if (idx !== -1) {
        let mappedRolId = parsedBody.rol_id || dbUsuarios[idx].rol_id;
        if (mappedRolId === 'ADMIN') {
          mappedRolId = '73bd9b9e-53da-4901-8bd8-9a127081e61b';
        } else if (mappedRolId === 'SUPERVISOR') {
          mappedRolId = 'd597024c-7362-4d41-a96b-a9321b8a0d77';
        } else if (mappedRolId === 'OPERADOR') {
          mappedRolId = 'e2fc9bc1-ab14-4cd4-8b16-492a2a5e8aec';
        }

        dbUsuarios[idx] = {
          ...dbUsuarios[idx],
          usuario: parsedBody.email || dbUsuarios[idx].usuario,
          nombre: `${parsedBody.nombres || ''} ${parsedBody.apellidos || ''}`.trim() || dbUsuarios[idx].nombre,
          rol_id: mappedRolId
        };
        const u = dbUsuarios[idx];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          user_id: u.user_id,
          email: u.usuario,
          nombres: u.nombre.split(' ')[0] || u.nombre,
          apellidos: u.nombre.split(' ').slice(1).join(' ') || '',
          rol_id: u.rol_id,
          created_at: u.created_at
        }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Usuario no encontrado' }));
      }
      return;
    }

    // ---- RUTA: PATCH /frontend/users/{user_id} (cambio de contraseña) ----
    const patchUserMatch = pathname.match(/^\/frontend\/users\/([^\/]+)$/);
    if (patchUserMatch && req.method === 'PATCH') {
      const userId = patchUserMatch[1];
      const idx = dbUsuarios.findIndex(u => u.user_id === userId);
      if (idx !== -1) {
        if (dbUsuarios[idx].contrasena !== parsedBody.old_password) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'La contraseña actual es incorrecta' }));
        } else {
          dbUsuarios[idx].contrasena = parsedBody.new_password;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Usuario no encontrado' }));
      }
      return;
    }

    // ---- RUTA: DELETE /frontend/users/{user_id} ----
    const deleteUserMatch = pathname.match(/^\/frontend\/users\/([^\/]+)$/);
    if (deleteUserMatch && req.method === 'DELETE') {
      const userId = deleteUserMatch[1];
      const idx = dbUsuarios.findIndex(u => u.user_id === userId);
      if (idx !== -1) {
        dbUsuarios.splice(idx, 1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Usuario no encontrado' }));
      }
      return;
    }

    // ---- RUTA: GET /frontend/permisos/ ----
    if ((pathname === '/frontend/permisos/' || pathname === '/frontend/permisos') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dbPermisos));
      return;
    }

    // ---- RUTA: GET /frontend/roles/ ----
    if ((pathname === '/frontend/roles/' || pathname === '/frontend/roles') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dbRoles));
      return;
    }

    // ---- RUTA: POST /frontend/roles/ (crear rol) ----
    if ((pathname === '/frontend/roles/' || pathname === '/frontend/roles') && req.method === 'POST') {
      const newRole = {
        rol_id: `role-uuid-${Math.random().toString(36).substring(2, 7)}`,
        nombre: parsedBody.nombre || 'NUEVO_ROL',
        descripcion: parsedBody.descripcion || '',
        id_permisos: parsedBody.id_permisos || []
      };
      dbRoles.push(newRole);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newRole));
      return;
    }

    // ---- RUTA: PUT /frontend/roles/{rol_id} ----
    const putRolMatch = pathname.match(/^\/frontend\/roles\/([^\/]+)$/);
    if (putRolMatch && req.method === 'PUT') {
      const rolId = putRolMatch[1];
      const idx = dbRoles.findIndex(r => r.rol_id === rolId);
      if (idx !== -1) {
        const systemRoles = ['ADMIN', 'SUPERVISOR', 'OPERADOR'];
        if (systemRoles.includes(dbRoles[idx].nombre.toUpperCase())) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'System roles cannot be updated.' }));
          return;
        }
        dbRoles[idx] = {
          ...dbRoles[idx],
          nombre: parsedBody.nombre || dbRoles[idx].nombre,
          descripcion: parsedBody.descripcion || dbRoles[idx].descripcion,
          id_permisos: parsedBody.id_permisos || dbRoles[idx].id_permisos
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbRoles[idx]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Rol no encontrado' }));
      }
      return;
    }

    // ---- RUTA: DELETE /frontend/roles/{rol_id} ----
    if (putRolMatch && req.method === 'DELETE') {
      const rolId = putRolMatch[1];
      const idx = dbRoles.findIndex(r => r.rol_id === rolId);
      if (idx !== -1) {
        const systemRoles = ['ADMIN', 'SUPERVISOR', 'OPERADOR'];
        if (systemRoles.includes(dbRoles[idx].nombre.toUpperCase())) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ detail: 'System roles cannot be deleted.' }));
          return;
        }
        dbRoles.splice(idx, 1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Rol no encontrado' }));
      }
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

    // ---- RUTA: DELETE /frontend/hosts/{fingerprint} ----
    const deleteHostMatch = pathname.match(/^\/frontend\/hosts\/([^\/]+)$/);
    if (deleteHostMatch && req.method === 'DELETE') {
      const hostFp = deleteHostMatch[1];
      const hostIndex = dbHosts.findIndex(h => h.fingerprint === hostFp);
      if (hostIndex !== -1) {
        dbHosts.splice(hostIndex, 1);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Nodo eliminado exitosamente' }));
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

    // ---- RUTA: GET /frontend/cameras/ (global) ----
    if ((pathname === '/frontend/cameras/' || pathname === '/frontend/cameras') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dbCameras));
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

    // ---- RUTA: PATCH /frontend/cameras/{camera_id} o POST /frontend/cameras/update/{camera_id} (legacy) ----
    const updateCamMatch = pathname.match(/^\/frontend\/cameras\/([^\/]+)$/);
    const legacyUpdateCamMatch = pathname.match(/^\/frontend\/cameras\/update\/([^\/]+)$/);
    if ((updateCamMatch && req.method === 'PATCH') || (legacyUpdateCamMatch && req.method === 'POST')) {
      const cameraId = legacyUpdateCamMatch ? legacyUpdateCamMatch[1] : updateCamMatch[1];
      if (cameraId !== 'update' && cameraId !== 'delete') {
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
    }

    // ---- RUTA: DELETE /frontend/cameras/{camera_id} o DELETE /frontend/cameras/delete/{camera_id} (legacy) ----
    const deleteCamMatch = pathname.match(/^\/frontend\/cameras\/([^\/]+)$/);
    const legacyDeleteCamMatch = pathname.match(/^\/frontend\/cameras\/delete\/([^\/]+)$/);
    if ((deleteCamMatch && req.method === 'DELETE') || (legacyDeleteCamMatch && req.method === 'DELETE')) {
      const cameraId = legacyDeleteCamMatch ? legacyDeleteCamMatch[1] : deleteCamMatch[1];
      if (cameraId !== 'update' && cameraId !== 'delete') {
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

    // ---- RUTA: GET /frontend/analytics/ (global) ----
    if ((pathname === '/frontend/analytics/' || pathname === '/frontend/analytics') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dbAnalytics));
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

    // ---- RUTA: PATCH /frontend/analytics/update_status/{analytic_id} o POST /frontend/analytics/update_status/{analytic_id} (legacy) ----
    const updateAnalyticMatch = pathname.match(/^\/frontend\/analytics\/update_status\/([^\/]+)$/);
    if (updateAnalyticMatch && (req.method === 'PATCH' || req.method === 'POST')) {
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
      if (analyticId !== 'update_status') {
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
    }

    // ---- RUTA: GET /frontend/schedules/ ----
    if ((pathname === '/frontend/schedules/' || pathname === '/frontend/schedules') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(dbSchedules));
      return;
    }

    // ---- RUTA: POST /frontend/schedules/ o POST /frontend/schedules/create (legacy) ----
    if (((pathname === '/frontend/schedules/' || pathname === '/frontend/schedules') && req.method === 'POST') ||
        (pathname === '/frontend/schedules/create' && req.method === 'POST')) {
      const newSched = {
        schedule_id: `sched-uuid-${Math.random().toString(36).substring(2, 7)}`,
        nombre: parsedBody.nombre || 'Nuevo Horario',
        fingerprint_host: parsedBody.fingerprint_host || '',
        analytics_ids: parsedBody.analytics_ids || [],
        timestamp_inicio: parsedBody.timestamp_inicio || new Date().toISOString(),
        timestamp_fin: parsedBody.timestamp_fin || new Date().toISOString(),
        frecuencia: parsedBody.frecuencia || 'diario',
        estado: parsedBody.estado || 'active'
      };
      dbSchedules.push(newSched);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(newSched));
      return;
    }

    // ---- RUTA: PUT /frontend/schedules/{schedule_id} o PUT /frontend/schedules/update/{schedule_id} (legacy) ----
    const putSchedMatch = pathname.match(/^\/frontend\/schedules\/([^\/]+)$/);
    const legacyPutSchedMatch = pathname.match(/^\/frontend\/schedules\/update\/([^\/]+)$/);
    if ((putSchedMatch && req.method === 'PUT') || (legacyPutSchedMatch && req.method === 'PUT')) {
      const schedId = legacyPutSchedMatch ? legacyPutSchedMatch[1] : putSchedMatch[1];
      if (schedId !== 'create' && schedId !== 'update' && schedId !== 'update_state' && schedId !== 'delete') {
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
    }

    // ---- RUTA: PATCH /frontend/schedules/update_state/{schedule_id} o POST /frontend/schedules/update_state/{schedule_id} (legacy) ----
    const updateSchedStateMatch = pathname.match(/^\/frontend\/schedules\/update_state\/([^\/]+)$/);
    if (updateSchedStateMatch && (req.method === 'PATCH' || req.method === 'POST')) {
      const schedId = updateSchedStateMatch[1];
      const index = dbSchedules.findIndex(s => s.schedule_id === schedId);
      if (index !== -1) {
        dbSchedules[index].estado = parsedBody.status || 'inactive';
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbSchedules[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Horario no encontrado' }));
      }
      return;
    }

    // ---- RUTA: DELETE /frontend/schedules/{schedule_id} o DELETE /frontend/schedules/delete/{schedule_id} (legacy) ----
    const deleteSchedMatch = pathname.match(/^\/frontend\/schedules\/([^\/]+)$/);
    const legacyDeleteSchedMatch = pathname.match(/^\/frontend\/schedules\/delete\/([^\/]+)$/);
    if ((deleteSchedMatch && req.method === 'DELETE') || (legacyDeleteSchedMatch && req.method === 'DELETE')) {
      const schedId = legacyDeleteSchedMatch ? legacyDeleteSchedMatch[1] : deleteSchedMatch[1];
      if (schedId !== 'create' && schedId !== 'update' && schedId !== 'update_state' && schedId !== 'delete') {
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

    // ---- RUTA: POST /frontend/lists/register o POST /frontend/lists ----
    if ((pathname === '/frontend/lists/register' || pathname === '/lists/register' || pathname === '/frontend/lists/' || pathname === '/frontend/lists' || pathname === '/lists/') && req.method === 'POST') {
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

    // ---- RUTA: PUT /frontend/lists/{list_id} ----
    const putListMatch = pathname.match(/^\/(?:frontend\/)?lists\/([^\/]+)$/);
    if (putListMatch && req.method === 'PUT') {
      const listId = putListMatch[1];
      const index = dbLists.findIndex(l => l.list_id === listId);
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

    // ---- RUTA: DELETE /frontend/lists/{id} / DELETE /frontend/lists/delete/{id} ----
    const deleteListMatch = pathname.match(/^\/(?:frontend\/)?lists\/(?:delete\/)?([^\/]+)$/);
    if (deleteListMatch && req.method === 'DELETE') {
      const listId = deleteListMatch[1];
      
      // Ignore if listId is a reserved route name
      if (listId === 'register' || listId === 'update') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Method not allowed' }));
        return;
      }

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

    // ---- RUTA: DELETE /frontend/list_details/{id} / DELETE /list_details/delete/{id} ----
    const deleteDetailMatch = pathname.match(/^\/(?:frontend\/)?list_details\/(?:delete\/)?([^\/]+)$/);
    if (deleteDetailMatch && req.method === 'DELETE') {
      const detailId = deleteDetailMatch[1];
      
      // Ignore if detailId matches a reserved route name
      if (detailId === 'register_face' || detailId === 'register_plate') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Method not allowed' }));
        return;
      }

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

    // ---- RUTA: PUT /frontend/list_details/update_face_detail/{detail_id} ----
    const updateFaceDetailMatch = pathname.match(/^\/(?:frontend\/)?list_details\/update_face_detail\/([^\/]+)$/);
    if (updateFaceDetailMatch && req.method === 'PUT') {
      const detailId = updateFaceDetailMatch[1];
      const index = dbListDetails.findIndex(d => d.detail_id === detailId);
      if (index !== -1) {
        dbListDetails[index].nombre_asociado = parsedBody.nombre_asociado || dbListDetails[index].nombre_asociado;
        if (parsedBody.list_id) {
          dbListDetails[index].list_id = parsedBody.list_id;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbListDetails[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Detalle de rostro no encontrado' }));
      }
      return;
    }

    // ---- RUTA: PUT /frontend/list_details/update_plate_detail/{detail_id} ----
    const updatePlateDetailMatch = pathname.match(/^\/(?:frontend\/)?list_details\/update_plate_detail\/([^\/]+)$/);
    if (updatePlateDetailMatch && req.method === 'PUT') {
      const detailId = updatePlateDetailMatch[1];
      const index = dbListDetails.findIndex(d => d.detail_id === detailId);
      if (index !== -1) {
        dbListDetails[index].nombre_asociado = parsedBody.nombre_asociado !== undefined ? parsedBody.nombre_asociado : dbListDetails[index].nombre_asociado;
        if (parsedBody.plate_text) {
          dbListDetails[index].metadata = dbListDetails[index].metadata || {};
          dbListDetails[index].metadata.text_placa = parsedBody.plate_text;
        }
        if (parsedBody.list_id) {
          dbListDetails[index].list_id = parsedBody.list_id;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(dbListDetails[index]));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Detalle de placa no encontrado' }));
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
    const rol = dbRoles.find(r => r.rol_id === u.rol_id);
    console.log(` - Usuario: '${u.usuario}' | Clave: '${u.contrasena}' | Rol: '${rol ? rol.nombre : u.rol_id}'`);
  });
  console.log(`=======================================================`);
});
