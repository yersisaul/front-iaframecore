/**
 * Utilidad global para copiar texto al portapapeles de manera segura.
 * 
 * Implementa un fallback automático:
 * 1. Intenta usar la API moderna `navigator.clipboard` (requiere HTTPS o localhost).
 * 2. Si falla o no está disponible (ej. entornos de red local HTTP), utiliza `document.execCommand('copy')`
 *    creando un textarea invisible temporalmente.
 */
export function copyToClipboard(text: string): Promise<void> {
  // Camino feliz: API moderna disponible
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  // Fallback: Entornos no seguros (HTTP por IP local)
  return new Promise((resolve, reject) => {
    try {
      const textarea = document.createElement('textarea');
      // Ocultar el textarea para que no interfiera visualmente
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.top = '0';
      textarea.style.left = '0';
      textarea.style.width = '2em';
      textarea.style.height = '2em';
      textarea.style.padding = '0';
      textarea.style.border = 'none';
      textarea.style.outline = 'none';
      textarea.style.boxShadow = 'none';
      textarea.style.background = 'transparent';
      
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (successful) {
        resolve();
      } else {
        reject(new Error('El comando execCommand falló al copiar el texto.'));
      }
    } catch (err) {
      reject(err);
    }
  });
}
