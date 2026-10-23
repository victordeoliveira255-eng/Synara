// ===========================================================================
// SYNARA — Contratos visuais e de acessibilidade das páginas públicas
// (Home, login/cadastro, recuperação de senha, privacidade).
// ---------------------------------------------------------------------------
// Testes estáticos: garantem que o refinamento da Fase 5 não regrediu
// identidade, acessibilidade, ícones SVG nem os fluxos existentes.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');

const index = read('index.html');
const login = read('login.html');
const reset = read('reset-password.html');
const privacy = read('privacy.html');
const style = read('style.css');

// Recorta da marca até o fim da seção que a contém.
function sectionSlice(html, marker) {
  const start = html.indexOf(marker);
  assert.ok(start > -1, 'marcador ausente: ' + marker);
  const end = html.indexOf('</section>', start);
  return html.slice(start, end);
}

const count = (text, needle) => text.split(needle).length - 1;

// ---------------------------------------------------------------------------
// 1. Home — ícones SVG e conteúdo honesto
// ---------------------------------------------------------------------------
test('home: fórmula, pilares e recursos usam SVG (sem emoji/glifo solto)', () => {
  const formula = sectionSlice(index, 'class="formula"');
  const pillars = sectionSlice(index, 'class="pillar-grid"');
  const features = sectionSlice(index, 'class="feature-list"');

  assert.equal(count(formula, '<svg class="sy-icon"'), 4, 'fórmula com 4 ícones');
  assert.equal(count(pillars, '<svg class="sy-icon"'), 3, 'três pilares com ícone');
  assert.equal(count(features, '<svg class="sy-icon"'), 8, 'oito recursos com ícone');

  for (const emoji of ['📚', '♡', '✦', '◎', '◌', '◒', '▦', '◈', '◷', '≡']) {
    assert.equal(formula.includes(emoji), false, 'emoji/glifo na fórmula: ' + emoji);
    assert.equal(pillars.includes(emoji), false, 'emoji/glifo nos pilares: ' + emoji);
    assert.equal(features.includes(emoji), false, 'emoji/glifo nos recursos: ' + emoji);
  }
  // Ícones decorativos: sempre ocultos para leitores de tela.
  assert.equal(count(formula, 'aria-hidden="true"'), 4);
});

test('home: comunica personalização do conteúdo e da forma de aprender', () => {
  const ai = sectionSlice(index, 'id="ia-chat"');
  assert.match(ai, /ajusta\s*<strong>o que<\/strong>\s*você estuda e\s*<strong>como<\/strong>\s*aprende/);
  assert.match(ai, /preferências/);
  assert.match(ai, /onde erra com mais frequência/);
  assert.match(ai, /retorno que você dá/);
  // Sem diagnóstico clínico nem promessa de resultado.
  for (const forbidden of ['diagnóstico', 'cura', 'garantia de aprovação', 'TDAH']) {
    assert.equal(index.includes(forbidden), false, 'promessa indevida: ' + forbidden);
  }
});

test('home: não exibe status fictício de disponibilidade', () => {
  assert.equal(index.includes('Online para você'), false, 'indicador de "online" removido');
  assert.ok(index.includes('Assistente de estudos'), 'rótulo honesto no topo do chat');
});

