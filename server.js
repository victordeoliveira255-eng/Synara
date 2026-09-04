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
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import validator from 'validator';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'synara-dev-secret-change-me';
const SESSION_COOKIE = 'synara_session';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase(); // Empty by default - admin must be configured explicitly
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const STORE_PATH = path.resolve('./memory_store.json');
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',').map(o => o.trim());
const USER_ROLE = { USER: 'user', ADMIN: 'admin' };

// Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  }
}));

// CORS with whitelist
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
    res.header('Access-Control-Allow-Origin', origin || ALLOWED_ORIGINS[0]);
  }
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

async function requirePageAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) {
    if (req.accepts('html')) {
      return res.redirect('/login.html');
    }
    return res.status(401).json({ success: false, message: 'Sessão expirada ou não autenticado.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await fetchUserById(payload.sub);
    if (!user) {
      if (req.accepts('html')) {
        return res.redirect('/login.html');
      }
      return res.status(401).json({ success: false, message: 'Usuário não encontrado.' });
    }
    req.user = buildSafeUser(user);
    return next();
  } catch {
    if (req.accepts('html')) {
      return res.redirect('/login.html');
    }
    return res.status(401).json({ success: false, message: 'Sessão expirada ou não autenticada.' });
  }
}

app.get('/dashboard', requirePageAuth, (req, res) => {
  res.sendFile(path.resolve('./dashboard.html'));
});

app.get('/dashboard.html', requirePageAuth, (req, res) => {
  res.sendFile(path.resolve('./dashboard.html'));
});

app.get('/admin.html', requireAuth, requireRole(USER_ROLE.ADMIN), (req, res) => {
  res.sendFile(path.resolve('./admin.html'));
});

app.use(express.static('.'));

const openAiKey = process.env.OPENAI_API_KEY;
const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

// Rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per windowMs
  message: 'Muitas tentativas. Tente novamente mais tarde.',
  standardHeaders: false,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production' && req.ip === '::1'
});

const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 requests per hour
  message: 'Muitas tentativas. Tente novamente mais tarde.',
  standardHeaders: false,
  legacyHeaders: false,
  skip: (req) => process.env.NODE_ENV !== 'production' && req.ip === '::1'
});

let pgPool = null;
let sqliteDb = null;
let memoryStore = {};
let userSessions = {}; // Track active sessions for account deletion and security

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
  // Use role from database, default to 'user' if not set
  const rowRole = row.role || USER_ROLE.USER;
  const user = {
    id: row.id,
    name: row.name,
    email: row.email,
    role: rowRole,
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

function signToken(id, email, role = USER_ROLE.USER) {
  return jwt.sign({ sub: id, email, role }, JWT_SECRET, { expiresIn: '7d' });
}

function setAuthCookie(res, token, userId) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: ONE_WEEK_MS,
    path: '/'
  });
  // Track session for account deletion
  if (userId) {
    if (!userSessions[userId]) userSessions[userId] = [];
    userSessions[userId].push({ token, createdAt: Date.now() });
  }
}

function clearAuthCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

