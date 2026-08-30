import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import sqlite3 from 'sqlite3';
import { Pool } from 'pg';
import { OpenAI } from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'synara-dev-secret-change-me';
const SESSION_COOKIE = 'synara_session';
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STORE_PATH = path.resolve('./memory_store.json');

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static('.'));

const openAiKey = process.env.OPENAI_API_KEY;
const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

let pgPool = null;
let sqliteDb = null;
let memoryStore = {};

function persistStore() {
  try {
    fs.writeFileSync(STORE_PATH, JSON.stringify(memoryStore, null, 2));
  } catch (error) {
    console.error('Error persisting memory store:', error.message);
  }
}

try {
  if (fs.existsSync(STORE_PATH)) {
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    memoryStore = raw ? JSON.parse(raw) : {};
  }
} catch (error) {
  console.warn('Could not read memory store:', error.message);
  memoryStore = {};
}

function parseProfile(value, fallback = {}) {
  if (!value) return fallback;
  try {
    return typeof value === 'string' ? JSON.parse(value) : value;
  } catch {
    return fallback;
  }
}

function buildSafeUser(row) {
  const profile = parseProfile(row.profile || row.profile_json || {}, {});
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    profile,
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    subjects: Array.isArray(profile.subjects) ? profile.subjects : [],
    goals: Array.isArray(profile.goals) ? profile.goals : [],
    studySessions: Array.isArray(profile.studySessions) ? profile.studySessions : [],
    schedule: Array.isArray(profile.schedule) ? profile.schedule : [],
    exerciseResults: Array.isArray(profile.exerciseResults) ? profile.exerciseResults : [],
    contentStats: profile.contentStats && typeof profile.contentStats === 'object' ? profile.contentStats : {},
    wellbeing: profile.wellbeing || { mood: '', updatedAt: null }
  };
  return user;
}

function signToken(id, email) {
  return jwt.sign({ sub: id, email }, JWT_SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ONE_WEEK_MS,
    path: '/'
  });
}

function clearAuthCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

async function initDatabase() {
  if (process.env.DATABASE_URL) {
    pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        profile JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding JSONB NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    console.log('Using PostgreSQL database');
    return;
  }

  const dataDir = path.resolve('./.data');
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, 'synara.db');
  sqliteDb = new sqlite3.Database(dbPath);

  await new Promise((resolve, reject) => {
    sqliteDb.serialize(() => {
      sqliteDb.run(`
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          profile TEXT NOT NULL DEFAULT '{}',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `, (error) => {
        if (error) return reject(error);
        sqliteDb.run(`
          CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            used_at TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
          );
        `, (tokenError) => {
          if (tokenError) return reject(tokenError);
          resolve();
        });
      });
    });
  });

  console.log('Using SQLite database fallback');
}

async function fetchUserById(id) {
  if (pgPool) {
    const result = await pgPool.query('SELECT * FROM users WHERE id = $1', [id]);
    return result.rows[0] || null;
  }

  return new Promise((resolve, reject) => {
    sqliteDb.get('SELECT * FROM users WHERE id = ?', [id], (error, row) => error ? reject(error) : resolve(row || null));
  });
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (pgPool) {
    const result = await pgPool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [normalizedEmail]);
    return result.rows[0] || null;
  }

  return new Promise((resolve, reject) => {
    sqliteDb.get('SELECT * FROM users WHERE lower(email) = lower(?)', [normalizedEmail], (error, row) => error ? reject(error) : resolve(row || null));
  });
}

async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Sessão expirada ou não autenticado.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await fetchUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
    }
    req.user = buildSafeUser(user);
    return next();
  } catch {
    return res.status(401).json({ success: false, message: 'Sessão expirada ou não autenticada.' });
  }
}

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanName || !cleanEmail || !password) {
    return res.status(400).json({ success: false, message: 'Preencha nome, e-mail e senha.' });
  }

  if (cleanName.length < 2) {
    return res.status(400).json({ success: false, message: 'Informe um nome válido.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ success: false, message: 'Informe um e-mail válido.' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ success: false, message: 'A senha precisa ter pelo menos 6 caracteres.' });
  }

  try {
    const existing = await findUserByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Este e-mail já está cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    if (pgPool) {
      const result = await pgPool.query(
        'INSERT INTO users (name, email, password_hash, profile) VALUES ($1, $2, $3, $4) RETURNING id, name, email, profile, created_at, updated_at',
        [cleanName, cleanEmail, passwordHash, JSON.stringify({})]
      );
      const user = buildSafeUser(result.rows[0]);
      return res.status(201).json({ success: true, user, message: 'Cadastro realizado com sucesso.' });
    }

    const insertResult = await new Promise((resolve, reject) => {
      sqliteDb.run(
        'INSERT INTO users (name, email, password_hash, profile) VALUES (?, ?, ?, ?)',
        [cleanName, cleanEmail, passwordHash, JSON.stringify({})],
        function onInsert(error) {
          if (error) return reject(error);
          resolve({ lastID: this.lastID });
        }
      );
    });

    const created = await new Promise((resolve, reject) => {
      sqliteDb.get('SELECT * FROM users WHERE id = ?', [insertResult.lastID], (error, row) => error ? reject(error) : resolve(row));
    });

    return res.status(201).json({ success: true, user: buildSafeUser(created), message: 'Cadastro realizado com sucesso.' });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível concluir o cadastro no momento.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanEmail || !password) {
    return res.status(400).json({ success: false, message: 'Informe e-mail e senha.' });
  }

  try {
    const row = await findUserByEmail(cleanEmail);
    if (!row) {
      return res.status(401).json({ success: false, message: 'E-mail ou senha incorretos.' });
    }

    const isValidPassword = await bcrypt.compare(String(password), row.password_hash || row.passwordHash);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: 'E-mail ou senha incorretos.' });
    }

    const user = buildSafeUser(row);
    const token = signToken(user.id, user.email);
    setAuthCookie(res, token);
    return res.json({ success: true, user, token, message: 'Login realizado com sucesso.' });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível fazer login no momento.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  clearAuthCookie(res);
  return res.json({ success: true, message: 'Logout realizado com sucesso.' });
});

