// ===========================================================================
// SYNARA — Contratos da gestão de conta na Central de Estudos
// ---------------------------------------------------------------------------
// Contexto: o commit 28eb738 reorganizou a Central e moveu a edição de nome e
// a alteração de senha da view "Configurações" para "Privacidade e dados".
// Estes testes garantem que as capacidades continuam existindo, ligadas aos
// fluxos reais (auth.js -> rotas autenticadas) e sem autopromoção de papel.
//
// O e-mail é SOMENTE LEITURA por decisão de produto: não existe rota de troca
// de e-mail no backend e nenhum campo editável no frontend. Este arquivo
// documenta esse contrato em vez de inventar um endpoint.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
const readRoot = (file) => fs.readFileSync(new URL('../' + file, import.meta.url), 'utf8');

const html = read('dashboard.html');
const dashboard = read('dashboard.js');
const auth = read('auth.js');
const server = readRoot('server.js');

// Recorta o conteúdo de uma view pelo marcador data-view="<nome>".
function view(nome) {
  const inicio = html.indexOf('data-view="' + nome + '"');
  assert.ok(inicio > -1, 'view ausente: ' + nome);
  const fim = html.indexOf('data-view="', inicio + 10);
  return html.slice(inicio, fim === -1 ? html.length : fim);
}

const conta = view('privacidade');
const configuracoes = view('configuracoes');

// ---------------------------------------------------------------------------
// 1. Edição de nome — presente, rotulada e ligada ao endpoint real
// ---------------------------------------------------------------------------
test('conta: editar nome existe na Central, rotulado e ligado a PUT /api/user/name', () => {
  assert.match(conta, /id="editProfileBtn"/);
  assert.match(conta, /id="profileEditPanel"/);
  assert.match(conta, /<label for="profileNameInput">/);
  assert.match(conta, /id="profileNameInput"[^>]*maxlength="100"/);
  assert.match(conta, /id="profileNameError"/);
  assert.match(conta, /id="profileNameSuccess"/);

  assert.match(dashboard, /#profileNameForm'\)\.addEventListener\('submit'/);
  assert.match(dashboard, /auth\.updateName\(\$\('#profileNameInput'\)\.value\.trim\(\)\)/);
  assert.match(auth, /this\.request\('\/api\/user\/name'/);
  assert.match(server, /app\.put\('\/api\/user\/name', requireAuth/);
});

// ---------------------------------------------------------------------------
// 2. Alteração de senha — presente e exigindo a senha atual no servidor
// ---------------------------------------------------------------------------
test('conta: alterar senha existe e o servidor exige a senha atual', () => {
  for (const id of ['changePasswordBtn', 'passwordEditPanel', 'passwordForm',
                    'currentPassword', 'newPassword', 'confirmPassword']) {
    assert.match(conta, new RegExp('id="' + id + '"'), 'controle ausente: ' + id);
  }
  assert.match(dashboard, /auth\.changePassword\(\$\('#currentPassword'\)\.value, \$\('#newPassword'\)\.value, \$\('#confirmPassword'\)\.value\)/);
  assert.match(auth, /this\.request\('\/api\/user\/password'/);

  assert.match(server, /app\.put\('\/api\/user\/password', requireAuth/);
  assert.match(server, /bcrypt\.compare\(String\(currentPassword\)/, 'senha atual verificada');
  assert.match(server, /token_version = token_version \+ 1/, 'troca invalida as sessões antigas');
});

// ---------------------------------------------------------------------------
// 3. Exclusão de conta e logout continuam ligados
// ---------------------------------------------------------------------------
test('conta: excluir conta e sair continuam ligados aos fluxos autenticados', () => {
  assert.match(conta, /id="deleteAccountBtn"/);
  // O logout permanece no cartão de sessão da view Configurações.
  assert.match(configuracoes, /id="settingsLogout"/);
  assert.match(dashboard, /\$\('#settingsLogout'\)\.addEventListener\('click', doLogout\)/);
  assert.match(server, /app\.delete\('\/api\/account', requireAuth/);
  assert.match(server, /app\.post\('\/api\/auth\/logout'/);
});

// ---------------------------------------------------------------------------
// 4. Sem autopromoção: os fluxos de conta não enviam "role"
// ---------------------------------------------------------------------------
test('conta: nenhum fluxo de conta envia papel (sem autopromoção a admin)', () => {
  for (const nome of ['updateName', 'changePassword']) {
    const inicio = auth.indexOf('async ' + nome + '(');
    assert.ok(inicio > -1, 'método ausente em auth.js: ' + nome);
    const corpo = auth.slice(inicio, auth.indexOf('\n    }', inicio));
    assert.equal(/role/.test(corpo), false, nome + ' não pode enviar role');
  }
  // O papel exibido vem do servidor (somente leitura), nunca de um campo editável.
  assert.match(conta, /id="privacyRole">-</);
  assert.equal(/<input[^>]*id="[^"]*role[^"]*"/.test(html), false, 'papel não é campo editável');
});

// ---------------------------------------------------------------------------
// 5. Relocação (não remoção): Configurações aponta para a gestão de conta
// ---------------------------------------------------------------------------
test('conta: Configurações encaminha para Privacidade e dados (relocação)', () => {
  assert.match(configuracoes, /data-goto="privacidade"/);
  assert.equal(/id="currentPassword"/.test(configuracoes), false,
    'o formulário de senha vive em Privacidade e dados');
  assert.equal(/id="profileNameForm"/.test(configuracoes), false);
  assert.match(conta, /id="privacyManageCard"/);
});

// ---------------------------------------------------------------------------
// 6. E-mail é somente leitura (não existe rota de troca de e-mail)
// ---------------------------------------------------------------------------
test('conta: e-mail permanece somente leitura (sem rota de troca de e-mail)', () => {
  assert.match(conta, /id="privacyEmail">-</);
  assert.equal(/app\.(put|post|patch)\(\s*'\/api\/user\/email'/.test(server), false,
    'nenhuma rota de troca de e-mail foi criada');
  assert.equal(/<input[^>]*type="email"[^>]*id="[^"]*(profile|account|settings)[^"]*"/.test(html), false);
});

// ---------------------------------------------------------------------------
// 7. Progresso por matéria continua renderizado (sucessor de progressSubjects)
// ---------------------------------------------------------------------------
test('progresso: domínio por conteúdo substitui a antiga lista de matérias', () => {
  const progresso = view('progresso');
  assert.match(progresso, /id="progressMastery"/);
  assert.match(progresso, /id="progressMasteryCard"/);
  assert.match(dashboard, /\$\('#progressMastery'\)\.innerHTML/);
  assert.match(dashboard, /class="d-progress-row"/);
  assert.equal(/progressSubjects/.test(html + dashboard), false, 'id antigo não é referenciado');
  assert.match(progresso, /Domínio por conteúdo/);
});
