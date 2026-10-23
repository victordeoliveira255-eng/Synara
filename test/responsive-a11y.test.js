// ===========================================================================
// SYNARA — Contratos de responsividade e acessibilidade global (Fase 8)
// ---------------------------------------------------------------------------
// Testes estáticos que travam os problemas concretos corrigidos na Fase 8:
// transbordamento horizontal em telas de 320px, cabeçalho público sem menu
// colapsado em tablet, alvos de toque pequenos, contraste do rótulo de
// demonstração e hierarquia de títulos nas páginas de autenticação.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');

const style = read('style.css');
const central = read('central.css');
const admin = read('admin.css');
const login = read('login.html');
const reset = read('reset-password.html');

const count = (text, needle) => text.split(needle).length - 1;

// ---------------------------------------------------------------------------
// 1. Grade da Central e do painel não transborda em 320px
//    minmax(320px, 1fr) força uma coluna de 320px dentro de um container
//    de ~288px (320 - paddings) => rolagem lateral.
// ---------------------------------------------------------------------------
test('grades: nenhuma coluna mínima fixa maior que a viewport estreita', () => {
  for (const [nome, css] of [['central.css', central], ['admin.css', admin]]) {
    assert.equal(/minmax\(\s*(?:3[2-9]\d|[4-9]\d\d|\d{4,})px/.test(css), false,
      nome + ': minmax com mínimo fixo grande provoca overflow em 320px');
    assert.equal(/minmax\(\s*2[89]\dpx/.test(css), false,
      nome + ': mínimo de 280px+ não cabe no container de 288px');
  }
  assert.match(central, /\.d-grid--2 \{[^}]*minmax\(min\(320px, 100%\), 1fr\)/);
  assert.match(central, /\.d-grid--cards \{[^}]*minmax\(min\(280px, 100%\), 1fr\)/);
  assert.match(admin, /\.a-grid--2 \{[^}]*minmax\(min\(320px, 100%\), 1fr\)/);
});

// ---------------------------------------------------------------------------
// 2. Cabeçalho público colapsa antes do tablet (768px)
//    Com 5 links + 2 ações o cabeçalho precisa de ~900px; o menu hambúrguer
//    só existia até 680px, então em 768px a chamada principal era cortada.
// ---------------------------------------------------------------------------
test('cabeçalho: menu colapsado cobre o tablet (breakpoint de 960px)', () => {
  const inicio960 = style.indexOf('@media(max-width:960px)');
  const inicio680 = style.indexOf('@media(max-width:680px)');

  assert.ok(inicio960 > -1, 'bloco de 960px ausente');
  assert.ok(inicio680 > inicio960, 'bloco de 680px deve vir depois do de 960px');

  const bloco960 = style.slice(inicio960, inicio680);
  assert.ok(bloco960.includes('.menu-toggle{display:grid'), 'hambúrguer precisa existir em 960px');
  assert.ok(bloco960.includes('.main-nav{position:absolute'), 'menu móvel precisa estar no bloco de 960px');
  assert.ok(bloco960.includes('.main-nav.is-open{display:grid}'), 'estado aberto do menu em 960px');
  assert.ok(bloco960.includes('.nav-actions{display:grid'), 'ações do menu empilhadas em 960px');

  // O bloco de 680px não deve ser o único responsável pelo menu colapsado.
  const bloco680 = style.slice(inicio680);
  assert.equal(bloco680.includes('.main-nav{position:absolute'), false,
    'regra duplicada do menu móvel no bloco de 680px');
});

// ---------------------------------------------------------------------------
// 3. Alvos de toque mínimos em controles usados no celular
// ---------------------------------------------------------------------------
test('alvos de toque: hambúrguer e link "esqueci a senha" com área adequada', () => {
  assert.match(style, /\.menu-toggle\{[^}]*min-width:44px/);
  assert.match(style, /\.menu-toggle\{[^}]*min-height:44px/);
  assert.match(style, /\.link-forgot-password\{[^}]*padding:\.35rem 0/);
  // Links do menu móvel ganham altura de toque sem alterar o visual.
  const bloco960 = style.slice(style.indexOf('@media(max-width:960px)'));
  assert.ok(bloco960.includes('.main-nav>a{padding:.4rem 0}'), 'links do menu móvel com área de toque');
});

// ---------------------------------------------------------------------------
// 4. Rótulo de demonstração com contraste AA nos dois temas
//    #9a7022 sobre #fff3d4 = 4.03:1 (reprovava para texto de 9,6px).
// ---------------------------------------------------------------------------
test('rótulo de demonstração usa tokens semânticos (contraste AA)', () => {
  assert.match(style, /\.demo-label\{[^}]*color:var\(--sy-warn\)/);
  assert.match(style, /\.demo-label\{[^}]*background:var\(--sy-warn-soft\)/);
  assert.equal(style.includes('#9a7022'), false, 'cor literal de baixo contraste removida');
  assert.equal(style.includes('#fff3d4'), false, 'fundo literal substituído pelo token');
  // Sem duplicação de override dark: o token já resolve os dois temas.
  assert.equal(style.includes('[data-theme="dark"] .demo-label'), false);
});

// ---------------------------------------------------------------------------
// 5. Hierarquia de títulos nas páginas de autenticação
// ---------------------------------------------------------------------------
test('login e recuperação de senha têm um único h1 e nenhum salto de nível', () => {
  for (const [nome, html] of [['login.html', login], ['reset-password.html', reset]]) {
    assert.equal(count(html, '<h1>'), 1, nome + ': precisa de exatamente um h1');

    const h1 = html.indexOf('<h1>');
    const primeiroH2 = html.indexOf('<h2>');
    const primeiroH3 = html.indexOf('<h3>');
    if (primeiroH2 > -1) assert.ok(h1 < primeiroH2, nome + ': h1 antes do primeiro h2');
    if (primeiroH2 > -1 && primeiroH3 > -1) {
      assert.ok(primeiroH3 > primeiroH2, nome + ': h3 não pode aparecer antes de um h2');
    }
  }
  // O título do documento continua estilizado como antes (sem h2 órfão).
  assert.match(style, /\.auth-header h1,\.auth-header h2\{/);
  assert.match(style, /\.auth-panel-head h2,\.auth-panel-head h3\{/);
  // Cabeçalhos de rodapé são seções de nível 2 em todas as páginas públicas.
  assert.match(style, /\.footer-inner h2,\.footer-inner h3\{/);
  for (const [nome, html] of [['login.html', login], ['privacy.html', read('privacy.html')]]) {
    assert.equal(html.includes('<h3'), false, nome + ': rodapé não deve usar h3');
    assert.equal(count(html, '<h2>Links rápidos</h2>'), 1, nome + ': rodapé com h2');
  }
});
// ---------------------------------------------------------------------------
// 6. Nenhuma largura em viewport inteira (100vw) gerando rolagem lateral
// ---------------------------------------------------------------------------
test('layouts: sem width:100vw em nenhuma folha de estilo ativa', () => {
  for (const [nome, css] of [['style.css', style], ['central.css', central], ['admin.css', admin]]) {
    assert.equal(/width:\s*100vw/.test(css), false, nome + ': 100vw ignora a barra de rolagem');
  }
});



// ---------------------------------------------------------------------------
// 7. Contraste do texto sobre os pilares (claro e escuro)
//    #8cb4ba sobre #004A68 = 4.29:1 e sobre #126A8A = 2.71:1 (reprovava).
// ---------------------------------------------------------------------------
function canal(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminancia([r, g, b]) {
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function hexParaRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

function sobre(branco, fundo) {
  return fundo.map((c) => Math.round(255 * branco + c * (1 - branco)));
}

function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

test('contraste: numeração do pilar em destaque atinge 4,5:1 nos dois temas', () => {
  assert.match(style, /\.pillar-featured \.card-number\{color:rgba\(255,255,255,\.82\)\}/);
  for (const fundo of ['#004A68', '#126A8A']) {
    const texto = sobre(0.82, hexParaRgb(fundo));
    assert.ok(contraste(texto, hexParaRgb(fundo)) >= 4.5,
      'numeração ilegível sobre ' + fundo);
  }
});

test('contraste: badges âmbar e estado pausado usam --sy-warn (sem literal)', () => {
  assert.equal(central.includes('#a8791d'), false, 'literal âmbar reprovado removido');
  assert.match(central, /\.d-badge--warm \{ background: [^}]*color: var\(--sy-warn\)/);
  assert.match(central, /\.d-pomodoro\[data-state="paused"\] \.d-pomodoro__center span \{ color: var\(--sy-warn\)/);
});


// ---------------------------------------------------------------------------
// 8. Glifos decorativos do fluxo de bem-estar não são lidos por leitores de tela
// ---------------------------------------------------------------------------
test('home: setas do fluxo e pontos da janela são decorativos (aria-hidden)', () => {
  const index = read('index.html');
  assert.equal(index.includes('<i>↓</i>'), false, 'seta sem aria-hidden');
  assert.equal(index.split('<i aria-hidden="true">↓</i>').length - 1, 3);
  assert.match(index, /<span class="chat-top-dots" aria-hidden="true">/);
});

// ---------------------------------------------------------------------------
// 10. Cabeçalho público cabe em 320px (marca + tema 44px + menu 44px + gaps)
// ---------------------------------------------------------------------------
test('cabeçalho: largura disponível em 320px respeitada nos dois modelos', () => {
  assert.match(style, /@media\(max-width:680px\)\{\.site-header\{padding:\.8rem 1\.1rem;gap:\.75rem\}/);

  const i420 = style.indexOf('@media(max-width:420px)');
  const i680 = style.indexOf('@media(max-width:680px)');
  assert.ok(i420 > i680, 'bloco de 420px deve vir depois do de 680px (cascata)');

  const bloco420 = style.slice(i420, style.indexOf('\n', i420) + 1);
  assert.ok(bloco420.includes('.site-header .brand-text small{display:none}'),
    'tagline deve sair abaixo de 420px');
  assert.ok(bloco420.includes('.cta-header{padding:.6rem .8rem}'),
    'atalho "Ver painel" precisa caber em 320px');
  // O gap grande da base não pode ser reintroduzido no bloco móvel.
  assert.equal(/@media\(max-width:680px\)\{[^}]*\.site-header\{[^}]*gap:2rem/.test(style), false);
});

// ---------------------------------------------------------------------------
// 11. Conteúdo longo (e-mail) não estoura a coluna no celular
// ---------------------------------------------------------------------------
test('privacidade: texto longo quebra linha em vez de vazar do contêiner', () => {
  const privacy = read('privacy.html');
  assert.match(privacy, /\.privacy-content \{[^}]*overflow-wrap: break-word/);
});