// ---------------------------------------------------------------------------
// 2. Tipografia e ritmo (tokens, não valores soltos)
// ---------------------------------------------------------------------------
test('css: hierarquia do título e ritmo das seções usam clamp/tokens', () => {
  assert.match(style, /h1\{font-size:clamp\(2\.65rem,4\.6vw,4\.5rem\)/);
  assert.match(style, /h1,h2\{[^}]*text-wrap:balance/);
  assert.match(style, /\.lead\{[^}]*text-wrap:pretty/);
  assert.match(style, /\.section\{[^}]*padding:clamp\(4\.5rem,7vw,6\.5rem\) 2rem/);
  assert.match(style, /\.section-heading\{[^}]*margin-bottom:clamp\(/);
  assert.match(style, /\.pillar-card:hover\{[^}]*var\(--sy-shadow-md\)/);
});

// ---------------------------------------------------------------------------
// 3. Login e cadastro — contratos preservados + acessibilidade
// ---------------------------------------------------------------------------
test('login: IDs, tipos e obrigatoriedade dos campos permanecem intactos', () => {
  const fields = [
    ['loginEmail', 'type="email"'],
    ['loginPassword', 'type="password"'],
    ['registerName', 'type="text"'],
    ['registerEmail', 'type="email"'],
    ['registerPassword', 'type="password"']
  ];
  for (const [id, type] of fields) {
    const tag = login.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'));
    assert.ok(tag, 'campo ausente: ' + id);
    assert.ok(tag[0].includes(type), id + ' deve manter ' + type);
    assert.ok(tag[0].includes('required'), id + ' deve continuar obrigatório');
  }
  assert.equal(count(login, 'id="loginForm"'), 1);
  assert.equal(count(login, 'id="registerForm"'), 1);
  // O script continua lendo os mesmos IDs (integração com a API intacta).
  for (const id of ['loginEmail', 'loginPassword', 'registerName', 'registerEmail', 'registerPassword']) {
    assert.ok(login.includes("getElementById('" + id + "')"), 'script deve ler ' + id);
  }
});

test('login: autocomplete correto em cada campo', () => {
  const expected = {
    loginEmail: 'email',
    loginPassword: 'current-password',
    registerName: 'name',
    registerEmail: 'email',
    registerPassword: 'new-password'
  };
  for (const [id, value] of Object.entries(expected)) {
    const tag = login.match(new RegExp('<input[^>]*id="' + id + '"[^>]*>'))[0];
    assert.ok(tag.includes('autocomplete="' + value + '"'), id + ' deve ter autocomplete=' + value);
  }
});

test('login: mensagens são anunciadas por leitores de tela', () => {
  assert.match(login, /<p class="form-error" id="loginError" role="alert">/);
  assert.match(login, /<p class="form-error" id="registerError" role="alert">/);
  assert.match(login, /<p class="form-success" id="loginSuccess" role="status">/);
  // Os botões de envio continuam existindo e acessíveis.
  assert.equal(count(login, 'type="submit"'), 2);
  assert.ok(login.includes('id="forgotPasswordBtn"'));
});

// ---------------------------------------------------------------------------
// 4. Recuperação de senha
// ---------------------------------------------------------------------------
test('recuperação: mensagens acessíveis e retorno para o login', () => {
  assert.match(reset, /<p class="form-error" id="resetError" role="alert">/);
  assert.match(reset, /<p class="form-success" id="resetSuccess" role="status">/);
  assert.ok(reset.includes('id="resetPasswordForm"'));
  assert.ok(reset.includes('type="password"'));
  assert.ok(reset.includes('autocomplete="new-password"'), 'campos de nova senha com autocomplete');
  assert.match(reset, /class="auth-back"><a href="login\.html"/);
});

// ---------------------------------------------------------------------------
// 5. Formulários: mensagens visíveis (inclui o caso sem toggle de display)
// ---------------------------------------------------------------------------
test('css: mensagens usam :empty/:not(:empty) e tokens de estado', () => {
  assert.match(style, /\.form-error:empty\{display:none\}/);
  assert.match(style, /\.form-error:not\(:empty\)\{[^}]*display:block[^}]*background:var\(--sy-danger-soft\)[^}]*color:var\(--sy-danger\)/);
  assert.match(style, /\.form-success:empty\{display:none\}/);
  assert.match(style, /\.form-success:not\(:empty\)\{[^}]*background:var\(--sy-success-soft\)[^}]*color:var\(--sy-success\)/);
});

// ---------------------------------------------------------------------------
// 6. Privacidade — legibilidade, contraste e ícones
// ---------------------------------------------------------------------------
test('privacidade: contraste dos subtítulos e medida de leitura', () => {
  assert.match(privacy, /\.privacy-content h3 \{ color: var\(--sy-accent-ink\)/);
  assert.match(privacy, /\.privacy-content p \{[^}]*max-width: 72ch/);
  assert.match(privacy, /\.back-link \{[^}]*color: var\(--sy-accent-ink\)/);
  assert.match(privacy, /@media \(max-width: 720px\)/);
});

test('privacidade: ícones SVG no bloco de contato (sem emoji)', () => {
  for (const emoji of ['📧', '📝', '⏱', '⚖']) {
    assert.equal(privacy.includes(emoji), false, 'emoji no conteúdo: ' + emoji);
  }
  const contact = sectionSlice(privacy, '<div class="privacy-contact">');
  const iconsInBlock = count(contact, '<svg class="sy-icon"');
  assert.ok(iconsInBlock >= 3, 'bloco de contato com ícones SVG (encontrados: ' + iconsInBlock + ')');
  assert.equal(count(contact, 'aria-hidden="true"'), iconsInBlock, 'todos os ícones são decorativos');
});

// ---------------------------------------------------------------------------
// 7. Ícones e tema
// ---------------------------------------------------------------------------
test('ícones: catálogo inclui os símbolos usados pelas páginas públicas', () => {
  for (const key of ['sun', 'moon', 'mail', 'book', 'sparkle', 'target', 'heart', 'compass', 'balance', 'chart', 'layers', 'calendar', 'mentor', 'list', 'bolt', 'activity']) {
    assert.match(iconsSource(), new RegExp('^ {4}' + key + ": '", 'm'), 'ícone ausente: ' + key);
  }
});

function iconsSource() {
  return read('icons.js');
}

test('tema: o botão continua presente e sem alteração de comportamento', () => {
  for (const page of [index, login, reset, privacy]) {
    assert.equal(count(page, 'data-theme-toggle'), 3, 'um botão + duas referências no bootstrap');
    assert.ok(page.includes("localStorage.getItem(KEY) === 'dark'"));
  }
});


// ---------------------------------------------------------------------------
// 8. Fontes e CSP — nenhuma requisição externa bloqueada
// ---------------------------------------------------------------------------
test('fontes: nenhuma página pede fontes externas (CSP inalterada)', () => {
  for (const page of ['index.html', 'login.html', 'reset-password.html', 'privacy.html', 'dashboard.html', 'admin.html']) {
    const html = read(page);
    assert.equal(/href="https?:\/\/fonts\./.test(html), false, page + ': sem <link> para fonts externas');
    assert.equal(/<link[^>]*preconnect/.test(html), false, page + ': sem preconnect externo');
  }
  // A pilha local continua definida no CSS compartilhado.
  assert.match(style, /font-family:'DM Sans',sans-serif/);
  assert.match(style, /font-family:'Plus Jakarta Sans',sans-serif/);
});
