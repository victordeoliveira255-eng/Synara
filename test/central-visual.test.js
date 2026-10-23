// ===========================================================================
// SYNARA — Contratos visuais e estruturais da Central de Estudos (Fase 6).
// ---------------------------------------------------------------------------
// Testes estáticos: garantem que o refinamento não quebrou IDs usados por
// dashboard.js, a hierarquia tipográfica, o estado ativo da navegação,
// o workspace da Mentora e os dois temas. Não substitui validação visual.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');

const html = read('dashboard.html');
const js = read('dashboard.js');
const css = read('central.css');

const count = (text, needle) => text.split(needle).length - 1;

// ---------------------------------------------------------------------------
// 1. Integridade estrutural
// ---------------------------------------------------------------------------
test('central: todos os IDs consultados por dashboard.js continuam no HTML', () => {
  const quote = String.fromCharCode(39);
  const re = new RegExp('\\$\\(' + quote + '#([A-Za-z0-9_-]+)' + quote + '\\)', 'g');
  const ids = [...new Set([...js.matchAll(re)].map((m) => m[1]))];
  assert.ok(ids.length >= 100, 'esperado um conjunto grande de IDs, recebido: ' + ids.length);
  const missing = ids.filter((id) => html.indexOf('id="' + id + '"') < 0);
  assert.deepEqual(missing, [], 'IDs removidos do HTML: ' + missing.join(', '));
});

test('central: nove seções e nove itens de navegação preservados', () => {
  const views = [...new Set([...html.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]))];
  const navItems = [...new Set([...html.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]))];
  assert.equal(views.length, 9, 'seções: ' + views.join(', '));
  assert.deepEqual([...navItems].sort(), [...views].sort(), 'navegação deve cobrir as mesmas seções');
  assert.ok(count(html, 'dashboard-view__head') >= 9, 'cabeçalhos padronizados nas seções');
});

test('central: nenhum emoji como ícone de interface', () => {
  assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(html), false, 'dashboard.html sem emoji');
});

// ---------------------------------------------------------------------------
// 2. Hierarquia tipográfica e ritmo
// ---------------------------------------------------------------------------
test('tipografia: títulos e textos quebram linha com equilíbrio', () => {
  assert.match(css, /\.dashboard-view__head h1 \{[^}]*text-wrap: balance/);
  assert.match(css, /\.dashboard-view__head p \{[^}]*text-wrap: pretty/);
  assert.match(css, /\.d-card__head h2 \{[^}]*text-wrap: balance/);
  assert.match(css, /\.d-card__head p \{[^}]*text-wrap: pretty/);
  assert.match(css, /\.dashboard-view__head \{[^}]*margin-bottom: clamp\(1\.1rem, 2vw, 1\.6rem\)/);
});

// ---------------------------------------------------------------------------
// 3. Navegação: estado ativo não depende só de cor
// ---------------------------------------------------------------------------
test('sidebar: item ativo combina cor, relevo e peso (pista não cromática)', () => {
  assert.match(css, /\.dashboard-nav-link\[aria-current="page"\] \{[^}]*font-weight: 800/);
  assert.match(css, /\.dashboard-nav-link\[aria-current="page"\] \{[^}]*box-shadow: inset/);
  assert.ok(js.includes('aria-current'), 'dashboard.js continua marcando a seção ativa');
  assert.ok(html.includes('aria-label="Recolher menu lateral"'), 'botão de recolher preservado');
});

test('estados vazios: borda tracejada usa token (legível nos dois temas)', () => {
  assert.match(css, /\.d-empty \{[^}]*border: 1px dashed var\(--sy-border-strong\)/);
  assert.equal(css.includes('#c7dbe3'), false, 'literal claro removido');
});

