// ===========================================================================
// SYNARA — Testes do P0-10 (C1/C2/C3/C6): validacao do vetor, isolamento de
// falhas por unidade, orcamentos de custo e retomada.
//
// TOTALMENTE OFFLINE: sem rede, sem chaves, sem cliente real de provedor, sem
// banco persistente. Os provedores sao FAKES injetados; a logica exercitada e a
// do repositorio (import direto do aiProvider.js e extracao do server.js).
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildEmbeddingFormat, createOpenAiEmbeddingProvider, validateEmbeddingVector } from '../aiProvider.js';

const serverSrc = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

function sliceFunction(signature) {
  const start = serverSrc.indexOf(signature);
  assert.ok(start !== -1, `nao encontrei "${signature}" em server.js`);
  const end = serverSrc.indexOf('\n}\n', start);
  assert.ok(end !== -1, `nao encontrei o fim de "${signature}"`);
  return serverSrc.slice(start, end + 3);
}

const DIM = 1536;
const VECTOR = new Array(DIM).fill(0.1);
const FORMAT = buildEmbeddingFormat({ id: 'openai', model: 'text-embedding-3-small', dimension: DIM });

function providerReturning(vector) {
  return createOpenAiEmbeddingProvider({ client: { embeddings: { create: async () => ({ data: [{ embedding: vector }] }) } } });
}

// ---------------------------------------------------------------------------
// C1 / C3 — validacao do vetor de embedding
// ---------------------------------------------------------------------------
test('C1: vetor com dimensao correta e aceito', async () => {
  const provider = providerReturning(VECTOR);
  const result = await provider.embed('texto');
  assert.equal(Array.isArray(result), true);
  assert.equal(result.length, DIM);
  assert.equal(validateEmbeddingVector(VECTOR, DIM), VECTOR);
});

test('C1: dimensao incorreta e REJEITADA (a dimensao declarada nao e corrigida)', async () => {
  const provider = providerReturning(new Array(768).fill(0.1));
  await assert.rejects(() => provider.embed('texto'), /dimension mismatch: expected 1536, received 768/);
  // A identidade do formato continua declarando 1536 (nada foi "ajustado").
  assert.equal(provider.dimension, DIM);
  assert.equal(FORMAT.dimension, DIM);
});

test('C3: vetor vazio e REJEITADO', async () => {
  await assert.rejects(() => providerReturning([]).embed('texto'), /empty vector/);
  assert.throws(() => validateEmbeddingVector([], DIM), /empty vector/);
});

test('C3: valores nao finitos (NaN/Infinity) sao REJEITADOS', async () => {
  const withNaN = new Array(DIM).fill(0.1); withNaN[7] = NaN;
  await assert.rejects(() => providerReturning(withNaN).embed('texto'), /non-finite value at index 7/);
  const withInf = new Array(DIM).fill(0.1); withInf[3] = Infinity;
  await assert.rejects(() => providerReturning(withInf).embed('texto'), /non-finite value at index 3/);
});

test('C3: resultado que nao e array e REJEITADO', async () => {
  await assert.rejects(() => providerReturning(null).embed('texto'), /non-array vector/);
  await assert.rejects(() => providerReturning('0.1,0.2').embed('texto'), /non-array vector/);
  await assert.rejects(() => providerReturning({ 0: 0.1 }).embed('texto'), /non-array vector/);
});

test('C3: a mensagem de erro nao expoe chave, conteudo ou dado pessoal', async () => {
  const provider = providerReturning(new Array(2).fill(0.1));
  await assert.rejects(() => provider.embed('MATERIAL CONFIDENCIAL DO ALUNO'), (error) => {
    assert.ok(!/MATERIAL CONFIDENCIAL/.test(error.message), 'nao pode ecoar o texto de entrada');
    assert.ok(!/sk-|AIza|AQ\./.test(error.message), 'nao pode conter chave');
    return true;
  });
});

// ---------------------------------------------------------------------------
// C3 — guarda na persistencia (defesa em profundidade)
// ---------------------------------------------------------------------------
function loadWriteEducationalEmbedding() {
  const block = sliceFunction('async function writeEducationalEmbedding(');
  const factory = new Function('educationalJsonb', 'pgPool', 'sqliteDb', 'validateEmbeddingVector',
    block + '\nreturn writeEducationalEmbedding;');
  return (pgPool, sqliteDb) => factory((value) => JSON.stringify(value), pgPool, sqliteDb, validateEmbeddingVector);
}

