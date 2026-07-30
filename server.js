import express from 'express';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';
import fs from 'fs';
import path from 'path';

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
    const entry = { id: Date.now(), content, embedding, metadata: metadata || {}, createdAt: new Date().toISOString() };
    memoryStore[userEmail] = memoryStore[userEmail] || [];
    memoryStore[userEmail].push(entry);
    persistStore();
    res.json({ ok: true, entry });
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
    const items = (memoryStore[userEmail] || []).map(entry => ({ id: entry.id, content: entry.content, score: cosine(qEmb, entry.embedding), metadata: entry.metadata }));
    items.sort((a, b) => b.score - a.score);
    const top = items.slice(0, topK);
    res.json({ items: top });
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
  const { message, subject, history, subjects, goals, messageHistory } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Mensagem inválida' });
  }

  if (!openai) {
    return res.json({ reply: fallbackResponse(message, subject) });
  }

  try {
    const systemPrompt = `Você é a mentora de estudos SYNARA. Sua missão é ajudar o aluno a aprender melhor, organizar matérias, criar planos de estudo e responder dúvidas de forma clara, acolhedora e prática. Use linguagem empática, explicações passo a passo, exemplos simples e, sempre que possível, proponha um pequeno plano de estudo baseado nas metas e nas matérias registradas. Se houver metas informadas, recomende próximos passos práticos para atingi-las, incluindo revisão, prática e pausas. Se não houver metas, sugira um plano geral de revisão para a matéria atual.`;

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
      subjects && subjects.length ? `Matérias do estudante: ${subjects.join(', ')}` : null,
      goals && goals.length ? `Metas do dia: ${goals.join(' | ')}` : 'Sem metas registradas no momento.',
      historySummary || null,
      `Pergunta: ${message}`,
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

app.listen(PORT, () => {
  console.log(`SYNARA API rodando em http://localhost:${PORT}`);
});
