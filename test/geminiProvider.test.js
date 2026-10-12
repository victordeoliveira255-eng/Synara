// ===========================================================================
// Testes da FASE 2 — provedor Google Gemini + selecao/fallback de provedores.
// Runner nativo do Node, SEM chamadas de rede: o SDK do Gemini e o da OpenAI
// sao substituidos por dublês (fakes) injetados.
// Rodar com: npm test   (ou: node --test)
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createGeminiTextProvider,
  extractGeminiText,
  sanitizeAiError,
  isTransientAiError,
  isModelUnavailableError,
  textProviderOrder,
  resolveTextProviders,
  resolveTextProvider,
  resolveEmbeddingProvider,
  attemptTextProviders
} from '../aiProvider.js';

const GEMINI_OK_TEXT = 'resposta do gemini';

function okResponse(text) {
  return { text };
}

// Fake do cliente @google/genai: registra as chamadas e delega o resultado.
function fakeGeminiClient(handler) {
  const calls = [];
  return {
    calls,
    client: {
      models: {
        generateContent: async (params) => {
          calls.push(params);
          return handler(params, calls.length);
        }
      }
    }
  };
}

function apiError(message, status) {
  return Object.assign(new Error(message), { status });
}

test('gemini: sem GEMINI_API_KEY e sem client, a fabrica retorna null', () => {
  assert.equal(createGeminiTextProvider({ env: {} }), null);
});

test('gemini: com GEMINI_API_KEY cria o provedor com o modelo padrao', () => {
  const provider = createGeminiTextProvider({ env: { GEMINI_API_KEY: 'fake-gemini-key' } });
  assert.equal(provider.id, 'gemini');
  assert.equal(provider.model, 'gemini-2.5-flash');
});

test('gemini: GEMINI_TEXT_MODEL define o modelo', () => {
  const provider = createGeminiTextProvider({ env: { GEMINI_API_KEY: 'k', GEMINI_TEXT_MODEL: 'gemini-x-flash' } });
  assert.equal(provider.model, 'gemini-x-flash');
});

test('gemini: generateReply mapeia systemInstruction, temperature, timeout e contents', async () => {
  const { client, calls } = fakeGeminiClient(() => okResponse(GEMINI_OK_TEXT));
  const provider = createGeminiTextProvider({ client, env: {} });
  const text = await provider.generateReply({ instructions: 'INSTRUCOES', input: 'CONTEXTO', temperature: 0.8 });
  assert.equal(text, GEMINI_OK_TEXT);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, 'gemini-2.5-flash');
  assert.equal(calls[0].contents, 'CONTEXTO');
  assert.equal(calls[0].config.systemInstruction, 'INSTRUCOES');
  assert.equal(calls[0].config.temperature, 0.8);
  assert.equal(calls[0].config.httpOptions.timeout, 30000);
});

test('gemini: generateExercise nao envia systemInstruction', async () => {
  const { client, calls } = fakeGeminiClient(() => okResponse('exercicio'));
  const provider = createGeminiTextProvider({ client, env: {} });
  const text = await provider.generateExercise({ input: 'PROMPT', temperature: 0.6 });
  assert.equal(text, 'exercicio');
  assert.equal(calls[0].contents, 'PROMPT');
  assert.equal(calls[0].config.temperature, 0.6);
  assert.equal('systemInstruction' in calls[0].config, false);
});

test('gemini: extractGeminiText cobre text, candidates e respostas vazias', () => {
  assert.equal(extractGeminiText({ text: 'a' }), 'a');
  assert.equal(extractGeminiText({ candidates: [{ content: { parts: [{ text: 'b' }, { text: 'c' }] } }] }), 'b c');
  assert.equal(extractGeminiText({ candidates: [] }), '');
  assert.equal(extractGeminiText({}), '');
  assert.equal(extractGeminiText(null), '');
});

test('gemini: fallback de MODELO apenas em 404', async () => {
  const { client, calls } = fakeGeminiClient((params) => {
    if (params.model === 'gemini-2.5-flash') throw apiError('model not found', 404);
    return okResponse('via alias');
  });
  const provider = createGeminiTextProvider({ client, env: {} });
  const text = await provider.generateReply({ instructions: 's', input: 'i', temperature: 0.8 });
  assert.equal(text, 'via alias');
  assert.deepEqual(calls.map((c) => c.model), ['gemini-2.5-flash', 'gemini-flash-latest']);
});

test('gemini: NAO faz fallback de modelo em 429 (quota)', async () => {
  const { client, calls } = fakeGeminiClient(() => { throw apiError('quota exceeded', 429); });
  const provider = createGeminiTextProvider({ client, env: {} });
  await assert.rejects(() => provider.generateReply({ instructions: 's', input: 'i', temperature: 0.8 }), /quota/);
  assert.equal(calls.length, 1);
});

test('gemini: uma nova tentativa em erro transitorio (503) e sucesso', async () => {
  const { client, calls } = fakeGeminiClient((params, n) => {
    if (n === 1) throw apiError('service unavailable', 503);
    return okResponse('ok apos retry');
  });
  const provider = createGeminiTextProvider({ client, env: {} });
  const text = await provider.generateReply({ instructions: 's', input: 'i', temperature: 0.8 });
  assert.equal(text, 'ok apos retry');
  assert.equal(calls.length, 2);
});