test('C3: a gravacao recusa vetor invalido ANTES de tocar o banco', async () => {
  const executed = [];
  const fakePool = { query: async (sql) => { executed.push(sql); return { rows: [] }; } };
  const write = loadWriteEducationalEmbedding()(fakePool, null);

  await assert.rejects(() => write(1, 'texto', [], 'h1', FORMAT), /empty vector/);
  await assert.rejects(() => write(1, 'texto', new Array(10).fill(0.1), 'h1', FORMAT), /dimension mismatch/);
  await assert.rejects(() => write(1, 'texto', 'nao-e-array', 'h1', FORMAT), /non-array vector/);
  assert.equal(executed.length, 0, 'nenhuma query pode ser executada com vetor invalido');

  // Vetor valido: grava normalmente (e inclui format_key/dim).
  await write(1, 'texto', VECTOR, 'h1', FORMAT);
  assert.equal(executed.length, 1);
  assert.match(executed[0], /format_key, dim/);
});

// ---------------------------------------------------------------------------
// C6 — orcamentos de custo (criacao de conteudo novo vs reindexacao)
// ---------------------------------------------------------------------------
function loadSetEducationalEmbedding() {
  const block = sliceFunction('async function setEducationalEmbedding(');
  const factory = new Function(
    'readEducationalEmbeddingMeta', 'writeEducationalEmbedding', 'isEmbeddingProviderAvailable', 'createEmbedding', 'isEmbeddingCompatible',
    block + '\nreturn setEducationalEmbedding;'
  );
  return factory;
}

function makeSetHarness(initialMeta) {
  const state = { meta: initialMeta, calls: 0, writes: 0 };
  const fn = loadSetEducationalEmbedding()(
    async () => state.meta,
    async (contentId, chunkText, embedding, contentHash, format) => {
      state.writes += 1;
      state.meta = { content_hash: contentHash, format_key: format.key, dim: embedding.length, model: format.model };
    },
    () => true,
    async () => { state.calls += 1; return VECTOR; },
    (storedFormatKey, storedDim, format, queryDim) => {
      if (!format || !format.key) return false;
      if (storedFormatKey !== format.key) return false;
      const dim = Number(storedDim);
      if (!Number.isInteger(dim) || dim <= 0 || dim !== Number(format.dimension)) return false;
      return queryDim == null || dim === Number(queryDim);
    }
  );
  return { state, fn };
}

test('C6: criacao de conteudo NOVO respeita o orcamento proprio', async () => {
  const h = makeSetHarness(null);
  const policy = { reindex: false, budget: { remaining: 0 }, createBudget: { remaining: 1 } };
  assert.equal(await h.fn(1, 'texto', 'h1', FORMAT, policy), 'created');
  assert.equal(h.state.calls, 1);
  assert.equal(policy.createBudget.remaining, 0);

  const h2 = makeSetHarness(null);
  const exhausted = { reindex: false, budget: { remaining: 0 }, createBudget: { remaining: 0 } };
  assert.equal(await h2.fn(1, 'texto', 'h1', FORMAT, exhausted), 'deferred');
  assert.equal(h2.state.calls, 0, 'sem orcamento nao pode gerar chamada');
  assert.equal(h2.state.writes, 0);
});

test('C6: o orcamento de CRIACAO nao e consumido pela reindexacao (caminhos separados)', async () => {
  const h = makeSetHarness({ content_hash: 'h1', format_key: FORMAT.key, dim: DIM, model: FORMAT.model });
  const policy = { reindex: true, budget: { remaining: 1 }, createBudget: { remaining: 5 } };
  assert.equal(await h.fn(1, 'texto novo', 'h2', FORMAT, policy), 'reindexed-content');
  assert.equal(policy.budget.remaining, 0, 'consumiu o teto de reindexacao');
  assert.equal(policy.createBudget.remaining, 5, 'o orcamento de criacao permanece intacto');
});

