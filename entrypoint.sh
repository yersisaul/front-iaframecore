#!/bin/sh

# 1. Reemplazar JWT_SECRET_KEY en los archivos JS de Angular
if [ -n "$JWT_SECRET_KEY" ]; then
  echo "🔧 Configurando JWT_SECRET_KEY de forma dinámica en los archivos JS..."
  # Busca 'PLACEHOLDER_JWT_SECRET_KEY' y lo cambia por el valor de la variable $JWT_SECRET_KEY de Docker
  find /usr/share/nginx/html -type f -name "*.js" -exec sed -i "s/PLACEHOLDER_JWT_SECRET_KEY/$JWT_SECRET_KEY/g" {} +
  echo "✅ JWT_SECRET_KEY reemplazado con éxito."
else
  echo "⚠️ Advertencia: JWT_SECRET_KEY no fue proporcionado. Se mantendrá el valor por defecto."
fi

# 2. Reemplazar manualmente API_HOST y OPENSEARCH_HOST en el template de Nginx
echo "🔧 Generando configuración de Nginx de forma dinámica..."
envsubst '$API_HOST $OPENSEARCH_HOST' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

# 3. Continuar con la ejecución de Nginx
echo "🚀 Iniciando Nginx..."
exec nginx -g "daemon off;"