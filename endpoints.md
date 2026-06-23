# Documentación Completa de Endpoints

Este documento detalla **todos** los endpoints expuestos por la API Core del sistema, organizados por dominios funcionales. Se diferencian claramente según su rol y método de autenticación:

1. **APIs de Interfaz (Frontend - Default)**: Rutas con prefijo `/frontend/` y globales. Utilizadas por la aplicación frontend Angular. Requieren autenticación Bearer Token (`Authorization: Bearer <token>`).
2. **APIs de Sistema (Backend - Non-default)**: Rutas de comunicación de bajo nivel del motor de analíticas. Requieren autenticación mediante la cabecera `x-api-key`.

---

## Índice de Dominios
1. [Autenticación (Auth)](#1-autenticación-auth)
2. [Hosts (Servidores de Analíticas)](#2-hosts-servidores-de-analíticas)
3. [Configuración (Configuration)](#3-configuración-configuration)
4. [Cámaras (Cameras)](#4-cámaras-cameras)
5. [Analíticas (Analytics)](#5-analíticas-analytics)
6. [Horarios (Schedules)](#6-horarios-schedules)
7. [Listas de Control (Lists)](#7-listas-de-control-lists)
8. [Detalles de Listas (List Details)](#8-detalles-de-listas-list-details)
9. [Almacenamiento (Storage)](#9-almacenamiento-storage)
10. [Salud y Sistema](#10-salud-y-sistema)
11. [Servicios Extra (Extra)](#11-servicios-extra-extra)

---

## 1. Autenticación (Auth)

### [API de Interfaz / Frontend - Default]

#### `POST /auth/login`
* **Descripción:** Valida credenciales de usuario y genera un token JWT.
* **Autenticación:** Ninguna (ruta pública).
* **Cuerpo de Petición (`application/json`):**
  * Schema: `LoginRequest` (ver [schemas.md](schemas.md#loginrequest))
  ```json
  {
    "usuario": "admin",
    "password": "admin1234"
  }
  ```
* **Respuestas:**
  * **200 (Success):** Sesión iniciada con éxito.
    * Schema: `LoginResponse` (ver [schemas.md](schemas.md#loginresponse))
    * Body:
      ```json
      {
        "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        "token_type": "bearer",
        "usuario": "admin",
        "rol": "ADMIN"
      }
      ```
  * **422 (Validation Error):** Parámetros incorrectos o faltantes.

---

## 2. Hosts (Servidores de Analíticas)

### [API de Sistema / Backend]

#### `POST /hosts/register`
* **Descripción:** Registra un nuevo host de procesamiento de analíticas en el sistema core.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `HostRegisterRequest` (ver [schemas.md](schemas.md#hostregisterrequest))
* **Respuestas:**
  * **201 (Created):** Servidor registrado exitosamente.
    * Body: `{}`
  * **422 (Validation Error):** Error de validación.

#### `POST /hosts/heartbeat/{host_fingerprint}`
* **Descripción:** Envía métricas periódicas del host (CPU, memoria, GPU, etc.) para monitorear su estado de salud y disponibilidad.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `host_fingerprint` (Path - string, Requerido): Huella única del servidor.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `HeartbeatRequest` (ver [schemas.md](schemas.md#heartbeatrequest))
  ```json
  {
    "cpu": 75.5,
    "gpu": 90,
    "memory": 80,
    "status": "online",
    "timestamp": "2024-01-15T10:35:00",
    "vram": 85
  }
  ```
* **Respuestas:**
  * **200 (Success):** Métricas recibidas.
    * Body: `{}`
  * **422 (Validation Error):** Datos inválidos.

---

### [API de Interfaz / Frontend - Default]

#### `GET /frontend/hosts/`
* **Descripción:** Lista todos los servidores hosts de procesamiento registrados.
* **Autenticación:** Bearer Token.
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<HostFrontendResponse>` (ver [schemas.md](schemas.md#hostfrontendresponse))

#### `GET /frontend/hosts/{fingerprint}`
* **Descripción:** Obtiene los detalles de un servidor específico.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `fingerprint` (Path - string, Requerido): Huella digital del host.
* **Respuestas:**
  * **200 (Success):**
    * Schema: `HostFrontendResponse`

#### `GET /frontend/hosts/heartbeat/{fingerprint}`
* **Descripción:** Consulta las métricas de rendimiento actuales del host y su estado en tiempo real.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `fingerprint` (Path - string, Requerido): Huella digital del host.
* **Respuestas:**
  * **200 (Success):**
    * Schema: `HeartbeatResponse` (ver [schemas.md](schemas.md#heartbeatresponse))

#### `POST /frontend/hosts/migrate_setup`
* **Descripción:** Asocia las analíticas y configuraciones a una nueva huella digital (por ejemplo, tras un cambio de placa madre o reinstalación del host).
* **Autenticación:** Bearer Token.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `HostMigrateRequest` (ver [schemas.md](schemas.md#hostmigraterequest))
* **Respuestas:**
  * **200 (Success):** Migración iniciada.
    * Body: `"string"`

#### `DELETE /frontend/hosts/delete/{fingerprint}`
* **Descripción:** Remueve un host registrado del sistema.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `fingerprint` (Path - string, Requerido): Huella digital del host.
* **Respuestas:**
  * **200 (Success):** Removido con éxito.
    * Body: `"string"`

---

## 3. Configuración (Configuration)

Estas rutas de backend sirven para que los hosts de analíticas se sincronicen y descarguen sus respectivas configuraciones de forma automática.

### [API de Sistema / Backend]

#### `GET /config/hosts/{host_id}`
* **Descripción:** Obtiene la configuración de conectividad general de un host.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `host_id` (Path - string, Requerido): ID único del host.
* **Respuestas:**
  * **200 (Success):** Configuración devuelta.
    * Body: `{}`
  * **422 (Validation Error):** ID no válido.

#### `GET /config/cameras/{host_id}`
* **Descripción:** Obtiene la configuración detallada de los streams de cámaras (URLs, usuarios, contraseñas, etc.) asignados a un host específico.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `host_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):** Listado de cámaras.
    * Body: `[{}]`

#### `GET /config/analytics/{host_id}`
* **Descripción:** Obtiene las analíticas detalladas que debe ejecutar dicho host.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `host_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):** Listado de analíticas.
    * Body: `[{}]`

---

## 4. Cámaras (Cameras)

### [API de Sistema / Backend]

#### `POST /cameras/register/`
* **Descripción:** Registra una cámara a bajo nivel con sus flujos de video completos e IPs.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `CameraRequest` (ver [schemas.md](schemas.md#camerarequest))
* **Respuestas:**
  * **201 (Created):** Cámara registrada.
    * Schema: `CameraResponse` (ver [schemas.md](schemas.md#cameraresponse))

#### `POST /cameras/update/`
* **Descripción:** Actualiza los flujos, configuraciones avanzadas o credenciales de la cámara.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `CameraRequest`
* **Respuestas:**
  * **200 (Success):**
    * Schema: `CameraResponse`

#### `POST /cameras/update_stream_selection/`
* **Descripción:** Modifica el stream seleccionado por defecto (ej. cambiar entre stream principal y secundario).
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros de Consulta (Query):**
  * `fingerprint_host` (string, Requerido)
  * `camera_id` (string, Requerido)
  * `selected_stream` (integer, Requerido)
* **Respuestas:**
  * **200 (Success):** Configuración modificada.
    * Schema: `CameraResponse`

#### `POST /cameras/update_status/{camera_id}`
* **Descripción:** Actualiza el estado actual (`online` / `offline`) reportado por el host procesador.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `camera_id` (Path - string, Requerido)
* **Cuerpo de Petición (`application/json`):**
  * Schema: `CameraStatusRequest` (ver [schemas.md](schemas.md#camerastatusrequest))
* **Respuestas:**
  * **200 (Success):** Estado actualizado.
    * Body: `{}`

#### `DELETE /cameras/delete/{camera_id}`
* **Descripción:** Elimina la cámara y sus streams del registro.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `camera_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Body: `{}`

---

### [API de Interfaz / Frontend - Default]

#### `GET /frontend/cameras/`
* **Descripción:** Retorna la lista simplificada de cámaras para su visualización.
* **Autenticación:** Bearer Token.
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<CameraFrontendResponse>` (ver [schemas.md](schemas.md#camerafrontendresponse))

#### `GET /frontend/cameras/{fingerprint_host}`
* **Descripción:** Filtra y lista cámaras asociadas a un host.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `fingerprint_host` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<CameraFrontendResponse>`

#### `POST /frontend/cameras/update/{camera_id}`
* **Descripción:** Permite al usuario web renombrar la cámara o reposicionar sus coordenadas en el mapa.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `camera_id` (Path - string, Requerido)
* **Cuerpo de Petición (`application/json`):**
  * Schema: `CameraFrontendRequest` (ver [schemas.md](schemas.md#camerafrontendrequest))
* **Respuestas:**
  * **200 (Success):** Cámara actualizada.
    * Schema: `CameraFrontendResponse`

#### `DELETE /frontend/cameras/delete/{camera_id}`
* **Descripción:** Elimina una cámara del frontend.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `camera_id` (Path - string, Requerido)
* **Respuestas:**
  * **204 (No Content):** Eliminado con éxito. Sin body.

---

## 5. Analíticas (Analytics)

### [API de Sistema / Backend]

#### `POST /analytics/register`
* **Descripción:** Crea una nueva regla analítica avanzada.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `AnalyticRequest` (ver [schemas.md](schemas.md#analyticrequest))
* **Respuestas:**
  * **201 (Created):** Analítica creada.
    * Schema: `AnalyticResponse` (ver [schemas.md](schemas.md#analyticresponse))

#### `POST /analytics/update`
* **Descripción:** Modifica los parámetros geométricos o de clase de una analítica.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `AnalyticRequest`
* **Respuestas:**
  * **200 (Success):** Analítica modificada.
    * Schema: `AnalyticResponse`

#### `GET /analytics/{host_id}`
* **Descripción:** Consulta las analíticas registradas para un ID de host.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `host_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<AnalyticResponse>`

#### `POST /analytics/update_status`
* **Descripción:** Actualiza rápidamente el estado operativo de la analítica.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros de Consulta (Query):**
  * `analytic_id` (string, Requerido)
  * `status` (string, Requerido)
* **Respuestas:**
  * **200 (Success):** Estado cambiado.
    * Schema: `AnalyticResponse`

#### `DELETE /analytics/delete/{analytic_id}`
* **Descripción:** Elimina la regla analítica.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `analytic_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Body: `{}`

---

### [API de Interfaz / Frontend - Default]

#### `GET /frontend/analytics/`
* **Descripción:** Lista todas las analíticas creadas en la interfaz.
* **Autenticación:** Bearer Token.
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<AnalyticResponse>`

#### `GET /frontend/analytics/{fingerprint_host}`
* **Descripción:** Lista analíticas asignadas a un host específico.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `fingerprint_host` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<AnalyticResponse>`

#### `POST /frontend/analytics/update_status/{analytic_id}`
* **Descripción:** Permite activar o desactivar una analítica mediante un switch en el frontend.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `analytic_id` (Path - string, Requerido)
* **Cuerpo de Petición (`application/json`):**
  * Schema: `UpdateAnalyticStatusRequest` (ver [schemas.md](schemas.md#updateanalyticstatusrequest))
* **Respuestas:**
  * **200 (Success):** Analítica con nuevo estado.
    * Schema: `AnalyticResponse`

#### `DELETE /frontend/analytics/{analytic_id}`
* **Descripción:** Elimina una analítica desde el frontend.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `analytic_id` (Path - string, Requerido)
* **Respuestas:**
  * **204 (No Content):** Sin contenido.

---

## 6. Horarios (Schedules)

### [API de Sistema / Backend]

#### `POST /schedules/register`
* **Descripción:** Registra una programación de horario.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `HorarioRequest` (ver [schemas.md](schemas.md#horariorequest))
* **Respuestas:**
  * **201 (Created):** Horario registrado.
    * Schema: `HorarioResponse` (ver [schemas.md](schemas.md#horarioresponse))

#### `POST /schedules/update`
* **Descripción:** Actualiza un horario.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `HorarioRequest`
* **Respuestas:**
  * **200 (Success):** Horario actualizado.
    * Schema: `HorarioResponse`

#### `GET /schedules/{fingerprint_host}`
* **Descripción:** Sincroniza y retorna todos los horarios activos del host especificado.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `fingerprint_host` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<HorarioResponse>`

#### `DELETE /schedules/delete/{schedule_id}`
* **Descripción:** Elimina un horario del sistema.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `schedule_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Body: `{}`

---

### [API de Interfaz / Frontend - Default]

#### `GET /frontend/schedules/`
* **Descripción:** Obtiene todos los horarios en la UI.
* **Autenticación:** Bearer Token.
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<HorarioResponse>`

#### `GET /frontend/schedules/{schedule_id}`
* **Descripción:** Detalla la información de un horario.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `schedule_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Schema: `HorarioResponse`

#### `POST /frontend/schedules/create`
* **Descripción:** Crea un horario desde el formulario web.
* **Autenticación:** Bearer Token.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `HorarioRequest`
* **Respuestas:**
  * **201 (Created):**
    * Schema: `HorarioResponse`

#### `PUT /frontend/schedules/update/{schedule_id}`
* **Descripción:** Actualiza un horario desde la interfaz.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `schedule_id` (Path - string, Requerido)
* **Cuerpo de Petición (`application/json`):**
  * Schema: `HorarioRequest`
* **Respuestas:**
  * **200 (Success):**
    * Schema: `HorarioResponse`

#### `POST /frontend/schedules/update_state/{schedule_id}`
* **Descripción:** Cambia el estado del programador (ej. activo/inactivo).
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `schedule_id` (Path - string, Requerido)
* **Cuerpo de Petición (`application/json`):**
  * Schema: `UpdateHorarioStatusRequest` (ver [schemas.md](schemas.md#updatehorariostatusrequest))
* **Respuestas:**
  * **200 (Success):**
    * Schema: `HorarioResponse`

#### `DELETE /frontend/schedules/delete/{schedule_id}`
* **Descripción:** Elimina una programación de horario.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `schedule_id` (Path - string, Requerido)
* **Respuestas:**
  * **204 (No Content):** Eliminación exitosa. Sin body.

---

## 7. Listas de Control (Lists)

### [API de Sistema / Backend]

#### `POST /lists/register`
* **Descripción:** Registra una lista de control (para que la use la GPU local).
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `ListRequest` (ver [schemas.md](schemas.md#listrequest))
* **Respuestas:**
  * **201 (Created):**
    * Schema: `ListResponse` (ver [schemas.md](schemas.md#listresponse))

#### `POST /lists/update`
* **Descripción:** Actualiza la lista.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `ListRequest`
* **Respuestas:**
  * **200 (Success):**
    * Schema: `ListResponse`

#### `DELETE /lists/delete/{list_id}`
* **Descripción:** Elimina una lista.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `list_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Body: `{}`

---

### [API de Interfaz / Frontend - Default]

#### `GET /frontend/lists/`
* **Descripción:** Obtiene todas las listas (ej. listas de vehículos autorizados, empleados, etc.).
* **Autenticación:** Bearer Token.
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<ListResponse>`

#### `GET /frontend/lists/{list_id}`
* **Descripción:** Obtiene los datos principales de una lista.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `list_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Schema: `ListResponse`

#### `POST /frontend/lists/register`
* **Descripción:** Registra una nueva lista (ej: RF o LPR).
* **Autenticación:** Bearer Token.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `ListRequest`
* **Respuestas:**
  * **201 (Created):**
    * Schema: `ListResponse`

#### `POST /frontend/lists/update`
* **Descripción:** Actualiza los datos descriptivos de la lista.
* **Autenticación:** Bearer Token.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `ListRequest`
* **Respuestas:**
  * **200 (Success):**
    * Schema: `ListResponse`

#### `DELETE /frontend/lists/delete/{list_id}`
* **Descripción:** Elimina la lista.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `list_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Body: `{}`

---

## 8. Detalles de Listas (List Details)

### [API de Sistema / Backend]

#### `POST /list_details/register_face`
* **Descripción:** Registra una persona en una lista RF con su foto desde el motor.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`multipart/form-data`):**
  * `list_detail_request` (JSON string): `ListFaceDetailRequest` (ver [schemas.md](schemas.md#listfacedetailrequest))
  * `file` (binary): Archivo de imagen.
* **Respuestas:**
  * **201 (Created):**
    * Schema: `ListDetailResponse` (ver [schemas.md](schemas.md#listdetailresponse))

#### `POST /list_details/register_plate`
* **Descripción:** Registra una placa vehicular.
* **Autenticación:** Cabecera `x-api-key`.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `ListPlateDetailRequest` (ver [schemas.md](schemas.md#listplatedetailrequest))
* **Respuestas:**
  * **201 (Created):**
    * Schema: `ListDetailResponse`

#### `DELETE /list_details/delete/{detail_id}`
* **Descripción:** Elimina un detalle.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `detail_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Body: `{}`

---

### [API de Interfaz / Frontend - Default]

#### `GET /frontend/list_details/`
* **Descripción:** Lista todos los elementos (rostros/placas) registrados.
* **Autenticación:** Bearer Token.
* **Respuestas:**
  * **200 (Success):**
    * Schema: `Array<ListAllDetailsResponse>` (ver [schemas.md](schemas.md#listalldetailsresponse))

#### `GET /frontend/list_details/get/{detail_id}`
* **Descripción:** Obtiene detalles de un elemento (incluido su embedding).
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `detail_id` (Path - string, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Schema: `ListAllDetailsResponse`

#### `POST /frontend/list_details/register_face`
* **Descripción:** Carga un rostro y lo añade a una lista RF (procesamiento multipart).
* **Autenticación:** Bearer Token.
* **Cuerpo de Petición (`multipart/form-data`):**
  * `list_id` (string, Requerido): ID de la lista.
  * `nombre_asociado` (string, Requerido): Nombre de la persona.
  * `file` (binary, Requerido): Foto.
* **Respuestas:**
  * **201 (Created):**
    * Schema: `ListDetailResponse`

#### `POST /frontend/list_details/register_plate`
* **Descripción:** Registra una placa en la base de datos de control desde el frontend.
* **Autenticación:** Bearer Token.
* **Cuerpo de Petición (`application/json`):**
  * Schema: `ListPlateDetailRequest`
* **Respuestas:**
  * **201 (Created):**
    * Schema: `ListDetailResponse`

#### `DELETE /frontend/list_details/delete/{detail_id}`
* **Descripción:** Elimina un rostro o placa de la lista.
* **Autenticación:** Bearer Token.
* **Parámetros:**
  * `detail_id` (Path - string, Requerido)
* **Respuestas:**
  * **204 (No Content):** Eliminado.

---

## 9. Almacenamiento (Storage)

Gestión de la subida y edición de imágenes (logos, rostros cargados, capturas de placas).

### [API de Sistema / Backend]

#### `POST /storage/upload/{category}`
* **Descripción:** Sube una imagen categorizada.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `category` (Path - string, Requerido): Categoría del archivo.
* **Cuerpo de Petición (`multipart/form-data`):**
  * `file` (binary, Requerido)
* **Respuestas:**
  * **201 (Created):**
    * Body: `{}`

#### `POST /storage/upload_with_name/{category}`
* **Descripción:** Sube una imagen categorizada definiendo su nombre de archivo final.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `category` (Path - string, Requerido)
  * `filename` (Query - string, Requerido): Nombre final del archivo.
* **Cuerpo de Petición (`multipart/form-data`):**
  * `file` (binary, Requerido)
* **Respuestas:**
  * **201 (Created):**
    * Body: `{}`

#### `PUT /storage/update/{image_path}`
* **Descripción:** Sobrescribe una imagen existente.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `image_path` (Path - string, Requerido): Ruta relativa del archivo.
* **Cuerpo de Petición (`multipart/form-data`):**
  * `file` (binary, Requerido)
* **Respuestas:**
  * **200 (Success):**
    * Body: `{}`

#### `DELETE /storage/delete/{url_img}`
* **Descripción:** Borra una imagen almacenada físicamente.
* **Autenticación:** Cabecera `x-api-key`.
* **Parámetros:**
  * `url_img` (Path - string, Requerido): URL completa o ruta de la imagen.
* **Respuestas:**
  * **200 (Success):**
    * Body: `{}`

---

## 10. Salud y Sistema

### [API de Interfaz / Frontend - Default]

#### `GET /health`
* **Descripción:** Validador básico del estado de conexión de la API.
* **Autenticación:** Ninguna (pública).
* **Respuestas:**
  * **200 (Success):** `{}`

#### `GET /`
* **Descripción:** Ruta raíz principal.
* **Autenticación:** Ninguna (pública).
* **Respuestas:**
  * **200 (Success):** `{}`

---

## 11. Servicios Extra (Extra)

### [API de Interfaz / Frontend - Default]

#### `POST /frontend/extra/search_faces_by_img`
* **Descripción:** Realiza una búsqueda de similitud facial en el índice de rostros cargando un archivo de imagen directo.
* **Autenticación:** Bearer Token.
* **Parámetros de Consulta (Query):**
  * `size` (integer, Opcional): Cantidad máxima de coincidencias a retornar. Por defecto 10. Mínimo 1, Máximo 100.
* **Cuerpo de Petición (`multipart/form-data`):**
  * `file` (binary, Requerido): Archivo de imagen (JPEG/PNG) que contiene el rostro a buscar.
* **Respuestas:**
  * **200 (Success):** Coincidencias encontradas ordenadas por confiabilidad.
    * Body:
      ```json
      [
        {
          "confiabilidad": 0.75,
          "edad": "adulto",
          "genero": "masculino",
          "reconocimiento": "Desconocido",
          "camara": "Caminos del inca",
          "timestamp": "2026-06-19T22:40:06.772787Z",
          "url_img": "http://192.168.210.31:8000/storage/rostros/2026/6/19/0241b597-a6c1-4096-8c0e-ace3e2da81e6.jpg",
          "permanencia": null
        }
      ]
      ```
  * **422 (Validation Error):** Parámetros incorrectos o archivo inválido.
