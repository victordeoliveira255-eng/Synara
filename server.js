import express from 'express';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

const openAiKey = process.env.OPENAI_API_KEY;
const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

// Simple local vector store (prototype) persisted to memory_store.json
const STORE_PATH = path.resolve('./memory_store.json');
let memoryStore = {};
try {
  if (fs.existsSync(STORE_PATH)) {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    memoryStore = raw ? JSON.parse(raw) : {};
  }
} catch (e) {
  console.warn('Could not read memory store:', e.message);
  memoryStore = {};
}

// Optional Postgres pool (simple fallback to local file if not configured)
let pgPool = null;
const DATABASE_URL = process.env.DATABASE_URL;
if (DATABASE_URL) {
  pgPool = new Pool({ connectionString: DATABASE_URL });
  // ensure table exists
  (async () => {
    try {
      await pgPool.query(
        `CREATE TABLE IF NOT EXISTS embeddings (
          id SERIAL PRIMARY KEY,
          user_email TEXT,
          content TEXT,
          embedding JSONB,
          metadata JSONB,
          created_at TIMESTAMPTZ DEFAULT now()
        );`
      );
      console.log('Postgres embeddings table ready');
    } catch (err) {
      console.error('Error creating embeddings table:', err.message);
      pgPool = null;
    }
  })();
}

function persistStore() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(memoryStore, null, 2));
  } catch (e) {
    console.error('Error persisting memory store:', e.message);
  }
}

