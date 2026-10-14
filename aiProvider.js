// ===========================================================================
// SYNARA — FASE 2: PROVEDORES DE IA (Gemini principal, OpenAI alternativa)
// ---------------------------------------------------------------------------
// Este modulo concentra TODA a comunicacao com provedores externos de IA, para
// O Google Gemini e o provedor PRINCIPAL de geracao de texto; a OpenAI segue
// como alternativa e os fallbacks locais do server.js permanecem intactos.
//
// Principios desta fase (preparacao, sem mudanca de comportamento):
//   1. TEXTO MULTIPROVEDOR. O Gemini e o provedor PRINCIPAL de geracao de
//      texto quando configurado; a OpenAI e a alternativa e os fallbacks
//      locais do server.js continuam sendo a ultima linha de defesa.
//   2. DEPENDENCIAS MINIMAS. Usa os SDKs oficiais `openai` e `@google/genai`.
//   3. RESOLUCAO PREGUICOSA. Os provedores sao resolvidos na PRIMEIRA chamada,
//      nunca no carregamento do modulo. Isso preserva a ordem do dotenv
//      (server.js chama dotenv.config() no corpo do modulo, DEPOIS dos imports)
//      e garante que a ausencia de chave NAO derruba a inicializacao.
//   4. RESPONSABILIDADES SEPARADAS. Gerar a resposta da Mentora, gerar um
//      exercicio e gerar embeddings sao operacoes distintas, com funcoes
//      publicas proprias.
//   5. EMBEDDINGS ISOLADOS. Embeddings sao resolvidos por um caminho SEPARADO
//      do texto. Uma migracao futura pode trocar o provedor de TEXTO (Gemini)
//      sem mexer no provedor de EMBEDDINGS, evitando misturar vetores de
//      modelos diferentes na mesma comparacao de similaridade.
// ===========================================================================

import { OpenAI } from 'openai';
import { GoogleGenAI } from '@google/genai';

// ---------------------------------------------------------------------------
// MODELOS E PARAMETROS.
// ---------------------------------------------------------------------------
// OpenAI (alternativa de TEXTO e unico provedor de EMBEDDINGS nesta fase).
const OPENAI_TEXT_MODEL = 'gpt-4.1-mini';
const OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';
// Dimensao declarada do modelo de embeddings da OpenAI. Compõe a IDENTIDADE DE
// FORMATO (ver buildEmbeddingFormat) sem duplicar strings de modelo no
// server.js; a dimensao REAL de cada vetor e conferida na gravacao.
const OPENAI_EMBEDDING_DIM = 1536;
// Versao do formato. Incrementar quando a SEMANTICA do vetor mudar sem que
// provedor/modelo/dimensao mudem (ex.: troca do texto de entrada). Como entra na
// identidade, vetores antigos deixam de ser comparados com os novos de forma
// automatica — nunca por suposicao.
const EMBEDDING_FORMAT_VERSION = 1;
// Gemini (provedor PRINCIPAL de TEXTO). Modelo configuravel por
// GEMINI_TEXT_MODEL. A lista de fallback so entra em acao quando o modelo
// pedido NAO existe / nao esta disponivel para a chave (HTTP 404) — nunca em
// erros de autenticacao, quota (429) ou indisponibilidade transitoria.
const DEFAULT_GEMINI_TEXT_MODEL = 'gemini-2.5-flash';
const GEMINI_TEXT_MODEL_FALLBACKS = ['gemini-flash-latest'];
// Timeout (ms) por requisicao ao Gemini. Configuravel por GEMINI_TIMEOUT_MS.
const DEFAULT_GEMINI_TIMEOUT_MS = 30000;
// Tentativas adicionais APENAS em erros transitorios (indisponibilidade/timeout).
// 1 = uma nova tentativa. Nunca em 401/403/429.
const TRANSIENT_RETRIES = 1;
// Preferencia de provedor de texto: 'auto' | 'gemini' | 'openai'.
const DEFAULT_TEXT_PROVIDER = 'auto';

