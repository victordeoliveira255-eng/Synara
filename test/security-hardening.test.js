// ===========================================================================
// SYNARA — Testes do P0 de seguranca (renderizacao segura + validacao de
// bem-estar). Runner nativo do Node, SEM navegador, SEM rede, SEM banco.
//
// Como nao existe dependencia de DOM no projeto (e nao vamos instalar uma),
// estes testes:
//   1) exercitam a funcao REAL de public/script.js dentro de um DOM minimo
//      implementado aqui;
//   2) extraem o bloco REAL de renderizacao de public/dashboard.js e o avaliam
//      com as mesmas dependencias que ele recebe no app (icon/strategyLabel);
//   3) extraem a funcao REAL validateWellbeing de server.js e a exercitam.
// Nao ha reimplementacao da logica sob teste: o codigo executado e o do repo.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const dashSrc = fs.readFileSync(new URL('../public/dashboard.js', import.meta.url), 'utf8');
const scriptSrc = fs.readFileSync(new URL('../public/script.js', import.meta.url), 'utf8');
// Normaliza CRLF apenas para facilitar a extracao de trechos do server.js.
const serverSrc = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// DOM minimo: apenas o que os renderizadores usam. `innerHTML` e registrado
// (nunca avaliado) para que seja possivel provar que o texto nao passou por ele.
// ---------------------------------------------------------------------------
function makeElement(tagName) {
  const el = {
    tagName: String(tagName),
    className: '',
    type: '',
    disabled: false,
    children: [],
    attributes: {},
    _text: '',
    _html: '',
    set textContent(value) { this._text = value == null ? '' : String(value); this.children = []; },
    get textContent() { return this._text + this.children.map((child) => child.textContent).join(''); },
    set innerHTML(value) { this._html = value == null ? '' : String(value); },
    get innerHTML() { return this._html; },
    setAttribute(key, value) { this.attributes[key] = value == null ? '' : String(value); },
    getAttribute(key) { return Object.prototype.hasOwnProperty.call(this.attributes, key) ? this.attributes[key] : null; },
    appendChild(child) { this.children.push(child); return child; }
  };
  return el;
}

function makeDocument(overrides = {}) {
  const created = [];
  const doc = {
    created,
    createElement(tag) { const el = makeElement(tag); created.push(el); return el; },
    createTextNode(value) { const node = makeElement('#text'); node._text = value == null ? '' : String(value); return node; },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    ...overrides
  };
  return doc;
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach((item) => walk(item, visit)); return; }
  visit(node);
  if (Array.isArray(node.children)) node.children.forEach((child) => walk(child, visit));
}

function assertNoExecutableMarkup(rootNode, payload) {
  walk(rootNode, (node) => {
    if (typeof node._html === 'string' && node._html) {
      assert.ok(!node._html.includes('<img'), 'HTML gravado continha <img>: ' + node._html);
      assert.ok(!node._html.includes('<script'), 'HTML gravado continha <script>: ' + node._html);
      assert.ok(!node._html.includes('onerror'), 'HTML gravado continha onerror: ' + node._html);
      assert.ok(!node._html.includes(payload), 'O payload foi gravado como HTML, nao como texto.');
    }
  });
}

// ---------------------------------------------------------------------------
// 1. public/dashboard.js — mentorMessageNode (resposta da Mentora)
// ---------------------------------------------------------------------------
function loadMentorMessageNode() {
  const start = dashSrc.indexOf('  function mentorExerciseNode(message) {');
  const end = dashSrc.indexOf('  function scrollMentorLog() {');
  assert.ok(start !== -1 && end !== -1 && end > start, 'Nao foi possivel localizar o bloco de renderizacao de mensagens.');
  const block = dashSrc.slice(start, end);
  const factory = new Function('document', 'icon', 'strategyLabel',
    block + '\nreturn { mentorMessageNode, mentorExerciseNode, mentorToolsNode };');
  const fakeIcon = '<svg class="dashboard-icon"></svg>';
  return factory(makeDocument(), () => fakeIcon, (key) => String(key));
}