function cosine(a, b) {
  const dot = a.reduce((s, v, i) => s + v * b[i], 0);
  const na = Math.sqrt(a.reduce((s, v) => s + v * v, 0));
  const nb = Math.sqrt(b.reduce((s, v) => s + v * v, 0));
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

async function createEmbedding(text) {
  if (!openai) throw new Error('OpenAI API key not configured');
  const resp = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
  return resp.data[0].embedding;
}

app.post('/api/embeddings/index', async (req, res) => {
  const { userEmail, content, metadata } = req.body;
  if (!userEmail || !content) return res.status(400).json({ error: 'Missing userEmail or content' });
  try {
    const embedding = await createEmbedding(content);
    if (pgPool) {
      const result = await pgPool.query('INSERT INTO embeddings (user_email, content, embedding, metadata) VALUES ($1, $2, $3, $4) RETURNING id, created_at', [userEmail, content, embedding, metadata || {}]);
      const entry = { id: result.rows[0].id, content, embedding, metadata: metadata || {}, createdAt: result.rows[0].created_at };
      res.json({ ok: true, entry, source: 'pg' });
      return;
    }

    const entry = { id: Date.now(), content, embedding, metadata: metadata || {}, createdAt: new Date().toISOString() };
    memoryStore[userEmail] = memoryStore[userEmail] || [];
    memoryStore[userEmail].push(entry);
    persistStore();
    res.json({ ok: true, entry, source: 'local' });
  } catch (err) {
    console.error('Indexing error:', err);
    res.status(500).json({ error: 'Indexing failed' });
  }
});

app.post('/api/embeddings/query', async (req, res) => {
  const { userEmail, query, topK = 3 } = req.body;
  if (!userEmail || !query) return res.status(400).json({ error: 'Missing userEmail or query' });
  try {
    const qEmb = await createEmbedding(query);

    if (pgPool) {
      // fetch all user entries and compute similarity in JS (simple approach)
      const dbRes = await pgPool.query('SELECT id, content, embedding, metadata FROM embeddings WHERE user_email = $1', [userEmail]);
      const items = dbRes.rows.map(r => ({ id: r.id, content: r.content, score: cosine(qEmb, r.embedding), metadata: r.metadata }));
      items.sort((a, b) => b.score - a.score);
      const top = items.slice(0, topK);
      res.json({ items: top, source: 'pg' });
      return;
    }

    const items = (memoryStore[userEmail] || []).map(entry => ({ id: entry.id, content: entry.content, score: cosine(qEmb, entry.embedding), metadata: entry.metadata }));
    items.sort((a, b) => b.score - a.score);
    const top = items.slice(0, topK);
    res.json({ items: top, source: 'local' });
  } catch (err) {
    console.error('Query error:', err);
    res.status(500).json({ error: 'Query failed' });
  }
});

function fallbackResponse(message, subject = 'Geral') {
  // Respostas locais mais variadas e com pequenas sugestões de plano
  const text = (message || '').toLowerCase();
  const variations = (arr) => arr[Math.floor(Math.random() * arr.length)];

  if (/foco|concentra|distração|atenção/.test(text)) {
    return variations([
      'Tente blocos de 25 minutos (Pomodoro) com 5 minutos de pausa. Como está seu ambiente de estudo?',
      'Divida a tarefa em passos de 25 minutos e anote o que fará em cada bloco. Quer que eu monte um cronograma rápido?',
      'Experimente 3 blocos de 25 minutos focados, depois avalie o progresso. Quer eu sugira o primeiro passo?'
    ]);
  }

  if (/ansiedade|estresse|cansaço/.test(text)) {
    return variations([
      'Respire e faça uma pausa curta de 5–10 minutos; uma caminhada rápida ajuda. Quer que eu sugira um exercício de respiração?',
      'Reduza a intensidade por um momento e volte com metas menores. Posso sugerir uma tarefa bem curta para recuperar o ritmo.'
    ]);
  }

  if (/plano|rotina|agenda/.test(text)) {
    return variations([
      `Monte um plano curto: revisão (20 min), prática (30 min), revisão rápida (10 min) — adaptação para ${subject}. Quer que eu detalhe?`,
      `Sugiro priorizar 1 tópico difícil por sessão e 2 tópicos de revisão. Posso gerar um plano de 3 passos para ${subject}.`
    ]);
  }

  if (/revisão|exercício|questão/.test(text)) {
    return variations([
      'Revisar com questões é ótimo: faça 10 questões focadas no tópico e corrija explicando cada passo.',
      'Intercale teoria e prática: 20 min teoria + 20 min exercícios. Quer um exercício agora?'
    ]);
  }

  if (/começar|ajuda|o que/.test(text)) {
    return variations([
      `Vamos começar por ${subject}. Diga um subtema que quer priorizar e eu monto um plano de 3 passos.`,
      `Diga se prefere revisão ou prática em ${subject} — eu sugiro o primeiro passo.`
    ]);
  }

  // Caso geral: ofereça sugestão de objetivo e um próximo passo
  return variations([
    `Boa! Um objetivo claro ajuda: defina 20–40 minutos para focar em um tópico de ${subject} e faça um exercício ao final. Qual tópico você prefere?`,
    `Ótima pergunta! Posso explicar brevemente ou propor um exercício para ${subject}. O que prefere agora?`,
    `Vamos focar no próximo passo: escolha um ponto pequeno em ${subject} e praticamos juntos.`
  ]);
}

app.post('/api/chat', async (req, res) => {
  const { message, subject, history, subjects, goals, messageHistory, mode, topic, difficulty, progress, contentStats, recentSchedule } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Mensagem inválida' });
  }

  // Clarification flow: if message seems ambiguous, ask a quick clarifying question
  const isAmbiguous = (text) => {
    if (!text) return true;
    const t = text.trim();
    if (t.length < 20) return true;
    if (/tudo sobre|tudo|me explica tudo|resuma tudo/.test(t.toLowerCase())) return true;
    return false;
  };

  const { clarification, originalMessage } = req.body;
  if (!clarification && isAmbiguous(message)) {
    return res.json({ clarify: true, question: 'Você prefere um resumo rápido, uma explicação passo a passo ou um exercício prático?' });
  }

  // If the client provided a clarification, merge it into the question
  let effectiveMessage = message;
  if (clarification && originalMessage) {
    effectiveMessage = `${originalMessage}\n\nEsclarecimento do usuário: ${clarification}`;
  }

  if (!openai) {
    const modeHint = {
      explain: 'Vou explicar em etapas, começando pelo essencial.',
      understand: 'Antes de explicar tudo, vou fazer uma pergunta para descobrir o que você já sabe.',
      summary: 'Vou organizar os conceitos principais, pontos importantes e uma forma de lembrar.',
      practice: 'Vou propor uma questão progressiva e pedir que você explique seu raciocínio.',
      review: 'Vou revisar os pontos mais importantes e destacar o que merece nova prática.',
      tip: 'Vou sugerir uma estratégia prática para estudar este conteúdo.',
      exam: 'Vou montar uma sequência curta de revisão, prática e pausas para a prova.'
    }[mode] || '';
    return res.json({ reply: `${modeHint} ${fallbackResponse(message, topic || subject)}`.trim() });
  }

  try {
    const modeInstructions = {
      explain: 'Explique progressivamente, do conceito básico a um exemplo, verificando a compreensão antes de avançar.',
      understand: 'Atue como professor particular: faça uma pergunta diagnóstica primeiro e conduza o aluno com pistas, sem entregar a resposta imediatamente.',
      summary: 'Crie um resumo organizado com conceitos principais, pontos importantes e uma seção Para lembrar.',
      practice: 'Crie uma questão adequada ao nível, peça o raciocínio e analise o erro com cuidado, indicando a etapa que precisa ser revista.',
      review: 'Faça uma revisão ativa baseada no histórico, nos erros e no domínio do conteúdo; priorize os pontos frágeis.',
      tip: 'Dê estratégias concretas de estudo, incluindo duração, prática e pausas.',
      exam: 'Monte um plano até a prova com blocos de revisão, exercícios, simulado e pausas; peça os assuntos se eles não estiverem disponíveis.'
    };
    const systemPrompt = `Você é a Mentora Synara, uma tutora educacional integrada ao progresso do estudante. ${modeInstructions[mode] || modeInstructions.explain} Personalize sua resposta com matéria, conteúdo, dificuldade, progresso, metas, cronograma, histórico e erros quando disponíveis. Não entregue respostas prontas quando o modo pedir raciocínio guiado. Se não houver contexto suficiente, diga isso e peça o material ou detalhe necessário; nunca invente fatos. Seja clara, acolhedora e prática. O módulo de bem-estar só pode sugerir organização, pausas e equilíbrio de estudos, sem diagnosticar saúde mental.`;

    // Construir resumo curto do histórico quando fornecido como array
    let historySummary = '';
    if (Array.isArray(messageHistory) && messageHistory.length) {
      const last = messageHistory.slice(-6).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
      historySummary = `Resumo do histórico (últimas mensagens):\n${last}`;
      if (historySummary.length > 800) {
        historySummary = historySummary.slice(-800);
        historySummary = `Resumo (truncado):\n${historySummary}`;
      }
    } else if (history) {
      historySummary = `Histórico: ${history}`;
    }

    const fewShot = `Exemplos de respostas (formato esperado):\nUsuario: Estou com dificuldade em resolver equações de 2º grau.\nMentora: Vamos passo a passo: primeiro identifique os coeficientes... [resposta curta, exemplo de exercício]\n---\nUsuario: Preciso de um plano rápido para revisar química.\nMentora: Sugiro 3 passos: 1) revisar conceitos principais (20min), 2) resolver 5 exercícios, 3) revisar erros (15min).`;

    const details = [
      subject ? `Matéria atual: ${subject}` : 'Matéria atual: Geral',
      topic ? `Conteúdo atual: ${topic}` : 'Conteúdo atual: não informado',
      difficulty ? `Nível de dificuldade: ${difficulty}` : null,
      Number.isFinite(Number(progress)) ? `Progresso geral: ${progress}%` : null,
      contentStats ? `Desempenho no conteúdo: ${contentStats.correct || 0}/${contentStats.attempts || 0} acertos, domínio estimado ${contentStats.mastery || 0}%, erros recentes: ${JSON.stringify(contentStats.errors || [])}` : null,
      subjects && subjects.length ? `Matérias do estudante: ${subjects.join(', ')}` : null,
      goals && goals.length ? `Metas do dia: ${goals.join(' | ')}` : 'Sem metas registradas no momento.',
      recentSchedule?.length ? `Cronograma recente: ${JSON.stringify(recentSchedule)}` : null,
      historySummary || null,
      `Pergunta: ${effectiveMessage}`,
      fewShot
    ].filter(Boolean).join('\n\n');

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      temperature: 0.8,
      input: `${systemPrompt}\n\n${details}`
    });

    const reply = response.output_text || (response.output || [])
      .flatMap(item => item?.content || [])
      .map(chunk => chunk?.text || '')
      .filter(Boolean)
      .join(' ') || fallbackResponse(message, subject);

    res.json({ reply });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.json({ reply: fallbackResponse(message, subject) });
  }
});