function invalidateUserSessions(userId) {
  // Clear all sessions for a user (used on account deletion or password reset)
  if (userSessions[userId]) {
    delete userSessions[userId];
  }
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
        role TEXT NOT NULL DEFAULT 'user',
        profile JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pgPool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`)
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
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS user_memories (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT 'general',
        title TEXT,
        content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS bncc_items (
        id SERIAL PRIMARY KEY,
        etapa TEXT,
        serie TEXT,
        area TEXT,
        disciplina TEXT,
        unidade_tematica TEXT,
        objeto_conhecimento TEXT,
        habilidade TEXT,
        codigo_habilidade TEXT,
        conteudos_relacionados TEXT,
        atividades TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS mentor_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        event_type TEXT NOT NULL,
        event_data JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS admin_logs (
        id SERIAL PRIMARY KEY,
        admin_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        resource TEXT,
        details JSONB DEFAULT '{}'::jsonb,
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
          role TEXT NOT NULL DEFAULT 'user',
          profile TEXT NOT NULL DEFAULT '{}',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
      `, (error) => {
        if (error) return reject(error);
        sqliteDb.all('PRAGMA table_info(users)', (pragmaError, tableInfo) => {
          if (pragmaError) return reject(pragmaError);
          const hasRole = Array.isArray(tableInfo) && tableInfo.some((column) => column.name === 'role');
          if (!hasRole) {
            sqliteDb.run('ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT "user"', (alterError) => {
              if (alterError) return reject(alterError);
              continueSetup();
            });
            return;
          }
          continueSetup();
        });
      });

      function continueSetup() {
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
          sqliteDb.run(`
            CREATE TABLE IF NOT EXISTS embeddings (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              user_email TEXT NOT NULL,
              content TEXT NOT NULL,
              embedding TEXT NOT NULL,
              metadata TEXT DEFAULT '{}',
              created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
          `, (embeddingError) => {
            if (embeddingError) return reject(embeddingError);
            sqliteDb.run(`
              CREATE TABLE IF NOT EXISTS user_memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                category TEXT NOT NULL DEFAULT 'general',
                title TEXT,
                content TEXT NOT NULL,
                metadata TEXT DEFAULT '{}',
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
              );
            `, (memoryError) => {
              if (memoryError) return reject(memoryError);
              sqliteDb.run(`
                CREATE TABLE IF NOT EXISTS bncc_items (
                  id INTEGER PRIMARY KEY AUTOINCREMENT,
                  etapa TEXT,
                  serie TEXT,
                  area TEXT,
                  disciplina TEXT,
                  unidade_tematica TEXT,
                  objeto_conhecimento TEXT,
                  habilidade TEXT,
                  codigo_habilidade TEXT,
                  conteudos_relacionados TEXT,
                  atividades TEXT,
                  status TEXT NOT NULL DEFAULT 'active',
                  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
                );
              `, (bnccError) => {
                if (bnccError) return reject(bnccError);
                sqliteDb.run(`
                  CREATE TABLE IF NOT EXISTS mentor_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    event_type TEXT NOT NULL,
                    event_data TEXT DEFAULT '{}',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                  );
                `, (eventError) => {
                  if (eventError) return reject(eventError);
                  sqliteDb.run(`
                    CREATE TABLE IF NOT EXISTS admin_logs (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      admin_user_id INTEGER NOT NULL,
                      action TEXT NOT NULL,
                      resource TEXT,
                      details TEXT DEFAULT '{}',
                      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                      FOREIGN KEY(admin_user_id) REFERENCES users(id) ON DELETE SET NULL
                    );
                  `, (logError) => {
                    if (logError) return reject(logError);
                    resolve();
                  });
                });
              });
            });
          });
        });
      }
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

function requireRole(role) {
  return (req, res, next) => {
    if (!req.user || req.user.role !== role) {
      return res.status(403).json({ success: false, message: 'Acesso restrito ao painel administrativo.' });
    }
    return next();
  };
}

// ensureAdminAccount: Disabled to prevent automatic admin promotion.
// Admin accounts must be configured explicitly through secure bootstrap mechanism.
// See documentation for how to set ADMIN_EMAIL in production.
async function ensureAdminAccount() {
  // This function intentionally does nothing.
  // Admin promotion must be configured externally, not hardcoded.
  return;
}

async function addAdminLog(adminUserId, action, resource, details = {}) {
  const payload = JSON.stringify(details || {});
  if (pgPool) {
    await pgPool.query('INSERT INTO admin_logs (admin_user_id, action, resource, details) VALUES ($1, $2, $3, $4)', [adminUserId, action, resource, payload]);
    return;
  }
  await new Promise((resolve, reject) => {
    sqliteDb.run('INSERT INTO admin_logs (admin_user_id, action, resource, details) VALUES (?, ?, ?, ?)', [adminUserId, action, resource, payload], (error) => error ? reject(error) : resolve());
  });
}