test('dashboard: resposta do bot entra como texto, nunca como HTML', () => {
  const { mentorMessageNode } = loadMentorMessageNode();
  const payload = '<img src=x onerror=alert(1)>';
  const node = mentorMessageNode({ id: 1, role: 'bot', kind: 'text', text: payload });
  const content = node.children.find((child) => child.className === 'd-msg__content');
  const bubble = content.children.find((child) => child.className === 'd-msg__bubble');
  assert.ok(bubble, 'bolha da mensagem nao encontrada');
  assert.equal(bubble.textContent, payload);
  assert.equal(bubble.innerHTML, '');
  assertNoExecutableMarkup(node, payload);
});

test('dashboard: mensagem do usuario entra como texto', () => {
  const { mentorMessageNode } = loadMentorMessageNode();
  const payload = '<script>alert(1)</script>';
  const node = mentorMessageNode({ id: 2, role: 'user', text: payload });
  const content = node.children.find((child) => child.className === 'd-msg__content');
  const bubble = content.children.find((child) => child.className === 'd-msg__bubble');
  assert.equal(bubble.textContent, payload);
  assertNoExecutableMarkup(node, payload);
});

test('dashboard: quebras de linha e acentos sao preservados no texto', () => {
  const { mentorMessageNode } = loadMentorMessageNode();
  const texto = 'Passo 1: função\nPasso 2: equação\n\t- item com ação';
  const node = mentorMessageNode({ id: 3, role: 'bot', kind: 'text', text: texto });
  const content = node.children.find((child) => child.className === 'd-msg__content');
  const bubble = content.children.find((child) => child.className === 'd-msg__bubble');
  assert.equal(bubble.textContent, texto);
  assert.ok(bubble.textContent.includes('\n'));
  assert.ok(bubble.textContent.includes('função'));
});

test('dashboard: enunciado, alternativas e explicacao do exercicio sao texto', () => {
  const { mentorMessageNode } = loadMentorMessageNode();
  const badQuestion = '<b>Pergunta</b>';
  const badOption = '<img src=x onerror=alert(1)>';
  const badExplanation = '<script>alert(1)</script>';
  const node = mentorMessageNode({
    id: 4,
    role: 'bot',
    kind: 'exercise',
    text: 'Vamos praticar com uma questão rápida.',
    exercise: { question: badQuestion, options: [badOption, 'Alternativa correta'], correctOption: 0, explanation: badExplanation }
  });
  const content = node.children.find((child) => child.className === 'd-msg__content');
  const exercise = content.children.find((child) => child.className === 'd-exercise');
  assert.ok(exercise, 'bloco de exercicio nao encontrado');
  assert.equal(exercise.textContent.includes(badQuestion), true);
  const options = exercise.children.find((child) => child.className === 'd-exercise__options');
  const optionLabels = options.children.map((button) => button.children[1].textContent);
  assert.deepEqual(optionLabels, [badOption, 'Alternativa correta']);
  assertNoExecutableMarkup(node, badOption);
});

test('dashboard: fonte nao reutiliza o padrao inseguro (guarda de regressao)', () => {
  assert.ok(!dashSrc.includes(': message.text)'), 'padrao antigo de concatenacao crua do texto do bot reapareceu');
  assert.ok(dashSrc.includes('bubble.textContent ='), 'a bolha deve ser preenchida via textContent');
  assert.ok(!dashSrc.includes('.map(mentorMessageHtml)'), 'renderMentorLog deve anexar nos DOM, nao montar HTML');
});

// ---------------------------------------------------------------------------
// 2. public/script.js — appendMessage (chat da pagina publica)
// ---------------------------------------------------------------------------
function loadAppendMessage() {
  const root = makeElement('div');
  const doc = makeDocument({ getElementById: (id) => (id === 'chatMessages' ? root : null) });
  const context = vm.createContext({ document: doc, console, window: {}, fetch: () => Promise.resolve(), setTimeout, clearTimeout });
  vm.runInContext(scriptSrc, context, { filename: 'public/script.js' });
  return { context, root, doc };
}

test('script.js: texto do usuario entra como texto (nunca HTML)', () => {
  const { context, root, doc } = loadAppendMessage();
  const payload = '<img src=x onerror=alert(1)>';
  vm.runInContext(`appendMessage('user', ${JSON.stringify(payload)})`, context);
  const messageEl = root.children[0];
  assert.ok(messageEl, 'mensagem nao foi anexada');
  const bubble = doc.created.find((el) => el.className === 'chat-bubble');
  assert.ok(bubble, 'bolha do chat nao encontrada');
  assert.equal(bubble.textContent, payload);
  assert.equal(bubble.innerHTML, '');
  assertNoExecutableMarkup(messageEl, payload);
});

