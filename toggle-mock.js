const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');

if (!fs.existsSync(envPath)) {
  console.error('❌ Error: No se encontró el archivo .env en la raíz del proyecto.');
  process.exit(1);
}

try {
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Helper parsing function
  function getEnvValue(content, key) {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const parts = trimmed.split('=');
      if (parts[0].trim() === key) {
        return parts.slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
      }
    }
    return null;
  }

  const currentApiTarget = getEnvValue(envContent, 'API_TARGET');
  const realApiTarget = getEnvValue(envContent, 'API_TARGET_REAL');
  const realOpenSearchTarget = getEnvValue(envContent, 'OPENSEARCH_TARGET_REAL');
  const mockApiTarget = getEnvValue(envContent, 'API_TARGET_MOCK');
  const mockOpenSearchTarget = getEnvValue(envContent, 'OPENSEARCH_TARGET_MOCK');

  if (!realApiTarget || !realOpenSearchTarget || !mockApiTarget || !mockOpenSearchTarget) {
    console.error('❌ Error: Faltan variables obligatorias en el archivo .env.');
    console.error('Asegúrese de definir: API_TARGET_REAL, OPENSEARCH_TARGET_REAL, API_TARGET_MOCK, OPENSEARCH_TARGET_MOCK');
    process.exit(1);
  }

  let newApiTarget;
  let newOpenSearchTarget;
  let isMockMode = false;

  // Si el actual es el real, cambiamos al mock. De lo contrario, al real.
  if (currentApiTarget && currentApiTarget === realApiTarget) {
    newApiTarget = mockApiTarget;
    newOpenSearchTarget = mockOpenSearchTarget;
    isMockMode = true;
  } else {
    newApiTarget = realApiTarget;
    newOpenSearchTarget = realOpenSearchTarget;
  }

  // Update envContent
  function setEnvValue(content, key, value) {
    const lines = content.split('\n');
    let found = false;
    const newLines = lines.map(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;
      const parts = trimmed.split('=');
      if (parts[0].trim() === key) {
        found = true;
        return `${key}=${value}`;
      }
      return line;
    });
    if (!found) {
      newLines.push(`${key}=${value}`);
    }
    return newLines.join('\n');
  }

  envContent = setEnvValue(envContent, 'API_TARGET', newApiTarget);
  envContent = setEnvValue(envContent, 'OPENSEARCH_TARGET', newOpenSearchTarget);

  fs.writeFileSync(envPath, envContent, 'utf8');

  console.log('================================================================');
  if (isMockMode) {
    console.log(`🔄 Conexión configurada a: MOCK SIMULADO (${newApiTarget})`);
    console.log('📌 NOTA: Tanto API_TARGET como OPENSEARCH_TARGET apuntan al mock.');
    console.log('📌 Ejecuta: "npm run mock-server" para iniciar el servidor de mock.');
  } else {
    console.log(`🔄 Conexión configurada a: BACKEND REAL (${newApiTarget})`);
    console.log(`📌 NOTA: API_TARGET va a ${newApiTarget} y OPENSEARCH_TARGET a ${newOpenSearchTarget}.`);
  }
  console.log('⚠️ IMPORTANTE: Si tenías la aplicación corriendo, detén "npm start"');
  console.log('   (Ctrl+C) y vuelve a ejecutar para aplicar los cambios del proxy.');
  console.log('================================================================');

} catch (error) {
  console.error('❌ Error al modificar .env:', error);
  process.exit(1);
}
