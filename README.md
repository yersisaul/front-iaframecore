# IaFrame Core — Frontend

Panel de control y monitoreo web para el sistema de orquestación de analíticas de video y visión computacional IaFrame Core. Construido con **Angular 21**, **RxJS**, y el ejecutor de pruebas **Vitest**.

---

## 📋 Tabla de Comandos Rápidos

| Comando | Descripción |
| :--- | :--- |
| `npm start` | Inicia el servidor de desarrollo local en `http://localhost:4200` con proxy inverso a los servicios backend. |
| `npm test` | Ejecuta la batería completa de pruebas unitarias (17 suites, 110 tests) usando Vitest. |
| `npm run test:watch` | Ejecuta las pruebas unitarias en modo observador continuo (*watch mode*). |
| `npm run build` | Compila la aplicación optimizada para producción en el directorio `dist/iaframecore`. |
| `npm run watch` | Compila continuamente la aplicación en modo desarrollo. |
| `npm run toggle-mock` | Alterna la configuración en `.env` entre servicios reales y el servidor mock local. |
| `npm run mock-server` | Inicia un servidor API mock local en `http://localhost:3000` para pruebas sin backend. |

---

## ⚙️ Configuración de Variables de Entorno (`.env`)

El frontend no quema direcciones IP ni dominios en su código TypeScript compilado. Las rutas del cliente son relativas (`/api`, `/minio`, `/opensearch`, `/ws`) y se resuelven mediante el Reverse Proxy (tanto en desarrollo con `proxy.conf.js` como en producción con Nginx).

Copia el archivo de plantilla para configurar tus servicios:
```bash
cp .env.example .env
```

### Variables disponibles en `.env`:
| Variable | Obligatoria | Descripción |
| :--- | :---: | :--- |
| `API_HOST` | Sí | URL base del backend FastAPI (ej. `http://localhost:8000`). El proxy la expone en `/api` y `/ws`. |
| `OPENSEARCH_HOST` | Sí | URL base del motor OpenSearch (ej. `http://localhost:9200`). El proxy la expone en `/opensearch`. |
| `MINIO_PUBLIC_URL` | No | URL base del almacenamiento de medios MinIO (ej. `http://localhost:9000`). Expuesta en `/minio`. |
| `JWT_SECRET_KEY` | Sí | Firma estática / API Key del backend FastAPI. Inyectada automáticamente por el proxy como header `x-api-key`. |
| `OPENSEARCH_USER` | Recomendada | Usuario con permisos en OpenSearch (ej. `admin`). Usado para inyectar Basic Auth en el proxy. |
| `OPENSEARCH_PASSWORD` | Recomendada | Contraseña de OpenSearch para la autenticación Basic en el proxy. |
| `WEBRTC_HOST` | No | Hostname o IP del servidor WebRTC / MediaMTX para streaming de cámaras. |

> [!NOTE]
> Cada vez que ejecutas `npm start` o `npm run build`, se ejecuta automáticamente `node generate-env.js` para sincronizar las variables necesarias en [app-environment.ts](src/app/core/config/app-environment.ts).

---

## 🚀 Entorno de Desarrollo

### 1. Iniciar el servidor de desarrollo
```bash
npm start
```
* **Acceso:** Navega a `http://localhost:4200/` o `http://<tu-ip-local>:4200/`.
* **Proxy Inverso Dinámico:** [proxy.conf.js](proxy.conf.js) intercepta las llamadas a `/api`, `/opensearch`, `/minio` y `/ws` y las redirige automáticamente a los hosts definidos en `.env`, evitando cualquier problema de CORS o certificados en desarrollo.

### 2. Uso con Servidor Mock (Sin backend disponible)
Si no tienes acceso temporal al servidor backend:
```bash
# Alternar configuración hacia servidor mock
npm run toggle-mock

# Iniciar servidor mock en otra terminal
npm run mock-server

# Iniciar frontend
npm start
```

---

## 🧪 Pruebas Unitarias

El proyecto utiliza **Vitest** como motor de pruebas unitarias de alto rendimiento con Angular TestBed:

### Ejecución de una sola pasada (CI / Verificación)
```bash
npx ng test --watch=false
```
o mediante:
```bash
npm test
```

### Ejecución en modo interactivo / desarrollo
```bash
npx ng test
```

### Ejecutar una suite específica
```bash
npx ng test --include src/app/presentation/views/camaras/camaras.spec.ts --watch=false
```

---

## 📦 Compilación y Producción

### Compilación local
```bash
npm run build
```
Los artefactos compilados y optimizados se generarán en la carpeta:
```text
dist/iaframecore/browser
```

---

## 🐳 Despliegue con Docker (Servidores Diferentes)

El proyecto cuenta con un `Dockerfile` multi-stage (Node.js Alpine para compilación + Nginx Alpine para servir archivos estáticos y actuar de Reverse Proxy).

### 1. Construir la imagen Docker
```bash
docker build -t front-iaframecore:latest .
```

### 2. Ejecutar el contenedor conectándolo a un backend remoto
Puedes ejecutar el contenedor en cualquier servidor apuntando a la IP o dominio de tu backend sin recompilar la imagen:

```bash
docker run -d \
  --name front-iaframecore \
  -p 80:80 \
  -e API_HOST="http://192.168.1.100:8000" \
  -e OPENSEARCH_HOST="http://192.168.1.100:9200" \
  -e MINIO_PUBLIC_URL="http://192.168.1.100:9000" \
  -e JWT_SECRET_KEY="tu_clave_secreta_jwt" \
  -e OPENSEARCH_USER="admin" \
  -e OPENSEARCH_PASSWORD="tu_clave_opensearch" \
  --restart unless-stopped \
  front-iaframecore:latest
```

### 3. Con Docker Compose
Si prefieres gestionar el servicio con `docker-compose`:
```bash
docker compose up -d
```
*(Asegúrate de configurar los valores correspondientes en tu archivo `.env`).*

---

## 🔒 Arquitectura de Seguridad y Autenticación
* **Autenticación Basada en JWT:** Al iniciar sesión en `/login`, el token dinámico se almacena en `sessionStorage` y se inyecta en cada petición mediante `Authorization: Bearer <token>`.
* **Cero Secretos en el Cliente:** No se queman claves estáticas ni credenciales privadas en el bundle de JavaScript.
* **Aislamiento de Red:** Nginx sirve la aplicación y a la vez actúa como túnel proxy hacia el backend, permitiendo que las bases de datos y la API se mantengan en una red interna protegida sin exponer puertos al público.

