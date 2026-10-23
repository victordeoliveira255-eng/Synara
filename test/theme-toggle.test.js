// ===========================================================================
// SYNARA — Infraestrutura de tema (claro/escuro) e botão sol/lua.
// ---------------------------------------------------------------------------
// Testes sem navegador e sem rede:
//   • executam o bootstrap REAL extraído do HTML em um DOM mínimo (node:vm);
//   • verificam persistência, alternância e tolerância a localStorage bloqueado;
//   • conferem a presença e a acessibilidade do controle nas seis páginas;
//   • conferem os contratos de CSS e do catálogo de ícones.
// O TEMA ESCURO COMPLETO não é testado aqui: nesta fase ele ainda não existe.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (file) => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');

const PAGES = ['index.html', 'login.html', 'reset-password.html', 'privacy.html', 'dashboard.html', 'admin.html'];
const PUBLIC_PAGES = ['index.html', 'login.html', 'reset-password.html', 'privacy.html'];

// Extrai o bloco <script> que contém o bootstrap de tema (as páginas podem ter
// outros scripts inline, como o menu da Home).
function themeScript(html) {
  const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const found = blocks.find((block) => block.includes('synara-theme'));
  assert.ok(found, 'bootstrap de tema não encontrado no HTML');
  return found;
}

// DOM mínimo: só o que o bootstrap usa (documentElement, querySelectorAll,
// addEventListener, readyState) + localStorage controlável.
function makeEnv(store, options = {}) {
  const rootAttrs = {};
  const root = {
    setAttribute(name, value) { rootAttrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(rootAttrs, name) ? rootAttrs[name] : null; }
  };
  const button = {
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  };
  const listeners = {};
  const document = {
    documentElement: root,
    readyState: options.readyState || 'complete',
    querySelectorAll(selector) { return selector === '[data-theme-toggle]' ? [button] : []; },
    addEventListener(type, handler) { (listeners[type] = listeners[type] || []).push(handler); }
  };
  const localStorage = store === null
    ? {
        getItem() { throw new Error('storage bloqueado'); },
        setItem() { throw new Error('storage bloqueado'); }
      }
    : {
        getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
        setItem(key, value) { store[key] = String(value); }
      };

  return { sandbox: { document, window: { localStorage }, localStorage, console }, rootAttrs, button, listeners };
}

function runBootstrap(store, options) {
  const env = makeEnv(store, options);
  vm.runInNewContext(themeScript(read('index.html')), env.sandbox, { timeout: 1000 });
  return env;
}

function click(env) {
  const handlers = env.listeners.click || [];
  assert.equal(handlers.length, 1, 'deve existir exatamente um handler de clique');
  handlers[0]({ target: { closest: (selector) => (selector === '[data-theme-toggle]' ? env.button : null) } });
}

// ---------------------------------------------------------------------------
// 1. Comportamento do bootstrap
// ---------------------------------------------------------------------------
test('tema: sem preferência salva, inicia no claro', () => {
  const env = runBootstrap({});
  assert.equal(env.rootAttrs['data-theme'], 'light');
  assert.equal(env.button.attrs['aria-pressed'], 'false');
  assert.equal(env.button.attrs['aria-label'], 'Ativar tema escuro');
  assert.equal(env.button.attrs.title, 'Ativar tema escuro');
});

test('tema: preferência salva "light" permanece clara', () => {
  const env = runBootstrap({ 'synara-theme': 'light' });
  assert.equal(env.rootAttrs['data-theme'], 'light');
  assert.equal(env.button.attrs['aria-pressed'], 'false');
});

test('tema: preferência salva "dark" restaura o escuro', () => {
  const env = runBootstrap({ 'synara-theme': 'dark' });
  assert.equal(env.rootAttrs['data-theme'], 'dark');
  assert.equal(env.button.attrs['aria-pressed'], 'true');
  assert.equal(env.button.attrs['aria-label'], 'Ativar tema claro');
  assert.equal(env.button.attrs.title, 'Ativar tema claro');
});

test('tema: valor inválido no storage cai no claro (sem quebrar)', () => {
  for (const invalid of ['', 'DARK', 'solar', 'true', '{}']) {
    const env = runBootstrap({ 'synara-theme': invalid });
    assert.equal(env.rootAttrs['data-theme'], 'light', 'valor inesperado: ' + invalid);
  }
});

