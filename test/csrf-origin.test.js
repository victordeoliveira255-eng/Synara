// ===========================================================================
// SYNARA — Testes do P0-5/P0-6: protecao CSRF por origem e consistencia do
// cookie de sessao. Runner nativo do Node, SEM rede, SEM banco, SEM servidor.
//
// O middleware e as funcoes de cookie sao EXTRAIDOS do server.js real e
// executados com requisicoes/respostas duble. Nao ha reimplementacao da logica
// sob teste: o codigo exercitado e o do repositorio. Iniciar o servidor de
// verdade nao e feito aqui porque initDatabase/syncEducationalBase escrevem no
// banco (e iniciariam um listener).
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const serverSrc = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const SESSION_COOKIE = (serverSrc.match(/const SESSION_COOKIE = '([^']+)';/) || [])[1];
const ALLOWED_ORIGINS = ['http://localhost:3000']; // valor controlado pelo teste
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

assert.ok(SESSION_COOKIE, 'SESSION_COOKIE nao encontrada no server.js');

// --- extracao do codigo real ------------------------------------------------
function originGuardBlock() {
  const start = serverSrc.indexOf('const CSRF_SAFE_METHODS = new Set(');
  const end = serverSrc.indexOf('app.use(requireTrustedOrigin);');
  assert.ok(start !== -1 && end !== -1 && end > start, 'bloco do guard de origem nao localizado em server.js');
  const block = serverSrc.slice(start, end);
  assert.ok(!block.includes('app.use('), 'a extracao nao deve incluir a chamada app.use');
  return block;
}

function loadOriginGuard() {
  const factory = new Function('ALLOWED_ORIGINS', 'SESSION_COOKIE',
    originGuardBlock() + '\nreturn { requireTrustedOrigin, normalizeOrigin, trustedOrigins };');
  return factory(ALLOWED_ORIGINS, SESSION_COOKIE);
}

function loadCookieHelpers() {
  const start = serverSrc.indexOf('function authCookieOptions() {');
  const clearStart = serverSrc.indexOf('function clearAuthCookie(res) {');
  assert.ok(start !== -1 && clearStart !== -1, 'funcoes de cookie nao localizadas em server.js');
  const end = serverSrc.indexOf('\n}\n', clearStart) + 3;
  const block = serverSrc.slice(start, end);
  const factory = new Function('process', 'SESSION_COOKIE', 'ONE_WEEK_MS',
    block + '\nreturn { authCookieOptions, setAuthCookie, clearAuthCookie };');
  return factory(process, SESSION_COOKIE, ONE_WEEK_MS);
}

// --- dubles -----------------------------------------------------------------
function makeReq({ method = 'POST', host = 'synara.example', protocol = 'https', headers = {}, cookie = '' } = {}) {
  const lower = {};
  Object.keys(headers).forEach((key) => { lower[key.toLowerCase()] = headers[key]; });
  if (host != null) lower.host = host;
  const cookies = {};
  String(cookie).split(';').forEach((part) => {
    const eq = part.indexOf('=');
    if (eq > 0) cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  });
  return { method, headers: lower, cookies, protocol };
}

function runGuard(guard, req) {
  const res = { statusCode: null, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  let nextCalled = false;
  guard(req, res, () => { nextCalled = true; });
  return { nextCalled, statusCode: res.statusCode, body: res.body };
}

// ---------------------------------------------------------------------------
// Tarefa 1 — middleware de origem
// ---------------------------------------------------------------------------
test('csrf: POST com Origin externo recebe 403', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  const result = runGuard(requireTrustedOrigin, makeReq({ method: 'POST', headers: { origin: 'https://evil.example' } }));
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
  assert.equal(result.body.success, false);
});

