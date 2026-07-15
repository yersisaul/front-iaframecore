# Stage 1: Build the Angular application
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:alpine

# Instalar envsubst (en alpine suele venir en el paquete gettext)
RUN apk add --no-cache gettext

# Eliminar configuraciones por defecto
RUN rm /etc/nginx/conf.d/default.conf

# Copiar la aplicación compilada de Angular
COPY --from=build /app/dist/iaframecore/browser /usr/share/nginx/html

# Copiar el template a una ruta temporal
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Copiar y dar permisos al script de entrada personalizado
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80

# Usamos nuestro script de entrada directamente
ENTRYPOINT ["/entrypoint.sh"]