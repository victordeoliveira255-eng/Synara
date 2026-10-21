// ===========================================================================
// SYNARA — Estrutura e identidade da Central / Painel Administrativo.
// ---------------------------------------------------------------------------
// Testes estáticos (sem navegador) que travam decisões desta reorganização:
//   - 9 seções navegáveis, sem duplicação de "progresso por matéria";
//   - conta/senha/exclusão apenas em Privacidade e dados;
//   - Configurações = preferências + sessão;
//   - paleta clara, sidebar clara, breakpoints preservados;
//   - todos os `data-icon` existem em icons.js (sem emoji como ícone).
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(new URL('../public/' + file, import.meta.url), 'utf8');
const dashboardHtml = read('dashboard.html');
const dashboardJs = read('dashboard.js');
const adminHtml = read('admin.html');
const adminCss = read('admin.css');
const centralCss = read('central.css');
const iconsJs = read('icons.js');

const sections = [...dashboardHtml.matchAll(/data-view="([^"]+)"/g)].map((m) => m[1]);
const navSections = [...dashboardHtml.matchAll(/data-section="([^"]+)"/g)].map((m) => m[1]);

test('central: nove seções, todas navegáveis e com rótulo acessível', () => {
  assert.deepEqual([...new Set(sections)].sort(), [
    'bem-estar', 'configuracoes', 'cronograma', 'inicio', 'materias',
    'mentora', 'metas', 'privacidade', 'progresso'
  ]);
  assert.equal(sections.length, 9);
  const uniqueNav = [...new Set(navSections)];
  assert.deepEqual(uniqueNav.sort(), [...sections].sort());
  const viewsWithLabel = [...dashboardHtml.matchAll(/<section class="dashboard-view[^"]*" data-view="[^"]+" aria-label="[^"]+"/g)];
  assert.equal(viewsWithLabel.length, 9);
});

test('central: progresso por matéria não é duplicado em Progresso', () => {
  assert.equal(dashboardHtml.includes('id="progressSubjects"'), false);
  assert.equal(dashboardJs.includes('progressSubjects'), false);
  // O resumo permanece em Início e a gestão completa em Minhas Matérias.
  assert.equal(dashboardHtml.includes('id="homeSubjects"'), true);
  assert.equal(dashboardHtml.includes('id="subjectList"'), true);
});

test('central: Início resume e aponta para a seção completa', () => {
  for (const target of ['progresso', 'cronograma', 'metas', 'materias']) {
    assert.ok(dashboardHtml.includes('data-goto="' + target + '"'), 'atalho ausente: ' + target);
  }
  assert.equal(dashboardHtml.includes('class="d-card__foot"'), true);
});

test('central: conta, senha e exclusão ficam somente em Privacidade e dados', () => {
  for (const id of ['privacyName', 'privacyEmail', 'privacyRole', 'editProfileBtn', 'changePasswordBtn', 'deleteAccountBtn']) {
    assert.ok(dashboardHtml.includes('id="' + id + '"'), 'elemento ausente em Privacidade: ' + id);
  }
  for (const removed of ['settingsName', 'settingsEmail', 'settingsRole', 'settingsAvatar', 'settingsChangePassword']) {
    assert.equal(dashboardHtml.includes(removed), false, 'duplicação remanescente: ' + removed);
    assert.equal(dashboardJs.includes(removed), false, 'referência remanescente: ' + removed);
  }
});

test('central: Configurações mantém preferências e sessão', () => {
  assert.ok(dashboardHtml.includes('id="learningPrefsForm"'));
  assert.ok(dashboardHtml.includes('id="settingsLogout"'));
  assert.match(dashboardHtml, /Preferências e sessão/);
  assert.match(dashboardHtml, /Gerenciar conta e dados/);
});

test('central: remoção de cartão genérico de privacidade em Configurações', () => {
  const settings = dashboardHtml.slice(dashboardHtml.indexOf('data-view="configuracoes"'));
  const section = settings.slice(0, settings.indexOf('</section>'));
  assert.equal(section.includes('Gerenciar privacidade e dados'), false);
  assert.equal((section.match(/Gerenciar conta e dados/g) || []).length, 1);
});

test('identidade: paleta petróleo/turquesa sobre fundo claro', () => {
  assert.match(centralCss, /--d-bg:\s*#f7f7f2/);
  assert.match(centralCss, /--d-navy:\s*#005b7f/);
  assert.match(centralCss, /--d-teal:\s*#00cfc8/);
  assert.match(adminCss, /--a-bg:\s*#f7f7f2/);
  assert.match(adminCss, /--a-navy:\s*#005b7f/);
});

test('identidade: sidebar clara (sem o bloco azul escuro anterior)', () => {
  assert.equal(centralCss.includes('#07384f'), false);
  assert.equal(adminCss.includes('#052b3f'), false);
  assert.match(centralCss, /\.dashboard-sidebar \{[\s\S]*?linear-gradient\(180deg, #ffffff 0%, #fbfbf8 100%\)/);
  assert.match(adminCss, /\.admin-sidebar \{[\s\S]*?linear-gradient\(180deg, #ffffff 0%, #fbfbf8 100%\)/);
});

test('responsividade: breakpoints preservados nos dois painéis', () => {
  assert.match(centralCss, /@media \(max-width: 900px\)/);
  assert.match(centralCss, /@media \(max-width: 620px\)/);
  assert.match(adminCss, /@media \(max-width: 900px\)/);
  assert.match(adminCss, /@media \(max-width: 620px\)/);
});

test('ícones: todo data-icon existe no catálogo SVG (sem emoji de interface)', () => {
  const keys = [...iconsJs.matchAll(/^\s{4}'?([a-z-]+)'?:/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 40);
  for (const html of [dashboardHtml, adminHtml]) {
    const used = [...new Set([...html.matchAll(/data-icon="([^"]+)"/g)].map((m) => m[1]))];
    const missing = used.filter((name) => keys.indexOf(name) === -1);
    assert.deepEqual(missing, [], 'ícones ausentes: ' + missing.join(','));
  }
});

test('html: IDs únicos em cada página', () => {
  for (const html of [dashboardHtml, adminHtml]) {
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
    assert.deepEqual([...new Set(duplicated)], []);
  }
});