test('tema: clique alterna, persiste e atualiza os atributos acessíveis', () => {
  const store = {};
  const env = runBootstrap(store);
  assert.equal(env.rootAttrs['data-theme'], 'light');

  click(env);
  assert.equal(env.rootAttrs['data-theme'], 'dark');
  assert.equal(store['synara-theme'], 'dark');
  assert.equal(env.button.attrs['aria-pressed'], 'true');
  assert.equal(env.button.attrs['aria-label'], 'Ativar tema claro');

  click(env);
  assert.equal(env.rootAttrs['data-theme'], 'light');
  assert.equal(store['synara-theme'], 'light');
  assert.equal(env.button.attrs['aria-pressed'], 'false');
  assert.equal(env.button.attrs['aria-label'], 'Ativar tema escuro');
});

test('tema: apenas a chave synara-theme é gravada', () => {
  const store = {};
  const env = runBootstrap(store);
  click(env);
  assert.deepEqual(Object.keys(store), ['synara-theme']);
});

test('tema: clique fora do botão não altera nada', () => {
  const store = {};
  const env = runBootstrap(store);
  const handler = (env.listeners.click || [])[0];
  handler({ target: { closest: () => null } });
  assert.equal(env.rootAttrs['data-theme'], 'light');
  assert.deepEqual(Object.keys(store), []);
});

test('tema: localStorage bloqueado não lança erro e mantém o claro', () => {
  const env = runBootstrap(null);
  assert.equal(env.rootAttrs['data-theme'], 'light');
  assert.doesNotThrow(() => click(env));
});

test('tema: com DOM ainda carregando, os atributos são sincronizados no DOMContentLoaded', () => {
  const env = runBootstrap({ 'synara-theme': 'dark' }, { readyState: 'loading' });
  assert.equal(env.rootAttrs['data-theme'], 'dark');
  const ready = (env.listeners.DOMContentLoaded || []);
  assert.equal(ready.length, 1, 'deve registrar um único listener de DOMContentLoaded');
  ready[0]();
  assert.equal(env.button.attrs['aria-pressed'], 'true');
  assert.equal(env.button.attrs['aria-label'], 'Ativar tema claro');
});

// ---------------------------------------------------------------------------
// 2. Presença e acessibilidade do controle nas seis páginas
// ---------------------------------------------------------------------------
test('html: as seis páginas têm exatamente um botão de tema', () => {
  for (const page of PAGES) {
    const html = read(page);
    assert.equal([...html.matchAll(/<button[^>]*data-theme-toggle/g)].length, 1, page + ': exatamente 1 botão de tema');
    assert.match(html, /<button[^>]*class="sy-theme-toggle"[^>]*type="button"[^>]*data-theme-toggle/, page + ': classe e type=button');
    assert.match(html, /<button[^>]*data-theme-toggle[^>]*aria-label="Ativar tema escuro"/, page + ': nome acessível inicial');
    assert.match(html, /<button[^>]*data-theme-toggle[^>]*aria-pressed="false"/, page + ': estado inicial coerente');
    assert.match(html, /<button[^>]*data-theme-toggle[^>]*title="Ativar tema escuro"/, page + ': title útil');
  }
});

test('html: o botão tem os dois ícones decorativos (sol e lua), sem emoji', () => {
  for (const page of PAGES) {
    const html = read(page);
    const start = html.indexOf('sy-theme-toggle');
    const block = html.slice(start, html.indexOf('</button>', start));
    assert.match(block, /class="sy-theme-toggle__icon is-sun"/, page + ': ícone de sol');
    assert.match(block, /class="sy-theme-toggle__icon is-moon"/, page + ': ícone de lua');
    assert.equal((block.match(/aria-hidden="true"/g) || []).length, 2, page + ': ícones decorativos');
    assert.equal(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(block), false, page + ': sem emoji como ícone');
  }
});

test('html: o controle fica no cabeçalho e fora do menu colapsável', () => {
  for (const page of PAGES) {
    const html = read(page);
    const headerOpen = html.indexOf('<header');
    const headerClose = html.indexOf('</header>');
    assert.ok(headerOpen !== -1 && headerClose > headerOpen, page + ': cabeçalho presente');
    const header = html.slice(headerOpen, headerClose);
    assert.ok(header.includes('data-theme-toggle'), page + ': botão dentro do cabeçalho');
    if (PUBLIC_PAGES.includes(page)) {
      // No mobile o menu vira display:none; o botão precisa vir ANTES dele.
      assert.ok(header.indexOf('data-theme-toggle') < header.indexOf('<nav'), page + ': botão fora do menu colapsável');
    }
  }
});

