// ===========================================================================
// SYNARA — Modo escuro: cobertura de CSS e contraste calculado.
// ---------------------------------------------------------------------------
// Sem navegador: verifica os tokens ativos, as regras [data-theme="dark"]
// das seis páginas e calcula os pares de contraste (WCAG 2.1) dos dois temas.
// Não substitui validação visual; é uma rede de segurança objetiva.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const tokensCss = strip(read('tokens.css'));
const styleCss = strip(read('style.css'));
const centralCss = strip(read('central.css'));
const adminCss = strip(read('admin.css'));

function blockOf(css, selector) {
  const start = css.indexOf(selector);
  assert.ok(start !== -1, 'seletor ausente: ' + selector);
  const end = css.indexOf('}', start);
  return css.slice(start, end);
}

const light = blockOf(tokensCss, ':root');
const dark = blockOf(tokensCss, '[data-theme="dark"]');

function token(block, name) {
  const match = block.match(new RegExp(name + ':\\s*(#[0-9A-Fa-f]{6})'));
  assert.ok(match, 'token ausente: ' + name);
  return match[1];
}

// --- WCAG 2.1: luminância relativa e razão de contraste ---------------------
function luminance(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const ratio = (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  return Math.round(ratio * 100) / 100;
}

// ---------------------------------------------------------------------------
// 1. Contraste do tema CLARO (garantindo que o refinamento não regrediu)
// ---------------------------------------------------------------------------
test('contraste claro: texto, secundário, marca e estados acima de AA', () => {
  const pairs = [
    ['--sy-text', '--sy-bg', 4.5],
    ['--sy-text', '--sy-surface', 7],
    ['--sy-text-muted', '--sy-surface', 4.5],
    ['--sy-brand', '--sy-surface', 4.5],
    ['--sy-accent-ink', '--sy-surface', 4.5],
    ['--sy-success', '--sy-success-soft', 4.5],
    ['--sy-warn', '--sy-warn-soft', 4.5],
    ['--sy-danger', '--sy-danger-soft', 4.5]
  ];
  for (const [fg, bg, min] of pairs) {
    const ratio = contrast(token(light, fg), token(light, bg));
    assert.ok(ratio >= min, fg + ' sobre ' + bg + ' = ' + ratio + ':1 (mínimo ' + min + ')');
  }
});

// ---------------------------------------------------------------------------
// 2. Contraste do tema ESCURO
// ---------------------------------------------------------------------------
test('contraste escuro: texto, secundário, marca e estados acima de AA', () => {
  const pairs = [
    ['--sy-text', '--sy-surface', 7],
    ['--sy-text', '--sy-bg', 7],
    ['--sy-text-muted', '--sy-surface', 4.5],
    ['--sy-brand', '--sy-surface', 4.5],
    ['--sy-accent', '--sy-surface', 4.5],
    ['--sy-success', '--sy-success-soft', 4.5],
    ['--sy-warn', '--sy-warn-soft', 4.5],
    ['--sy-danger', '--sy-danger-soft', 4.5]
  ];
  for (const [fg, bg, min] of pairs) {
    const ratio = contrast(token(dark, fg), token(dark, bg));
    assert.ok(ratio >= min, fg + ' sobre ' + bg + ' = ' + ratio + ':1 (mínimo ' + min + ')');
  }
});

test('contraste escuro: botão primário, foco e bordas visíveis', () => {
  assert.ok(contrast('#FFFFFF', token(dark, '--sy-brand-deep')) >= 4.5, 'texto branco no botão primário');
  assert.ok(contrast(token(dark, '--sy-focus'), token(dark, '--sy-surface')) >= 3, 'anel de foco sobre cartão');
  assert.ok(contrast(token(dark, '--sy-focus'), token(dark, '--sy-bg')) >= 3, 'anel de foco sobre o fundo');
  assert.ok(contrast(token(dark, '--sy-border'), token(dark, '--sy-surface')) >= 1.2, 'borda perceptível');
});

test('escuro: superfícies distintas por tom (sem depender de sombra)', () => {
  const bg = token(dark, '--sy-bg');
  const surface = token(dark, '--sy-surface');
  const soft = token(dark, '--sy-surface-soft');
  assert.notEqual(bg, surface);
  assert.notEqual(surface, soft);
  assert.ok(luminance(bg) < luminance(surface), 'surface deve ser mais clara que o fundo');
  assert.ok(luminance(surface) < luminance(soft), 'surface-soft deve ser mais clara que a surface');
});

// ---------------------------------------------------------------------------
// 3. Cobertura das seis páginas
// ---------------------------------------------------------------------------
test('css público: regras escuras cobrem navegação, cartões, formulários e rodapé', () => {
  const required = [
    '[data-theme="dark"] body{',
    '[data-theme="dark"] .site-header{',
    '[data-theme="dark"] .main-nav{',
    '[data-theme="dark"] .button-primary',
    '[data-theme="dark"] .button-ghost{',
    '[data-theme="dark"] .auth-card{',
    '[data-theme="dark"] .form-field input{',
    '[data-theme="dark"] .footer{',
    '[data-theme="dark"] .chat-preview',
    '[data-theme="dark"] .dashboard-window',
    '[data-theme="dark"] .privacy-consent{'
  ];
  for (const selector of required) {
    assert.ok(styleCss.includes(selector), 'regra escura ausente em style.css: ' + selector);
  }
  assert.match(styleCss, /\[data-theme="dark"\]\s*\{--navy:#8FD3EC/, 'petróleo claro para texto no escuro');
  assert.match(styleCss, /\[data-theme="dark"\] \.form-field input::placeholder/, 'placeholder legível');
});

test('css da Central: regras escuras cobrem sidebar, topbar, cartões e toast', () => {
  const required = [
    '[data-theme="dark"] .dashboard-page{',
    '[data-theme="dark"] .dashboard-sidebar{',
    '[data-theme="dark"] .dashboard-topbar{',
    '[data-theme="dark"] .d-mentor{',
    '[data-theme="dark"] .d-toast{',
    '[data-theme="dark"] .d-btn--primary{',
    '[data-theme="dark"] .d-modal__backdrop{'
  ];
  for (const selector of required) {
    assert.ok(centralCss.includes(selector), 'regra escura ausente em central.css: ' + selector);
  }
});

test('css do admin: regras escuras cobrem sidebar, topbar, banner e mensagens', () => {
  const required = [
    '[data-theme="dark"] .admin-page{',
    '[data-theme="dark"] .admin-sidebar{',
    '[data-theme="dark"] .admin-topbar{',
    '[data-theme="dark"] .a-banner{',
    '[data-theme="dark"] .a-toast{',
    '[data-theme="dark"] .a-error{',
    '[data-theme="dark"] .a-modal__backdrop{'
  ];
  for (const selector of required) {
    assert.ok(adminCss.includes(selector), 'regra escura ausente em admin.css: ' + selector);
  }
});

// ---------------------------------------------------------------------------
// 4. Guardas de regressão
// ---------------------------------------------------------------------------
test('css: nenhum filtro global de inversão (evita imagens e logos errados)', () => {
  for (const [name, css] of [['style.css', styleCss], ['central.css', centralCss], ['admin.css', adminCss]]) {
    assert.equal(/filter:\s*invert\(/.test(css), false, name + ': filter: invert não permitido');
  }
});

test('css: contratos do tema claro continuam intactos', () => {
  assert.match(centralCss, /--d-bg:\s*#f7f7f2/);
  assert.match(centralCss, /--d-navy:\s*#005b7f/);
  assert.match(centralCss, /--d-teal:\s*#00cfc8/);
  assert.match(adminCss, /--a-bg:\s*#f7f7f2/);
  assert.match(adminCss, /--a-navy:\s*#005b7f/);
  assert.match(centralCss, /\.dashboard-sidebar \{[\s\S]*?linear-gradient\(180deg, #ffffff 0%, #fbfbf8 100%\)/);
  assert.match(adminCss, /\.admin-sidebar \{[\s\S]*?linear-gradient\(180deg, #ffffff 0%, #fbfbf8 100%\)/);
});

test('css: sidebar e topbar mudam de tom no escuro (não ficam brancas)', () => {
  assert.match(centralCss, /\[data-theme="dark"\] \.dashboard-sidebar\{background:radial-gradient\([\s\S]*?var\(--sy-surface\)/);
  assert.match(adminCss, /\[data-theme="dark"\] \.admin-sidebar\{background:radial-gradient\([\s\S]*?var\(--sy-surface\)/);
  assert.match(centralCss, /\[data-theme="dark"\] \.dashboard-topbar\{background:rgba\(15,42,54/);
  assert.match(adminCss, /\[data-theme="dark"\] \.admin-topbar\{background:rgba\(15,42,54/);
});


test('escuro: preenchimentos de marca e botões de perigo mantêm texto legível', () => {
  // Avatares e bolha do usuário usam glifo/texto branco: o fundo precisa ser profundo.
  assert.match(centralCss, /\[data-theme="dark"\] \.dashboard-avatar[\s\S]*?var\(--sy-brand-deep\)/);
  assert.match(centralCss, /\[data-theme="dark"\] \.d-btn--danger\{background:#A63B35;color:#fff\}/);
  assert.match(adminCss, /\[data-theme="dark"\] \.a-btn--danger\{background:#A63B35;color:#fff\}/);
  // Badges "navy" e avatar amarelo: textos escolhidos por contraste.
  assert.match(centralCss, /\[data-theme="dark"\] \.d-badge--navy\{[^}]*color:#BFE3F2/);
  assert.match(adminCss, /\[data-theme="dark"\] \.a-badge--user\{[^}]*color:#BFE3F2/);
  assert.match(styleCss, /\[data-theme="dark"\] \.avatar-stack b:last-child\{color:#0B2940\}/);
  assert.ok(contrast('#BFE3F2', '#1A4151') >= 4.5, 'badge navy no escuro');
  assert.ok(contrast('#0B2940', '#E8C37A') >= 4.5, 'avatar amarelo no escuro');
  assert.ok(contrast('#FFFFFF', '#A63B35') >= 4.5, 'botão de perigo');
});

test('escuro: superfícies translúcidas do mentor e barras do topo estão cobertas', () => {
  assert.match(centralCss, /\[data-theme="dark"\] \.d-mentor__context\{background:rgba\(18,51,65/);
  assert.match(centralCss, /\[data-theme="dark"\] \.d-mentor__composer\{background:rgba\(15,42,54/);
  assert.match(centralCss, /\[data-theme="dark"\] \.dashboard-sidebar\{color:var\(--sy-text-muted\)\}/);
  assert.match(adminCss, /\[data-theme="dark"\] \.admin-sidebar\{color:var\(--sy-text-muted\)\}/);
});


test('css: as regras [data-theme="dark"] estão na raiz, fora de media queries', () => {
  // Regressão real ocorrida na Fase 4: um bloco escuro foi inserido dentro de
  // @media (prefers-reduced-motion), ficando ativo só para quem reduz movimento.
  for (const [name, css] of [['style.css', styleCss], ['central.css', centralCss], ['admin.css', adminCss]]) {
    let depth = 0;
    for (const line of css.split('\n')) {
      if (line.trimStart().startsWith('[data-theme="dark"]')) {
        assert.equal(depth, 0, name + ': regra escura aninhada -> ' + line.slice(0, 70));
      }
      depth += (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
    }
    assert.equal(depth, 0, name + ': chaves desbalanceadas');
  }
});