test('C6: o teto de REINDEXACAO nao e consumido pela criacao', async () => {
  const h = makeSetHarness(null);
  const policy = { reindex: true, budget: { remaining: 3 }, createBudget: { remaining: 1 } };
  assert.equal(await h.fn(1, 'texto', 'h1', FORMAT, policy), 'created');
  assert.equal(policy.budget.remaining, 3, 'o teto de reindexacao permanece intacto');
  assert.equal(policy.createBudget.remaining, 0);
});

test('C6: orcamento nao e consumido quando a geracao falha', async () => {
  const state = { calls: 0 };
  const fn = loadSetEducationalEmbedding()(
    async () => null,
    async () => { throw new Error('nao deveria gravar'); },
    () => true,
    async () => { state.calls += 1; throw new Error('provider down'); },
    () => false
  );
  const policy = { reindex: false, budget: { remaining: 0 }, createBudget: { remaining: 2 } };
  await assert.rejects(() => fn(1, 'texto', 'h1', FORMAT, policy), /provider down/);
  assert.equal(state.calls, 1);
  assert.equal(policy.createBudget.remaining, 2, 'falha nao pode consumir orcamento');
});

test('C6: persistencia que falha nao marca a unidade como concluida', async () => {
  const fn = loadSetEducationalEmbedding()(
    async () => null,
    async () => { throw new Error('falha ao gravar'); },
    () => true,
    async () => VECTOR,
    () => false
  );
  const policy = { reindex: false, budget: { remaining: 0 }, createBudget: { remaining: 5 } };
  await assert.rejects(() => fn(1, 'texto', 'h1', FORMAT, policy), /falha ao gravar/);
  assert.equal(policy.createBudget.remaining, 5, 'sem gravacao nao ha consumo nem conclusao');
});


// ---------------------------------------------------------------------------
// C2 — isolamento de falhas por unidade e resumo da sincronizacao
// ---------------------------------------------------------------------------
function loadSyncEducationalBase() {
  const block = sliceFunction('async function syncEducationalBase(');
  const factory = new Function(
    'readEducationalSeed', 'EDUCATIONAL_SEED_PATH', 'validateEducationalUnit', 'syncEducationalUnit',
    'listEducationalSourceKeys', 'deleteEducationalContentByKey', 'getEmbeddingFormat',
    'EMBEDDING_REINDEX_ENABLED', 'EMBEDDING_REINDEX_MAX', 'EMBEDDING_CREATE_MAX', 'sanitizeOperationalError',
    block + '\nreturn syncEducationalBase;'
  );
  return factory;
}

function makeSyncHarness({ units, unitImpl, sanitizer }) {
  const calls = [];
  const fn = loadSyncEducationalBase()(
    () => ({ collection: 'col', version: '1', units }),
    '/dev/null',
    (raw) => (raw && raw.invalid ? { error: 'unidade invalida' } : { value: raw }),
    async (unit, context) => { calls.push(unit.sourceKey); return unitImpl(unit, context); },
    async () => [],
    async () => false,
    () => FORMAT,
    false,
    50,
    25,
    sanitizer || ((error) => String((error && error.message) || error))
  );
  return { fn, calls };
}

