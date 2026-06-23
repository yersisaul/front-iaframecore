# Stage 1: Build the Angular application
FROM node:20-alpine AS build
WORKDIR /app

# Accept JWT_API_KEY as build argument (for configuration file generation)
ARG JWT_API_KEY
RUN if [ -z "$JWT_API_KEY" ]; then echo "❌ Error: JWT_API_KEY no suministrado en la construcción de Docker" && exit 1; fi

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci

# Copy the rest of the source code
COPY . .

# Generate the .env file with the build argument for the configuration build script
RUN echo "JWT_API_KEY=${JWT_API_KEY}" > .env

# Build the project (which runs generate-env.js beforehand)
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:alpine

# Copy built assets to default nginx directory
COPY --from=build /app/dist/iaframecore/browser /usr/share/nginx/html

# Copy nginx config template for envsubst
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Configure envsubst to only replace API_TARGET and OPENSEARCH_TARGET
ENV NGINX_ENVSUBST_FILTER="API_TARGET OPENSEARCH_TARGET"

EXPOSE 80