// Le uma variavel de ambiente nao vazia (sem expor o valor em nenhum lugar).
function readKey(env, name) {
  const value = env ? env[name] : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

// Normaliza a resposta de texto da API de Responses em uma string unica.
// Extracao identica a que existia inline em server.js (sem mudanca de resultado).
export function extractResponseText(response) {
  if (!response) return '';
  if (response.output_text) return response.output_text;
  return (response.output || [])
    .flatMap((item) => item?.content || [])
    .map((chunk) => chunk?.text || '')
    .filter(Boolean)
    .join(' ');
}

// Normaliza a resposta de TEXTO do SDK do Gemini em uma string unica.
// Usa o getter `response.text` (string | undefined) e, quando ele nao entrega
// texto, le explicitamente candidates[0].content.parts[].text. Respostas
// bloqueadas (sem candidatos) resultam em string vazia — nunca em excecao.
export function extractGeminiText(response) {
  if (!response) return '';
  try {
    const text = response.text;
    if (typeof text === 'string' && text) return text;
  } catch {
    // O getter pode lancar em respostas sem candidatos (conteudo bloqueado).
  }
  const parts = response.candidates && response.candidates[0] && response.candidates[0].content
    ? response.candidates[0].content.parts
    : null;
  if (Array.isArray(parts)) {
    return parts
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .filter(Boolean)
      .join(' ');
  }
  return '';
}

// Sanitiza erros de provedor ANTES de qualquer log. Mesma ideia do
// sanitizePgError do server.js: encurta a mensagem e substitui padroes de
// segredo por <REDACTED>. NUNCA deixa uma chave/token vazar para o log.
export function sanitizeAiError(error) {
  const message = error && error.message
    ? String(error.message)
    : (typeof error === 'string' ? error : '');
  const raw = message || 'erro desconhecido';
  const status = error && error.status ? ` (HTTP ${String(error.status).slice(0, 6)})` : '';
  const code = error && error.code ? ` [${String(error.code).slice(0, 24)}]` : '';
  const clean = raw
    .replace(/(api[_-]?key|apikey|authorization|bearer|token|secret|password|senha)\s*[:=]?\s*\S+/gi, '$1=<REDACTED>')
    .replace(/\b(sk-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{6,}|AQ\.[A-Za-z0-9._-]{10,})\b/g, '<REDACTED>')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 300);
  return clean + status + code;
}

// Erro TRANSITORIO? Indisponibilidade, timeout ou limite de conexao — vale uma
// nova tentativa. NUNCA para 401/403 (autenticacao) nem 429 (quota): repetir
// ali so gastaria tempo/cota sem chance de sucesso.
export function isTransientAiError(error) {
  const status = Number(error && error.status);
  if ([408, 425, 500, 502, 503, 504, 522, 524].includes(status)) return true;
  if ([400, 401, 403, 404, 429].includes(status)) return false;
  const code = String((error && error.code) || '').toUpperCase();
  if (['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ABORT_ERR'].includes(code)) return true;
  const message = String((error && error.message) || '');
  return /timed? out|timeout|temporar|unavailable|overloaded|try again|econnreset|socket hang up|network error/i.test(message);
}

// O MODELO pedido nao existe / nao esta disponivel para a chave (HTTP 404)?
// SOMENTE nesse caso vale tentar o proximo modelo da lista de fallback.
export function isModelUnavailableError(error) {
  if (Number(error && error.status) === 404) return true;
  const message = String((error && error.message) || '');
  return /not found|not_found|is not supported|unsupported model|does not exist|no such model|invalid model name|model not available/i.test(message);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// PROVEDOR DE TEXTO — OpenAI (Responses API).
// `client` opcional permite injetar um cliente falso nos testes (sem rede).
// `env` opcional permite resolver contra um ambiente controlado nos testes.
// ---------------------------------------------------------------------------
export function createOpenAiTextProvider({ client, env = process.env } = {}) {
  const apiKey = readKey(env, 'OPENAI_API_KEY');
  const baseURL = readKey(env, 'OPENAI_BASE_URL');
  const ai = client || (apiKey ? new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }) : null);
  if (!ai) return null;

  return {
    id: 'openai',
    model: OPENAI_TEXT_MODEL,
    async generateReply({ instructions, input, temperature }) {
      const response = await ai.responses.create({ model: OPENAI_TEXT_MODEL, temperature, instructions, input });
      return extractResponseText(response);
    },
    async generateExercise({ input, temperature }) {
      const response = await ai.responses.create({ model: OPENAI_TEXT_MODEL, input, temperature });
      return extractResponseText(response);
    }
  };
}