// ---------------------------------------------------------------------------
// 4. Mentora como área de trabalho
// ---------------------------------------------------------------------------
test('mentora: workspace, histórico anunciado e composição preservados', () => {
  assert.match(html, /class="d-mentor">[\s\S]*class="d-mentor__head"/);
  assert.match(html, /id="mentorLog"[^>]*aria-live="polite"/);
  assert.equal(count(html, 'id="mentorForm"'), 1);
  assert.equal(count(html, 'id="mentorInput"'), 1);
  assert.equal(count(html, 'id="mentorSend"'), 1);
  assert.ok(html.includes('class="d-mentor__composer"'));
  assert.match(css, /\.d-mentor \{[^}]*grid-template-rows: auto auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.d-msg__bubble \{[^}]*overflow-wrap: anywhere/);
});

test('mentora: status descreve a função, sem alegar disponibilidade', () => {
  assert.equal(html.includes('> Online<'), false, 'selo "Online" removido');
  assert.ok(html.includes('Assistente de estudos'));
  assert.match(css, /\.d-mentor__status \{[^}]*color: var\(--d-teal-dark\)/);
  assert.equal(/\.d-mentor__status \{[^}]*var\(--d-success\)/.test(css), false, 'sem semântica de status verde');
});

// ---------------------------------------------------------------------------
// 5. Tema escuro — textos que antes ficavam ilegíveis
// ---------------------------------------------------------------------------
test('escuro: navegação, rótulos de grupo e estados âmbar usam tokens', () => {
  assert.match(css, /\[data-theme="dark"\] \.dashboard-nav-link\{color:var\(--sy-text-muted\)\}/);
  assert.match(css, /\[data-theme="dark"\] \.dashboard-nav-link:hover\{color:var\(--sy-brand\)/);
  assert.match(css, /\[data-theme="dark"\] \.dashboard-nav-group__label\{color:var\(--sy-text-muted\)\}/);
  assert.match(css, /\[data-theme="dark"\] \.d-badge--warm\{color:var\(--sy-warn\)\}/);
  assert.match(css, /\[data-theme="dark"\] \.d-pomodoro\[data-state="paused"\][^{]*\{color:var\(--sy-warn\)\}/);
});

test('escuro: regras continuam na raiz, fora de media queries', () => {
  let depth = 0;
  for (const line of css.split('\n')) {
    if (line.trimStart().startsWith('[data-theme="dark"]')) {
      assert.equal(depth, 0, 'regra escura aninhada: ' + line.slice(0, 70));
    }
    depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
  }
  assert.equal(depth, 0, 'chaves desbalanceadas em central.css');
});

// ---------------------------------------------------------------------------
// 6. Contratos protegidos pelas fases anteriores
// ---------------------------------------------------------------------------
test('central: paleta clara e sidebar continuam intactas (contratos de teste)', () => {
  assert.match(css, /--d-bg: #f7f7f2/);
  assert.match(css, /--d-navy: #005b7f/);
  assert.match(css, /--d-teal: #00cfc8/);
  assert.match(css, /\.dashboard-sidebar \{[\s\S]*?linear-gradient\(180deg, #ffffff 0%, #fbfbf8 100%\)/);
  assert.match(css, /@media \(max-width: 900px\)/);
  assert.match(css, /@media \(max-width: 620px\)/);
});

test('central: nenhum token inexistente é referenciado', () => {
  const tokens = read('tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const defined = new Set([...tokens.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
  for (const [, name] of css.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
    defined.add(name); // tokens definidos no próprio central.css (--d-*)
  }
  const missing = [...new Set([...css.matchAll(/var\((--sy-[a-zA-Z0-9-]+)/g)].map((m) => m[1]))]
    .filter((name) => defined.has(name) === false);
  assert.deepEqual(missing, [], 'tokens sem definição: ' + missing.join(', '));
});

test('central: sem filtros de inversão e com movimento reduzido respeitado', () => {
  assert.equal(/filter:\s*invert\(/.test(css), false);
  assert.match(css, /prefers-reduced-motion/);
});
