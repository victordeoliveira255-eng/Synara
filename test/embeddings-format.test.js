// ===========================================================================
// SYNARA — Testes do P0-7/P0-8/P0-9: identidade de formato, compatibilidade e
// idempotencia das embeddings.
//
// TOTALMENTE OFFLINE: nao ha rede, nao se constroi cliente OpenAI/Gemini, nao se
// abre banco persistente (o teste de migracao usa SQLite `:memory:`) e nenhum
// vetor real e gerado. Os provedores sao FAKES injetados.
//
// A logica sob teste e o codigo REAL do repositorio: `buildEmbeddingFormat` e
// `createOpenAiEmbeddingProvider` vem por import; as funcoes do server.js sao
// extraidas do proprio arquivo e executadas com dependencias injetadas.
// ===========================================================================

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import sqlite3 from 'sqlite3';

import { buildEmbeddingFormat, createOpenAiEmbeddingProvider } from '../aiProvider.js';

const serverSrc = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const selfSrc = fs.readFileSync(new URL(import.meta.url), 'utf8');

// --- extracao do codigo real do server.js -----------------------------------
function sliceFunction(signature) {
  const start = serverSrc.indexOf(signature);
  assert.ok(start !== -1, `nao encontrei "${signature}" em server.js`);
  const end = serverSrc.indexOf('\n}\n', start);
  assert.ok(end !== -1, `nao encontrei o fim de "${signature}"`);
  return serverSrc.slice(start, end + 3);
}

function loadIsEmbeddingCompatible() {
  return new Function(sliceFunction('function isEmbeddingCompatible(') + '\nreturn isEmbeddingCompatible;')();
}

function loadSetEducationalEmbedding() {
  const block = sliceFunction('async function setEducationalEmbedding(');
  const factory = new Function(
    'readEducationalEmbeddingMeta', 'writeEducationalEmbedding', 'isEmbeddingProviderAvailable', 'createEmbedding', 'isEmbeddingCompatible',
    block + '\nreturn setEducationalEmbedding;'
  );
  return factory;
}

function loadEnsureEmbeddingFormatColumns() {
  const start = serverSrc.indexOf('const EMBEDDING_FORMAT_COLUMNS = [');
  assert.ok(start !== -1, 'nao encontrei EMBEDDING_FORMAT_COLUMNS');
  const fnStart = serverSrc.indexOf('async function ensureEmbeddingFormatColumns()', start);
  assert.ok(fnStart !== -1, 'nao encontrei ensureEmbeddingFormatColumns');
  const end = serverSrc.indexOf('\n}\n', fnStart);
  assert.ok(end !== -1, 'nao encontrei o fim de ensureEmbeddingFormatColumns');
  const block = serverSrc.slice(start, end + 3);
  return new Function('pgPool', 'sqliteDb', block + '\nreturn ensureEmbeddingFormatColumns;');
}

function loadSearchEducationalKnowledge() {
  const block = sliceFunction('async function searchEducationalKnowledge(');
  const factory = new Function(
    'loadEducationalRows', 'educationalNormalizeKey', 'educationalTokens', 'lexicaRelevance', 'cosine',
    'MENTOR_KNOWLEDGE_LIMITS', 'educationalPublicItem', 'isEmbeddingCompatible',
    block + '\nreturn searchEducationalKnowledge;'
  );
  return factory;
}

// --- dublês -----------------------------------------------------------------
function makeProvider(overrides = {}) {
  return Object.assign({ id: 'openai', model: 'text-embedding-3-small', dimension: 1536 }, overrides);
}

const FORMAT = buildEmbeddingFormat(makeProvider());
const OTHER_MODEL_FORMAT = buildEmbeddingFormat(makeProvider({ model: 'text-embedding-3-large' }));
const OTHER_DIM_FORMAT = buildEmbeddingFormat(makeProvider({ model: 'outro', dimension: 768 }));

const LIMITS = {
  items: 3, maxItems: 5, minScore: 0.22, minSimilarity: 0.10, maxPerTopic: 2,
  blockChars: 2500, unitChars: 900, fieldChars: 240,
  subjectBoost: 0.10, topicBoost: 0.12, levelBoost: 0.05, lexicalAlpha: 0.6
};

function memoryDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (error) => (error ? reject(error) : resolve(db)));
  });
}
function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => db.all(sql, params, (error, rows) => (error ? reject(error) : resolve(rows))));
}
function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, function onRun(error) { error ? reject(error) : resolve(this); }));
}
function dbClose(db) {
  return new Promise((resolve) => db.close(() => resolve()));
}

// ---------------------------------------------------------------------------
// P0-7 — identidade de formato
// ---------------------------------------------------------------------------
test('formato: identificador estavel com provedor, modelo, dimensao e versao', () => {
  const format = buildEmbeddingFormat(makeProvider(), 1);
  assert.deepEqual(format, {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimension: 1536,
    version: 1,
    key: 'openai:text-embedding-3-small:1536:v1'
  });
  // Estavel: chamadas repetidas produzem exatamente o mesmo identificador.
  assert.equal(buildEmbeddingFormat(makeProvider(), 1).key, format.key);
});

test('formato: deriva do provedor REAL (nao de string duplicada) e cobre a dimensao', () => {
  const provider = createOpenAiEmbeddingProvider({ client: { embeddings: { create: async () => ({ data: [{ embedding: [] }] }) } } });
  assert.equal(provider.model, 'text-embedding-3-small');
  assert.equal(provider.dimension, 1536);
  const format = buildEmbeddingFormat(provider);
  assert.ok(format.key.includes(provider.model), 'a chave deve conter o modelo do provedor');
  assert.ok(format.key.includes(String(provider.dimension)), 'a chave deve conter a dimensao');
});

test('formato: modelo, dimensao e versao distintos geram identificadores distintos', () => {
  assert.notEqual(buildEmbeddingFormat(makeProvider()).key, OTHER_MODEL_FORMAT.key);
  assert.notEqual(buildEmbeddingFormat(makeProvider()).key, OTHER_DIM_FORMAT.key);
  assert.notEqual(buildEmbeddingFormat(makeProvider(), 1).key, buildEmbeddingFormat(makeProvider(), 2).key);
});

test('formato: provedor incompleto/invalido nao gera identidade', () => {
  assert.equal(buildEmbeddingFormat(null), null);
  assert.equal(buildEmbeddingFormat({ id: 'openai', model: 'x' }), null);            // sem dimensao
  assert.equal(buildEmbeddingFormat(makeProvider({ dimension: 0 })), null);
  assert.equal(buildEmbeddingFormat(makeProvider({ dimension: 'abc' })), null);
});

// ---------------------------------------------------------------------------
// P0-8 — compatibilidade
// ---------------------------------------------------------------------------
test('compatibilidade: exige o MESMO formato E a MESMA dimensao', () => {
  const isEmbeddingCompatible = loadIsEmbeddingCompatible();
  assert.equal(isEmbeddingCompatible(FORMAT.key, 1536, FORMAT, 1536), true);
  assert.equal(isEmbeddingCompatible(OTHER_MODEL_FORMAT.key, 1536, FORMAT, 1536), false, 'mesma dimensao, modelos diferentes');
  assert.equal(isEmbeddingCompatible(FORMAT.key, 768, FORMAT, 1536), false, 'dimensao gravada diferente');
  assert.equal(isEmbeddingCompatible(FORMAT.key, 1536, FORMAT, 768), false, 'dimensao da consulta diferente');
});

test('compatibilidade: registro LEGADO/desconhecido nunca e tratado como compativel', () => {
  const isEmbeddingCompatible = loadIsEmbeddingCompatible();
  assert.equal(isEmbeddingCompatible(null, 1536, FORMAT, 1536), false, 'format_key NULL e legado');
  assert.equal(isEmbeddingCompatible(undefined, 1536, FORMAT, 1536), false);
  assert.equal(isEmbeddingCompatible(FORMAT.key, null, FORMAT, 1536), false, 'dim ausente');
  assert.equal(isEmbeddingCompatible(FORMAT.key, 0, FORMAT, 1536), false);
  assert.equal(isEmbeddingCompatible('', 1536, FORMAT, 1536), false);
});

test('compatibilidade: sem formato corrente (sem provedor) nada e comparavel', () => {
  const isEmbeddingCompatible = loadIsEmbeddingCompatible();
  assert.equal(isEmbeddingCompatible(FORMAT.key, 1536, null, 1536), false);
  assert.equal(isEmbeddingCompatible(FORMAT.key, 1536, {}, 1536), false);
});

