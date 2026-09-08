#!/bin/sh

# 1. Configurar Basic Auth para OpenSearch si se proporcionan credenciales
if [ -n "$OPENSEARCH_USER" ] && [ -n "$OPENSEARCH_PASSWORD" ]; then
  echo "🔒 Configurando autenticación Basic para OpenSearch..."
  OPENSEARCH_AUTH_BASE64=$(printf "%s:%s" "$OPENSEARCH_USER" "$OPENSEARCH_PASSWORD" | base64 | tr -d '\r\n')
  export OPENSEARCH_AUTH_HEADER="proxy_set_header Authorization \"Basic ${OPENSEARCH_AUTH_BASE64}\";"
else
  export OPENSEARCH_AUTH_HEADER=""
fi

# 2. Configurar header X-API-Key si se proporciona JWT_SECRET_KEY
if [ -n "$JWT_SECRET_KEY" ]; then
  echo "🔑 Configurando inyección de X-API-Key para backend API..."
  export API_KEY_HEADER="proxy_set_header x-api-key \"${JWT_SECRET_KEY}\"; proxy_set_header X-API-Key \"${JWT_SECRET_KEY}\";"
  # Opcional: reemplazar placeholder si existiera en build estático
  find /usr/share/nginx/html -type f -name "*.js" -exec sed -i "s/PLACEHOLDER_JWT_SECRET_KEY/$JWT_SECRET_KEY/g" {} + 2>/dev/null || true
else
  export API_KEY_HEADER=""
fi

# 3. Reemplazar variables dinámicas en el template de Nginx
echo "🔧 Generando configuración de Nginx de forma dinámica..."
if [ -z "$MINIO_PUBLIC_URL" ]; then
  export MINIO_PUBLIC_URL="$API_HOST"
fi

envsubst '$API_HOST $OPENSEARCH_HOST $MINIO_PUBLIC_URL $OPENSEARCH_AUTH_HEADER $API_KEY_HEADER' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# 4. Continuar con la ejecución de Nginx
echo "🚀 Iniciando Nginx..."
exec nginx -g "daemon off;"