// Endpoint para gerar exercício programaticamente
app.post('/api/generate-exercise', async (req, res) => {
  const { userEmail, subject, topic, difficulty = 'médio' } = req.body;
  if (!subject && !topic) return res.status(400).json({ error: 'Faltam parâmetros (subject/topic)' });
  try {
    if (!openai) {
      const currentTopic = topic || subject;
      const question = `Qual é uma boa estratégia para estudar ${currentTopic}?`;
      const options = [
        'Estudar em blocos curtos, praticar e revisar os erros.',
        'Ler o conteúdo uma única vez e não praticar.',
        'Evitar pausas para estudar sem parar.',
        'Decorar respostas sem entender o conceito.'
      ];
      return res.json({
        exercise: `${question}\nA) ${options[0]}\nB) ${options[1]}\nC) ${options[2]}\nD) ${options[3]}`,
        question,
        options,
        correctOption: 0,
        explanation: 'Blocos de estudo, prática e revisão dos erros ajudam a consolidar a aprendizagem.'
      });
    }

    const prompt = `Gere 1 exercício prático sobre ${topic || subject}, nível ${difficulty}. Inclua enunciado claro, passos para resolver e a solução explicada.`;
    const response = await openai.responses.create({ model: 'gpt-4.1-mini', input: prompt, temperature: 0.6 });
    const exercise = response.output_text || (response.output || []).flatMap(i => i?.content || []).map(c => c?.text || '').join(' ');
    res.json({ exercise });
  } catch (err) {
    console.error('Generate exercise error:', err);
    res.status(500).json({ error: 'Erro ao gerar exercício' });
  }
});

app.listen(PORT, () => {
  console.log(`SYNARA API rodando em http://localhost:${PORT}`);
});