app.get('/api/auth/me', async (req, res) => {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Sessão expirada ou não autenticada.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await fetchUserById(payload.sub);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
    }
    return res.json({ success: true, user: buildSafeUser(user) });
  } catch {
    return res.status(401).json({ success: false, message: 'Sessão expirada ou não autenticada.' });
  }
});

app.put('/api/user/profile', requireAuth, async (req, res) => {
  const incomingProfile = req.body?.profile && typeof req.body.profile === 'object' ? req.body.profile : {};
  const mergedProfile = {
    ...((req.user?.profile) || {}),
    ...incomingProfile,
    subjects: Array.isArray(incomingProfile.subjects) ? incomingProfile.subjects : ((req.user?.profile?.subjects) || []),
    goals: Array.isArray(incomingProfile.goals) ? incomingProfile.goals : ((req.user?.profile?.goals) || []),
    studySessions: Array.isArray(incomingProfile.studySessions) ? incomingProfile.studySessions : ((req.user?.profile?.studySessions) || []),
    schedule: Array.isArray(incomingProfile.schedule) ? incomingProfile.schedule : ((req.user?.profile?.schedule) || []),
    exerciseResults: Array.isArray(incomingProfile.exerciseResults) ? incomingProfile.exerciseResults : ((req.user?.profile?.exerciseResults) || []),
    contentStats: incomingProfile.contentStats && typeof incomingProfile.contentStats === 'object' ? incomingProfile.contentStats : ((req.user?.profile?.contentStats) || {}),
    wellbeing: incomingProfile.wellbeing || ((req.user?.profile?.wellbeing) || { mood: '', updatedAt: null })
  };

  try {
    if (pgPool) {
      const result = await pgPool.query(
        'UPDATE users SET profile = $1, updated_at = now() WHERE id = $2 RETURNING id, name, email, profile, created_at, updated_at',
        [JSON.stringify(mergedProfile), req.user.id]
      );
      return res.json({ success: true, user: buildSafeUser(result.rows[0]) });
    }

    await new Promise((resolve, reject) => {
      sqliteDb.run(
        'UPDATE users SET profile = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [JSON.stringify(mergedProfile), req.user.id],
        (error) => error ? reject(error) : resolve()
      );
    });

    const row = await fetchUserById(req.user.id);
    return res.json({ success: true, user: buildSafeUser(row) });
  } catch (error) {
    console.error('Update profile error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível salvar os dados do usuário.' });
  }
});

