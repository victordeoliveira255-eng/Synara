// ===========================================================================
// SYNARA — Visibilidade do acesso administrativo.
// ---------------------------------------------------------------------------
// Regressão do bug em que o link "Painel Admin" aparecia para todos: o
// `display:inline-flex` de `.d-btn` vencia o `display:none` que o navegador
// aplica ao atributo `hidden`, e o JS não exigia sessão confirmada.
//
// Estes testes exercitam o código REAL:
//   - `hasVerifiedAdminAccess` e `renderHeaderUser` extraídos de dashboard.js;
//   - a regra `[hidden]` dos dois CSS;
//   - `requireRole` extraído de server.js (autorização do servidor intacta).
// Sem navegador, sem rede e sem banco.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashSrc = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
const dashHtml = fs.readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const centralCss = fs.readFileSync(new URL('../public/central.css', import.meta.url), 'utf8');
const adminCss = fs.readFileSync(new URL('../public/admin.css', import.meta.url), 'utf8');
const serverSrc = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// 1. Renderizador real do cabeçalho
// ---------------------------------------------------------------------------
function loadHeaderRenderer() {
  const start = dashSrc.indexOf('  function hasVerifiedAdminAccess(');
  const end = dashSrc.indexOf('  function emptyState(');
  assert.ok(start !== -1 && end !== -1 && end > start, 'Bloco de visibilidade admin não localizado em dashboard.js');

  const elements = new Map();
  const makeElement = () => ({
    textContent: '',
    hidden: true,
    attrs: {},
    setAttribute(key, value) { this.attrs[key] = String(value); },
    removeAttribute(key) { delete this.attrs[key]; }
  });
  const required = ['#accountAvatar', '#accountName', '#accountMenuName', '#accountMenuEmail', '#adminQuickLink'];
  required.forEach((selector) => elements.set(selector, makeElement()));
  const $ = (selector) => elements.get(selector) || null;
  const state = { user: null, sessionVerified: false };

  const factory = new Function(
    '$',
    'state',
    'initials',
    dashSrc.slice(start, end) + '\nreturn { hasVerifiedAdminAccess, renderHeaderUser };'
  );
  const api = factory($, state, (name) => String(name || 'Estudante').slice(0, 1).toUpperCase());
  return { ...api, state, link: elements.get('#adminQuickLink') };
}

function renderFor(user, sessionVerified) {
  const harness = loadHeaderRenderer();
  harness.state.user = user;
  harness.state.sessionVerified = sessionVerified;
  harness.renderHeaderUser();
  return harness;
}

test('admin: usuário admin com sessão confirmada vê o atalho', () => {
  const harness = renderFor({ name: 'Admin', email: 'a@example.com', role: 'admin' }, true);
  assert.equal(harness.link.hidden, false);
  assert.equal(harness.link.attrs['aria-hidden'], undefined);
});

test('admin: usuário comum com sessão confirmada NÃO vê o atalho', () => {
  const harness = renderFor({ name: 'Aluno', email: 'u@example.com', role: 'user' }, true);
  assert.equal(harness.link.hidden, true);
  assert.equal(harness.link.attrs['aria-hidden'], 'true');
});

test('admin: papel admin em storage adulterado, sem confirmação do servidor, NÃO vê o atalho', () => {
  const harness = renderFor({ name: 'Aluno', email: 'u@example.com', role: 'admin' }, false);
  assert.equal(harness.link.hidden, true);
});

test('admin: estado de carregamento (sem usuário) NÃO vê o atalho', () => {
  const harness = renderFor(null, false);
  assert.equal(harness.link.hidden, true);
});

test('admin: papel com caixa diferente não é aceito como administrativo', () => {
  const { hasVerifiedAdminAccess } = loadHeaderRenderer();
  assert.equal(hasVerifiedAdminAccess({ role: 'Admin' }, true), false);
  assert.equal(hasVerifiedAdminAccess({ role: 'user' }, true), false);
  assert.equal(hasVerifiedAdminAccess({ role: 'admin' }, true), true);
  assert.equal(hasVerifiedAdminAccess({ role: 'admin' }, 'true'), false);
});

test('admin: o HTML começa com o atalho oculto e há um único atalho administrativo', () => {
  const matches = dashHtml.match(/id="adminQuickLink"/g) || [];
  assert.equal(matches.length, 1);
  const index = dashHtml.indexOf('id="adminQuickLink"');
  const tag = dashHtml.slice(index - 140, index + 100);
  assert.match(tag, /hidden/);
  assert.equal((dashHtml.match(/href="\/admin"/g) || []).length, 1);
});

// ---------------------------------------------------------------------------
// 2. CSS: `hidden` não pode ser vencido por display de componente
// ---------------------------------------------------------------------------
test('css: central.css garante display:none para [hidden]', () => {
  assert.match(centralCss, /\.dashboard-page \[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test('css: admin.css garante display:none para [hidden]', () => {
  assert.match(adminCss, /\.admin-page \[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test('css: o link admin é um .d-btn (por isso a regra [hidden] é obrigatória)', () => {
  const index = dashHtml.indexOf('id="adminQuickLink"');
  const tag = dashHtml.slice(index - 150, index);
  assert.match(tag, /class="[^"]*d-btn/);
});

// ---------------------------------------------------------------------------
// 3. Servidor: autorização continua obrigatória (não foi afrouxada)
// ---------------------------------------------------------------------------
function loadRequireRole() {
  const start = serverSrc.indexOf('function requireRole(role) {');
  const end = serverSrc.indexOf('\n}\n', start) + 3;
  assert.ok(start !== -1 && end > start, 'requireRole não localizada em server.js');
  return new Function(serverSrc.slice(start, end) + '\nreturn requireRole;')();
}

function runRequireRole(guard, user) {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  let nextCalled = false;
  guard({ user }, res, () => { nextCalled = true; });
  return { nextCalled, statusCode: res.statusCode };
}

test('server: requireRole libera admin e bloqueia usuário comum', () => {
  const requireRole = loadRequireRole()('admin');
  assert.equal(runRequireRole(requireRole, { role: 'admin' }).nextCalled, true);
  assert.equal(runRequireRole(requireRole, { role: 'user' }).statusCode, 403);
});

test('server: requireRole bloqueia sessão sem usuário', () => {
  const requireRole = loadRequireRole()('admin');
  const result = runRequireRole(requireRole, null);
  assert.equal(result.nextCalled, false);
  assert.equal(result.statusCode, 403);
});


test('server: toda rota administrativa exige autenticação E papel admin', () => {
  const routeLines = serverSrc
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^app\.(get|post)\('(\/admin(?:\.html)?|\/api\/admin\/[^']+)'/.test(line));

  assert.ok(routeLines.length >= 9, 'rotas administrativas esperadas não encontradas');
  for (const line of routeLines) {
    assert.match(line, /requireAuth/, 'sem requireAuth: ' + line);
    assert.match(line, /requireRole\(USER_ROLE\.ADMIN\)/, 'sem requireRole(ADMIN): ' + line);
  }
});

test('server: nenhuma rota /api/admin dispensa papel admin', () => {
  const adminApiRoutes = serverSrc
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^app\.(get|post|put|delete)\('\/api\/admin\//.test(line));
  assert.ok(adminApiRoutes.length >= 7);
  assert.equal(adminApiRoutes.filter((line) => !line.includes('requireRole(USER_ROLE.ADMIN)')).length, 0);
});

