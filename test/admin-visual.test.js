// ===========================================================================
// SYNARA — Contratos visuais e estruturais do Painel Administrativo (Fase 7).
// ---------------------------------------------------------------------------
// Estáticos, sem navegador. Complementam test/admin-visibility.test.js
// (que cobre a autorização) garantindo que o refinamento visual não removeu
// IDs, seções, o guarda [hidden] nem os contratos de tema.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');

const html = read('admin.html');
const js = read('admin.js');
const css = read('admin.css');

const count = (text, needle) => text.split(needle).length - 1;

// ---------------------------------------------------------------------------
// 1. Integridade estrutural
// ---------------------------------------------------------------------------
test('admin: todos os IDs consultados por admin.js continuam no HTML', () => {
  const quote = String.fromCharCode(39);
  const re = new RegExp('\\$\\(' + quote + '#([A-Za-z0-9_-]+)' + quote + '\\)', 'g');
  const ids = [...new Set([...js.matchAll(re)].map((m) => m[1]))];
  assert.ok(ids.length >= 40, 'esperado um conjunto relevante de IDs, recebido: ' + ids.length);
  const missing = ids.filter((id) => html.indexOf('id="' + id + '"') < 0);
  assert.deepEqual(missing, [], 'IDs removidos: ' + missing.join(', '));
});

test('admin: seis seções e seis itens de navegação, com os mesmos nomes', () => {
  const views = [...new Set([...html.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]))];
  const navItems = [...new Set([...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]))];
  assert.deepEqual(views, ['overview', 'users', 'mentor', 'health', 'logs', 'bncc']);
  assert.deepEqual(navItems, views);
});

test('admin: nenhum emoji como ícone de interface', () => {
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), false);
});

// ---------------------------------------------------------------------------
// 2. Hierarquia tipográfica
// ---------------------------------------------------------------------------
test('admin: títulos e textos com quebra equilibrada e ritmo fluido', () => {
  assert.match(css, /\.admin-view__head \{[^}]*margin-bottom: clamp\(1\.1rem, 2vw, 1\.5rem\)/);
  assert.match(css, /\.admin-view__head h1 \{[^}]*text-wrap: balance/);
  assert.match(css, /\.admin-view__head p \{[^}]*text-wrap: pretty/);
  assert.match(css, /\.a-card__head h2 \{[^}]*text-wrap: balance/);
  assert.match(css, /\.a-banner h1 \{[^}]*text-wrap: balance/);
});

// ---------------------------------------------------------------------------
// 3. Navegação
// ---------------------------------------------------------------------------
test('admin: item ativo tem pista além da cor e continua marcado pelo JS', () => {
  assert.match(css, /\.admin-nav-link\[aria-current="page"\] \{[^}]*font-weight: 800/);
  assert.match(css, /\.admin-nav-link\[aria-current="page"\] \{[^}]*box-shadow: inset/);
  assert.ok(js.includes('aria-current'), 'admin.js continua marcando a seção ativa');
  assert.ok(html.includes('aria-label="Recolher menu lateral"'), 'botão de recolher preservado');
});

// ---------------------------------------------------------------------------
// 4. Tabelas e estados
// ---------------------------------------------------------------------------
test('admin: tabela mantém rolagem horizontal e fonte legível', () => {
  assert.match(css, /\.a-table-wrap \{[^}]*overflow-x: auto/);
  assert.match(css, /\.a-table \{[^}]*min-width: 560px/);
  assert.match(css, /\.a-table td \{[^}]*font-size: \.86rem/);
  assert.match(css, /\.a-table th \{[^}]*font-size: \.72rem/);
  assert.match(css, /\.a-table tbody tr:hover/);
});

test('admin: estado vazio usa token (borda legível nos dois temas)', () => {
  assert.match(css, /\.a-empty \{[^}]*border: 1px dashed var\(--sy-border-strong\)/);
  assert.equal(css.includes('#c3d6e0'), false, 'literal claro removido');
});

test('admin: badges têm texto e cor por token (não dependem só da cor)', () => {
  for (const variant of ['--admin', '--user', '--ok', '--warn']) {
    assert.match(css, new RegExp('\\.a-badge\\' + variant + ' \\{[^}]*color: var\\(--a-'), 'badge ' + variant);
  }
});

// ---------------------------------------------------------------------------
// 5. Tema escuro e acessibilidade
// ---------------------------------------------------------------------------
test('escuro: navegação e banner de erro usam tokens', () => {
  assert.match(css, /\[data-theme="dark"\] \.admin-nav-link\{color:var\(--sy-text-muted\)\}/);
  assert.match(css, /\[data-theme="dark"\] \.admin-nav-link:hover\{color:var\(--sy-brand\)/);
  assert.match(css, /\[data-theme="dark"\] \.a-error\{border-color:rgba\(255,154,144/);
});

test('escuro: regras na raiz, chaves balanceadas e sem inversão de filtro', () => {
  let depth = 0;
  for (const line of css.split('\n')) {
    if (line.trimStart().startsWith('[data-theme="dark"]')) {
      assert.equal(depth, 0, 'regra escura aninhada: ' + line.slice(0, 70));
    }
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
  }
  assert.equal(depth, 0, 'chaves desbalanceadas em admin.css');
  assert.equal(/filter:\s*invert\(/.test(css), false);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.admin-page :focus-visible \{[^}]*outline: var\(--sy-focus-width\) solid var\(--sy-focus\)/);
});

test('admin: ação destrutiva continua visualmente distinta', () => {
  assert.match(css, /\.a-btn--danger \{[^}]*background: var\(--a-danger\)/);
  assert.match(css, /\[data-theme="dark"\] \.a-btn--danger\{background:#A63B35;color:#fff\}/);
});

// ---------------------------------------------------------------------------
// 6. Segurança visual — o guarda [hidden] não pode ser vencido por CSS
// ---------------------------------------------------------------------------
test('admin: [hidden] continua vencendo qualquer display de componente', () => {
  assert.match(css, /\.admin-page \[hidden\] \{ display: none !important; \}/);
  assert.ok(css.indexOf('.admin-page [hidden]') < css.indexOf('.a-btn'), 'guarda declarado antes dos componentes');
});

test('admin: nenhuma regra de CSS promove elementos ocultos da conta', () => {
  // Elementos de conta/menu dependem de [hidden] controlado pelo JS.
  assert.equal(/\.admin-menu[^{]*\{[^}]*display:\s*block\s*!important/.test(css), false);
  assert.equal(/\.admin-modal[^{]*\{[^}]*!important/.test(css), false);
});

// ---------------------------------------------------------------------------
// 7. Contratos preservados das fases anteriores
// ---------------------------------------------------------------------------
test('admin: paleta clara, sidebar e breakpoints intactos', () => {
  assert.match(css, /--a-bg: #f7f7f2/);
  assert.match(css, /--a-navy: #005b7f/);
  assert.match(css, /\.admin-sidebar \{[\s\S]*?linear-gradient\(180deg, #ffffff 0%, #fbfbf8 100%\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
});

test('admin: nenhum token inexistente é referenciado', () => {
  const tokens = read('tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Set([...tokens.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
  const missing = [...new Set([...css.matchAll(/var\((--sy-[a-zA-Z0-9-]+)/g)].map((m) => m[1]))]
    .filter((name) => defined.has(name) === false);
  assert.deepEqual(missing, [], 'tokens sem definição: ' + missing.join(', '));
});