test('csrf: POST com a propria origem da aplicacao e aceito (mesmo fora de ALLOWED_ORIGINS)', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  const result = runGuard(requireTrustedOrigin, makeReq({
    method: 'POST', host: 'synara-web.onrender.com', protocol: 'https',
    headers: { origin: 'https://synara-web.onrender.com' }
  }));
  assert.equal(result.nextCalled, true);
  assert.equal(result.statusCode, null);
});

test('csrf: aceita a origem de ALLOWED_ORIGINS (frontend em outra origem)', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  const result = runGuard(requireTrustedOrigin, makeReq({
    method: 'POST', host: '127.0.0.1:9999', protocol: 'http',
    headers: { origin: 'http://localhost:3000' }
  }));
  assert.equal(result.nextCalled, true);
});

test('csrf: POST sem Origin usa o Referer (legitimo passa, externo recebe 403)', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  const ok = runGuard(requireTrustedOrigin, makeReq({ method: 'POST', headers: { referer: 'https://synara.example/dashboard.html' } }));
  assert.equal(ok.nextCalled, true);
  const bad = runGuard(requireTrustedOrigin, makeReq({ method: 'POST', headers: { referer: 'https://evil.example/attack' } }));
  assert.equal(bad.nextCalled, false);
  assert.equal(bad.statusCode, 403);
});

test('csrf: politica para Origin e Referer ausentes (com e sem cookie de sessao)', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  const withCookie = runGuard(requireTrustedOrigin, makeReq({ method: 'POST', cookie: `${SESSION_COOKIE}=abc` }));
  assert.equal(withCookie.nextCalled, false);
  assert.equal(withCookie.statusCode, 403);
  const withoutCookie = runGuard(requireTrustedOrigin, makeReq({ method: 'POST' }));
  assert.equal(withoutCookie.nextCalled, true);
});

test('csrf: Origin opaco ("null") e rejeitado', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  const result = runGuard(requireTrustedOrigin, makeReq({ method: 'POST', headers: { origin: 'null' } }));
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
});

test('csrf: Origin invalido (lixo) e rejeitado', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  for (const origin of ['not-a-url', 'ftp://synara.example', '://x']) {
    const result = runGuard(requireTrustedOrigin, makeReq({ method: 'POST', headers: { origin } }));
    assert.equal(result.statusCode, 403, 'deveria rejeitar Origin invalido: ' + origin);
  }
});


test('csrf: GET/HEAD/OPTIONS nunca sao bloqueados por este middleware', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const result = runGuard(requireTrustedOrigin, makeReq({ method, headers: { origin: 'https://evil.example' } }));
    assert.equal(result.nextCalled, true, method + ' nao deveria ser bloqueado');
    assert.equal(result.statusCode, null);
  }
});

test('csrf: POST/PUT/PATCH/DELETE com Origem externa sao bloqueados', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = runGuard(requireTrustedOrigin, makeReq({ method, headers: { origin: 'https://evil.example' } }));
    assert.equal(result.statusCode, 403, method + ' deveria ser bloqueado');
  }
});

test('csrf: metodos mutaveis com origem legitima sao aceitos', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const result = runGuard(requireTrustedOrigin, makeReq({ method, headers: { origin: 'https://synara.example' } }));
    assert.equal(result.nextCalled, true, method + ' deveria passar');
  }
});

test('csrf: fluxos pre-autenticacao permanecem acessiveis e sem excecao por rota', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  // Navegador enviando a propria origem, sem cookie (cadastro/login/recuperacao).
  const result = runGuard(requireTrustedOrigin, makeReq({
    method: 'POST', headers: { origin: 'https://synara.example', 'content-type': 'application/json' }
  }));
  assert.equal(result.nextCalled, true);
  // Cliente que omite Origin/Referer e ainda nao tem sessao tambem passa.
  const noContext = runGuard(requireTrustedOrigin, makeReq({ method: 'POST' }));
  assert.equal(noContext.nextCalled, true);
  // Nao ha allowlist de rotas dentro do guard (nenhuma excecao ampla por path).
  assert.ok(!originGuardBlock().includes('/api/'), 'o guard nao deve conter caminhos de rota');
});