// ---------------------------------------------------------------------------
// P0-10 (C1/C3) — VALIDACAO DO VETOR DE EMBEDDING.
// ---------------------------------------------------------------------------
// Um vetor so e aceito se for um array NAO VAZIO de numeros FINITOS e se a
// dimensao coincidir EXATAMENTE com a declarada pelo formato. A dimensao
// declarada NUNCA e "corrigida" para casar com um resultado inesperado: a
// divergencia e um ERRO OPERACIONAL. As mensagens trazem apenas dimensoes/indices
// — nunca chave de API, conteudo de material ou dado de estudante.
// ---------------------------------------------------------------------------
export function validateEmbeddingVector(vector, expectedDim) {
  if (!Array.isArray(vector)) {
    throw new Error('Embedding provider returned a non-array vector');
  }
  if (vector.length === 0) {
    throw new Error('Embedding provider returned an empty vector');
  }
  if (Number.isInteger(expectedDim) && expectedDim > 0 && vector.length !== expectedDim) {
    throw new Error(`Embedding dimension mismatch: expected ${expectedDim}, received ${vector.length}`);
  }
  for (let i = 0; i < vector.length; i += 1) {
    const value = vector[i];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Embedding vector has a non-finite value at index ${i}`);
    }
  }
  return vector;
}

// ---------------------------------------------------------------------------
// PROVEDOR DE EMBEDDINGS — OpenAI. Caminho SEPARADO do texto (ver cabecalho):
// a futura migracao de embeddings nao deve reutilizar o provedor de texto.
// ---------------------------------------------------------------------------
export function createOpenAiEmbeddingProvider({ client, env = process.env } = {}) {
  const apiKey = readKey(env, 'OPENAI_API_KEY');
  const baseURL = readKey(env, 'OPENAI_BASE_URL');
  const ai = client || (apiKey ? new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }) : null);
  if (!ai) return null;

  return {
    id: 'openai',
    model: OPENAI_EMBEDDING_MODEL,
    dimension: OPENAI_EMBEDDING_DIM,
    async embed(text) {
      const response = await ai.embeddings.create({ model: OPENAI_EMBEDDING_MODEL, input: text });
      const vector = response && response.data && response.data[0] ? response.data[0].embedding : null;
      // P0-10 (C1/C3) — nunca aceitar (nem persistir) um vetor invalido ou com
      // dimensao divergente da declarada pelo formato.
      return validateEmbeddingVector(vector, OPENAI_EMBEDDING_DIM);
    }
  };
}

// ---------------------------------------------------------------------------
// PROVEDOR DE TEXTO — Google Gemini (SDK oficial @google/genai).
//  - Le GEMINI_API_KEY SOMENTE no backend (env injetado / process.env).
//  - Modelo configuravel por GEMINI_TEXT_MODEL; a lista de fallback de MODELO
//    so e usada quando o modelo pedido nao existe para a chave (HTTP 404).
//  - systemInstruction + temperature preservam as instrucoes pedagogicas da
//    Mentora. O contexto/historico continuam chegando dentro de `contents`.
//  - Uma nova tentativa apenas em erros transitorios (TRANSIENT_RETRIES).
// ---------------------------------------------------------------------------
export function createGeminiTextProvider({ client, env = process.env } = {}) {
  const apiKey = readKey(env, 'GEMINI_API_KEY');
  // GEMINI_BASE_URL permite apontar para um endpoint alternativo/stub local em
  // testes (espelha o OPENAI_BASE_URL). Em producao fica vazio -> endpoint oficial.
  const baseUrl = readKey(env, 'GEMINI_BASE_URL');
  const ai = client || (apiKey ? new GoogleGenAI({ apiKey, ...(baseUrl ? { httpOptions: { baseUrl } } : {}) }) : null);
  if (!ai) return null;

  const configuredModel = readKey(env, 'GEMINI_TEXT_MODEL') || DEFAULT_GEMINI_TEXT_MODEL;
  const models = [configuredModel, ...GEMINI_TEXT_MODEL_FALLBACKS.filter((name) => name !== configuredModel)];
  const timeoutMs = Number(env.GEMINI_TIMEOUT_MS) > 0 ? Number(env.GEMINI_TIMEOUT_MS) : DEFAULT_GEMINI_TIMEOUT_MS;

  async function generate(contents, temperature, systemInstruction) {
    let lastError = null;
    for (const model of models) {
      let attempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          const config = { temperature, httpOptions: { timeout: timeoutMs } };
          if (systemInstruction) config.systemInstruction = systemInstruction;
          const response = await ai.models.generateContent({ model, contents, config });
          return extractGeminiText(response);
        } catch (error) {
          lastError = error;
          if (isModelUnavailableError(error)) break; // tenta o proximo MODELO
          if (isTransientAiError(error) && attempt < TRANSIENT_RETRIES) {
            attempt += 1;
            await delay(250 * attempt);
            continue; // mesma requisicao: nova tentativa
          }
          throw error;
        }
      }
    }
    throw lastError || new Error('Gemini text provider unavailable');
  }

  return {
    id: 'gemini',
    model: configuredModel,
    async generateReply({ instructions, input, temperature }) {
      return generate(input, temperature, instructions);
    },
    async generateExercise({ input, temperature }) {
      return generate(input, temperature, undefined);
    }
  };
}

// ---------------------------------------------------------------------------
// REGISTRO DE PROVEDORES. ORDEM DE PREFERENCIA.
// TEXTO: Gemini (principal) e OpenAI (alternativa), conforme AI_TEXT_PROVIDER.
// EMBEDDINGS: somente OpenAI nesta fase — a migracao vetorial e uma fase
// separada e NAO deve ser acoplada a troca do provedor de texto.
// ---------------------------------------------------------------------------
const TEXT_PROVIDER_FACTORIES = {
  gemini: createGeminiTextProvider,
  openai: createOpenAiTextProvider
};
const EMBEDDING_PROVIDER_FACTORIES = [createOpenAiEmbeddingProvider];

// Ordem de preferencia dos provedores de TEXTO.
//  - AI_TEXT_PROVIDER=openai -> SOMENTE OpenAI (respeita a escolha explicita do
//    operador; nenhum fallback silencioso para o Gemini).
//  - AI_TEXT_PROVIDER=gemini ou 'auto' (padrao) -> Gemini primeiro, OpenAI
//    como alternativa quando estiver configurada.
export function textProviderOrder(env = process.env) {
  const preference = (readKey(env, 'AI_TEXT_PROVIDER') || DEFAULT_TEXT_PROVIDER).toLowerCase();
  if (preference === 'openai') return ['openai'];
  return ['gemini', 'openai'];
}

// Lista, EM ORDEM, dos provedores de TEXTO configurados.
export function resolveTextProviders(env = process.env) {
  const providers = [];
  for (const id of textProviderOrder(env)) {
    const factory = TEXT_PROVIDER_FACTORIES[id];
    if (!factory) continue;
    const provider = factory({ env });
    if (provider) providers.push(provider);
  }
  return providers;
}

// Primeiro provedor de TEXTO (compatibilidade com a API publica da Fase 1).
export function resolveTextProvider(env = process.env) {
  return resolveTextProviders(env)[0] || null;
}

export function resolveEmbeddingProvider(env = process.env) {
  for (const factory of EMBEDDING_PROVIDER_FACTORIES) {
    const provider = factory({ env });
    if (provider) return provider;
  }
  return null;
}

export function resolveProviders(env = process.env) {
  return {
    text: resolveTextProvider(env),
    embedding: resolveEmbeddingProvider(env)
  };
}

// Executa a cadeia de TEXTO: devolve a resposta do PRIMEIRO provedor que
// responder. O proximo so e chamado quando o anterior FALHA ou devolve resposta
// vazia — nunca ha duas chamadas bem-sucedidas para a mesma mensagem.
export async function attemptTextProviders(providers, method, params) {
  let lastError = null;
  for (const provider of providers) {
    try {
      const text = await provider[method](params);
      if (typeof text === 'string' && text.trim()) return text;
      lastError = new Error('Empty response from ' + provider.id);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Text AI provider not configured');
}

// ---------------------------------------------------------------------------
// RESOLUCAO ATIVA (singleton preguicoso). A cadeia de TEXTO e os embeddings sao
// resolvidos na PRIMEIRA chamada (nunca no import): o dotenv ja foi aplicado
// pelo server.js e a ausencia de chave nao derruba a inicializacao.
// ---------------------------------------------------------------------------
let activeTextChain = [];
let activeEmbedding = null;
let activeResolved = false;

function resolveActive() {
  if (activeResolved) return;
  activeResolved = true;
  activeTextChain = resolveTextProviders();
  activeEmbedding = resolveEmbeddingProvider();
}

export function getTextProviderId() {
  resolveActive();
  return activeTextChain.length ? activeTextChain[0].id : null;
}

export function getEmbeddingProviderId() {
  resolveActive();
  return activeEmbedding ? activeEmbedding.id : null;
}

// ---------------------------------------------------------------------------
// P0-7 — IDENTIDADE DE FORMATO DAS EMBEDDINGS.
// ---------------------------------------------------------------------------
// Um vetor so pode ser comparado com outro se AMBOS vierem do MESMO formato.
// Dimensao igual NAO basta: dois modelos distintos podem ter 1536 dimensoes e
// espacos semanticos diferentes. O identificador e estavel e explicito:
//
//     <provider>:<model>:<dimension>:v<version>
//     ex.: openai:text-embedding-3-small:1536:v1
//
// Ele e DERIVADO da configuracao efetiva do provedor (nunca de uma string de
// modelo duplicada no server.js) e nao existe "default" adivinhado.
// ---------------------------------------------------------------------------

// Puro: permite testar a identidade sem tocar no singleton do modulo.
export function buildEmbeddingFormat(provider, version = EMBEDDING_FORMAT_VERSION) {
  if (!provider || !provider.id || !provider.model || !provider.dimension) return null;
  const providerId = String(provider.id);
  const model = String(provider.model);
  const dimension = Number(provider.dimension);
  if (!Number.isInteger(dimension) || dimension <= 0) return null;
  return {
    provider: providerId,
    model,
    dimension,
    version,
    key: `${providerId}:${model}:${dimension}:v${version}`
  };
}

// Formato do provedor ATIVO (null quando nao ha provedor de embeddings).
export function getEmbeddingFormat() {
  resolveActive();
  return buildEmbeddingFormat(activeEmbedding);
}

// Identificador estavel do formato ativo (null sem provedor). E o valor gravado
// na coluna format_key das tabelas de embeddings.
export function getEmbeddingFormatId() {
  const format = getEmbeddingFormat();
  return format ? format.key : null;
}

// ---------------------------------------------------------------------------
// API PUBLICA consumida pelo server.js. Nomes alinhados ao codigo anterior
// (createEmbedding) e as duas operacoes de TEXTO separadas por responsabilidade.
// ---------------------------------------------------------------------------
export function isTextProviderAvailable() {
  resolveActive();
  return activeTextChain.length > 0;
}

export function isEmbeddingProviderAvailable() {
  resolveActive();
  return Boolean(activeEmbedding);
}

export async function generateMentorReply(params) {
  resolveActive();
  if (!activeTextChain.length) throw new Error('Text AI provider not configured');
  return attemptTextProviders(activeTextChain, 'generateReply', params);
}

export async function generateExerciseText(params) {
  resolveActive();
  if (!activeTextChain.length) throw new Error('Text AI provider not configured');
  return attemptTextProviders(activeTextChain, 'generateExercise', params);
}

export async function createEmbedding(text) {
  resolveActive();
  if (!activeEmbedding) throw new Error('Embedding AI provider not configured');
  return activeEmbedding.embed(text);
}