async function withSilencedConsole(fn) {
  const original = { log: console.log, warn: console.warn, error: console.error };
  const captured = [];
  console.log = (...args) => captured.push(['log', args.join(' ')]);
  console.warn = (...args) => captured.push(['warn', args.join(' ')]);
  console.error = (...args) => captured.push(['error', args.join(' ')]);
  try {
    const result = await fn();
    return { result, captured };
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

test('C2: falha em uma unidade NAO interrompe as demais e nao a conta como concluida', async () => {
  const units = [{ sourceKey: 'a' }, { sourceKey: 'b' }, { sourceKey: 'c' }];
  const { fn, calls } = makeSyncHarness({
    units,
    unitImpl: async (unit) => {
      if (unit.sourceKey === 'b') throw new Error('falha simulada na unidade b');
      return { content: 'inserted', embedding: 'created' };
    }
  });
  const { result } = await withSilencedConsole(() => fn());

  assert.deepEqual(calls, ['a', 'b', 'c'], 'as unidades seguintes continuam sendo processadas');
  assert.equal(result.processed, 3);
  assert.equal(result.failed, 1);
  assert.equal(result.inserted, 2, 'a unidade que falhou NAO pode contar como inserida');
  assert.equal(result.embeddingsCreated, 2);
  assert.equal(result.complete, false, 'com falha a sincronizacao e PARCIAL');
});

test('C2: resumo agrega criadas, atualizadas, inalteradas, falhas e pendentes', async () => {
  const units = [{ sourceKey: 'a' }, { sourceKey: 'b' }, { sourceKey: 'c' }, { sourceKey: 'd' }, { invalid: true }];
  const plan = {
    a: { content: 'inserted', embedding: 'created' },
    b: { content: 'updated', embedding: 'unchanged' },
    c: { content: 'unchanged', embedding: 'deferred' },
    d: { content: 'inserted', embedding: 'pending' }
  };
  const { fn } = makeSyncHarness({
    units,
    unitImpl: async (unit) => {
      if (unit.sourceKey === 'd') throw new Error('falha d');
      return plan[unit.sourceKey];
    }
  });
  const { result } = await withSilencedConsole(() => fn());

  assert.equal(result.units, 5);
  assert.equal(result.invalid, 1, 'unidade invalida nao e processada');
  assert.equal(result.processed, 4);
  assert.equal(result.inserted, 1);
  assert.equal(result.updated, 1);
  assert.equal(result.unchanged, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.embeddingsCreated, 1);
  assert.equal(result.embeddingsReused, 1);
  assert.equal(result.embeddingsDeferred, 1);
  assert.equal(result.embeddingsPending, 0);
  assert.equal(result.complete, false);
});

test('C2: sem falhas nem pendencias a sincronizacao e COMPLETA', async () => {
  const { fn } = makeSyncHarness({
    units: [{ sourceKey: 'a' }, { sourceKey: 'b' }],
    unitImpl: async () => ({ content: 'inserted', embedding: 'created' })
  });
  const { result } = await withSilencedConsole(() => fn());
  assert.equal(result.failed, 0);
  assert.equal(result.embeddingsDeferred, 0);
  assert.equal(result.embeddingsPending, 0);
  assert.equal(result.embeddingsStale, 0);
  assert.equal(result.complete, true);
});

test('C2: o log de falha e sanitizado (sem chave)', async () => {
  const { fn } = makeSyncHarness({
    units: [{ sourceKey: 'a' }],
    unitImpl: async () => { throw new Error('sk-ABCDEF0123456789'); },
    sanitizer: (error) => String((error && error.message) || error).replace(/sk-[A-Za-z0-9]+/g, '<REDACTED>')
  });
  const { captured } = await withSilencedConsole(() => fn());
  const errors = captured.filter(([level]) => level === 'error').map(([, message]) => message).join('\n');
  assert.ok(errors.includes('a'), 'o log deve identificar a unidade pelo sourceKey');
  assert.ok(!errors.includes('sk-ABCDEF0123456789'), 'o log nao pode conter chave');
});


// ---------------------------------------------------------------------------
// Retomada: falha/interrupcao nao duplica chamadas para o que ja foi processado
// ---------------------------------------------------------------------------
function makeCompat(storedFormatKey, storedDim, format, queryDim) {
  if (!format || !format.key) return false;
  if (storedFormatKey !== format.key) return false;
  const dim = Number(storedDim);
  if (!Number.isInteger(dim) || dim <= 0 || dim !== Number(format.dimension)) return false;
  return queryDim == null || dim === Number(queryDim);
}

function makeResumeHarness() {
  const state = { meta: null, calls: 0 };
  const fn = loadSetEducationalEmbedding()(
    async () => state.meta,
    async (contentId, chunkText, embedding, contentHash, format) => {
      state.meta = { content_hash: contentHash, format_key: format.key, dim: embedding.length, model: format.model };
    },
    () => true,
    async () => { state.calls += 1; return VECTOR; },
    makeCompat
  );
  return { state, fn };
}

test('retomada: unidade ja processada volta como unchanged (zero chamadas e zero consumo)', async () => {
  const { state, fn } = makeResumeHarness();
  const policy = { reindex: false, budget: { remaining: 0 }, createBudget: { remaining: 10 } };

  assert.equal(await fn(1, 'texto a', 'ha', FORMAT, policy), 'created');
  assert.equal(state.calls, 1);
  assert.equal(policy.createBudget.remaining, 9);

  // Retomada apos interrupcao: a MESMA unidade nao gera chamada nova.
  assert.equal(await fn(1, 'texto a', 'ha', FORMAT, policy), 'unchanged');
  assert.equal(state.calls, 1, 'nada ja processado pode ser reenviado ao provedor');
  assert.equal(policy.createBudget.remaining, 9, 'a retomada nao consome orcamento novamente');
});

test('retomada: unidade pendente por limite e retomada na execucao seguinte', async () => {
  const { state, fn } = makeResumeHarness();
  const first = { reindex: false, budget: { remaining: 0 }, createBudget: { remaining: 0 } };
  assert.equal(await fn(1, 'texto a', 'ha', FORMAT, first), 'deferred');
  assert.equal(state.calls, 0, 'sem orcamento nada e gerado');

  const second = { reindex: false, budget: { remaining: 0 }, createBudget: { remaining: 10 } };
  assert.equal(await fn(1, 'texto a', 'ha', FORMAT, second), 'created');
  assert.equal(state.calls, 1, 'a unidade pendente e retomada exatamente uma vez');
  assert.equal(second.createBudget.remaining, 9);
});

// ---------------------------------------------------------------------------
// Legado + fallback lexical (cross-check com o comportamento exigido)
// ---------------------------------------------------------------------------
test('legado: vetor sem identidade de formato fica stale-legacy e so e retomado com autorizacao', async () => {
  const state = { meta: { content_hash: 'h1', format_key: null, dim: DIM, model: 'text-embedding-3-small' }, calls: 0 };
  const fn = loadSetEducationalEmbedding()(
    async () => state.meta,
    async (contentId, chunkText, embedding, contentHash, format) => {
      state.meta = { content_hash: contentHash, format_key: format.key, dim: embedding.length, model: format.model };
    },
    () => true,
    async () => { state.calls += 1; return VECTOR; },
    makeCompat
  );

  const off = { reindex: false, budget: { remaining: 0 }, createBudget: { remaining: 10 } };
  assert.equal(await fn(1, 'texto', 'h1', FORMAT, off), 'stale-legacy');
  assert.equal(state.calls, 0, 'sem autorizacao nada e gerado');
  assert.equal(state.meta.format_key, null, 'o legado NAO e relabelado por suposicao');
  assert.equal(off.createBudget.remaining, 10, 'legado nao consome o orcamento de criacao');

  // Com reindexacao autorizada e orcamento, o legado e retomado (uma chamada).
  const on = { reindex: true, budget: { remaining: 1 }, createBudget: { remaining: 10 } };
  assert.equal(await fn(1, 'texto', 'h1', FORMAT, on), 'reindexed-legacy');
  assert.equal(state.calls, 1);
  assert.equal(state.meta.format_key, FORMAT.key);
  assert.equal(on.budget.remaining, 0, 'consumiu o teto de reindexacao');
  assert.equal(on.createBudget.remaining, 10, 'reindexar legado nao consome o orcamento de criacao');
});

test('regressao: orcamentos e validacao estao presentes no codigo', () => {
  assert.ok(serverSrc.includes("const EMBEDDING_CREATE_MAX = Number(process.env.EMBEDDINGS_CREATE_MAX) > 0"), 'orcamento de criacao documentado');
  assert.ok(serverSrc.includes("if (createBudget.remaining <= 0) return 'deferred';"), 'criacao limitada por orcamento');
  assert.ok(serverSrc.includes("if (budget.remaining <= 0) return 'deferred';"), 'reindexacao limitada por orcamento');
  assert.ok(serverSrc.includes('validateEmbeddingVector(embedding, format && format.dimension'), 'guarda na persistencia');
  assert.ok(serverSrc.includes('await syncEducationalUnit(unit, context)'), 'processamento por unidade isolado');
  assert.ok(serverSrc.includes('stats.failed += 1'), 'falhas contabilizadas');
  assert.ok(serverSrc.includes('sanitizeOperationalError(error)'), 'log de falha sanitizado');
});