test('csrf: lista confiavel nao reflete Origin arbitrario', () => {
  const { trustedOrigins } = loadOriginGuard();
  const origins = trustedOrigins(makeReq({ host: 'synara.example', protocol: 'https' }));
  assert.ok(origins.has('https://synara.example'));
  assert.ok(origins.has('http://synara.example'));
  assert.ok(origins.has('http://localhost:3000'));       // ALLOWED_ORIGINS
  assert.ok(!origins.has('https://evil.example'));
  assert.ok(!origins.has('https://synara.example.evil.example'));
});

test('csrf: esquema do proxy nao quebra a origem legitima (X-Forwarded-Proto ausente)', () => {
  const { requireTrustedOrigin } = loadOriginGuard();
  // Proxy interno HTTP: req.protocol = 'http', mas o navegador fala HTTPS.
  const result = runGuard(requireTrustedOrigin, makeReq({
    method: 'POST', host: 'synara.example', protocol: 'http',
    headers: { origin: 'https://synara.example' }
  }));
  assert.equal(result.nextCalled, true);
});


// ---------------------------------------------------------------------------
// Tarefa 2 — consistencia do cookie de sessao
// ---------------------------------------------------------------------------
test('cookie: criacao e remocao usam os mesmos atributos (path/SameSite/Secure/httpOnly)', () => {
  const { authCookieOptions, setAuthCookie, clearAuthCookie } = loadCookieHelpers();
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.equal(authCookieOptions().secure, true);
    const created = {};
    setAuthCookie({ cookie: (name, value, options) => { created.name = name; created.options = options; } }, 'tok');
    const cleared = {};
    clearAuthCookie({ clearCookie: (name, options) => { cleared.name = name; cleared.options = options; } });

    assert.equal(created.name, SESSION_COOKIE);
    assert.equal(cleared.name, SESSION_COOKIE);
    for (const opts of [created.options, cleared.options]) {
      assert.equal(opts.path, '/');
      assert.equal(opts.sameSite, 'lax');
      assert.equal(opts.secure, true);
      assert.equal(opts.httpOnly, true);
    }
    assert.equal(created.options.maxAge, ONE_WEEK_MS); // duracao da sessao inalterada
    assert.equal(cleared.options.maxAge, undefined);   // clearCookie nao define duracao

    process.env.NODE_ENV = 'development';
    assert.equal(authCookieOptions().secure, false);
    const clearedDev = {};
    clearAuthCookie({ clearCookie: (name, options) => { clearedDev.options = options; } });
    assert.equal(clearedDev.options.secure, false);
    assert.equal(clearedDev.options.path, '/');
    assert.equal(clearedDev.options.sameSite, 'lax');
    assert.equal(clearedDev.options.httpOnly, true);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
  }
});

// ---------------------------------------------------------------------------
// Regressao das etapas anteriores (renderizacao segura + wellbeing)
// ---------------------------------------------------------------------------
test('regressao: renderizacao segura e validacao de wellbeing continuam presentes', () => {
  const dashboardSrc = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
  const scriptSrc = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
  assert.ok(dashboardSrc.includes('bubble.textContent ='), 'dashboard deve preencher a bolha via textContent');
  assert.ok(!dashboardSrc.includes(': message.text)'), 'padrao inseguro de renderizacao nao pode voltar');
  assert.ok(!scriptSrc.includes('innerHTML'), 'script.js nao deve usar innerHTML');
  assert.ok(serverSrc.includes('function validateWellbeing(value) {'));
  assert.ok(serverSrc.includes('const wellbeingError = validateWellbeing(incomingProfile.wellbeing);'));
  assert.ok(serverSrc.includes("const WELLBEING_MOODS = ['', 'tranquilo', 'normal', 'sobrecarregado'];"));
});
