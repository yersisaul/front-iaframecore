# Iaframecore

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.10.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.


## Despliegue
Este proyecto está configurado para empaquetarse en una imagen genérica de Docker utilizando un flujo de compilación *Multi-stage* (Node.js + Nginx Alpine). La imagen resultante se puede subir a Docker Hub y reutilizar de forma independiente en la intranet de cualquier cliente modificando únicamente sus variables de entorno.

### Arquitectura Dinámica del Contenedor
Durante la fase de construcción (`docker build`), la aplicación Angular se compila usando una semilla de texto estática (`PLACEHOLDER_JWT_SECRET_KEY`) para evitar fallos de compilación. 

Al arrancar el contenedor en el servidor del cliente, entra en acción el script de automatización `entrypoint.sh`, el cual cumple dos funciones críticas en caliente (Runtime):
1. **Inyección de API Key:** Busca la semilla `PLACEHOLDER_JWT_SECRET_KEY` dentro de los archivos Javascript compilados de Angular y la reemplaza por el valor real de la variable `$JWT_SECRET_KEY` configurada para ese cliente.
2. **Proxy Inverso Dinámico:** Reemplaza de forma explícita las variables `$API_HOST` y `$OPENSEARCH_HOST` en la plantilla `nginx.conf.template` generando el archivo de configuración final de Nginx, protegiendo y manteniendo intactas las variables nativas del servidor web (como `$host` o `$remote_addr`).

---

### 1. Construir la imagen Docker (Modo Genérico)

Para generar la imagen del frontend ejecute el siguiente comando en la raíz del proyecto. Esta imagen queda lista para ser subida a Docker Hub:

```bash
docker build -t front-iaframecore:latest .