test('gemini: sem retry em 401 (chave invalida)', async () => {
  const { client, calls } = fakeGeminiClient(() => { throw apiError('API key not valid', 401); });
  const provider = createGeminiTextProvider({ client, env: {} });
  await assert.rejects(() => provider.generateReply({ instructions: 's', input: 'i', temperature: 0.8 }), /API key/);
  assert.equal(calls.length, 1);
});

test('cadeia: usa o primeiro provedor que responde e NAO chama o segundo', async () => {
  const calls = [];
  const first = { id: 'gemini', generateReply: async () => { calls.push('gemini'); return 'g'; } };
  const second = { id: 'openai', generateReply: async () => { calls.push('openai'); return 'o'; } };
  const text = await attemptTextProviders([first, second], 'generateReply', {});
  assert.equal(text, 'g');
  assert.deepEqual(calls, ['gemini']);
});

test('cadeia: cai para o segundo provedor quando o primeiro falha', async () => {
  const calls = [];
  const first = { id: 'gemini', generateReply: async () => { calls.push('gemini'); throw apiError('boom', 500); } };
  const second = { id: 'openai', generateReply: async () => { calls.push('openai'); return 'o'; } };
  const text = await attemptTextProviders([first, second], 'generateReply', {});
  assert.equal(text, 'o');
  assert.deepEqual(calls, ['gemini', 'openai']);
});

test('cadeia: resposta vazia do primeiro provedor aciona o segundo', async () => {
  const calls = [];
  const first = { id: 'gemini', generateReply: async () => { calls.push('gemini'); return '   '; } };
  const second = { id: 'openai', generateReply: async () => { calls.push('openai'); return 'o'; } };
  assert.equal(await attemptTextProviders([first, second], 'generateReply', {}), 'o');
  assert.deepEqual(calls, ['gemini', 'openai']);
});

test('cadeia: sem provedores, falha (o server.js assume com o fallback local)', async () => {
  await assert.rejects(() => attemptTextProviders([], 'generateReply', {}), /not configured/);
});

test('selecao: AI_TEXT_PROVIDER controla a ordem', () => {
  assert.deepEqual(textProviderOrder({}), ['gemini', 'openai']);
  assert.deepEqual(textProviderOrder({ AI_TEXT_PROVIDER: 'gemini' }), ['gemini', 'openai']);
  assert.deepEqual(textProviderOrder({ AI_TEXT_PROVIDER: 'auto' }), ['gemini', 'openai']);
  assert.deepEqual(textProviderOrder({ AI_TEXT_PROVIDER: 'openai' }), ['openai']);
});

test('selecao: resolveTextProviders ordena pelos provedores configurados', () => {
  const both = resolveTextProviders({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o' });
  assert.deepEqual(both.map((p) => p.id), ['gemini', 'openai']);

  const onlyOpenAi = resolveTextProviders({ OPENAI_API_KEY: 'o' });
  assert.deepEqual(onlyOpenAi.map((p) => p.id), ['openai']);

  const onlyGemini = resolveTextProviders({ GEMINI_API_KEY: 'g' });
  assert.deepEqual(onlyGemini.map((p) => p.id), ['gemini']);

  const explicit = resolveTextProviders({ GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', AI_TEXT_PROVIDER: 'openai' });
  assert.deepEqual(explicit.map((p) => p.id), ['openai']);

  assert.deepEqual(resolveTextProviders({}), []);
  assert.equal(resolveTextProvider({}), null);
});

test('embeddings: permanecem na OpenAI e nunca usam o Gemini', () => {
  assert.equal(resolveEmbeddingProvider({ GEMINI_API_KEY: 'g' }), null);
  const embedding = resolveEmbeddingProvider({ OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' });
  assert.equal(embedding.id, 'openai');
  assert.equal(embedding.model, 'text-embedding-3-small');
});

test('erros: classificacao transitoria e de modelo', () => {
  assert.equal(isTransientAiError(apiError('x', 503)), true);
  assert.equal(isTransientAiError(apiError('x', 429)), false);
  assert.equal(isTransientAiError(apiError('x', 401)), false);
  assert.equal(isTransientAiError(apiError('request timed out', undefined)), true);
  assert.equal(isModelUnavailableError(apiError('x', 404)), true);
  assert.equal(isModelUnavailableError(apiError('x', 429)), false);
});

test('sanitizeAiError: redige chaves do Google (AIza e AQ.) sem vazar', () => {
  const aq = sanitizeAiError({ message: 'invalid key AQ.Ab8RN6KyFAKEKEY123456 padding' });
  assert.ok(!aq.includes('AQ.Ab8RN6KyFAKEKEY123456'), aq);
  const aiza = sanitizeAiError({ message: 'key: AIzaSyFAKE1234567890' });
  assert.ok(!aiza.includes('AIzaSyFAKE1234567890'), aiza);
});
