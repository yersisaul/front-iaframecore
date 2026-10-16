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
else
  export API_KEY_HEADER=""
fi

# 3. Configurar proxy dinámico hacia Azor Panel (Report Types)
# El destino lo define el dominio ingresado en cada acción "Enviar a API"; aquí solo se configura la clave y el DNS.
if [ -n "$TOKEN_AZOR_ANALYTICS" ]; then
  echo "🔑 Configurando inyección de X-API-Key para Azor Panel..."
  export AZOR_PROXY_AUTH_HEADER="proxy_set_header X-API-Key \"${TOKEN_AZOR_ANALYTICS}\";"
else
  echo "⚠️ TOKEN_AZOR_ANALYTICS no definido: las consultas a Azor Panel se enviarán sin clave de integración."
  export AZOR_PROXY_AUTH_HEADER=""
fi

# Resolver DNS para dominios con nombre (proxy_pass con variables). Se puede forzar con NGINX_RESOLVER.
if [ -z "$NGINX_RESOLVER" ]; then
  NGINX_RESOLVER=$(awk '/^nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null)
fi
if [ -z "$NGINX_RESOLVER" ]; then
  NGINX_RESOLVER="127.0.0.11"
fi
# Las direcciones IPv6 deben ir entre corchetes
case "$NGINX_RESOLVER" in
  *:*) case "$NGINX_RESOLVER" in \[*) ;; *) NGINX_RESOLVER="[$NGINX_RESOLVER]" ;; esac ;;
esac
export NGINX_RESOLVER
echo "🌐 Resolver DNS para Azor Panel: ${NGINX_RESOLVER}"

# 4. Generar archivo de configuración de runtime para el frontend de Angular
echo "📦 Generando runtime env.js para la versión del cliente..."
ENV_JS_PATH="/usr/share/nginx/html/assets/env.js"
mkdir -p /usr/share/nginx/html/assets

if [ -n "$APP_VERSION" ]; then
  VERSION_JS="\"$APP_VERSION\""
else
  VERSION_JS="null"
fi

cat <<EOF > "$ENV_JS_PATH"
(function(window) {
  window.__env = window.__env || {};
  window.__env.APP_VERSION = ${VERSION_JS};
})(this);
EOF

# 5. Reemplazar variables dinámicas en el template de Nginx
echo "🔧 Generando configuración de Nginx de forma dinámica..."

envsubst '$API_HOST $OPENSEARCH_HOST $OPENSEARCH_AUTH_HEADER $API_KEY_HEADER $AZOR_PROXY_AUTH_HEADER $NGINX_RESOLVER' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# 6. Continuar con la ejecución de Nginx
echo "🚀 Iniciando Nginx..."
exec nginx -g "daemon off;"