test('script.js: indicador de processamento continua sendo texto simples', () => {
  const { context, doc } = loadAppendMessage();
  vm.runInContext("appendMessage('bot', 'Pensando...')", context);
  const bubble = doc.created.filter((el) => el.className === 'chat-bubble').pop();
  assert.equal(bubble.textContent, 'Pensando...');
});

test('script.js: appendMessage nao usa innerHTML (guarda de regressao)', () => {
  const start = scriptSrc.indexOf('function appendMessage(');
  const end = scriptSrc.indexOf('function fallbackResponse(');
  assert.ok(start !== -1 && end !== -1 && end > start, 'appendMessage nao localizada');
  const body = scriptSrc.slice(start, end);
  assert.ok(!body.includes('innerHTML'), 'appendMessage voltou a usar innerHTML');
  assert.ok(body.includes('textContent'), 'appendMessage deve usar textContent');
});

// ---------------------------------------------------------------------------
// 3. server.js — validateWellbeing
// ---------------------------------------------------------------------------
function loadValidateWellbeing() {
  const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const moodsMatch = serverSrc.match(/const WELLBEING_MOODS = (\[[^\]]*\]);/);
  assert.ok(moodsMatch, 'constante WELLBEING_MOODS nao encontrada');
  const WELLBEING_MOODS = new Function('return ' + moodsMatch[1])();
  const start = serverSrc.indexOf('function validateWellbeing(value) {');
  assert.ok(start !== -1, 'validateWellbeing nao encontrada');
  const end = serverSrc.indexOf('\n}\n', start);
  assert.ok(end !== -1, 'fim de validateWellbeing nao encontrado');
  const block = serverSrc.slice(start, end + 3);
  const factory = new Function('isPlainObject', 'WELLBEING_MOODS', block + '\nreturn validateWellbeing;');
  return { validateWellbeing: factory(isPlainObject, WELLBEING_MOODS), WELLBEING_MOODS };
}

test('wellbeing: valores legitimos usados pelo app sao aceitos', () => {
  const { validateWellbeing, WELLBEING_MOODS } = loadValidateWellbeing();
  assert.deepEqual(WELLBEING_MOODS, ['', 'tranquilo', 'normal', 'sobrecarregado']);
  for (const mood of WELLBEING_MOODS) {
    assert.equal(validateWellbeing({ mood, updatedAt: new Date().toISOString() }), null, 'mood legitimo rejeitado: ' + mood);
  }
  assert.equal(validateWellbeing(null), null);              // ausente: mantem o atual
  assert.equal(validateWellbeing(undefined), null);
  assert.equal(validateWellbeing({ updatedAt: '2026-01-01T00:00:00.000Z' }), null); // sem mood
});

test('wellbeing: valores invalidos sao rejeitados com mensagem', () => {
  const { validateWellbeing } = loadValidateWellbeing();
  for (const mood of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', 'feliz', 123, true]) {
    const error = validateWellbeing({ mood });
    assert.equal(typeof error, 'string', 'mood invalido aceito: ' + JSON.stringify(mood));
  }
  assert.equal(typeof validateWellbeing('tranquilo'), 'string');       // nao e objeto
  assert.equal(typeof validateWellbeing(['tranquilo']), 'string');     // array
  assert.equal(typeof validateWellbeing({ mood: 'normal', updatedAt: 42 }), 'string'); // data invalida
});

test('wellbeing: campos extras nao quebram a persistencia (tolerante)', () => {
  const { validateWellbeing } = loadValidateWellbeing();
  assert.equal(validateWellbeing({ mood: 'normal', updatedAt: '2026-01-01T00:00:00.000Z', extra: 'preservado' }), null);
});

test('server.js: rota de perfil rejeita bem-estar invalido com HTTP 400 (guarda)', () => {
  assert.ok(serverSrc.includes('const wellbeingError = validateWellbeing(incomingProfile.wellbeing);'));
  assert.ok(serverSrc.includes('return res.status(400).json({ success: false, message: wellbeingError });'));
  assert.ok(serverSrc.includes("const WELLBEING_MOODS = ['', 'tranquilo', 'normal', 'sobrecarregado'];"));
});
