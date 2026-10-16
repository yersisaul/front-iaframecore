import {
  AzorDomain,
  buildAzorOrigin,
  buildAzorReportsEndpoint,
  getAzorCandidateOrigins,
  normalizeAzorDomain
} from './azor-endpoint.util';

function domainOf(input: string): AzorDomain {
  const result = normalizeAzorDomain(input);
  if (!result.ok) throw new Error(`Se esperaba un dominio válido para "${input}": ${result.message}`);
  return result.domain;
}

describe('normalizeAzorDomain', () => {
  it.each([
    // [entrada, valor limpio]
    ['38.187.6.36:3010', '38.187.6.36:3010'],
    ['38.187.6.36:3010/backend', '38.187.6.36:3010'],
    ['http://38.187.6.36:3010/azor-analytics/reports', 'http://38.187.6.36:3010'],
    ['https:/panel.com/backend', 'https://panel.com'],
    ['https//panel.com', 'https://panel.com'],
    ['http:\\\\panel.com\\backend', 'http://panel.com'],
    ['HTTPS://Panel.COM:443/backend/?x=1#y', 'https://panel.com'],
    ['http://panel.com:80/', 'http://panel.com'],
    ['https://panel.com:8443/api', 'https://panel.com:8443'],
    ['usuario:clave@panel.com/backend', 'panel.com'],
    ['https://user:pass@panel.com:3010', 'https://panel.com:3010'],
    ['[2001:db8::1]:3010/backend', '[2001:db8::1]:3010'],
    ['http://[2001:DB8::1]', 'http://[2001:db8::1]'],
    ['  panel.com  ', 'panel.com'],
    ['panel.com:', 'panel.com'],
    ['panel.com.', 'panel.com'],
    ['localhost:3010', 'localhost:3010'],
    ['127.0.0.1:3010', '127.0.0.1:3010'],
    ['https://api.mi-sistema.com/alertas', 'https://api.mi-sistema.com'],
    ['panel.com?debug=1', 'panel.com'],
    ['panel.com#seccion', 'panel.com']
  ])('limpia "%s" → "%s"', (input, expected) => {
    expect(domainOf(input).display).toBe(expected);
    expect(domainOf(input).key).toBe(expected);
  });

  it('conserva el esquema solo si fue escrito', () => {
    expect(domainOf('panel.com').explicitScheme).toBeNull();
    expect(domainOf('https:/panel.com').explicitScheme).toBe('https');
    expect(domainOf('HTTP://panel.com').explicitScheme).toBe('http');
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    [null, 'empty'],
    ['panel com', 'invalid-host'],
    [':3010', 'invalid-host'],
    ['3010', 'invalid-host'],
    ['300.1.1.1', 'invalid-host'],
    ['panel_com', 'invalid-host'],
    ['-panel.com', 'invalid-host'],
    ['http://', 'invalid-host'],
    ['/backend', 'invalid-host'],
    ['[zz::1]', 'invalid-host'],
    ['panel.com:99999', 'invalid-port'],
    ['panel.com:0', 'invalid-port'],
    ['panel.com:abc', 'invalid-port']
  ])('rechaza "%s" (%s) sin consultar', (input, error) => {
    const result = normalizeAzorDomain(input as string | null);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(error);
      expect(result.message.length).toBeGreaterThan(0);
    }
  });
});

describe('getAzorCandidateOrigins (consulta híbrida)', () => {
  it('prueba https primero cuando no se escribió esquema', () => {
    const candidates = getAzorCandidateOrigins(domainOf('panel.com'));
    expect(candidates).toEqual([
      { scheme: 'https', origin: 'https://panel.com', proxyBase: '/azor-proxy/https/panel.com/443' },
      { scheme: 'http', origin: 'http://panel.com', proxyBase: '/azor-proxy/http/panel.com/80' }
    ]);
  });

  it('prueba primero el esquema escrito y mantiene el puerto explícito en ambos', () => {
    const candidates = getAzorCandidateOrigins(domainOf('http://38.187.6.36:3010/backend'));
    expect(candidates).toEqual([
      { scheme: 'http', origin: 'http://38.187.6.36:3010', proxyBase: '/azor-proxy/http/38.187.6.36/3010' },
      { scheme: 'https', origin: 'https://38.187.6.36:3010', proxyBase: '/azor-proxy/https/38.187.6.36/3010' }
    ]);
  });

  it('conserva el puerto 443 escrito sin esquema para el intento http', () => {
    const [https, http] = getAzorCandidateOrigins(domainOf('panel.com:443'));
    expect(https.origin).toBe('https://panel.com');
    expect(http.origin).toBe('http://panel.com:443');
    expect(http.proxyBase).toBe('/azor-proxy/http/panel.com/443');
  });

  it('soporta IPv6 en la ruta del proxy', () => {
    const [https] = getAzorCandidateOrigins(domainOf('[2001:db8::1]:3010'));
    expect(https.proxyBase).toBe('/azor-proxy/https/[2001:db8::1]/3010');
  });
});

describe('endpoint de reportes', () => {
  it('arma {origen}/azor-analytics/reports', () => {
    expect(buildAzorReportsEndpoint('http://38.187.6.36:3010')).toBe('http://38.187.6.36:3010/azor-analytics/reports');
    expect(buildAzorReportsEndpoint('https://panel.com/')).toBe('https://panel.com/azor-analytics/reports');
  });

  it('omite el puerto por defecto del esquema en el origen', () => {
    expect(buildAzorOrigin('https', 'panel.com', 443)).toBe('https://panel.com');
    expect(buildAzorOrigin('http', 'panel.com', null)).toBe('http://panel.com');
    expect(buildAzorOrigin('http', 'panel.com', 3010)).toBe('http://panel.com:3010');
  });

  it('un endpoint guardado limpio se vuelve a armar idéntico (ida y vuelta)', () => {
    const saved = 'http://38.187.6.36:3010/azor-analytics/reports';
    const domain = domainOf(saved);
    const [preferred] = getAzorCandidateOrigins(domain);
    expect(buildAzorReportsEndpoint(preferred.origin)).toBe(saved);
  });
});
