// ===========================================================================
// Testes da FASE 1 — abstracao de provedores de IA (aiProvider.js).
// Usam o runner nativo do Node (node:test) e NAO fazem nenhuma chamada de rede:
// os clientes externos sao substituidos por dublês (fakes) injetados.
// Rodar com: npm test   (ou: node --test)
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractResponseText,
  sanitizeAiError,
  createOpenAiTextProvider,
  createOpenAiEmbeddingProvider,
  resolveTextProvider,
  resolveEmbeddingProvider,
  resolveProviders,
  isTextProviderAvailable,
  isEmbeddingProviderAvailable,
  getTextProviderId,
  getEmbeddingProviderId,
  generateMentorReply,
  generateExerciseText,
  createEmbedding
} from '../aiProvider.js';

// ---------------------------------------------------------------------------
// extractResponseText
// ---------------------------------------------------------------------------
test('extractResponseText: usa output_text quando presente', () => {
  assert.equal(extractResponseText({ output_text: 'ola' }), 'ola');
});

test('extractResponseText: concatena blocos de content', () => {
  const response = {
    output: [
      { content: [{ text: 'a' }, { text: 'b' }] },
      { content: [{ text: 'c' }] }
    ]
  };
  assert.equal(extractResponseText(response), 'a b c');
});

test('extractResponseText: ignora entradas vazias e nulas', () => {
  assert.equal(extractResponseText(null), '');
  assert.equal(extractResponseText({}), '');
  assert.equal(extractResponseText({ output: [{ content: [{ text: '' }] }] }), '');
});

// ---------------------------------------------------------------------------
// sanitizeAiError — nunca pode vazar segredo
// ---------------------------------------------------------------------------
test('sanitizeAiError: redige chave estilo sk-', () => {
  const out = sanitizeAiError({ message: 'Incorrect API key provided: sk-abcdef123456' });
  assert.ok(!out.includes('sk-abcdef123456'), out);
});

test('sanitizeAiError: redige chave estilo Google AIza', () => {
  const out = sanitizeAiError({ message: 'Request failed: Authorization: Bearer AIzaSyFAKE1234567890' });
  assert.ok(!out.includes('AIzaSyFAKE1234567890'), out);
});

test('sanitizeAiError: redige token= e apikey:', () => {
  const out = sanitizeAiError('token=supersecret apikey: another');
  assert.ok(!out.includes('supersecret'), out);
  assert.ok(!out.includes('another'), out);
});

test('sanitizeAiError: preserva status/code e trunca mensagem longa', () => {
  const out = sanitizeAiError({ message: 'x'.repeat(1000), status: 429, code: 'RESOURCE_EXHAUSTED' });
  assert.ok(out.includes('HTTP 429'), out);
  assert.ok(out.includes('RESOURCE_EXHAUSTED'), out);
  assert.ok(out.length < 400, String(out.length));
});

// ---------------------------------------------------------------------------
// Fabricas de provedor — sem chave e com cliente injetado
// ---------------------------------------------------------------------------
test('fabricas: sem chave e sem client retornam null', () => {
  assert.equal(createOpenAiTextProvider({ env: {} }), null);
  assert.equal(createOpenAiEmbeddingProvider({ env: {} }), null);
});

test('texto: gera resposta com os parametros atuais da Mentora', async () => {
  const calls = [];
  const fake = { responses: { create: async (params) => { calls.push(params); return { output_text: 'resposta' }; } } };
  const provider = createOpenAiTextProvider({ client: fake });
  assert.equal(provider.id, 'openai');
  assert.equal(provider.model, 'gpt-4.1-mini');
  const text = await provider.generateReply({ instructions: 's', input: 'i', temperature: 0.8 });
  assert.equal(text, 'resposta');
  assert.deepEqual(calls[0], { model: 'gpt-4.1-mini', temperature: 0.8, instructions: 's', input: 'i' });
});

test('texto: gera exercicio com os parametros atuais', async () => {
  const calls = [];
  const fake = { responses: { create: async (params) => { calls.push(params); return { output_text: 'exercicio' }; } } };
  const provider = createOpenAiTextProvider({ client: fake });
  const text = await provider.generateExercise({ input: 'p', temperature: 0.6 });
  assert.equal(text, 'exercicio');
  assert.deepEqual(calls[0], { model: 'gpt-4.1-mini', input: 'p', temperature: 0.6 });
});

test('embeddings: usa text-embedding-3-small e retorna o vetor', async () => {
  const calls = [];
  // P0-10 (C1) — o provedor valida a dimensao contra a declarada pelo formato:
  // o vetor do duble precisa ter a dimensao REAL do modelo (1536).
  const embedding = new Array(1536).fill(0).map((_, index) => Number((index / 1536).toFixed(6)));
  const fake = { embeddings: { create: async (params) => { calls.push(params); return { data: [{ embedding }] }; } } };
  const provider = createOpenAiEmbeddingProvider({ client: fake });
  assert.equal(provider.model, 'text-embedding-3-small');
  assert.equal(provider.dimension, 1536);
  const vector = await provider.embed('texto');
  assert.equal(vector.length, 1536);
  assert.deepEqual(vector, embedding);
  assert.deepEqual(calls[0], { model: 'text-embedding-3-small', input: 'texto' });
});

test('embeddings: dimensao divergente da declarada e rejeitada', async () => {
  const fake = { embeddings: { create: async () => ({ data: [{ embedding: [0.1, 0.2, 0.3] }] }) } };
  const provider = createOpenAiEmbeddingProvider({ client: fake });
  await assert.rejects(() => provider.embed('texto'), /dimension mismatch/);
});

// ---------------------------------------------------------------------------
// Resolucao por ambiente (deterministica, sem tocar no singleton)
// ---------------------------------------------------------------------------
test('resolveProviders: sem chave nao ha provedores', () => {
  const providers = resolveProviders({});
  assert.equal(providers.text, null);
  assert.equal(providers.embedding, null);
  assert.equal(resolveTextProvider({}), null);
  assert.equal(resolveEmbeddingProvider({}), null);
});

test('resolveProviders: com OPENAI_API_KEY resolve o provedor openai', () => {
  const providers = resolveProviders({ OPENAI_API_KEY: 'test-key-not-real' });
  assert.equal(providers.text && providers.text.id, 'openai');
  assert.equal(providers.embedding && providers.embedding.id, 'openai');
});

// ---------------------------------------------------------------------------
// Singleton ativo — primeira resolucao acontece aqui, com chaves removidas.
// ---------------------------------------------------------------------------
test('singleton: sem chave, indisponivel; chamadas falham sem expor segredo', async () => {
  const savedOpenAi = process.env.OPENAI_API_KEY;
  const savedGemini = process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    assert.equal(isTextProviderAvailable(), false);
    assert.equal(isEmbeddingProviderAvailable(), false);
    assert.equal(getTextProviderId(), null);
    assert.equal(getEmbeddingProviderId(), null);
    await assert.rejects(() => generateMentorReply({ instructions: 's', input: 'i', temperature: 0.8 }), /not configured/);
    await assert.rejects(() => generateExerciseText({ input: 'i', temperature: 0.6 }), /not configured/);
    await assert.rejects(() => createEmbedding('t'), /not configured/);
  } finally {
    if (savedOpenAi !== undefined) process.env.OPENAI_API_KEY = savedOpenAi;
    if (savedGemini !== undefined) process.env.GEMINI_API_KEY = savedGemini;
  }
});
