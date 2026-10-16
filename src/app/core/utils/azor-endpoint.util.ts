import { AppEnvironment } from '../config/app-environment';

// Dominio de Azor Panel para la acción "Enviar a API".
// El usuario solo ingresa el dominio (IP o nombre, con o sin esquema/puerto); las rutas son fijas:
//  - Report Types:  {dominio}/others/report-types   (consultado vía /azor-proxy)
//  - Reportes:      {dominio}/azor-analytics/reports (endpoint guardado en la acción)

export const AZOR_REPORTS_PATH = '/azor-analytics/reports';

export type AzorScheme = 'http' | 'https';

export interface AzorDomain {
  /** Host en minúsculas; IPv6 entre corchetes. */
  host: string;
  /** Puerto explícito, o null si no se indicó (o era el puerto por defecto del esquema indicado). */
  port: number | null;
  /** Esquema escrito por el usuario; null si no lo indicó. */
  explicitScheme: AzorScheme | null;
  /** Valor limpio para mostrar en el input. */
  display: string;
  /** Clave estable de caché (mismo valor limpio). */
  key: string;
}

export type AzorDomainError = 'empty' | 'invalid-host' | 'invalid-port';

export type AzorDomainParseResult =
  | { ok: true; domain: AzorDomain }
  | { ok: false; error: AzorDomainError; message: string };

export interface AzorCandidateOrigin {
  scheme: AzorScheme;
  /** Origen sin puerto por defecto, p. ej. "https://panel.com" o "http://10.0.0.5:3010". */
  origin: string;
  /** Base del proxy, p. ej. "/azor-proxy/https/panel.com/443". */
  proxyBase: string;
}

const DEFAULT_PORT: Record<AzorScheme, number> = { http: 80, https: 443 };

const DOMAIN_ERROR_MESSAGES: Record<AzorDomainError, string> = {
  'empty': 'Dominio requerido.',
  'invalid-host': 'Formato inválido.',
  'invalid-port': 'Puerto inválido (1-65535).'
};

// Esquema al inicio, tolerando errores de tipeo: "https://", "https:/", "https//", "http:\\", "HTTPS:"
const SCHEME_RE = /^(https?)(?::[\\/]*|[\\/]{2,})/i;
const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const HOSTNAME_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV6_AUTHORITY_RE = /^\[([0-9a-f:.]+)\](?::(\d*))?$/i;
const HOST_AUTHORITY_RE = /^([^:]*)(?::(.*))?$/;

function isValidHostname(host: string): boolean {
  if (host.length > 253) return false;
  const ipv4 = IPV4_RE.exec(host);
  if (ipv4) return ipv4.slice(1).every(octet => Number(octet) <= 255);
  // Un host solo numérico que no es IPv4 (p. ej. "3010") no es válido
  if (/^[\d.]+$/.test(host)) return false;
  return host.split('.').every(label => HOSTNAME_LABEL_RE.test(label));
}

function parsePort(raw: string | undefined): { ok: true; port: number | null } | { ok: false } {
  if (raw === undefined || raw === '') return { ok: true, port: null };
  if (!/^\d{1,5}$/.test(raw)) return { ok: false };
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? { ok: true, port } : { ok: false };
}

function failure(error: AzorDomainError): AzorDomainParseResult {
  return { ok: false, error, message: DOMAIN_ERROR_MESSAGES[error] };
}

/**
 * Limpia lo ingresado (o un endpoint guardado) y conserva solo esquema, host y puerto.
 * Se descarta cualquier ruta, query, fragmento o credencial embebida.
 */
export function normalizeAzorDomain(input: string | null | undefined): AzorDomainParseResult {
  let rest = (input ?? '').trim();
  if (!rest) return failure('empty');

  let explicitScheme: AzorScheme | null = null;
  const schemeMatch = SCHEME_RE.exec(rest);
  if (schemeMatch) {
    explicitScheme = schemeMatch[1].toLowerCase() as AzorScheme;
    rest = rest.slice(schemeMatch[0].length);
  }

  // Autoridad = hasta la primera "/", "\", "?" o "#"; el resto es ruta descartada
  const authorityEnd = rest.search(/[\/\\?#]/);
  let authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);

  // Credenciales embebidas (usuario:clave@host): nunca se conservan
  const atIndex = authority.lastIndexOf('@');
  if (atIndex !== -1) authority = authority.slice(atIndex + 1);

  if (!authority || /\s/.test(authority)) return failure('invalid-host');

  let host: string;
  let rawPort: string | undefined;
  const ipv6 = IPV6_AUTHORITY_RE.exec(authority);
  if (ipv6) {
    if (!ipv6[1].includes(':')) return failure('invalid-host');
    host = `[${ipv6[1].toLowerCase()}]`;
    rawPort = ipv6[2];
  } else {
    // Un "[" sin IPv6 válida es un host inválido; el host va hasta el primer ":" y el resto es el puerto
    if (authority.startsWith('[')) return failure('invalid-host');
    const hostMatch = HOST_AUTHORITY_RE.exec(authority)!;
    host = hostMatch[1].toLowerCase().replace(/\.$/, '');
    rawPort = hostMatch[2];
    if (!isValidHostname(host)) return failure('invalid-host');
  }

  const parsedPort = parsePort(rawPort);
  if (!parsedPort.ok) return failure('invalid-port');

  // El puerto por defecto del esquema indicado no aporta información
  const port = explicitScheme && parsedPort.port === DEFAULT_PORT[explicitScheme] ? null : parsedPort.port;

  const hostPort = port !== null ? `${host}:${port}` : host;
  const display = explicitScheme ? `${explicitScheme}://${hostPort}` : hostPort;
  return { ok: true, domain: { host, port, explicitScheme, display, key: display } };
}

/** Origen sin el puerto por defecto del esquema. */
export function buildAzorOrigin(scheme: AzorScheme, host: string, port: number | null): string {
  const effectivePort = port ?? DEFAULT_PORT[scheme];
  return effectivePort === DEFAULT_PORT[scheme] ? `${scheme}://${host}` : `${scheme}://${host}:${effectivePort}`;
}

export function buildAzorProxyBase(scheme: AzorScheme, host: string, port: number | null): string {
  return `${AppEnvironment.azorProxyUrl}/${scheme}/${host}/${port ?? DEFAULT_PORT[scheme]}`;
}

/**
 * Orígenes a probar en la consulta híbrida, en orden de preferencia:
 * primero el esquema escrito por el usuario; si no escribió ninguno, https.
 */
export function getAzorCandidateOrigins(domain: AzorDomain): AzorCandidateOrigin[] {
  const preferred: AzorScheme = domain.explicitScheme ?? 'https';
  const schemes: AzorScheme[] = preferred === 'https' ? ['https', 'http'] : ['http', 'https'];
  return schemes.map(scheme => ({
    scheme,
    origin: buildAzorOrigin(scheme, domain.host, domain.port),
    proxyBase: buildAzorProxyBase(scheme, domain.host, domain.port)
  }));
}

/** Endpoint guardado en la acción: {origen}/azor-analytics/reports */
export function buildAzorReportsEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${AZOR_REPORTS_PATH}`;
}