async function recordMentorEvent(userId, eventType, eventData = {}) {
  const payload = JSON.stringify(eventData || {});
  if (pgPool) {
    await pgPool.query('INSERT INTO mentor_events (user_id, event_type, event_data) VALUES ($1, $2, $3)', [userId || null, eventType, payload]);
    return;
  }
  await new Promise((resolve, reject) => {
    sqliteDb.run('INSERT INTO mentor_events (user_id, event_type, event_data) VALUES (?, ?, ?)', [userId || null, eventType, payload], (error) => error ? reject(error) : resolve());
  });
}

async function getUserMemoryContext(user, limit = 5) {
  if (!user || !user.id) return '';
  if (pgPool) {
    const result = await pgPool.query('SELECT category, title, content, metadata, created_at FROM user_memories WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [user.id, limit]);
    const memories = result.rows.map((row) => `- ${row.category}: ${row.title || row.content}`);
    return memories.length ? `Memória educacional do estudante:\n${memories.join('\n')}` : '';
  }
  return new Promise((resolve, reject) => {
    sqliteDb.all('SELECT category, title, content, metadata, created_at FROM user_memories WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', [user.id, limit], (error, rows) => {
      if (error) return reject(error);
      const memories = rows.map((row) => `- ${row.category}: ${row.title || row.content}`);
      resolve(memories.length ? `Memória educacional do estudante:\n${memories.join('\n')}` : '');
    });
  });
}

app.post('/api/auth/register', authLimiter, async (req, res) => {
  const { name, email, password, role: _ignoredRole } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanEmail = String(email || '').trim().toLowerCase();

  if (!cleanName || !cleanEmail || !password) {
    return res.status(400).json({ success: false, message: 'Preencha nome, e-mail e senha.' });
  }

  if (cleanName.length < 2 || cleanName.length > 100) {
    return res.status(400).json({ success: false, message: 'Informe um nome válido.' });
  }

  if (!validator.isEmail(cleanEmail)) {
    return res.status(400).json({ success: false, message: 'Informe um e-mail válido.' });
  }

  if (String(password).length < 6 || String(password).length > 128) {
    return res.status(400).json({ success: false, message: 'A senha precisa ter entre 6 e 128 caracteres.' });
  }

  try {
    const existing = await findUserByEmail(cleanEmail);
    if (existing) {
      return res.status(409).json({ success: false, message: 'Este e-mail já está cadastrado.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const role = USER_ROLE.USER; // All new accounts start as users

    let user;
    if (pgPool) {
      const result = await pgPool.query(
        'INSERT INTO users (name, email, password_hash, role, profile) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, profile, created_at, updated_at',
        [cleanName, cleanEmail, passwordHash, role, JSON.stringify({})]
      );
      user = buildSafeUser(result.rows[0]);
    } else {
      const insertResult = await new Promise((resolve, reject) => {
        sqliteDb.run(
          'INSERT INTO users (name, email, password_hash, role, profile) VALUES (?, ?, ?, ?, ?)',
          [cleanName, cleanEmail, passwordHash, role, JSON.stringify({})],
          function onInsert(error) {
            if (error) return reject(error);
            resolve({ lastID: this.lastID });
          }
        );
      });

      const created = await new Promise((resolve, reject) => {
        sqliteDb.get('SELECT * FROM users WHERE id = ?', [insertResult.lastID], (error, row) => error ? reject(error) : resolve(row));
      });

      user = buildSafeUser(created);
    }

    const token = signToken(user.id, user.email, user.role);
    setAuthCookie(res, token, user.id);
    return res.status(201).json({ success: true, user, message: 'Cadastro realizado com sucesso.' });
  } catch (error) {
    console.error('Register error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível concluir o cadastro no momento.' });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
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
    const token = signToken(user.id, user.email, user.role);
    setAuthCookie(res, token, user.id);
    return res.json({ success: true, user, message: 'Login realizado com sucesso.' });
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

app.get('/admin', requireAuth, requireRole(USER_ROLE.ADMIN), (req, res) => {
  res.sendFile(path.resolve('./admin.html'));
});

app.get('/api/admin/stats', requireAuth, requireRole(USER_ROLE.ADMIN), async (req, res) => {
  try {
    let totalUsers = 0;
    let activeUsers = 0;
    let totalMentorInteractions = 0;
    let totalQuestions = 0;
    let totalSummaries = 0;
    let totalCourseItems = 0;
    let totalContentItems = 0;

    if (pgPool) {
      const [usersRes, mentorRes, bnccRes] = await Promise.all([
        pgPool.query('SELECT COUNT(*)::int AS total_users, COUNT(*) FILTER (WHERE role = $1)::int AS active_users FROM users', [USER_ROLE.ADMIN]),
        pgPool.query("SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE event_type = 'question')::int AS questions, COUNT(*) FILTER (WHERE event_type = 'summary')::int AS summaries FROM mentor_events"),
        pgPool.query('SELECT COUNT(*)::int AS total FROM bncc_items')
      ]);
      totalUsers = Number(usersRes.rows[0]?.total_users || 0);
      activeUsers = Number(usersRes.rows[0]?.active_users || 0);
      totalMentorInteractions = Number(mentorRes.rows[0]?.total || 0);
      totalQuestions = Number(mentorRes.rows[0]?.questions || 0);
      totalSummaries = Number(mentorRes.rows[0]?.summaries || 0);
      totalContentItems = Number(bnccRes.rows[0]?.total || 0);
    } else {
      const userRows = await new Promise((resolve, reject) => {
        sqliteDb.all('SELECT COUNT(*) AS total_users, SUM(CASE WHEN role = ? THEN 1 ELSE 0 END) AS active_users FROM users', [USER_ROLE.ADMIN], (error, rows) => error ? reject(error) : resolve(rows[0] || {}));
      });
      const mentorRows = await new Promise((resolve, reject) => {
        sqliteDb.get("SELECT COUNT(*) AS total, SUM(CASE WHEN event_type = 'question' THEN 1 ELSE 0 END) AS questions, SUM(CASE WHEN event_type = 'summary' THEN 1 ELSE 0 END) AS summaries FROM mentor_events", (error, row) => error ? reject(error) : resolve(row || {}));
      });
      const bnccRows = await new Promise((resolve, reject) => {
        sqliteDb.get('SELECT COUNT(*) AS total FROM bncc_items', (error, row) => error ? reject(error) : resolve(row || {}));
      });
      totalUsers = Number(userRows.total_users || 0);
      activeUsers = Number(userRows.active_users || 0);
      totalMentorInteractions = Number(mentorRows.total || 0);
      totalQuestions = Number(mentorRows.questions || 0);
      totalSummaries = Number(mentorRows.summaries || 0);
      totalContentItems = Number(bnccRows.total || 0);
    }

    const stats = {
      totalUsers,
      activeUsers,
      totalMentorInteractions,
      totalQuestions,
      totalSummaries,
      totalCourseItems: totalContentItems,
      totalContentItems,
      totalInfluences: totalMentorInteractions,
      lastUpdated: new Date().toISOString()
    };

    return res.json({ success: true, stats });
  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar as estatísticas administrativas.' });
  }
});

app.get('/api/admin/users', requireAuth, requireRole(USER_ROLE.ADMIN), async (req, res) => {
  try {
    if (pgPool) {
      const result = await pgPool.query('SELECT id, name, email, role, created_at, updated_at FROM users ORDER BY created_at DESC');
      return res.json({ success: true, users: result.rows.map((row) => ({ ...row, createdAt: row.created_at, updatedAt: row.updated_at })) });
    }

    sqliteDb.all('SELECT id, name, email, role, created_at, updated_at FROM users ORDER BY created_at DESC', (error, rows) => {
      if (error) {
        return res.status(500).json({ success: false, message: 'Não foi possível carregar usuários.' });
      }
      return res.json({ success: true, users: rows.map((row) => ({ ...row, createdAt: row.created_at, updatedAt: row.updated_at })) });
    });
    return;
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar usuários.' });
  }
});

app.get('/api/admin/bncc', requireAuth, requireRole(USER_ROLE.ADMIN), async (req, res) => {
  try {
    if (pgPool) {
      const result = await pgPool.query('SELECT * FROM bncc_items ORDER BY created_at DESC');
      return res.json({ success: true, items: result.rows });
    }
    sqliteDb.all('SELECT * FROM bncc_items ORDER BY created_at DESC', (error, rows) => {
      if (error) {
        return res.status(500).json({ success: false, message: 'Não foi possível carregar a BNCC.' });
      }
      return res.json({ success: true, items: rows });
    });
    return;
  } catch (error) {
    console.error('BNCC admin error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar a BNCC.' });
  }
});

app.get('/api/admin/logs', requireAuth, requireRole(USER_ROLE.ADMIN), async (req, res) => {
  try {
    if (pgPool) {
      const result = await pgPool.query('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 50');
      return res.json({ success: true, logs: result.rows });
    }
    sqliteDb.all('SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT 50', (error, rows) => {
      if (error) {
        return res.status(500).json({ success: false, message: 'Não foi possível carregar logs.' });
      }
      return res.json({ success: true, logs: rows });
    });
    return;
  } catch (error) {
    console.error('Admin logs error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar logs.' });
  }
});

app.get('/api/admin/mentor', requireAuth, requireRole(USER_ROLE.ADMIN), async (req, res) => {
  try {
    if (pgPool) {
      const result = await pgPool.query("SELECT event_type, COUNT(*)::int AS total FROM mentor_events GROUP BY event_type ORDER BY total DESC");
      const latest = await pgPool.query('SELECT event_type, created_at FROM mentor_events ORDER BY created_at DESC LIMIT 10');
      return res.json({ success: true, summary: result.rows, latest: latest.rows });
    }
    sqliteDb.all("SELECT event_type, COUNT(*) AS total FROM mentor_events GROUP BY event_type ORDER BY total DESC", (error, rows) => {
      if (error) return res.status(500).json({ success: false, message: 'Não foi possível carregar dados da mentora.' });
      sqliteDb.all('SELECT event_type, created_at FROM mentor_events ORDER BY created_at DESC LIMIT 10', (innerError, latestRows) => {
        if (innerError) return res.status(500).json({ success: false, message: 'Não foi possível carregar dados da mentora.' });
        return res.json({ success: true, summary: rows, latest: latestRows });
      });
    });
    return;
  } catch (error) {
    console.error('Admin mentor data error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível carregar dados da mentora.' });
  }
});

app.post('/api/admin/bncc', requireAuth, requireRole(USER_ROLE.ADMIN), async (req, res) => {
  const { etapa, serie, area, disciplina, unidadeTematica, objetoConhecimento, habilidade, codigoHabilidade, conteudosRelacionados, atividades } = req.body || {};
  if (!disciplina || !area) {
    return res.status(400).json({ success: false, message: 'Disciplina e área são obrigatórias.' });
  }

  try {
    if (pgPool) {
      const result = await pgPool.query(
        'INSERT INTO bncc_items (etapa, serie, area, disciplina, unidade_tematica, objeto_conhecimento, habilidade, codigo_habilidade, conteudos_relacionados, atividades, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
        [etapa || '', serie || '', area || '', disciplina, unidadeTematica || '', objetoConhecimento || '', habilidade || '', codigoHabilidade || '', conteudosRelacionados || '', atividades || '', 'active']
      );
      await addAdminLog(req.user.id, 'create_content', 'bncc', { codigoHabilidade, disciplina, area });
      return res.status(201).json({ success: true, item: result.rows[0] });
    }

    sqliteDb.run(
      'INSERT INTO bncc_items (etapa, serie, area, disciplina, unidade_tematica, objeto_conhecimento, habilidade, codigo_habilidade, conteudos_relacionados, atividades, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [etapa || '', serie || '', area || '', disciplina, unidadeTematica || '', objetoConhecimento || '', habilidade || '', codigoHabilidade || '', conteudosRelacionados || '', atividades || '', 'active'],
      function onInsert(error) {
        if (error) return res.status(500).json({ success: false, message: 'Não foi possível salvar esta estrutura BNCC.' });
        sqliteDb.get('SELECT * FROM bncc_items WHERE id = ?', [this.lastID], (readError, row) => {
          if (readError) return res.status(500).json({ success: false, message: 'Não foi possível recuperar a estrutura salva.' });
          addAdminLog(req.user.id, 'create_content', 'bncc', { codigoHabilidade, disciplina, area });
          return res.status(201).json({ success: true, item: row });
        });
      }
    );
    return;
  } catch (error) {
    console.error('Create BNCC record error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível criar a estrutura BNCC.' });
  }
});

app.post('/api/mentor/memory', requireAuth, async (req, res) => {
  const { category = 'general', title, content, metadata = {} } = req.body || {};
  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ success: false, message: 'Conteúdo da memória é obrigatório.' });
  }

  try {
    if (pgPool) {
      const result = await pgPool.query(
        'INSERT INTO user_memories (user_id, category, title, content, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *',
        [req.user.id, category, title || 'Memória educacional', content.trim(), metadata]
      );
      return res.status(201).json({ success: true, memory: result.rows[0] });
    }

    sqliteDb.run(
      'INSERT INTO user_memories (user_id, category, title, content, metadata) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, category, title || 'Memória educacional', content.trim(), JSON.stringify(metadata || {})],
      function onInsert(error) {
        if (error) return res.status(500).json({ success: false, message: 'Não foi possível salvar a memória.' });
        sqliteDb.get('SELECT * FROM user_memories WHERE id = ?', [this.lastID], (readError, row) => {
          if (readError) return res.status(500).json({ success: false, message: 'Não foi possível recuperar a memória salva.' });
          return res.status(201).json({ success: true, memory: row });
        });
      }
    );
    return;
  } catch (error) {
    console.error('Save memory error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível salvar a memória.' });
  }
});