test('rede: a suite nao importa clientes de rede nem chama fetch', () => {
  assert.ok(!/require\(['"](https?|net)['"]\)/.test(selfSrc), 'nao deve requerer http/https/net');
  assert.ok(!/\bfetch\s*\(/.test(selfSrc), 'nao deve chamar fetch');
  assert.ok(!/new\s+OpenAI\s*\(/.test(selfSrc), 'nao deve instanciar cliente OpenAI real');
  assert.ok(!/new\s+GoogleGenAI\s*\(/.test(selfSrc), 'nao deve instanciar cliente Gemini real');
});



// ---------------------------------------------------------------------------
// P0-9 — idempotencia e reindexacao controlada
// ---------------------------------------------------------------------------
function makeSetEmbeddingHarness(initialMeta) {
  const state = { meta: initialMeta, calls: 0, writes: [] };
  const factory = loadSetEducationalEmbedding();
  const fn = factory(
    async () => state.meta,
    async (contentId, chunkText, embedding, contentHash, format) => {
      state.writes.push({ contentId, contentHash, formatKey: format.key, dim: embedding.length });
      state.meta = { content_hash: contentHash, format_key: format.key, dim: embedding.length, model: format.model };
    },
    () => true,
    async () => { state.calls += 1; return new Array(1536).fill(0.01); },
    loadIsEmbeddingCompatible()
  );
  return { state, fn };
}

const OFF = { reindex: false, budget: { remaining: 0 }, createBudget: { remaining: 10 } };
const ON = { reindex: true, budget: { remaining: 10 }, createBudget: { remaining: 10 } };

test('idempotencia: mesmo conteudo e mesmo formato nao geram embedding novamente', async () => {
  const h = makeSetEmbeddingHarness({ content_hash: 'h1', format_key: FORMAT.key, dim: 1536, model: FORMAT.model });
  assert.equal(await h.fn(1, 'texto', 'h1', FORMAT, OFF), 'unchanged');
  assert.equal(h.state.calls, 0);
  assert.equal(h.state.writes.length, 0);
});

test('idempotencia: conteudo alterado com reindexacao DESLIGADA nao gera embedding', async () => {
  const previous = { content_hash: 'h1', format_key: FORMAT.key, dim: 1536, model: FORMAT.model };
  const h = makeSetEmbeddingHarness({ ...previous });
  assert.equal(await h.fn(1, 'texto novo', 'h2', FORMAT, OFF), 'stale-content');
  assert.equal(h.state.calls, 0, 'nao deve chamar o provedor por padrao');
  assert.deepEqual(h.state.meta, previous, 'o vetor antigo permanece intacto');
});

test('idempotencia: formato diferente com reindexacao DESLIGADA nao reutiliza nem gera', async () => {
  const h = makeSetEmbeddingHarness({ content_hash: 'h1', format_key: FORMAT.key, dim: 1536, model: FORMAT.model });
  assert.equal(await h.fn(1, 'texto', 'h1', OTHER_MODEL_FORMAT, OFF), 'stale-format');
  assert.equal(h.state.calls, 0);
  assert.equal(h.state.meta.format_key, FORMAT.key, 'o vetor antigo permanece com o formato original');
});

test('idempotencia: registro LEGADO (format_key NULL) nunca e assumido como compativel', async () => {
  const h = makeSetEmbeddingHarness({ content_hash: 'h1', format_key: null, dim: 1536, model: 'text-embedding-3-small' });
  assert.equal(await h.fn(1, 'texto', 'h1', FORMAT, OFF), 'stale-legacy');
  assert.equal(h.state.calls, 0);
  assert.equal(h.state.meta.format_key, null, 'legado NAO e relabelado por suposicao');
});

test('idempotencia: reindexacao LIGADA regenera o formato divergente (uma chamada)', async () => {
  const h = makeSetEmbeddingHarness({ content_hash: 'h1', format_key: FORMAT.key, dim: 1536, model: FORMAT.model });
  assert.equal(await h.fn(1, 'texto', 'h1', OTHER_MODEL_FORMAT, ON), 'reindexed-format');
  assert.equal(h.state.calls, 1);
  assert.equal(h.state.writes[0].formatKey, OTHER_MODEL_FORMAT.key);
  assert.equal(h.state.writes[0].dim, 1536);
});

test('idempotencia: reindexacao LIGADA regenera conteudo alterado (uma chamada)', async () => {
  const h = makeSetEmbeddingHarness({ content_hash: 'h1', format_key: FORMAT.key, dim: 1536, model: FORMAT.model });
  assert.equal(await h.fn(1, 'texto novo', 'h2', FORMAT, ON), 'reindexed-content');
  assert.equal(h.state.calls, 1);
});

test('idempotencia: conteudo NOVO e ingerido normalmente (uma chamada)', async () => {
  const h = makeSetEmbeddingHarness(null);
  assert.equal(await h.fn(1, 'texto', 'h1', FORMAT, OFF), 'created');
  assert.equal(h.state.calls, 1);
  assert.equal(h.state.writes[0].formatKey, FORMAT.key);
});

test('idempotencia: teto de reindexacao esgotado marca a unidade como PENDENTE (deferred)', async () => {
  const h = makeSetEmbeddingHarness({ content_hash: 'h1', format_key: FORMAT.key, dim: 1536, model: FORMAT.model });
  const policy = { reindex: true, budget: { remaining: 0 }, createBudget: { remaining: 5 } };
  assert.equal(await h.fn(1, 'texto novo', 'h2', FORMAT, policy), 'deferred');
  assert.equal(h.state.calls, 0, 'teto esgotado nao pode gerar chamada');
});

test('idempotencia: sem formato/provedor nada e criado nem comparado', async () => {
  const h = makeSetEmbeddingHarness(null);
  assert.equal(await h.fn(1, 'texto', 'h1', null, OFF), 'pending');
  assert.equal(h.state.calls, 0);
  const withMeta = makeSetEmbeddingHarness({ content_hash: 'h1', format_key: FORMAT.key, dim: 1536 });
  assert.equal(await withMeta.fn(1, 'texto', 'h1', null, OFF), 'pending');
  assert.equal(withMeta.state.calls, 0);
});

// ---------------------------------------------------------------------------
// P0-7 — migracao ADITIVA do esquema
// ---------------------------------------------------------------------------
const OLD_EMBEDDINGS_DDL = `CREATE TABLE embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)`;
const OLD_EDUCATIONAL_EMBEDDINGS_DDL = `CREATE TABLE educational_embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_id INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  chunk_text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  content_hash TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
)`;

test('migracao SQLite (:memory:): adiciona colunas, preserva linhas e e idempotente', async () => {
  const db = await memoryDb();
  try {
    await dbRun(db, OLD_EMBEDDINGS_DDL);
    await dbRun(db, OLD_EDUCATIONAL_EMBEDDINGS_DDL);
    // Dados "legados" ANTES da migracao.
    await dbRun(db, 'INSERT INTO embeddings (user_email, content, embedding) VALUES (?, ?, ?)', ['aluno@exemplo.com', 'Materia: Matematica', '[0.1,0.2]']);
    await dbRun(db, 'INSERT INTO educational_embeddings (content_id, chunk_index, chunk_text, embedding, content_hash) VALUES (?, 0, ?, ?, ?)', [1, 'texto', '[0.1,0.2]', 'h1']);

    const ensureColumns = loadEnsureEmbeddingFormatColumns()(null, db);

    // 1a execucao
    await ensureColumns();
    const embCols = (await dbAll(db, 'PRAGMA table_info(embeddings)')).map((r) => r.name);
    const eduCols = (await dbAll(db, 'PRAGMA table_info(educational_embeddings)')).map((r) => r.name);
    assert.ok(embCols.includes('format_key') && embCols.includes('dim'), 'embeddings deve ganhar format_key e dim');
    assert.ok(eduCols.includes('format_key') && eduCols.includes('dim'), 'educational_embeddings deve ganhar format_key e dim');

    // 2a execucao: idempotente, sem erro
    await ensureColumns();
    assert.deepEqual((await dbAll(db, 'PRAGMA table_info(embeddings)')).map((r) => r.name), embCols);

    // Linhas preservadas e NAO relabeladas (format_key continua NULL = legado).
    const embRows = await dbAll(db, 'SELECT user_email, content, format_key, dim FROM embeddings');
    assert.equal(embRows.length, 1);
    assert.equal(embRows[0].format_key, null);
    assert.equal(embRows[0].dim, null);
    const eduRows = await dbAll(db, 'SELECT content_id, chunk_text, content_hash, model, format_key, dim FROM educational_embeddings');
    assert.equal(eduRows.length, 1);
    assert.equal(eduRows[0].format_key, null, 'o DEFAULT historico NAO e usado como prova de formato');
    assert.equal(eduRows[0].dim, null);
    assert.equal(eduRows[0].content_hash, 'h1');
  } finally {
    await dbClose(db);
  }
});

test('migracao PostgreSQL: usa ADD COLUMN IF NOT EXISTS (aditivo e idempotente)', async () => {
  const queries = [];
  const fakePool = { query: async (sql) => { queries.push(sql); return { rows: [] }; } };
  await loadEnsureEmbeddingFormatColumns()(fakePool, null)();
  assert.equal(queries.length, 4);
  for (const sql of queries) {
    assert.match(sql, /^ALTER TABLE (embeddings|educational_embeddings) ADD COLUMN IF NOT EXISTS (format_key TEXT|dim INTEGER)$/);
  }
  assert.ok(!/DROP|DELETE|UPDATE|TRUNCATE/i.test(queries.join(' ')), 'a migracao nao pode apagar nem reescrever dados');
});

test('migracao: tabela ausente nao e criada nem inventada', async () => {
  const db = await memoryDb();
  try {
    await dbRun(db, OLD_EDUCATIONAL_EMBEDDINGS_DDL); // apenas uma das tabelas existe
    await loadEnsureEmbeddingFormatColumns()(null, db)();
    assert.deepEqual(await dbAll(db, "SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings'"), []);
    const eduCols = (await dbAll(db, 'PRAGMA table_info(educational_embeddings)')).map((r) => r.name);
    assert.ok(eduCols.includes('format_key'));
  } finally {
    await dbClose(db);
  }
});



// ---------------------------------------------------------------------------
// P0-8 — busca: vetores incompativeis saem da comparacao, lexico permanece
// ---------------------------------------------------------------------------
function eduRow({ id, formatKey, dim, embeddingHash, contentHash, topicKey }) {
  return {
    id,
    sourceKey: 'fonte-' + id,
    subject: 'Matematica',
    subjectKey: 'matematica',
    topic: 'Topico ' + id,
    topicKey: topicKey || ('topico-' + id),
    title: 'Titulo ' + id,
    type: 'concept',
    level: 'geral',
    content: 'conteudo ' + id,
    examples: [],
    commonErrors: [],
    strategies: [],
    relatedTopics: [],
    prerequisites: [],
    embedding: new Array(1536).fill(0.02),
    embeddingFormatKey: formatKey,
    embeddingDim: dim,
    embeddingHash,
    contentHash
  };
}

function makeSearchHarness(rows) {
  const cosineCalls = [];
  const fn = loadSearchEducationalKnowledge()(
    async () => rows,
    (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80),
    (text) => String(text || '').split(/[^a-z0-9]+/i).filter((token) => token.length > 2),
    () => 1,
    (a, b) => { cosineCalls.push(b); return 0.9; },
    LIMITS,
    (row) => ({ id: row.id, type: row.type, score: row.score }),
    loadIsEmbeddingCompatible()
  );
  return { fn, cosineCalls };
}

test('busca: apenas vetores compativeis entram na similaridade; resto vai para o lexico', async () => {
  const rows = [
    eduRow({ id: 1, formatKey: FORMAT.key, dim: 1536, embeddingHash: 'h1', contentHash: 'h1' }),
    eduRow({ id: 2, formatKey: null, dim: 1536, embeddingHash: 'h1', contentHash: 'h1' }),
    eduRow({ id: 3, formatKey: OTHER_MODEL_FORMAT.key, dim: 1536, embeddingHash: 'h1', contentHash: 'h1' }),
    eduRow({ id: 4, formatKey: FORMAT.key, dim: 1536, embeddingHash: 'h1', contentHash: 'h2' })
  ];
  const { fn, cosineCalls } = makeSearchHarness(rows);
  const queryEmbedding = new Array(1536).fill(0.03);
  const result = await fn({ query: 'equacao do primeiro grau', queryEmbedding, subject: null, topic: null, level: null, types: null, limit: 10, currentFormat: FORMAT });

  assert.equal(cosineCalls.length, 1, 'somente o vetor compativel pode ir ao cosseno');
  assert.equal(cosineCalls[0][0], 0.02);
  assert.equal(result.excludedEmbeddings, 3, 'legado + formato diferente + desatualizado');
  assert.equal(result.mode, 'semantic');
  assert.equal(result.items.length, 4, 'os demais continuam disponiveis pelo sinal lexical');
});

test('busca: sem nenhum vetor compativel o resultado continua pelo fallback lexical', async () => {
  const rows = [
    eduRow({ id: 1, formatKey: null, dim: 1536, embeddingHash: 'h1', contentHash: 'h1' }),
    eduRow({ id: 2, formatKey: null, dim: 1536, embeddingHash: 'h1', contentHash: 'h1' })
  ];
  const { fn, cosineCalls } = makeSearchHarness(rows);
  const result = await fn({ query: 'funcao quadratica', queryEmbedding: new Array(1536).fill(0.03), subject: null, topic: null, level: null, types: null, limit: 5, currentFormat: FORMAT });
  assert.equal(cosineCalls.length, 0);
  assert.equal(result.mode, 'lexical');
  assert.equal(result.items.length, 2, 'o fallback lexical existente e preservado');
  assert.equal(result.excludedEmbeddings, 2);
});

test('busca: sem formato corrente (sem provedor) a comparacao vetorial nao acontece', async () => {
  const rows = [eduRow({ id: 1, formatKey: FORMAT.key, dim: 1536, embeddingHash: 'h1', contentHash: 'h1' })];
  const { fn, cosineCalls } = makeSearchHarness(rows);
  const result = await fn({ query: 'trigonometria', queryEmbedding: new Array(1536).fill(0.03), subject: null, topic: null, level: null, types: null, limit: 5, currentFormat: null });
  assert.equal(cosineCalls.length, 0);
  assert.equal(result.mode, 'lexical');
});

test('busca: filtros explicitos e diversidade continuam aplicados', async () => {
  const rows = [
    eduRow({ id: 1, formatKey: FORMAT.key, dim: 1536, embeddingHash: 'h1', contentHash: 'h1', topicKey: 'algebra' }),
    eduRow({ id: 2, formatKey: FORMAT.key, dim: 1536, embeddingHash: 'h1', contentHash: 'h1', topicKey: 'algebra' }),
    eduRow({ id: 3, formatKey: FORMAT.key, dim: 1536, embeddingHash: 'h1', contentHash: 'h1', topicKey: 'geometria' })
  ];
  const { fn } = makeSearchHarness(rows);
  const queryEmbedding = new Array(1536).fill(0.03);
  const filtered = await fn({ query: 'algebra', queryEmbedding, subject: 'Matematica', topic: null, level: null, types: null, limit: 10, currentFormat: FORMAT });
  assert.equal(filtered.items.length, 3, 'todos sao da mesma materia; diversidade limita por topico');
  assert.equal(filtered.items.filter((item) => item.id <= 2).length, 2, 'no maximo 2 por (materia, topico)');
});

// ---------------------------------------------------------------------------
// Guarda de regressao: os caminhos de busca/gravacao usam a identidade de formato
// ---------------------------------------------------------------------------
test('regressao: gravacao, busca e endpoint de embeddings usam a identidade de formato', () => {
  assert.ok(serverSrc.includes('e.format_key AS embedding_format_key'), 'o SELECT educacional deve trazer format_key');
  assert.ok(serverSrc.includes('e.dim AS embedding_dim'), 'o SELECT educacional deve trazer dim');
  assert.ok(serverSrc.includes('isEmbeddingCompatible(entry.format_key, entry.dim, currentFormat, queryDim)'), 'busca do aluno deve checar formato');
  assert.ok(serverSrc.includes('const format = getEmbeddingFormat();'), 'a gravacao usa o formato efetivo do provedor');
  assert.ok(!/INSERT INTO embeddings \(user_email, content, embedding, metadata\)/.test(serverSrc), 'insert antigo sem format_key nao deve existir');
  assert.ok(serverSrc.includes("const EMBEDDING_REINDEX_ENABLED = ['1', 'true', 'yes', 'on']"), 'reindexacao desligada por padrao');
});