app.post('/api/auth/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ success: false, message: 'Informe o e-mail da conta.' });
  }

  try {
    const row = await findUserByEmail(email);
    if (!row) {
      return res.json({ success: true, message: 'Se o e-mail existir, enviaremos instruções para recuperação.' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    if (pgPool) {
      await pgPool.query('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)', [row.id, token, expiresAt]);
    } else {
      await new Promise((resolve, reject) => {
        sqliteDb.run('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)', [row.id, token, expiresAt], (error) => error ? reject(error) : resolve());
      });
    }

    const showToken = process.env.NODE_ENV !== 'production';
    return res.json({
      success: true,
      message: 'Se o e-mail existir, enviaremos instruções para recuperação.',
      resetToken: showToken ? token : undefined,
      resetTokenHint: showToken ? 'Use este token para testar a recuperação localmente.' : undefined
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível processar a recuperação de senha.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || String(password).length < 6) {
    return res.status(400).json({ success: false, message: 'Token e nova senha válidos são obrigatórios.' });
  }

  try {
    let resetRecord = null;
    if (pgPool) {
      const result = await pgPool.query('SELECT * FROM password_reset_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > now()', [token]);
      resetRecord = result.rows[0] || null;
    } else {
      resetRecord = await new Promise((resolve, reject) => {
        sqliteDb.get('SELECT * FROM password_reset_tokens WHERE token = ? AND used_at IS NULL AND expires_at > ?', [token, new Date().toISOString()], (error, row) => error ? reject(error) : resolve(row || null));
      });
    }

    if (!resetRecord) {
      return res.status(400).json({ success: false, message: 'Token inválido ou expirado.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    if (pgPool) {
      await pgPool.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [passwordHash, resetRecord.user_id]);
      await pgPool.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [resetRecord.id]);
    } else {
      await new Promise((resolve, reject) => {
        sqliteDb.run('UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [passwordHash, resetRecord.user_id], (error) => error ? reject(error) : resolve());
      });
      await new Promise((resolve, reject) => {
        sqliteDb.run('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [resetRecord.id], (error) => error ? reject(error) : resolve());
      });
    }

    return res.json({ success: true, message: 'Senha redefinida com sucesso.' });
  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível redefinir a senha.' });
  }
});

function cosine(a, b) {
  const dot = a.reduce((sum, value, index) => sum + value * b[index], 0);
  const na = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  const nb = Math.sqrt(b.reduce((sum, value) => sum + value * value, 0));
  if (na === 0 || nb === 0) return 0;
  return dot / (na * nb);
}

async function createEmbedding(text) {
  if (!openai) throw new Error('OpenAI API key not configured');
  const response = await openai.embeddings.create({ model: 'text-embedding-3-small', input: text });
  return response.data[0].embedding;
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
  } catch (error) {
    console.error('Indexing error:', error);
    res.status(500).json({ error: 'Indexing failed' });
  }
});

app.post('/api/embeddings/query', async (req, res) => {
  const { userEmail, query, topK = 3 } = req.body;
  if (!userEmail || !query) return res.status(400).json({ error: 'Missing userEmail or query' });

  try {
    const qEmb = await createEmbedding(query);

    if (pgPool) {
      const dbRes = await pgPool.query('SELECT id, content, embedding, metadata FROM embeddings WHERE user_email = $1', [userEmail]);
      const items = dbRes.rows.map((entry) => ({ id: entry.id, content: entry.content, score: cosine(qEmb, entry.embedding), metadata: entry.metadata }));
      items.sort((a, b) => b.score - a.score);
      const top = items.slice(0, topK);
      res.json({ items: top, source: 'pg' });
      return;
    }

    const items = (memoryStore[userEmail] || []).map((entry) => ({ id: entry.id, content: entry.content, score: cosine(qEmb, entry.embedding), metadata: entry.metadata }));
    items.sort((a, b) => b.score - a.score);
    const top = items.slice(0, topK);
    res.json({ items: top, source: 'local' });
  } catch (error) {
    console.error('Query error:', error);
    res.status(500).json({ error: 'Query failed' });
  }
});

function fallbackResponse(message, subject = 'Geral') {
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

  const isAmbiguous = (text) => {
    if (!text) return true;
    const value = text.trim();
    if (value.length < 20) return true;
    if (/tudo sobre|tudo|me explica tudo|resuma tudo/.test(value.toLowerCase())) return true;
    return false;
  };

  const { clarification, originalMessage } = req.body;
  if (!clarification && isAmbiguous(message)) {
    return res.json({ clarify: true, question: 'Você prefere um resumo rápido, uma explicação passo a passo ou um exercício prático?' });
  }

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

    let historySummary = '';
    if (Array.isArray(messageHistory) && messageHistory.length) {
      const last = messageHistory.slice(-6).map((entry) => `${entry.role.toUpperCase()}: ${entry.content}`).join('\n');
      historySummary = `Resumo do histórico (últimas mensagens):\n${last}`;
      if (historySummary.length > 800) {
        historySummary = `Resumo (truncado):\n${historySummary.slice(-800)}`;
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
      .flatMap((item) => item?.content || [])
      .map((chunk) => chunk?.text || '')
      .filter(Boolean)
      .join(' ') || fallbackResponse(message, subject);

    return res.json({ reply });
  } catch (error) {
    console.error('OpenAI error:', error);
    return res.json({ reply: fallbackResponse(message, subject) });
  }
});

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
    const exercise = response.output_text || (response.output || []).flatMap((item) => item?.content || []).map((chunk) => chunk?.text || '').join(' ');
    return res.json({ exercise });
  } catch (error) {
    console.error('Generate exercise error:', error);
    return res.status(500).json({ error: 'Erro ao gerar exercício' });
  }
});

async function startServer() {
  await initDatabase();
  app.listen(PORT, () => {
    console.log(`SYNARA API rodando em http://localhost:${PORT}`);
  });
}

startServer();