app.get('/api/mentor/memory', requireAuth, async (req, res) => {
  try {
    if (pgPool) {
      const result = await pgPool.query('SELECT id, category, title, content, metadata, created_at FROM user_memories WHERE user_id = $1 ORDER BY created_at DESC LIMIT 10', [req.user.id]);
      return res.json({ success: true, memories: result.rows });
    }
    sqliteDb.all('SELECT id, category, title, content, metadata, created_at FROM user_memories WHERE user_id = ? ORDER BY created_at DESC LIMIT 10', [req.user.id], (error, rows) => {
      if (error) return res.status(500).json({ success: false, message: 'Não foi possível recuperar a memória.' });
      return res.json({ success: true, memories: rows });
    });
    return;
  } catch (error) {
    console.error('Get memory error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível recuperar a memória.' });
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

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
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

app.post('/api/auth/reset-password', strictLimiter, async (req, res) => {
  const { token, password } = req.body || {};
  if (!token || !password || String(password).length < 6 || String(password).length > 128) {
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

    // Invalidate all sessions for this user (security best practice after password reset)
    invalidateUserSessions(resetRecord.user_id);

    return res.json({ success: true, message: 'Senha redefinida com sucesso. Por favor, faça login novamente.' });
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

app.post('/api/embeddings/index', requireAuth, async (req, res) => {
  const { userEmail, content, metadata } = req.body;
  
  // Verify user owns this email (prevent users from indexing data for other users)
  if (userEmail !== req.user.email) {
    return res.status(403).json({ error: 'Acesso não autorizado' });
  }

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

app.post('/api/embeddings/query', requireAuth, async (req, res) => {
  const { userEmail, query, topK = 3 } = req.body;
  
  // Verify user owns this email
  if (userEmail !== req.user.email) {
    return res.status(403).json({ error: 'Acesso não autorizado' });
  }

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

app.post('/api/chat', requireAuth, async (req, res) => {
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

    const memoryContext = await getUserMemoryContext(req.user);
    const systemPrompt = `Você é a Mentora Synara, uma tutora educacional integrada ao progresso do estudante. ${modeInstructions[mode] || modeInstructions.explain} Personalize sua resposta com matéria, conteúdo, dificuldade, progresso, metas, cronograma, histórico e erros quando disponíveis. Não entregue respostas prontas quando o modo pedir raciocínio guiado. Se não houver contexto suficiente, diga isso e peça o material ou detalhe necessário; nunca invente fatos. Seja clara, acolhedora e prática. O módulo de bem-estar só pode sugerir organização, pausas e equilíbrio de estudos, sem diagnosticar saúde mental. ${memoryContext ? `\n\nContexto da memória do estudante:\n${memoryContext}` : ''}`;

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

    await recordMentorEvent(req.user.id, mode || 'conversation', { subject: subject || topic || 'Geral', mode, messageLength: String(message).length, hasGoal: Array.isArray(goals) && goals.length > 0 });
    return res.json({ reply });
  } catch (error) {
    console.error('OpenAI error:', error);
    return res.json({ reply: fallbackResponse(message, subject) });
  }
});

app.post('/api/generate-exercise', requireAuth, async (req, res) => {
  const { userEmail, subject, topic, difficulty = 'médio' } = req.body;
  if (userEmail && userEmail !== req.user.email) {
    return res.status(403).json({ success: false, message: 'Acesso não autorizado.' });
  }
  if (!subject && !topic) return res.status(400).json({ success: false, message: 'Faltam parâmetros (subject/topic)' });

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
      await recordMentorEvent(req.user.id, 'question', { subject: subject || topic || 'Geral', difficulty });
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
    await recordMentorEvent(req.user.id, 'question', { subject: subject || topic || 'Geral', difficulty, isGenerated: true });
    return res.json({ exercise });
  } catch (error) {
    console.error('Generate exercise error:', error);
    return res.status(500).json({ success: false, message: 'Erro ao gerar exercício' });
  }
});

// Account deletion endpoint
app.delete('/api/account', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    
    if (pgPool) {
      // Delete all associated data
      await pgPool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
      await pgPool.query('DELETE FROM embeddings WHERE user_email = $1', [req.user.email]);
      await pgPool.query('DELETE FROM users WHERE id = $1', [userId]);
    } else {
      // SQLite deletion
      await new Promise((resolve, reject) => {
        sqliteDb.run('DELETE FROM password_reset_tokens WHERE user_id = ?', [userId], (error) => error ? reject(error) : resolve());
      });
      
      // Remove embeddings for this user
      if (memoryStore[req.user.email]) {
        delete memoryStore[req.user.email];
        persistStore();
      }
      
      await new Promise((resolve, reject) => {
        sqliteDb.run('DELETE FROM users WHERE id = ?', [userId], (error) => error ? reject(error) : resolve());
      });
    }
    
    // Invalidate all sessions for this user
    invalidateUserSessions(userId);
    
    // Clear the auth cookie
    clearAuthCookie(res);
    
    return res.json({ success: true, message: 'Conta excluída com sucesso. Seus dados foram removidos.' });
  } catch (error) {
    console.error('Account deletion error:', error);
    return res.status(500).json({ success: false, message: 'Não foi possível excluir a conta no momento.' });
  }
});

async function startServer() {
  try {
    console.log('Inicializando banco de dados...');
    await Promise.race([
      initDatabase(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Database init timeout')), 10000))
    ]);
    console.log('✅ Banco de dados inicializado');
  } catch (error) {
    console.error('⚠️ Erro ao inicializar banco de dados:', error.message);
    console.log('Continuando com servidor disponível...');
  }

  await ensureAdminAccount();

  app.listen(PORT, () => {
    console.log(`SYNARA API rodando em http://localhost:${PORT}`);
  });
}

app.get('/api/admin/health', requireAuth, requireRole(USER_ROLE.ADMIN), (req, res) => {
  res.json({ success: true, ok: true, admin: req.user.email });
});

startServer();