test('html: o bootstrap roda antes da folha de estilos (evita flash)', () => {
  for (const page of PAGES) {
    const html = read(page);
    const scriptAt = html.indexOf('synara-theme');
    const cssAt = html.indexOf('href="style.css"');
    assert.ok(scriptAt !== -1, page + ': bootstrap presente');
    assert.ok(cssAt !== -1, page + ': style.css presente');
    assert.ok(scriptAt < cssAt, page + ': bootstrap antes do CSS');
  }
});

test('html: todas as páginas usam exatamente o mesmo bootstrap', () => {
  const normalize = (text) => text.replace(/\r\n/g, '\n').trim();
  const reference = normalize(themeScript(read('index.html')));
  for (const page of PAGES) {
    assert.equal(normalize(themeScript(read(page))), reference, page + ': bootstrap idêntico');
  }
});

// ---------------------------------------------------------------------------
// 3. Contratos de CSS, tokens e catálogo de ícones
// ---------------------------------------------------------------------------
test('css: o controle tem 44px, hover com token e troca de ícone por data-theme', () => {
  const css = read('style.css');
  assert.match(css, /\.sy-theme-toggle\{[^}]*width:44px;height:44px/, 'área clicável de 44x44');
  assert.match(css, /\.sy-theme-toggle\{[^}]*cursor:pointer/, 'cursor de botão');
  assert.match(css, /\.sy-theme-toggle:hover\{[^}]*border-color:var\(--sy-border-strong\)/, 'hover com token');
  assert.match(css, /\[data-theme="dark"\] \.sy-theme-toggle \.is-sun\{display:none\}/, 'sol escondido no escuro');
  assert.match(css, /\[data-theme="dark"\] \.sy-theme-toggle \.is-moon\{display:block\}/, 'lua visível no escuro');
  assert.match(css, /\.site-header \.sy-theme-toggle\{margin-left:auto\}/, 'posicionamento no cabeçalho público');
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.sy-theme-toggle\{transition:none\}/, 'respeita movimento reduzido');
});

test('css: o bloco de tokens escuros está ativo e o claro segue como padrão', () => {
  const tokens = read('tokens.css');
  const active = tokens.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(active, /\[data-theme="dark"\]\s*\{/, 'bloco escuro ativo');
  assert.match(active, /color-scheme:\s*dark/, 'color-scheme escuro');
  const dark = active.slice(active.indexOf('[data-theme="dark"]'));
  for (const token of ['--sy-bg', '--sy-surface', '--sy-text', '--sy-text-muted', '--sy-border', '--sy-brand', '--sy-field-bg', '--sy-focus', '--sy-success', '--sy-danger']) {
    assert.ok(new RegExp(token + '\\s*:').test(dark), 'token escuro ausente: ' + token);
  }
  // O claro permanece como padrão (sem o atributo, os valores de :root valem).
  assert.match(active, /^:root\s*\{/m);
  assert.match(active, /--sy-bg:\s*#F5F8F8/);
  assert.match(active, /--sy-text:\s*#12303B/);
});

test('icons.js: expõe sun e moon no catálogo, no padrão existente', () => {
  const icons = read('icons.js');
  assert.match(icons, /^ {4}sun: '<circle cx="12" cy="12" r="4"\/>/m);
  assert.match(icons, /^ {4}moon: '<path d="M20\.5 14\.5/m);
  const keys = [...icons.matchAll(/^\s{4}'?([a-z-]+)'?:/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 40);
  assert.ok(keys.includes('sun') && keys.includes('moon'));
});

test('tema: o bootstrap não toca em auth, sessão, API ou outros dados', () => {
  const script = themeScript(read('index.html'));
  for (const forbidden of ['sessionStorage', 'fetch(', '/api/', 'token', 'password', 'synara_current_user']) {
    assert.equal(script.includes(forbidden), false, 'bootstrap não deve tocar em: ' + forbidden);
  }
});
