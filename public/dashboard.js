/* ============================================================
   SYNARA — Central de Estudos (dashboard.js)
   Reconstruido por responsabilidades:
   1) utilitarios  2) icones  3) toast/modal  4) sidebar  5) rotas
   6) dados  7) motor de aprendizagem  8) renderizadores
   9) Mentora  10) eventos  11) boot
   ============================================================ */
(function () {
  'use strict';

  const SIDEBAR_KEY = 'synara-central-sidebar';
  const SECTION_TITLES = {
    inicio: 'Início',
    mentora: 'Mentora',
    materias: 'Minhas Matérias',
    cronograma: 'Cronograma',
    metas: 'Metas',
    progresso: 'Progresso',
    'bem-estar': 'Bem-estar',
    privacidade: 'Privacidade e dados',
    configuracoes: 'Configurações'
  };
  const STRATEGY_LABELS = {
    explain: 'explicação passo a passo',
    understand: 'perguntas guiadas',
    summary: 'resumo organizado',
    practice: 'prática com exercícios',
    review: 'revisão ativa',
    tip: 'estratégias de estudo',
    exam: 'plano para prova'
  };
  const SUBJECT_STRATEGIES = {
    'matematica': ['explain', 'practice', 'understand', 'review'],
    'fisica': ['explain', 'practice', 'review'],
    'quimica': ['explain', 'practice', 'summary'],
    'biologia': ['summary', 'explain', 'review'],
    'historia': ['summary', 'explain', 'review'],
    'geografia': ['summary', 'explain', 'practice'],
    'portugues': ['explain', 'practice', 'summary'],
    'literatura': ['summary', 'explain', 'review'],
    'ingles': ['practice', 'explain', 'summary'],
    'filosofia': ['understand', 'summary', 'review'],
    'sociologia': ['summary', 'understand', 'review'],
    'artes': ['summary', 'explain', 'review']
  };
  const DEFAULT_STRATEGIES = ['explain', 'summary', 'practice', 'understand', 'review'];

  // ---------- 1. Utilitarios ----------
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function todayISO() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  function formatDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('pt-BR');
  }
  function weekdayShort(iso) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  }
  function formatMinutes(minutes) {
    const value = Math.round(Number(minutes) || 0);
    if (value < 60) return value + 'min';
    const h = Math.floor(value / 60);
    const m = value % 60;
    return m ? h + 'h ' + m + 'min' : h + 'h';
  }
  function initials(name) {
    const parts = String(name || 'Estudante').trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'E';
  }
  function uid() {
    return Date.now() + Math.floor(Math.random() * 1000);
  }
  function normalizeKey(text) {
    return String(text || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }

  // ---------- 2. Icones ----------
  // Fonte unica de verdade: icons.js (window.SynaraIcons).
  // Mantido o mesmo contrato: icon(name, className) e hydrateIcons(root).
  function icon(name, className) {
    return (window.SynaraIcons && window.SynaraIcons.icon(name, className)) || '';
  }
  function hydrateIcons(root) {
    if (window.SynaraIcons) window.SynaraIcons.hydrate(root || document);
  }

  // ---------- 3. Toast / Modal ----------
  let toastTimer = null;
  function toast(message, isError) {
    const box = $('#toast');
    const text = $('#toastText');
    if (!box || !text) return;
    text.textContent = message;
    box.classList.toggle('is-error', !!isError);
    box.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => box.classList.remove('is-visible'), 3200);
  }

  const modalState = { resolver: null };
  function openModal(options) {
    const modal = $('#appModal');
    if (!modal) return Promise.resolve(null);
    $('#appModalTitle').textContent = options.title || 'Confirmação';
    $('#appModalMessage').textContent = options.message || '';
    const field = $('#appModalField');
    const confirmBtn = $('#appModalConfirm');
    const errorBox = $('#appModalError');
    errorBox.hidden = true;
    errorBox.textContent = '';
    if (options.input) {
      field.hidden = false;
      $('#appModalInputLabel').textContent = options.input.label || 'Confirmação';
      const input = $('#appModalInput');
      input.value = '';
      input.placeholder = options.input.placeholder || '';
    } else {
      field.hidden = true;
    }
    confirmBtn.textContent = options.confirmLabel || 'Confirmar';
    confirmBtn.className = 'd-btn ' + (options.danger ? 'd-btn--danger' : 'd-btn--primary');
    modal.hidden = false;
    window.setTimeout(() => { (options.input ? $('#appModalInput') : confirmBtn).focus(); }, 30);
    return new Promise((resolve) => { modalState.resolver = resolve; });
  }
  function closeModal(result) {
    const modal = $('#appModal');
    if (modal) modal.hidden = true;
    const resolver = modalState.resolver;
    modalState.resolver = null;
    if (resolver) resolver(result);
  }
  function wireModal() {
    $('#appModalClose').addEventListener('click', () => closeModal(null));
    $('#appModalCancel').addEventListener('click', () => closeModal(null));
    $('#appModalBackdrop').addEventListener('click', () => closeModal(null));
    $('#appModalConfirm').addEventListener('click', () => {
      const field = $('#appModalField');
      if (!field.hidden) {
        const value = $('#appModalInput').value.trim();
        if (!value) {
          const errorBox = $('#appModalError');
          errorBox.textContent = 'Digite a confirmação solicitada.';
          errorBox.hidden = false;
          return;
        }
        closeModal(value);
        return;
      }
      closeModal(true);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const modal = $('#appModal');
      if (modal && !modal.hidden) closeModal(null);
    });
  }

  // ---------- 4. Estado e acesso a dados ----------
  const state = {
    user: null,
    section: 'inicio',
    mentor: { messages: [], pending: null, sending: false, lastStrategy: null },
    pomodoro: {
      config: { focus: 25, shortBreak: 5, longBreak: 15, cyclesBeforeLong: 4 },
      phase: 'idle',
      paused: false,
      remaining: 25 * 60,
      duration: 25 * 60,
      cycles: 0,
      interval: null,
      session: { focusMinutes: 0, breakMinutes: 0, cycles: 0, interrupted: 0 }
    }
  };

  function refreshUser() {
    state.user = auth.getCurrentUser();
    return state.user;
  }
  function subjects() { return Array.isArray(state.user && state.user.subjects) ? state.user.subjects : []; }
  function goals() { return Array.isArray(state.user && state.user.goals) ? state.user.goals : []; }
  function schedule() { return Array.isArray(state.user && state.user.schedule) ? state.user.schedule : []; }
  function sessions() { return Array.isArray(state.user && state.user.studySessions) ? state.user.studySessions : []; }
  function contentStats() { return (state.user && state.user.contentStats) || {}; }

  function subjectsOptions(selected) {
    const list = subjects();
    if (!list.length) return '<option value="">Geral</option>';
    return list.map((s) => '<option value="' + escapeHtml(s.name) + '"' + (s.name === selected ? ' selected' : '') + '>' + escapeHtml(s.name) + '</option>').join('');
  }
  function totalProgress() {
    const list = subjects();
    if (!list.length) return 0;
    const sum = list.reduce((acc, s) => acc + (Number(s.progress) || 0), 0);
    return Math.round(sum / list.length);
  }
  function studyStreak() {
    const days = new Set(sessions().map((s) => String(s.completedAt || '').slice(0, 10)).filter(Boolean));
    if (!days.size) return 0;
    let streak = 0;
    const cursor = new Date();
    for (let i = 0; i < 400; i += 1) {
      const key = new Date(cursor.getTime() - cursor.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      if (!days.has(key)) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }
  function nextScheduledItem() {
    const now = new Date();
    const pending = schedule().filter((item) => !item.completed);
    const upcoming = pending.filter((item) => new Date(item.date + 'T' + (item.time || '00:00')) >= now);
    const pool = upcoming.length ? upcoming : pending;
    pool.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return pool[0] || null;
  }
  function subjectMasteryMap() {
    const map = {};
    Object.keys(contentStats()).forEach((key) => {
      const stat = contentStats()[key];
      if (!stat || !stat.subject) return;
      const current = map[stat.subject];
      if (!current || (stat.attempts || 0) > (current.attempts || 0)) map[stat.subject] = stat;
    });
    return map;
  }

  // ---------- 5. Motor de aprendizagem (com as APIs existentes) ----------
  function defaultLearningProfile() {
    return { strategies: {}, preferences: { explanationStyle: '', pace: '', formats: [] }, updatedAt: null };
  }
  function learningProfile() {
    const profile = (state.user && state.user.profile) || {};
    const stored = profile.learningProfile;
    if (!stored || typeof stored !== 'object') return defaultLearningProfile();
    if (!stored.strategies || typeof stored.strategies !== 'object') stored.strategies = {};
    if (!stored.preferences || typeof stored.preferences !== 'object') stored.preferences = { explanationStyle: '', pace: '', formats: [] };
    if (!Array.isArray(stored.preferences.formats)) stored.preferences.formats = [];
    return stored;
  }
  function saveLearningProfile(profile) {
    profile.updatedAt = new Date().toISOString();
    state.user.profile = Object.assign({}, state.user.profile, { learningProfile: profile });
    auth.saveUser(state.user);
    refreshUser();
  }
  function strategyBucket(profile, strategy) {
    if (!profile.strategies[strategy]) profile.strategies[strategy] = { uses: 0, helped: 0, notHelped: 0, bySubject: {} };
    const bucket = profile.strategies[strategy];
    if (!bucket.bySubject || typeof bucket.bySubject !== 'object') bucket.bySubject = {};
    return bucket;
  }
  function strategyScore(bucket) {
    if (!bucket || !bucket.uses) return 0;
    return (bucket.helped + 0.5) / (bucket.uses + 1);
  }
  function postMemory(payload) {
    try {
      fetch('/api/mentor/memory', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    } catch (err) { /* nao interrompe a experiencia */ }
  }
  function registerStrategyUse(entry) {
    if (!entry || !entry.strategy) return;
    const profile = learningProfile();
    const bucket = strategyBucket(profile, entry.strategy);
    const subjectName = entry.subject || 'Geral';
    bucket.uses += 1;
    if (!bucket.bySubject[subjectName]) bucket.bySubject[subjectName] = { uses: 0, helped: 0, notHelped: 0 };
    bucket.bySubject[subjectName].uses += 1;
    saveLearningProfile(profile);
    postMemory({
      category: 'strategy',
      title: entry.strategy,
      content: 'Estrategia ' + entry.strategy + (entry.subject ? ' em ' + entry.subject : '') + ' usada',
      metadata: { strategy: entry.strategy, subject: entry.subject || null, topic: entry.topic || null, helped: null, source: 'central' }
    });
  }
  function setStrategyFeedback(entry, helped) {
    if (!entry || !entry.strategy || entry.reported) return;
    entry.reported = helped;
    const profile = learningProfile();
    const bucket = strategyBucket(profile, entry.strategy);
    const subjectName = entry.subject || 'Geral';
    if (helped === true) bucket.helped += 1;
    if (helped === false) bucket.notHelped += 1;
    if (!bucket.bySubject[subjectName]) bucket.bySubject[subjectName] = { uses: 0, helped: 0, notHelped: 0 };
    if (helped === true) bucket.bySubject[subjectName].helped += 1;
    if (helped === false) bucket.bySubject[subjectName].notHelped += 1;
    saveLearningProfile(profile);
    postMemory({
      category: 'strategy',
      title: entry.strategy,
      content: 'Feedback: ' + (helped === true ? 'ajudou' : 'nao ajudou') + ' (' + entry.strategy + (entry.subject ? ' em ' + entry.subject : '') + ')',
      metadata: { strategy: entry.strategy, subject: entry.subject || null, topic: entry.topic || null, helped: helped === true, source: 'feedback' }
    });
  }

  function candidateStrategies(subject) {
    const key = normalizeKey(subject);
    return SUBJECT_STRATEGIES[key] || DEFAULT_STRATEGIES;
  }
  function chooseStrategy(subject, forced) {
    if (forced && forced !== 'auto') {
      return { strategy: forced, reason: 'Voce escolheu esta estrategia manualmente.' };
    }
    const profile = learningProfile();
    const candidates = candidateStrategies(subject);
    let best = null;
    let bestScore = 0;
    let hasData = false;
    candidates.forEach((strategy) => {
      const bucket = profile.strategies[strategy];
      if (bucket && bucket.uses) hasData = true;
      const score = strategyScore(bucket);
      if (best === null || score > bestScore) { best = strategy; bestScore = score; }
    });
    if (hasData && best) {
      return { strategy: best, reason: 'Escolhida porque teve o melhor resultado com voce ate agora.' };
    }
    if (profile.preferences.explanationStyle) {
      return { strategy: profile.preferences.explanationStyle, reason: 'Usando o formato que voce marcou como preferido nas configuracoes.' };
    }
    return { strategy: candidates[0], reason: 'Ainda estou aprendendo como voce aprende melhor. Vamos testar esta abordagem.' };
  }
  function strategyLabel(strategy) {
    return STRATEGY_LABELS[strategy] || 'estrategia de estudo';
  }

  // ---------- 5b. Pomodoro (foco, pausa, ciclos e registro real) ----------
  const POMODORO_DEFAULTS = { focus: 25, shortBreak: 5, longBreak: 15, cyclesBeforeLong: 4 };
  const POMODORO_RING = 2 * Math.PI * 88;

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }
  function pomodoroConfig() {
    const profile = (state.user && state.user.profile) || {};
    const stored = (profile.pomodoro && profile.pomodoro.config) || {};
    return {
      focus: clampNumber(stored.focus, 5, 90, POMODORO_DEFAULTS.focus),
      shortBreak: clampNumber(stored.shortBreak, 1, 30, POMODORO_DEFAULTS.shortBreak),
      longBreak: clampNumber(stored.longBreak, 5, 60, POMODORO_DEFAULTS.longBreak),
      cyclesBeforeLong: clampNumber(stored.cyclesBeforeLong, 2, 8, POMODORO_DEFAULTS.cyclesBeforeLong)
    };
  }
  function pomodoroStatsStore() {
    const profile = (state.user && state.user.profile) || {};
    const stored = (profile.pomodoro && profile.pomodoro.stats) || {};
    return {
      sessions: Number(stored.sessions) || 0,
      completedCycles: Number(stored.completedCycles) || 0,
      focusMinutesTotal: Number(stored.focusMinutesTotal) || 0,
      interrupted: Number(stored.interrupted) || 0,
      longBreaks: Number(stored.longBreaks) || 0,
      bySubject: stored.bySubject && typeof stored.bySubject === 'object' ? stored.bySubject : {}
    };
  }
  function savePomodoro(partial) {
    const profile = (state.user && state.user.profile) || {};
    const current = profile.pomodoro && typeof profile.pomodoro === 'object' ? profile.pomodoro : {};
    const next = Object.assign({}, current, partial);
    state.user.profile = Object.assign({}, profile, { pomodoro: next });
    auth.saveUser(state.user);
    refreshUser();
    return next;
  }
  function bumpPomodoroStats(patch, subjectName, minutes) {
    const stats = pomodoroStatsStore();
    if (patch) {
      Object.keys(patch).forEach((key) => {
        if (key === 'bySubject') return;
        stats[key] = (Number(stats[key]) || 0) + Number(patch[key]);
      });
    }
    if (subjectName && minutes) {
      stats.bySubject[subjectName] = (Number(stats.bySubject[subjectName]) || 0) + Number(minutes);
    }
    savePomodoro({ stats: stats });
    return stats;
  }
  function phaseDuration(phase) {
    const cfg = state.pomodoro.config;
    if (phase === 'focus') return cfg.focus * 60;
    if (phase === 'shortBreak') return cfg.shortBreak * 60;
    if (phase === 'longBreak') return cfg.longBreak * 60;
    return cfg.focus * 60;
  }
  function phaseLabel(phase) {
    if (phase === 'focus') return 'Foco';
    if (phase === 'shortBreak') return 'Pausa curta';
    if (phase === 'longBreak') return 'Pausa longa';
    return 'Foco';
  }
  function formatClock(seconds) {
    const total = Math.max(0, Math.round(seconds));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function isBreakPhase(phase) {
    return phase === 'shortBreak' || phase === 'longBreak';
  }
  function pomodoroStateKey() {
    const p = state.pomodoro;
    if (p.paused && p.phase !== 'idle') return 'paused';
    return p.phase;
  }

  function renderPomodoro() {
    const card = $('#pomodoro');
    if (!card) return;
    const p = state.pomodoro;
    p.config = pomodoroConfig();
    card.setAttribute('data-state', pomodoroStateKey());
    $('#pomodoroTime').textContent = formatClock(p.remaining);
    $('#pomodoroPhase').textContent = (p.paused && p.phase !== 'idle') ? 'Pausado' : phaseLabel(p.phase);

    const elapsed = p.duration > 0 ? (p.duration - p.remaining) / p.duration : 0;
    $('#pomodoroProgress').setAttribute('stroke-dashoffset', String(POMODORO_RING * (1 - elapsed)));

    const badgeMap = {
      idle: ['Pronto para começar', 'd-badge--navy'],
      focus: ['Em foco', 'd-badge--teal'],
      paused: ['Pausado', 'd-badge--warm'],
      shortBreak: ['Em pausa curta', 'd-badge--success'],
      longBreak: ['Em pausa longa', 'd-badge--success'],
      done: ['Sessão concluída', 'd-badge--success']
    };
    const badge = badgeMap[pomodoroStateKey()] || badgeMap.idle;
    const stateBadge = $('#pomodoroState');
    stateBadge.textContent = badge[0];
    stateBadge.className = 'd-badge ' + badge[1];

    const dots = Math.max(1, p.config.cyclesBeforeLong);
    const inSet = p.cycles % dots;
    let dotsHtml = '';
    for (let i = 0; i < dots; i += 1) {
      const done = i < inSet;
      const current = !done && i === inSet && p.phase === 'focus';
      dotsHtml += '<span class="d-pomodoro__dot' + (done ? ' is-done' : '') + (current ? ' is-current' : '') + '"></span>';
    }
    $('#pomodoroCycles').innerHTML = dotsHtml;
    $('#pomodoroCycleNote').textContent = p.cycles
      ? p.cycles + ' ciclo(s) nesta sessão · pausa longa a cada ' + p.config.cyclesBeforeLong
      : 'A pausa longa acontece a cada ' + p.config.cyclesBeforeLong + ' ciclos.';

    $('#pomodoroStart').hidden = !(p.phase === 'idle' || p.phase === 'done');
    $('#pomodoroPause').hidden = p.phase === 'idle' || p.paused;
    $('#pomodoroResume').hidden = !p.paused;
    $('#pomodoroSkip').hidden = !(isBreakPhase(p.phase) && !p.paused);
    $('#pomodoroReset').hidden = p.phase === 'idle';
    $('#pomodoroStop').hidden = p.phase !== 'focus';

    const hint = $('#pomodoroHint');
    if (p.phase === 'idle') hint.textContent = subjects().length ? 'Selecione uma matéria e inicie um bloco de foco.' : 'Cadastre uma matéria para registrar suas sessões de estudo.';
    else if (p.phase === 'focus' && !p.paused) hint.textContent = 'Foco em andamento. A sessão só é registrada ao concluir os ' + p.config.focus + ' minutos.';
    else if (p.paused) hint.textContent = 'Bloco pausado. O tempo em pausa não conta como estudo.';
    else if (isBreakPhase(p.phase)) hint.textContent = 'Pausa em andamento. Levante, respire e descanse a atenção.';
    else if (p.phase === 'done') hint.textContent = 'Ciclo completo concluído. Você pode iniciar um novo bloco quando quiser.';

    const stats = pomodoroStatsStore();
    $('#pomodoroStats').innerHTML = [
      { label: 'Foco nesta sessão', value: formatMinutes(p.session.focusMinutes) },
      { label: 'Pausa nesta sessão', value: formatMinutes(p.session.breakMinutes) },
      { label: 'Ciclos nesta sessão', value: String(p.session.cycles) },
      { label: 'Sessões registradas', value: String(stats.sessions) },
      { label: 'Tempo total de foco', value: formatMinutes(stats.focusMinutesTotal) },
      { label: 'Blocos interrompidos', value: String(stats.interrupted) }
    ].map((item) => '<div class="d-pomodoro__stat"><span>' + escapeHtml(item.label) + '</span><strong>' + escapeHtml(item.value) + '</strong></div>').join('');

    $('#pomodoroFocusMinutes').value = p.config.focus;
    $('#pomodoroShortBreak').value = p.config.shortBreak;
    $('#pomodoroLongBreak').value = p.config.longBreak;
    $('#pomodoroCyclesBefore').value = p.config.cyclesBeforeLong;

    renderWellbeingOrientation();
  }

  function renderWellbeingOrientation() {
    const box = $('#wellbeingOrientation');
    if (!box) return;
    const stats = pomodoroStatsStore();
    const wellbeing = (state.user && state.user.wellbeing) || { mood: '' };
    const notes = [];
    if (stats.completedCycles > 0) notes.push('Você já concluiu ' + stats.completedCycles + ' bloco(s) de foco, somando ' + formatMinutes(stats.focusMinutesTotal) + '.');
    if (stats.interrupted > stats.sessions && stats.interrupted > 0) notes.push('Você interrompeu ' + stats.interrupted + ' bloco(s). Se isso acontecer com frequência, um bloco mais curto pode ajudar.');
    if (wellbeing.mood === 'sobrecarregado') notes.push('No seu último check-in você marcou um ritmo sobrecarregado. Considere uma pausa maior hoje.');
    if (!notes.length) notes.push('Ainda sem registros de Pomodoro. Ao concluir blocos de foco, as orientações aparecem aqui.');
    box.innerHTML = '<ul class="d-stack" style="gap:.5rem">' + notes.map((note) => '<li class="d-muted">' + escapeHtml(note) + '</li>').join('') + '</ul>';
  }

  function pomodoroClearTimer() {
    if (state.pomodoro.interval) {
      window.clearInterval(state.pomodoro.interval);
      state.pomodoro.interval = null;
    }
  }
  function pomodoroSetPhase(phase) {
    const p = state.pomodoro;
    p.phase = phase;
    p.paused = false;
    p.duration = phaseDuration(phase);
    p.remaining = p.duration;
    renderPomodoro();
  }
  function pomodoroSetSubject(name) {
    const select = $('#pomodoroSubject');
    if (!select || !name) return;
    const list = subjects();
    if (!list.some((s) => s.name === name)) return;
    select.value = name;
  }
  function pomodoroTick() {
    const p = state.pomodoro;
    if (p.paused || p.phase === 'idle' || p.phase === 'done') return;
    p.remaining -= 1;
    if (p.remaining <= 0) {
      p.remaining = 0;
      pomodoroClearTimer();
      if (p.phase === 'focus') pomodoroCompleteFocus();
      else pomodoroCompleteBreak();
      return;
    }
    renderPomodoro();
  }
  function pomodoroRun() {
    pomodoroClearTimer();
    state.pomodoro.interval = window.setInterval(pomodoroTick, 1000);
  }

  function pomodoroRegisterSession(subjectName, minutes, topic) {
    const subject = subjects().find((s) => s.name === subjectName);
    if (!subject) return false;
    // Fluxo real existente: cria studySession, soma horas e recalcula progresso.
    auth.addStudySession(subject.id, minutes, topic || 'Bloco de foco');
    refreshUser();
    bumpPomodoroStats({ sessions: 1, completedCycles: 1, focusMinutesTotal: minutes }, subjectName, minutes);
    postMemory({
      category: 'pomodoro',
      title: subjectName,
      content: 'Bloco de foco concluido: ' + minutes + ' min em ' + subjectName + (topic ? ' (' + topic + ')' : ''),
      metadata: { subject: subjectName, topic: topic || null, minutes: minutes, source: 'pomodoro' }
    });
    return true;
  }

  function pomodoroCompleteFocus() {
    const p = state.pomodoro;
    const subjectName = $('#pomodoroSubject').value;
    const topic = ($('#pomodoroTopic').value || '').trim();
    const minutes = p.config.focus;
    // Regra definida: SOMENTE bloco de foco concluido integralmente gera sessao.
    const registered = pomodoroRegisterSession(subjectName, minutes, topic);
    p.session.focusMinutes += minutes;
    p.session.cycles += 1;
    p.cycles += 1;
    const isLong = p.cycles % Math.max(1, p.config.cyclesBeforeLong) === 0;
    pomodoroSetPhase(isLong ? 'longBreak' : 'shortBreak');
    pomodoroRun();
    if (registered) {
      toast('Bloco de ' + minutes + ' min concluído e registrado em ' + subjectName + '. ' + (isLong ? 'Hora da pausa longa.' : 'Faça uma pausa curta.'));
    } else {
      toast('Bloco concluído, mas não foi possível registrar a sessão.', true);
    }
  }

  function pomodoroCompleteBreak() {
    const p = state.pomodoro;
    const wasLong = p.phase === 'longBreak';
    p.session.breakMinutes += p.duration / 60;
    if (wasLong) bumpPomodoroStats({ longBreaks: 1 });
    pomodoroClearTimer();
    if (wasLong) {
      p.phase = 'done';
      p.paused = false;
      p.duration = phaseDuration('focus');
      p.remaining = p.duration;
      renderPomodoro();
      toast('Ciclo completo concluído. Você pode começar um novo bloco quando quiser.');
    } else {
      pomodoroSetPhase('idle');
      toast('Pausa concluída. Pronto para o próximo bloco de foco.');
    }
  }

  function pomodoroStart() {
    const p = state.pomodoro;
    if (!subjects().length) {
      toast('Cadastre uma matéria para registrar suas sessões de estudo.', true);
      return;
    }
    const select = $('#pomodoroSubject');
    if (!select.value) select.value = subjects()[0].name;
    p.config = pomodoroConfig();
    p.session = { focusMinutes: 0, breakMinutes: 0, cycles: 0, interrupted: 0 };
    p.cycles = 0;
    pomodoroSetPhase('focus');
    pomodoroRun();
    toast('Bloco de foco de ' + p.config.focus + ' min iniciado.');
  }
  function pomodoroPause() {
    const p = state.pomodoro;
    if (p.phase === 'idle' || p.paused) return;
    p.paused = true;
    pomodoroClearTimer();
    renderPomodoro();
  }
  function pomodoroResume() {
    const p = state.pomodoro;
    if (!p.paused) return;
    p.paused = false;
    renderPomodoro();
    pomodoroRun();
  }
  function pomodoroReset() {
    const p = state.pomodoro;
    if (p.phase === 'idle') return;
    pomodoroClearTimer();
    p.paused = false;
    p.duration = phaseDuration(p.phase);
    p.remaining = p.duration;
    renderPomodoro();
    if (p.phase === 'focus') pomodoroRun();
    toast('Bloco reiniciado do começo.');
  }
  function pomodoroStop() {
    const p = state.pomodoro;
    if (p.phase !== 'focus') return;
    pomodoroClearTimer();
    // Encerramento antecipado NAO registra sessao (regra definida).
    bumpPomodoroStats({ interrupted: 1 });
    const elapsed = Math.round((p.duration - p.remaining) / 60);
    p.phase = 'idle';
    p.paused = false;
    p.duration = phaseDuration('focus');
    p.remaining = p.duration;
    p.session = { focusMinutes: 0, breakMinutes: 0, cycles: 0, interrupted: p.session.interrupted + 1 };
    renderPomodoro();
    toast(elapsed > 0
      ? 'Bloco encerrado após ' + elapsed + ' min. Nada foi registrado, pois a sessão só conta quando o bloco é concluído.'
      : 'Bloco encerrado. Nada foi registrado.');
  }
  function pomodoroSkipBreak() {
    if (!isBreakPhase(state.pomodoro.phase)) return;
    pomodoroClearTimer();
    pomodoroSetPhase('idle');
    toast('Pausa encerrada. Pronto para o próximo bloco.');
  }
  function openPomodoro(subjectName) {
    navigate('bem-estar');
    if (subjectName) pomodoroSetSubject(subjectName);
    renderPomodoro();
    const card = $('#pomodoro');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }




  // ---------- 6. Sidebar ----------
  function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }
  function applySidebar(collapsed, persist) {
    const shell = $('#dashboardShell');
    const toggle = $('#sidebarToggle');
    shell.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral');
    if (persist) { try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch (e) {} }
  }
  function setMobileSidebar(open) {
    $('#dashboardSidebar').classList.toggle('is-open', open);
    $('#sidebarBackdrop').hidden = !open;
    $('#menuToggle').setAttribute('aria-expanded', String(open));
  }
  function initSidebar() {
    let stored = 'expanded';
    try { stored = localStorage.getItem(SIDEBAR_KEY) || 'expanded'; } catch (e) {}
    applySidebar(stored === 'collapsed', false);
  }

  // ---------- 7. Navegacao ----------
  function navigate(section, options) {
    const target = SECTION_TITLES[section] ? section : 'inicio';
    state.section = target;
    $$('.dashboard-view').forEach((view) => view.classList.toggle('is-active', view.getAttribute('data-view') === target));
    $$('.dashboard-nav-link').forEach((link) => {
      if (link.getAttribute('data-section') === target) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    $('#topbarTitle').textContent = SECTION_TITLES[target];
    if (!(options && options.silentHistory)) {
      try { history.replaceState(null, '', '#/' + target); } catch (e) { window.location.hash = '#/' + target; }
    }
    if (isMobile()) setMobileSidebar(false);
    renderSection(target);
    return true;
  }
  function navigateFromHash() {
    const raw = String(window.location.hash || '').replace('#/', '').replace('#', '');
    return navigate(SECTION_TITLES[raw] ? raw : 'inicio', { silentHistory: true });
  }
  function renderSection(section) {
    if (section === 'inicio') renderHome();
    else if (section === 'materias') renderSubjects();
    else if (section === 'cronograma') renderSchedule();
    else if (section === 'metas') renderGoals();
    else if (section === 'progresso') renderProgress();
    else if (section === 'mentora') renderMentor();
    else if (section === 'bem-estar') renderWellbeing();
    else if (section === 'privacidade') renderPrivacy();
    else if (section === 'configuracoes') renderSettings();
  }
  function renderAll() {
    refreshUser();
    renderHeaderUser();
    renderSection(state.section);
  }

  // ---------- 8. Renderizadores ----------
  function renderHeaderUser() {
    const user = state.user || {};
    const name = user.name || 'Estudante';
    $('#accountAvatar').textContent = initials(name);
    $('#accountName').textContent = name.split(' ')[0];
    $('#accountMenuName').textContent = name;
    $('#accountMenuEmail').textContent = user.email || '-';
    const adminLink = $('#adminQuickLink');
    if (adminLink) adminLink.hidden = user.role !== 'admin';
  }
  function emptyState(iconName, title, text, actionLabel, actionId) {
    return '<div class="d-empty"><span class="d-empty__mark">' + icon(iconName) + '</span><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(text) + '</p>' +
      (actionLabel ? '<button class="d-btn d-btn--primary" type="button" data-goto="' + escapeHtml(actionId) + '">' + escapeHtml(actionLabel) + '</button>' : '') + '</div>';
  }

  function renderHome() {
    const user = state.user || {};
    const firstName = (user.name || '').split(' ')[0] || 'estudante';
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    $('#homeGreeting').textContent = greeting + ', ' + firstName + '.';
    $('#homeSubtitle').textContent = subjects().length
      ? 'Vamos continuar sua jornada de aprendizagem.'
      : 'Vamos dar o primeiro passo juntos: crie sua primeira matéria.';

    const next = nextScheduledItem();
    const openGoal = goals().find((g) => !g.completed);
    const focusTitle = $('#homeFocusTitle');
    const focusText = $('#homeFocusText');
    const focusBtn = $('#homeFocusAction');
    if (next) {
      focusTitle.textContent = 'Continue: ' + (next.topic || next.subjectName || 'sessão de estudo');
      focusText.textContent = 'Planejado para ' + formatDate(next.date) + ' às ' + (next.time || '--:--') + ' · ' + (next.duration || 30) + ' min.';
      focusBtn.textContent = 'Estudar com a Mentora';
      focusBtn.onclick = () => openMentorWith(next.subjectName || next.subject || 'Geral', next.topic || '');
    } else if (openGoal) {
      focusTitle.textContent = 'Sua meta em aberto';
      focusText.textContent = openGoal.text + (openGoal.dueDate ? ' · prazo ' + formatDate(openGoal.dueDate) : '');
      focusBtn.textContent = 'Trabalhar nesta meta';
      focusBtn.onclick = () => openMentorWith(openGoal.subject || 'Geral', openGoal.text);
    } else if (subjects().length) {
      const mastery = subjectMasteryMap();
      const weakest = subjects().slice().sort((a, b) => ((mastery[a.name] && mastery[a.name].mastery) || 0) - ((mastery[b.name] && mastery[b.name].mastery) || 0))[0];
      focusTitle.textContent = 'Continue em ' + (weakest ? weakest.name : 'seus estudos');
      focusText.textContent = 'Sem tarefas agendadas agora. Um bom momento para revisar o que mais precisa de atenção.';
      focusBtn.textContent = 'Revisar com a Mentora';
      focusBtn.onclick = () => openMentorWith(weakest ? weakest.name : 'Geral', '', 'review');
    } else {
      focusTitle.textContent = 'Crie sua primeira matéria';
      focusText.textContent = 'Com uma matéria cadastrada, a Mentora passa a personalizar explicações e atividades para você.';
      focusBtn.textContent = 'Adicionar matéria';
      focusBtn.onclick = () => navigate('materias');
    }

    const minutes = auth.getStudyMinutes ? auth.getStudyMinutes() : sessions().reduce((t, s) => t + Number(s.minutes || 0), 0);
    const doneGoals = goals().filter((g) => g.completed).length;
    $('#homeStats').innerHTML = [
      { label: 'Progresso geral', value: totalProgress() + '<small>%</small>' },
      { label: 'Tempo estudado', value: escapeHtml(formatMinutes(minutes)) },
      { label: 'Metas concluídas', value: doneGoals + '<small>/' + goals().length + '</small>' },
      { label: 'Sequência', value: studyStreak() + '<small> dias</small>' }
    ].map((item) => '<article class="d-card d-stat"><span class="d-stat__label">' + item.label + '</span><span class="d-stat__value">' + item.value + '</span></article>').join('');

    const upcoming = schedule().filter((s) => !s.completed).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 4);
    $('#homeSchedule').innerHTML = upcoming.length
      ? '<div class="d-list">' + upcoming.map((item) => '<div class="d-item"><span class="d-item__mark">' + icon('calendar') + '</span><div class="d-item__body"><strong>' + escapeHtml(item.topic || item.subjectName || 'Estudo') + '</strong><small>' + escapeHtml(item.subjectName || item.subject || 'Geral') + ' · ' + formatDate(item.date) + ' ' + (item.time || '') + ' · ' + (item.duration || 30) + 'min</small></div></div>').join('') + '</div>'
      : emptyState('calendar', 'Nada agendado ainda', 'Seu cronograma está livre. Planeje um bloco de estudo para começar.', 'Ir para o cronograma', 'cronograma');

    const open = goals().filter((g) => !g.completed).slice(0, 3);
    $('#homeGoals').innerHTML = open.length
      ? '<div class="d-list">' + open.map((goal) => '<div class="d-item"><span class="d-item__mark">' + icon('target') + '</span><div class="d-item__body"><strong>' + escapeHtml(goal.text) + '</strong><small>' + escapeHtml(goal.subject || 'Geral') + (goal.dueDate ? ' · prazo ' + formatDate(goal.dueDate) : '') + '</small></div></div>').join('') + '</div>'
      : emptyState('target', 'Nenhuma meta em aberto', 'Defina um objetivo para dar direção aos seus estudos.', 'Criar meta', 'metas');

    const list = subjects().slice(0, 4);
    $('#homeSubjects').innerHTML = list.length
      ? '<div class="d-list">' + list.map((s) => '<div class="d-item"><span class="d-item__mark">' + icon('book') + '</span><div class="d-item__body"><strong>' + escapeHtml(s.name) + '</strong><div class="d-progress" style="margin-top:.35rem"><div class="d-progress__fill" style="width:' + (Number(s.progress) || 0) + '%"></div></div></div><span class="d-badge d-badge--teal">' + (Number(s.progress) || 0) + '%</span></div>').join('') + '</div>'
      : emptyState('book', 'Sem matérias ainda', 'Cadastre o que você estuda para acompanhar o progresso.', 'Adicionar matéria', 'materias');

    const strategy = chooseStrategy((list[0] && list[0].name) || 'Geral', 'auto');
    $('#homeMentor').innerHTML =
      '<div class="d-stack" style="gap:.7rem">' +
      '<p class="d-muted">Estratégia atual: <strong class="d-emphasis">' + escapeHtml(strategyLabel(strategy.strategy)) + '</strong>.</p>' +
      '<p class="d-help">' + escapeHtml(strategy.reason) + '</p>' +
      '<div class="d-row"><button class="d-btn d-btn--primary" type="button" data-goto="mentora">Estudar agora</button>' +
      (list[0] ? '<button class="d-btn d-btn--quiet" type="button" data-mentor-subject="' + escapeHtml(list[0].name) + '">Usar ' + escapeHtml(list[0].name) + '</button>' : '') +
      '</div></div>';
  }

  function renderSubjects() {
    const list = subjects();
    const container = $('#subjectList');
    if (!list.length) {
      container.innerHTML = emptyState('book', 'Você ainda não tem matérias', 'Adicione a primeira matéria para a Mentora começar a personalizar seus estudos.', 'Nova matéria', 'materias');
      return;
    }
    const mastery = subjectMasteryMap();
    const next = nextScheduledItem();
    container.innerHTML = '<div class="d-grid d-grid--cards">' + list.map((subject) => {
      const stat = mastery[subject.name];
      const masteryText = stat ? (stat.mastery || 0) + '% de domínio em ' + stat.topic : 'Sem exercícios registrados ainda';
      const difficulty = subject.targetHours > 0
        ? (Number(subject.completedHours || 0) >= subject.targetHours ? 'Meta de horas atingida' : Math.round((Number(subject.completedHours || 0) / subject.targetHours) * 100) + '% da meta de horas')
        : 'Sem meta de horas definida';
      const nextText = next && (next.subjectName === subject.name || next.subject === subject.name)
        ? 'Próximo: ' + (next.topic || 'estudo') + ' em ' + formatDate(next.date)
        : 'Sem atividade agendada';
      const recommendation = stat && stat.mastery < 60
        ? 'Recomendamos revisar este conteúdo com a Mentora.'
        : 'Continue avançando neste ritmo.';
      return '<article class="d-card">' +
        '<div class="d-card__head"><div><h2>' + escapeHtml(subject.name) + '</h2><p>' + escapeHtml(difficulty) + '</p></div><span class="d-card__mark">' + icon('book') + '</span></div>' +
        '<div class="d-progress"><div class="d-progress__fill" style="width:' + (Number(subject.progress) || 0) + '%"></div></div>' +
        '<p class="d-muted" style="margin-top:.6rem">' + (Number(subject.progress) || 0) + '% do progresso · ' + formatMinutes(Number(subject.completedHours || 0) * 60) + ' estudadas</p>' +
        '<p class="d-help" style="margin-top:.5rem">' + escapeHtml(nextText) + '</p>' +
        '<p class="d-help">' + escapeHtml(masteryText) + '</p>' +
        '<p class="d-help" style="color:var(--d-teal-dark)">' + escapeHtml(recommendation) + '</p>' +
        '<div class="d-form-actions" style="margin-top:.9rem">' +
        '<button class="d-btn d-btn--primary d-btn--sm" type="button" data-action="mentor-subject" data-subject="' + escapeHtml(subject.name) + '">' + icon('mentor') + ' Estudar com a Mentora</button>' +
        '<button class="d-btn d-btn--ghost d-btn--sm" type="button" data-action="pomodoro-subject" data-subject="' + escapeHtml(subject.name) + '">' + icon('timer') + ' Iniciar foco</button>' +
        '<button class="d-btn d-btn--ghost d-btn--sm" type="button" data-action="study-session" data-subject="' + escapeHtml(subject.name) + '">' + icon('plus') + ' Registrar estudo</button>' +
        '<button class="d-btn d-btn--quiet d-btn--sm" type="button" data-action="edit-subject" data-id="' + escapeHtml(subject.id) + '" aria-label="Editar matéria">' + icon('edit') + '</button>' +
        '<button class="d-btn d-btn--quiet d-btn--sm" type="button" data-action="remove-subject" data-id="' + escapeHtml(subject.id) + '" aria-label="Remover matéria">' + icon('trash') + '</button>' +
        '</div></article>';
    }).join('') + '</div>';
  }

  function seriesItem(item) {
    const subjectName = item.subjectName || item.subject || 'Geral';
    const title = item.topic ? escapeHtml(item.topic) : escapeHtml(subjectName);
    return '<div class="d-item' + (item.completed ? ' is-done' : '') + '">' +
      '<span class="d-item__mark">' + icon(item.completed ? 'check' : 'clock') + '</span>' +
      '<div class="d-item__body"><strong>' + title + '</strong><small>' + escapeHtml(subjectName) + ' · ' + formatDate(item.date) + ' ' + (item.time || '') + ' · ' + (item.duration || 30) + 'min</small></div>' +
      '<div class="d-item__actions">' +
      '<button class="d-btn d-btn--quiet d-btn--sm" type="button" data-action="toggle-schedule" data-id="' + escapeHtml(item.id) + '" aria-label="Alternar conclusão">' + icon(item.completed ? 'reset' : 'check') + '</button>' +
      '<button class="d-btn d-btn--quiet d-btn--sm" type="button" data-action="remove-schedule" data-id="' + escapeHtml(item.id) + '" aria-label="Remover item">' + icon('trash') + '</button>' +
      '</div></div>';
  }

  function renderSchedule() {
    const container = $('#scheduleGroups');
    const items = schedule().slice();
    if (!items.length) {
      container.innerHTML = emptyState('calendar', 'Seu cronograma está vazio', 'Adicione um bloco de estudo para saber o que fazer e quando.', 'Novo item', 'cronograma');
      return;
    }
    const today = todayISO();
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekKey = new Date(weekEnd.getTime() - weekEnd.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    const pending = items.filter((i) => !i.completed);
    const groups = [
      { title: 'Hoje', items: pending.filter((i) => i.date === today) },
      { title: 'Próximos dias', items: pending.filter((i) => i.date > today && i.date <= weekKey) },
      { title: 'Depois', items: pending.filter((i) => i.date > weekKey) },
      { title: 'Concluídas', items: items.filter((i) => i.completed) }
    ];
    container.innerHTML = groups.filter((group) => group.items.length).map((group) => {
      group.items.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
      return '<article class="d-card"><div class="d-card__head"><div><span class="d-eyebrow">' + group.items.length + ' item(ns)</span><h2>' + group.title + '</h2></div></div><div class="d-list">' + group.items.map(seriesItem).join('') + '</div></article>';
    }).join('');
  }

  function goalItem(goal) {
    const steps = Array.isArray(goal.steps) ? goal.steps : [];
    const doneSteps = steps.filter((s) => s.done).length;
    const stepProgress = steps.length ? Math.round((doneSteps / steps.length) * 100) : 0;
    const overdue = goal.dueDate && !goal.completed && goal.dueDate < todayISO();
    return '<div class="d-card">' +
      '<div class="d-card__head"><div><h2>' + escapeHtml(goal.text) + '</h2>' +
      '<p>' + escapeHtml(goal.subject || 'Geral') + (goal.dueDate ? ' · prazo ' + formatDate(goal.dueDate) : '') + '</p></div>' +
      '<span class="d-badge ' + (goal.completed ? 'd-badge--success' : overdue ? 'd-badge--danger' : 'd-badge--teal') + '">' + (goal.completed ? 'Concluída' : overdue ? 'Atrasada' : 'Em andamento') + '</span></div>' +
      (steps.length ? '<div class="d-progress"><div class="d-progress__fill" style="width:' + stepProgress + '%"></div></div><p class="d-muted" style="margin-top:.45rem">' + doneSteps + ' de ' + steps.length + ' etapas</p>' : '') +
      (steps.length ? '<div class="d-list" style="margin-top:.7rem">' + steps.map((step, index) => '<button class="d-item' + (step.done ? ' is-done' : '') + '" type="button" data-action="toggle-step" data-id="' + escapeHtml(goal.id) + '" data-step="' + index + '" style="width:100%;text-align:left"><span class="d-item__mark">' + icon(step.done ? 'check' : 'clock') + '</span><span class="d-item__body"><strong>' + escapeHtml(step.text) + '</strong></span></button>').join('') + '</div>' : '') +
      '<div class="d-form-actions" style="margin-top:.8rem">' +
      '<button class="d-btn d-btn--ghost d-btn--sm" type="button" data-action="complete-goal" data-id="' + escapeHtml(goal.id) + '">' + icon(goal.completed ? 'reset' : 'check') + (goal.completed ? ' Reabrir' : ' Concluir') + '</button>' +
      '<button class="d-btn d-btn--ghost d-btn--sm" type="button" data-action="add-step" data-id="' + escapeHtml(goal.id) + '">' + icon('plus') + ' Dividir em etapa</button>' +
      '<button class="d-btn d-btn--primary d-btn--sm" type="button" data-action="mentor-goal" data-id="' + escapeHtml(goal.id) + '">' + icon('mentor') + ' Ajuda da Mentora</button>' +
      '<button class="d-btn d-btn--quiet d-btn--sm" type="button" data-action="remove-goal" data-id="' + escapeHtml(goal.id) + '" aria-label="Remover meta">' + icon('trash') + '</button>' +
      '</div></div>';
  }

  function renderGoals() {
    const container = $('#goalGroups');
    const all = goals();
    if (!all.length) {
      container.innerHTML = emptyState('target', 'Nenhuma meta definida', 'Metas dão direção ao estudo. Crie a primeira e acompanhe a evolução.', 'Criar meta', 'metas');
      return;
    }
    const active = all.filter((g) => !g.completed);
    const done = all.filter((g) => g.completed);
    container.innerHTML = active.map(goalItem).join('') + done.map(goalItem).join('');
  }

  function renderProgress() {
    const minutes = auth.getStudyMinutes ? auth.getStudyMinutes() : sessions().reduce((t, s) => t + Number(s.minutes || 0), 0);
    const doneGoals = goals().filter((g) => g.completed).length;
    const hasData = sessions().length > 0 || Object.keys(contentStats()).length > 0 || goals().length > 0;
    $('#progressStats').innerHTML = [
      { label: 'Progresso geral', value: totalProgress() + '<small>%</small>' },
      { label: 'Tempo estudado', value: escapeHtml(formatMinutes(minutes)) },
      { label: 'Sessões registradas', value: String(sessions().length) },
      { label: 'Metas concluídas', value: doneGoals + '<small>/' + goals().length + '</small>' },
      { label: 'Sequência atual', value: studyStreak() + '<small> dias</small>' }
    ].map((item) => '<article class="d-card d-stat"><span class="d-stat__label">' + item.label + '</span><span class="d-stat__value">' + item.value + '</span></article>').join('');

    const days = [];
    for (let i = 6; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const key = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      days.push({ key: key, label: weekdayShort(key), minutes: sessions().filter((s) => String(s.completedAt || '').slice(0, 10) === key).reduce((sum, s) => sum + Number(s.minutes || 0), 0) });
    }
    const max = Math.max.apply(null, days.map((d) => d.minutes).concat([1]));
    $('#progressChart').innerHTML = hasData
      ? '<div class="d-chart">' + days.map((d) => '<div class="d-chart__bar"><div class="d-chart__col" style="height:' + Math.max(4, Math.round((d.minutes / max) * 160)) + 'px" title="' + d.minutes + ' minutos"></div><span class="d-chart__label">' + d.label + '</span></div>').join('') + '</div>'
      : emptyState('chart', 'Ainda sem dados de estudo', 'Registre suas sessões de estudo para ver sua evolução aqui.', 'Registrar no Bem-estar', 'bem-estar');

    const list = subjects();
    $('#progressSubjects').innerHTML = list.length
      ? '<div class="d-stack" style="gap:.9rem">' + list.map((s) => '<div class="d-progress-row"><div class="d-progress-row__head"><strong>' + escapeHtml(s.name) + '</strong><b>' + (Number(s.progress) || 0) + '%</b></div><div class="d-progress"><div class="d-progress__fill" style="width:' + (Number(s.progress) || 0) + '%"></div></div></div>').join('') + '</div>'
      : emptyState('book', 'Sem matérias para acompanhar', 'Adicione matérias para visualizar seu progresso.', 'Adicionar matéria', 'materias');

    const achievements = [
      { icon: 'check', label: 'Primeiro estudo', unlocked: sessions().length > 0 },
      { icon: 'calendar', label: '5 dias de constância', unlocked: new Set(sessions().map((s) => String(s.completedAt || '').slice(0, 10))).size >= 5 },
      { icon: 'clock', label: '10 horas estudadas', unlocked: minutes >= 600 },
      { icon: 'target', label: '10 exercícios concluídos', unlocked: (state.user.exerciseResults || []).length >= 10 }
    ];
    $('#progressAchievements').innerHTML = '<div class="d-stack" style="gap:.6rem">' + achievements.map((a) => '<div class="d-achievement' + (a.unlocked ? '' : ' is-locked') + '">' + icon(a.icon) + '<div><strong>' + escapeHtml(a.label) + '</strong><span>' + (a.unlocked ? 'Conquistada' : 'Ainda não desbloqueada') + '</span></div></div>').join('') + '</div>';

    const stats = Object.keys(contentStats()).map((key) => contentStats()[key]).filter((s) => s && s.attempts);
    stats.sort((a, b) => (a.mastery || 0) - (b.mastery || 0));
    $('#progressMastery').innerHTML = stats.length
      ? '<div class="d-stack" style="gap:.9rem">' + stats.slice(0, 8).map((s) => '<div class="d-progress-row"><div class="d-progress-row__head"><strong>' + escapeHtml(s.subject + ' · ' + s.topic) + '</strong><b>' + (s.mastery || 0) + '%</b></div><div class="d-progress"><div class="d-progress__fill" style="width:' + (s.mastery || 0) + '%"></div></div><small class="d-help">' + (s.correct || 0) + ' acertos em ' + (s.attempts || 0) + ' tentativas</small></div>').join('') + '</div>'
      : emptyState('target', 'Sem exercícios registrados', 'Quando você praticar com a Mentora, o domínio por conteúdo aparece aqui.', 'Praticar com a Mentora', 'mentora');
  }

  function renderWellbeing() {
    const wellbeing = (state.user && state.user.wellbeing) || { mood: '', updatedAt: null };
    $$('#wellbeingMoods [data-mood]').forEach((btn) => btn.classList.toggle('is-selected', btn.getAttribute('data-mood') === wellbeing.mood));
    $('#wellbeingMoodNote').textContent = wellbeing.mood
      ? 'Último check-in: ' + escapeHtml(wellbeing.mood) + (wellbeing.updatedAt ? ' · ' + formatDate(wellbeing.updatedAt) : '') + '.'
      : 'Você ainda não registrou como está se sentindo.';
    const pomodoroSelect = $('#pomodoroSubject');
    if (pomodoroSelect) {
      const previous = pomodoroSelect.value;
      pomodoroSelect.innerHTML = subjectsOptions(previous);
      if (!pomodoroSelect.value && subjects().length) pomodoroSelect.value = subjects()[0].name;
    }
    renderPomodoro();
    const tips = [
      { icon: 'clock', title: 'Blocos curtos', text: 'Estude em blocos de 25 a 50 minutos e faça pausas curtas entre eles.' },
      { icon: 'leaf', title: 'Pausa consciente', text: 'Levante, beba água e respire. A pausa faz parte do aprendizado.' },
      { icon: 'balance', title: 'Ritmo constante', text: 'Pouco todos os dias funciona melhor do que muito de uma só vez.' }
    ];
    $('#wellbeingTips').innerHTML = tips.map((tip) => '<article class="d-card"><div class="d-card__head"><div><h2>' + escapeHtml(tip.title) + '</h2><p>' + escapeHtml(tip.text) + '</p></div><span class="d-card__mark">' + icon(tip.icon) + '</span></div></article>').join('');
  }

  function renderPrivacy() {
    const user = state.user || {};
    $('#privacyName').textContent = user.name || '-';
    $('#privacyEmail').textContent = user.email || '-';
    $('#privacyCreatedAt').textContent = user.createdAt ? formatDate(user.createdAt) : '-';
    $('#privacyRole').textContent = user.role === 'admin' ? 'Administrador' : 'Estudante';
    $('#privacyStorage').innerHTML = '<div class="d-info-row"><span>Matérias</span><strong>' + subjects().length + '</strong></div>' +
      '<div class="d-info-row"><span>Metas</span><strong>' + goals().length + '</strong></div>' +
      '<div class="d-info-row"><span>Sessões de estudo</span><strong>' + sessions().length + '</strong></div>' +
      '<div class="d-info-row"><span>Exercícios respondidos</span><strong>' + ((state.user.exerciseResults || []).length) + '</strong></div>' +
      '<div class="d-info-row"><span>Check-in de bem-estar</span><strong>' + ((state.user.wellbeing && state.user.wellbeing.mood) || 'Não registrado') + '</strong></div>';

    const profile = learningProfile();
    const strategyKeys = Object.keys(profile.strategies).filter((k) => profile.strategies[k].uses);
    let html = '';
    if (strategyKeys.length) {
      html += '<p class="d-muted">Formatos que já testamos com você e o resultado percebido:</p><div class="d-stack" style="gap:.5rem;margin-top:.6rem">' +
        strategyKeys.map((key) => {
          const bucket = profile.strategies[key];
          return '<div class="d-info-row"><span>' + escapeHtml(strategyLabel(key)) + '</span><strong>' + bucket.helped + ' ajudou · ' + bucket.notHelped + ' não ajudou (de ' + bucket.uses + ' uso(s))</strong></div>';
        }).join('') + '</div>';
    } else {
      html += '<p class="d-help">Ainda não registramos feedback de estratégias. Use os botões "Ajudou / Não ajudou" na conversa com a Mentora para a SYNARA aprender como você aprende melhor.</p>';
    }
    const prefs = profile.preferences || {};
    const prefBits = [];
    if (prefs.explanationStyle) prefBits.push('formato preferido: ' + strategyLabel(prefs.explanationStyle));
    if (prefs.pace) prefBits.push('ritmo: ' + (prefs.pace === 'micro' ? 'em pequenas etapas' : 'explicações completas'));
    if (Array.isArray(prefs.formats) && prefs.formats.length) prefBits.push('formatos: ' + prefs.formats.join(', '));
    html += '<p class="d-muted" style="margin-top:.8rem">Preferências informadas por você: ' + (prefBits.length ? escapeHtml(prefBits.join(' · ')) : 'nenhuma registrada') + '.</p>';
    $('#privacyLearning').innerHTML = html;
  }

  function renderSettings() {
    const user = state.user || {};
    const name = user.name || 'Estudante';
    $('#settingsName').textContent = name;
    $('#settingsEmail').textContent = user.email || '-';
    $('#settingsRole').textContent = user.role === 'admin' ? 'Administrador' : 'Estudante';
    $('#settingsAvatar').textContent = initials(name);
    const prefs = learningProfile().preferences || {};
    $('#prefStyle').value = prefs.explanationStyle || '';
    $('#prefPace').value = prefs.pace || '';
    const selected = Array.isArray(prefs.formats) ? prefs.formats : [];
    $$('#prefFormats input[name="formats"]').forEach((input) => {
      input.checked = selected.indexOf(input.value) !== -1;
      const label = input.closest('.d-choice');
      if (label) label.classList.toggle('is-selected', input.checked);
    });
  }

  // ---------- 9. Mentora ----------
  function mentorWelcomeHtml() {
    const quick = [
      { action: 'organizar', icon: 'calendar', label: 'Organizar meus estudos' },
      { action: 'explicar', icon: 'book', label: 'Explicar um conteúdo' },
      { action: 'outra-forma', icon: 'reset', label: 'Quero estudar de outra forma' },
      { action: 'materia', icon: 'mentor', label: 'Me ajude com esta matéria' },
      { action: 'revisar', icon: 'target', label: 'Quero revisar' }
    ];
    return '<div class="d-mentor__welcome">' +
      '<span class="d-mentor__welcome-mark">' + icon('mentor') + '</span>' +
      '<h2>Olá! Eu sou sua Mentora da SYNARA.</h2>' +
      '<p>Estou aqui para ajudar você a aprender de uma forma que faça sentido para você. Conforme conversamos, eu percebo o que funciona melhor e adapto a explicação.</p>' +
      '<div class="d-mentor__quick">' + quick.map((q) => '<button class="d-mentor__quick-btn" type="button" data-action="mentor-quick" data-quick="' + q.action + '">' + icon(q.icon) + '<span>' + escapeHtml(q.label) + '</span></button>').join('') + '</div>' +
      '</div>';
  }

  function mentorMessageHtml(message) {
    const isUser = message.role === 'user';
    const avatar = icon(isUser ? 'user' : 'mentor');
    let tools = '';
    if (!isUser && message.kind === 'text') {
      const helped = message.feedback === 'helped';
      const notHelped = message.feedback === 'nothelped';
      tools = '<div class="d-msg__tools">' +
        '<button class="d-msg__tool' + (helped ? ' is-active' : '') + '" type="button" data-action="mentor-feedback" data-id="' + message.id + '" data-value="helped">' + icon('check') + ' Ajudou</button>' +
        '<button class="d-msg__tool' + (notHelped ? ' is-active' : '') + '" type="button" data-action="mentor-feedback" data-id="' + message.id + '" data-value="nothelped">' + icon('alert') + ' Não ajudou</button>' +
        '<button class="d-msg__tool" type="button" data-action="mentor-rephrase" data-id="' + message.id + '">' + icon('reset') + ' De outra forma</button>' +
        '</div>';
    }
    let exercise = '';
    if (!isUser && message.exercise && Array.isArray(message.exercise.options) && message.exercise.options.length) {
      exercise = '<div class="d-exercise">' +
        escapeHtml(message.exercise.question || '') +
        '<div class="d-exercise__options">' + message.exercise.options.map((option, index) => {
          const answered = message.answerIndex != null;
          const isCorrect = index === message.exercise.correctOption;
          let cls = '';
          if (answered && isCorrect) cls = ' is-correct';
          else if (answered && index === message.answerIndex) cls = ' is-wrong';
          return '<button class="d-exercise__option' + cls + '" type="button" data-action="exercise-answer" data-id="' + message.id + '" data-index="' + index + '"' + (answered ? ' disabled' : '') + '>' +
            '<span class="d-exercise__key">' + String.fromCharCode(65 + index) + '</span><span>' + escapeHtml(option) + '</span></button>';
        }).join('') + '</div>' +
        (message.answerIndex != null ? '<div class="d-exercise__feedback">' + escapeHtml(message.exercise.explanation || '') + '</div>' : '') +
        '</div>';
    }
    return '<div class="d-msg ' + (isUser ? 'd-msg--user' : 'd-msg--bot') + '" data-msg="' + message.id + '">' +
      '<span class="d-msg__avatar">' + avatar + '</span>' +
      '<div class="d-msg__content">' +
      '<span class="d-msg__author">' + (isUser ? 'Você' : 'Mentora SYNARA') + (message.strategy ? ' · ' + escapeHtml(strategyLabel(message.strategy)) : '') + '</span>' +
      '<div class="d-msg__bubble">' + (isUser ? escapeHtml(message.text) : message.text) + '</div>' +
      exercise + tools +
      '</div></div>';
  }

  function scrollMentorLog() {
    const log = $('#mentorLog');
    if (log) log.scrollTop = log.scrollHeight;
  }

  function renderMentorLog() {
    const log = $('#mentorLog');
    if (!log) return;
    if (!state.mentor.messages.length) {
      log.innerHTML = mentorWelcomeHtml();
      return;
    }
    log.innerHTML = state.mentor.messages.map(mentorMessageHtml).join('') +
      (state.mentor.sending ? '<div class="d-msg d-msg--bot"><span class="d-msg__avatar">' + icon('mentor') + '</span><div class="d-msg__content"><span class="d-msg__author">Mentora SYNARA</span><div class="d-msg__bubble"><span class="d-mentor__typing"><i></i><i></i><i></i></span></div></div></div>' : '');
    scrollMentorLog();
  }

  function renderMentor() {
    const subjectSelect = $('#mentorSubject');
    if (subjectSelect) subjectSelect.innerHTML = subjectsOptions(subjectSelect.value);
    const strategySelect = $('#mentorStrategy');
    const subject = subjectSelect ? subjectSelect.value : 'Geral';
    if (strategySelect && strategySelect.value === 'auto') {
      const choice = chooseStrategy(subject, 'auto');
      $('#mentorStrategyNote').textContent = 'Estratégia atual: ' + strategyLabel(choice.strategy) + '. ' + choice.reason;
    } else if (strategySelect) {
      $('#mentorStrategyNote').textContent = 'Você escolheu manualmente: ' + strategyLabel(strategySelect.value) + '.';
    }
    renderMentorLog();
  }

  function addMentorMessage(message) {
    state.mentor.messages.push(message);
    if (state.mentor.messages.length > 40) state.mentor.messages.shift();
    renderMentorLog();
    return message;
  }

  function mentorContext() {
    const subject = ($('#mentorSubject') && $('#mentorSubject').value) || 'Geral';
    const topic = ($('#mentorTopic') && $('#mentorTopic').value.trim()) || '';
    const difficulty = ($('#mentorDifficulty') && $('#mentorDifficulty').value) || 'médio';
    const forced = ($('#mentorStrategy') && $('#mentorStrategy').value) || 'auto';
    return { subject: subject, topic: topic, difficulty: difficulty, forced: forced };
  }

  function openMentorWith(subject, topic, forcedStrategy) {
    if (subject) {
      const select = $('#mentorSubject');
      const exists = subjects().some((s) => s.name === subject);
      if (!exists && subject !== 'Geral' && select) {
        select.innerHTML = subjectsOptions() + '<option value="' + escapeHtml(subject) + '">' + escapeHtml(subject) + '</option>';
      }
      if (select) select.value = subject;
    }
    if (topic) $('#mentorTopic').value = topic;
    if (forcedStrategy) $('#mentorStrategy').value = forcedStrategy;
    navigate('mentora');
    renderMentor();
    const input = $('#mentorInput');
    if (input) input.focus();
  }

  async function fetchKnowledge(query) {
    const email = state.user && state.user.email;
    if (!email || !query) return [];
    try {
      const response = await fetch('/api/embeddings/query', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: email, query: query, topK: 3 })
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.items || []).map((item) => item.content).filter(Boolean);
    } catch (err) {
      return [];
    }
  }

  function statsForContent(subject, topic) {
    const all = contentStats();
    if (topic) return all[subject + '::' + topic] || null;
    return subjectMasteryMap()[subject] || null;
  }

  async function sendMentorMessage(text) {
    if (!text || !text.trim()) return;
    if (state.mentor.sending) return;
    const message = text.trim();
    const ctx = mentorContext();
    const choice = chooseStrategy(ctx.subject, ctx.forced);
    const strategy = choice.strategy;
    const entry = { strategy: strategy, subject: ctx.subject, topic: ctx.topic, reported: null };
    addMentorMessage({ id: uid(), role: 'user', text: message, kind: 'text' });
    state.mentor.sending = true;
    renderMentorLog();

    // Sinal implicito real: "nao entendi" marca a ultima estrategia como nao util.
    const lastBot = state.mentor.messages.slice().reverse().find((m) => m.role === 'bot' && m.kind === 'text');
    if (lastBot && lastBot.entry && !lastBot.entry.reported && /não entendi|nao entendi|não deu|nao deu|confuso|não faz sentido/.test(message.toLowerCase())) {
      lastBot.entry.reported = false;
      setStrategyFeedback(lastBot.entry, false);
      lastBot.feedback = 'nothelped';
    }

    try {
      const knowledge = await fetchKnowledge(message);
      const body = {
        message: message,
        subject: ctx.subject,
        topic: ctx.topic,
        difficulty: ctx.difficulty,
        mode: strategy,
        progress: totalProgress(),
        contentStats: statsForContent(ctx.subject, ctx.topic),
        recentSchedule: schedule().filter((s) => !s.completed).slice(0, 5),
        subjects: subjects().map((s) => s.name),
        goals: goals().filter((g) => !g.completed).map((g) => g.text),
        messageHistory: state.mentor.messages.slice(-8).map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text })),
        history: state.mentor.messages.slice(-4).map((m) => (m.role === 'user' ? 'USUARIO: ' : 'MENTORA: ') + m.text).join('\n'),
        knowledge: knowledge
      };
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await response.json().catch(() => ({}));
      state.mentor.sending = false;
      if (!response.ok) {
        addMentorMessage({ id: uid(), role: 'bot', kind: 'text', text: 'Não consegui responder agora. Verifique sua conexão e tente novamente.', strategy: strategy });
        renderMentorLog();
        return;
      }
      if (data && data.clarify) {
        addMentorMessage({ id: uid(), role: 'bot', kind: 'text', text: data.question || 'Você prefere um resumo rápido, uma explicação passo a passo ou um exercício prático?', strategy: strategy, entry: entry });
        registerStrategyUse(entry);
        state.mentor.pending = message;
      } else {
        const reply = data && data.reply ? data.reply : 'Vou ajudar com isso. Pode me dar mais detalhes?';
        addMentorMessage({ id: uid(), role: 'bot', kind: 'text', text: reply, strategy: strategy, entry: entry });
        registerStrategyUse(entry);
        state.mentor.lastStrategy = strategy;
        if (strategy === 'practice') {
          await appendExercise(ctx);
        }
      }
      renderMentorLog();
    } catch (error) {
      state.mentor.sending = false;
      addMentorMessage({ id: uid(), role: 'bot', kind: 'text', text: 'Tive um problema para responder agora. Tente novamente em instantes.', strategy: strategy });
      renderMentorLog();
      console.warn('Mentor error:', error);
    }
  }

  async function appendExercise(ctx) {
    try {
      const response = await fetch('/api/generate-exercise', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: ctx.subject, topic: ctx.topic, difficulty: ctx.difficulty })
      });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.options) && data.options.length) {
        addMentorMessage({
          id: uid(),
          role: 'bot',
          kind: 'exercise',
          text: 'Vamos praticar com uma questão rápida.',
          exercise: { question: data.question || data.exercise || '', options: data.options, correctOption: Number(data.correctOption) || 0, explanation: data.explanation || '' }
        });
      } else if (data.exercise) {
        addMentorMessage({ id: uid(), role: 'bot', kind: 'text', text: data.exercise });
      }
    } catch (err) { /* mantem a conversa mesmo sem exercicio */ }
  }

  function answerExercise(messageId, index) {
    const message = state.mentor.messages.find((m) => m.id === messageId);
    if (!message || !message.exercise || message.answerIndex != null) return;
    message.answerIndex = index;
    const correct = index === Number(message.exercise.correctOption);
    const ctx = mentorContext();
    try {
      auth.recordExercise({ subject: ctx.subject, topic: ctx.topic || 'Prática', correct: correct, answer: String((message.exercise.options || [])[index] || '') });
      refreshUser();
    } catch (err) { /* registro e opcional */ }
    renderMentorLog();
    toast(correct ? 'Boa! Resposta correta.' : 'Quase. Veja a explicação abaixo.', !correct);
  }

  function mentorFeedback(messageId, value) {
    const message = state.mentor.messages.find((m) => m.id === messageId);
    if (!message || !message.entry) return;
    const helped = value === 'helped';
    message.feedback = helped ? 'helped' : 'nothelped';
    setStrategyFeedback(message.entry, helped);
    renderMentorLog();
    toast(helped ? 'Ótimo! Vou priorizar este formato com você.' : 'Anotado. Vou tentar outro formato.', !helped);
  }

  function setStrategy(value) {
    const select = $('#mentorStrategy');
    if (select) select.value = value;
  }
  function nextStrategyAfter(current) {
    const candidates = candidateStrategies(mentorContext().subject);
    const index = candidates.indexOf(current);
    return candidates[(index + 1) % candidates.length] || candidates[0];
  }
  function mentorRephrase(messageId) {
    const message = state.mentor.messages.find((m) => m.id === messageId);
    if (!message || !message.entry) return;
    setStrategyFeedback(message.entry, false);
    message.feedback = 'nothelped';
    const alternative = nextStrategyAfter(message.entry.strategy);
    setStrategy(alternative === 'auto' ? 'auto' : alternative);
    renderMentorLog();
    sendMentorMessage('Não entendi dessa forma. Pode explicar de outro jeito, mais alinhado ao que funciona para mim?');
  }
  function mentorQuick(action) {
    const ctx = mentorContext();
    if (action === 'organizar') return sendMentorMessage('Me ajude a organizar meus estudos desta semana.');
    if (action === 'explicar') { setStrategy('explain'); return sendMentorMessage('Explique um conteúdo para mim, passo a passo.'); }
    if (action === 'outra-forma') {
      const alternative = nextStrategyAfter(state.mentor.lastStrategy || 'explain');
      setStrategy(alternative);
      return sendMentorMessage('Quero estudar de outra forma, diferente da que usamos até agora.');
    }
    if (action === 'materia') return sendMentorMessage('Me ajude com esta matéria: ' + ctx.subject + '.');
    if (action === 'revisar') { setStrategy('review'); return sendMentorMessage('Quero revisar o conteúdo que já estudei.'); }
    return null;
  }

  // ---------- 10. Manipuladores ----------
  function findSubject(id) { return subjects().find((s) => String(s.id) === String(id)); }
  function findGoal(id) { return goals().find((g) => String(g.id) === String(id)); }

  async function handleStudySession(subjectName) {
    const subject = subjects().find((s) => s.name === subjectName);
    if (!subject) return;
    const value = await openModal({ title: 'Registrar estudo', message: 'Quantos minutos você estudou ' + subjectName + '?', input: { label: 'Minutos', placeholder: 'Ex.: 30' }, confirmLabel: 'Registrar' });
    if (!value) return;
    const minutes = Math.max(1, Math.min(600, parseInt(value, 10) || 0));
    auth.addStudySession(subject.id, minutes, '');
    renderAll();
    toast('Sessão de ' + minutes + ' min registrada em ' + subjectName + '.');
  }

  async function handleAddStep(goalId) {
    const goal = findGoal(goalId);
    if (!goal) return;
    const value = await openModal({ title: 'Dividir meta em etapa', message: 'Descreva uma etapa desta meta.', input: { label: 'Etapa', placeholder: 'Ex.: Revisar 10 exercícios' }, confirmLabel: 'Adicionar etapa' });
    if (!value) return;
    goal.steps = Array.isArray(goal.steps) ? goal.steps : [];
    goal.steps.push({ text: value, done: false });
    auth.saveUser(state.user);
    renderAll();
    toast('Etapa adicionada.');
  }

  function handleToggleStep(goalId, index) {
    const goal = findGoal(goalId);
    if (!goal || !Array.isArray(goal.steps) || !goal.steps[index]) return;
    goal.steps[index].done = !goal.steps[index].done;
    auth.saveUser(state.user);
    renderAll();
  }

  async function handleRemoveSubject(id) {
    const subject = findSubject(id);
    if (!subject) return;
    const confirmed = await openModal({ title: 'Remover matéria', message: 'Remover "' + subject.name + '"? Os registros de estudo permanecem no seu histórico.', confirmLabel: 'Remover', danger: true });
    if (!confirmed) return;
    auth.removeSubject(subject.id);
    renderAll();
    toast('Matéria removida.');
  }

  async function handleRemoveGoal(id) {
    const goal = findGoal(id);
    if (!goal) return;
    const confirmed = await openModal({ title: 'Remover meta', message: 'Remover a meta "' + goal.text + '"?', confirmLabel: 'Remover', danger: true });
    if (!confirmed) return;
    auth.removeGoal(goal.id);
    renderAll();
    toast('Meta removida.');
  }

  async function handleEditSubject(id) {
    const subject = findSubject(id);
    if (!subject) return;
    const value = await openModal({ title: 'Editar matéria', message: 'Novo nome para esta matéria.', input: { label: 'Nome', placeholder: subject.name }, confirmLabel: 'Salvar' });
    if (!value) return;
    auth.editSubject(subject.id, value, subject.targetHours);
    renderAll();
    toast('Matéria atualizada.');
  }

  function handleDeleteAccount() {
    openModal({
      title: 'Excluir minha conta',
      message: 'Esta ação é permanente e remove todos os seus dados. Digite CONFIRMAR EXCLUSAO para continuar.',
      input: { label: 'Confirmação', placeholder: 'CONFIRMAR EXCLUSAO' },
      confirmLabel: 'Excluir conta',
      danger: true
    }).then(async (value) => {
      if (!value) return;
      if (value.trim().toUpperCase() !== 'CONFIRMAR EXCLUSAO') {
        toast('Confirmação incorreta. A exclusão foi cancelada.', true);
        return;
      }
      try {
        const response = await fetch('/api/account', { method: 'DELETE', credentials: 'include' });
        if (!response.ok) throw new Error('delete failed');
        sessionStorage.clear();
        window.location.href = 'login.html';
      } catch (err) {
        toast('Não foi possível excluir a conta. Tente novamente.', true);
      }
    });
  }

  async function handleSavePrefs(event) {
    event.preventDefault();
    const profile = learningProfile();
    profile.preferences = {
      explanationStyle: $('#prefStyle').value || '',
      pace: $('#prefPace').value || '',
      formats: $$('#prefFormats input[name="formats"]:checked').map((input) => input.value)
    };
    saveLearningProfile(profile);
    $('#prefsSuccess').hidden = false;
    $('#prefsError').hidden = true;
    $$('#prefFormats .d-choice').forEach((label) => {
      const input = label.querySelector('input');
      label.classList.toggle('is-selected', !!(input && input.checked));
    });
    toast('Preferências salvas. A Mentora vai considerar isso.');
  }

  function handleResetLearning() {
    openModal({ title: 'Redefinir perfil de aprendizagem', message: 'Isso apaga as estatísticas de estratégia guardadas no seu perfil. Deseja continuar?', confirmLabel: 'Redefinir', danger: true }).then((confirmed) => {
      if (!confirmed) return;
      const profile = defaultLearningProfile();
      saveLearningProfile(profile);
      renderAll();
      toast('Perfil de aprendizagem redefinido.');
    });
  }

  function wireNavigation() {
    document.addEventListener('click', (event) => {
      const actionEl = event.target.closest('[data-action]');
      if (actionEl) {
        const action = actionEl.getAttribute('data-action');
        if (action === 'mentor-subject') { openMentorWith(actionEl.getAttribute('data-subject') || 'Geral', ''); return; }
        if (action === 'study-session') { handleStudySession(actionEl.getAttribute('data-subject') || ''); return; }
        if (action === 'edit-subject') { handleEditSubject(actionEl.getAttribute('data-id')); return; }
        if (action === 'remove-subject') { handleRemoveSubject(actionEl.getAttribute('data-id')); return; }
        if (action === 'toggle-schedule') { auth.toggleScheduleItem(Number(actionEl.getAttribute('data-id'))); renderAll(); return; }
        if (action === 'remove-schedule') { auth.removeScheduleItem(Number(actionEl.getAttribute('data-id'))); renderAll(); return; }
        if (action === 'complete-goal') { auth.completeGoal(Number(actionEl.getAttribute('data-id'))); renderAll(); return; }
        if (action === 'remove-goal') { handleRemoveGoal(actionEl.getAttribute('data-id')); return; }
        if (action === 'add-step') { handleAddStep(actionEl.getAttribute('data-id')); return; }
        if (action === 'toggle-step') { handleToggleStep(actionEl.getAttribute('data-id'), Number(actionEl.getAttribute('data-step'))); return; }
        if (action === 'mentor-goal') { const goal = findGoal(actionEl.getAttribute('data-id')); if (goal) openMentorWith(goal.subject || 'Geral', goal.text); return; }
        if (action === 'mentor-quick') { mentorQuick(actionEl.getAttribute('data-quick')); return; }
        if (action === 'mentor-feedback') { mentorFeedback(Number(actionEl.getAttribute('data-id')), actionEl.getAttribute('data-value')); return; }
        if (action === 'mentor-rephrase') { mentorRephrase(Number(actionEl.getAttribute('data-id'))); return; }
        if (action === 'exercise-answer') { answerExercise(Number(actionEl.getAttribute('data-id')), Number(actionEl.getAttribute('data-index'))); return; }
        if (action === 'pomodoro-open') { openPomodoro(''); return; }
        if (action === 'pomodoro-subject') { openPomodoro(actionEl.getAttribute('data-subject') || ''); return; }
        if (action === 'pomodoro-from-mentor') {
          const mentorSelect = $('#mentorSubject');
          openPomodoro(mentorSelect && mentorSelect.value !== 'Geral' ? mentorSelect.value : '');
          return;
        }
      }
      const mentorSubject = event.target.closest('[data-mentor-subject]');
      if (mentorSubject) { openMentorWith(mentorSubject.getAttribute('data-mentor-subject'), ''); return; }
      const goto = event.target.closest('[data-goto]');
      if (goto) { navigate(goto.getAttribute('data-goto')); return; }
      const sectionBtn = event.target.closest('[data-section]');
      if (sectionBtn) navigate(sectionBtn.getAttribute('data-section'));
    });
  }

  function wireForms() {
    function toggleCard(buttonId, cardId) {
      const button = $('#' + buttonId);
      const card = $('#' + cardId);
      if (button && card) button.addEventListener('click', () => {
        card.hidden = !card.hidden;
        if (!card.hidden) { const field = card.querySelector('input, select'); if (field) field.focus(); }
      });
    }
    toggleCard('subjectToggleForm', 'subjectFormCard');
    toggleCard('scheduleToggleForm', 'scheduleFormCard');
    toggleCard('goalToggleForm', 'goalFormCard');

    $('#subjectCancel').addEventListener('click', () => { $('#subjectFormCard').hidden = true; $('#subjectError').hidden = true; });
    $('#scheduleCancel').addEventListener('click', () => { $('#scheduleFormCard').hidden = true; $('#scheduleError').hidden = true; });
    $('#goalCancel').addEventListener('click', () => { $('#goalFormCard').hidden = true; $('#goalError').hidden = true; });

    $('#subjectForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = $('#subjectName').value.trim();
      const target = Number($('#subjectTarget').value) || 0;
      const errorBox = $('#subjectError');
      if (!name) { errorBox.textContent = 'Informe o nome da matéria.'; errorBox.hidden = false; return; }
      if (subjects().some((s) => normalizeKey(s.name) === normalizeKey(name))) { errorBox.textContent = 'Você já tem uma matéria com esse nome.'; errorBox.hidden = false; return; }
      errorBox.hidden = true;
      auth.addSubject(name, target);
      $('#subjectForm').reset();
      $('#subjectFormCard').hidden = true;
      renderAll();
      toast('Matéria adicionada.');
    });

    $('#scheduleForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const subjectName = $('#scheduleSubject').value;
      const subject = subjects().find((s) => s.name === subjectName);
      const errorBox = $('#scheduleError');
      const item = {
        subjectId: subject ? subject.id : 'geral',
        subjectName: subjectName || 'Geral',
        subject: subjectName || 'Geral',
        topic: $('#scheduleTopic').value.trim(),
        date: $('#scheduleDate').value,
        time: $('#scheduleTime').value,
        duration: Number($('#scheduleDuration').value) || 0
      };
      if (!item.date || !item.time || !item.duration) { errorBox.textContent = 'Informe data, horário e duração.'; errorBox.hidden = false; return; }
      errorBox.hidden = true;
      auth.addScheduleItem(item);
      $('#scheduleForm').reset();
      $('#scheduleDate').value = todayISO();
      $('#scheduleFormCard').hidden = true;
      renderAll();
      toast('Item adicionado ao cronograma.');
    });

    $('#goalForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const text = $('#goalText').value.trim();
      const subject = $('#goalSubject').value;
      const due = $('#goalDue').value;
      const errorBox = $('#goalError');
      if (!text) { errorBox.textContent = 'Descreva a meta.'; errorBox.hidden = false; return; }
      errorBox.hidden = true;
      const goal = auth.addGoal(text, subject);
      if (goal && due) { goal.dueDate = due; auth.saveUser(state.user); }
      $('#goalForm').reset();
      $('#goalFormCard').hidden = true;
      renderAll();
      toast('Meta criada.');
    });
  }

  function doLogout() {
    auth.logout().then(() => { window.location.href = 'login.html'; }).catch(() => { sessionStorage.clear(); window.location.href = 'login.html'; });
  }

  function wireShell() {
    $('#sidebarToggle').addEventListener('click', () => {
      const collapsed = !$('#dashboardShell').classList.contains('is-collapsed');
      applySidebar(collapsed, true);
    });
    $('#menuToggle').addEventListener('click', () => setMobileSidebar(!$('#dashboardSidebar').classList.contains('is-open')));
    $('#sidebarBackdrop').addEventListener('click', () => setMobileSidebar(false));

    const trigger = $('#accountTrigger');
    const menu = $('#accountMenu');
    trigger.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      trigger.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', (event) => {
      if (menu.hidden) return;
      if (event.target.closest('#accountMenu') || event.target.closest('#accountTrigger')) return;
      menu.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !menu.hidden) { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); }
    });

    $('#logoutButton').addEventListener('click', doLogout);
    $('#settingsLogout').addEventListener('click', doLogout);
    window.addEventListener('hashchange', navigateFromHash);
    window.addEventListener('resize', () => { if (!isMobile()) setMobileSidebar(false); });
  }

  function wireWellbeing() {
    $$('#wellbeingMoods [data-mood]').forEach((button) => {
      button.addEventListener('click', () => {
        auth.setWellbeing(button.getAttribute('data-mood'));
        renderAll();
        toast('Check-in registrado. Obrigado por compartilhar.');
      });
    });

    $('#pomodoroStart').addEventListener('click', pomodoroStart);
    $('#pomodoroPause').addEventListener('click', pomodoroPause);
    $('#pomodoroResume').addEventListener('click', pomodoroResume);
    $('#pomodoroReset').addEventListener('click', pomodoroReset);
    $('#pomodoroStop').addEventListener('click', pomodoroStop);
    $('#pomodoroSkip').addEventListener('click', pomodoroSkipBreak);

    $('#pomodoroConfigForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const config = {
        focus: clampNumber($('#pomodoroFocusMinutes').value, 5, 90, POMODORO_DEFAULTS.focus),
        shortBreak: clampNumber($('#pomodoroShortBreak').value, 1, 30, POMODORO_DEFAULTS.shortBreak),
        longBreak: clampNumber($('#pomodoroLongBreak').value, 5, 60, POMODORO_DEFAULTS.longBreak),
        cyclesBeforeLong: clampNumber($('#pomodoroCyclesBefore').value, 2, 8, POMODORO_DEFAULTS.cyclesBeforeLong)
      };
      savePomodoro({ config: config });
      state.pomodoro.config = config;
      if (state.pomodoro.phase === 'idle' || state.pomodoro.phase === 'done') {
        state.pomodoro.duration = phaseDuration('focus');
        state.pomodoro.remaining = state.pomodoro.duration;
      }
      $('#pomodoroConfigSaved').hidden = false;
      renderPomodoro();
      toast('Configurações do Pomodoro salvas.');
    });

    renderPomodoro();
  }

  function wirePrivacy() {
    $('#editProfileBtn').addEventListener('click', () => {
      const panel = $('#profileEditPanel');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) { $('#profileNameInput').value = (state.user && state.user.name) || ''; $('#profileNameInput').focus(); }
    });
    $('#cancelProfileEdit').addEventListener('click', () => { $('#profileEditPanel').hidden = true; });
    $('#changePasswordBtn').addEventListener('click', () => {
      const panel = $('#passwordEditPanel');
      panel.hidden = !panel.hidden;
      if (!panel.hidden) $('#currentPassword').focus();
    });
    $('#cancelPasswordEdit').addEventListener('click', () => { $('#passwordEditPanel').hidden = true; });

    $('#profileNameForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = $('#profileNameError');
      const successBox = $('#profileNameSuccess');
      errorBox.hidden = true; successBox.hidden = true;
      const result = await auth.updateName($('#profileNameInput').value.trim());
      if (!result.success) { errorBox.textContent = result.message; errorBox.hidden = false; return; }
      successBox.textContent = result.message;
      successBox.hidden = false;
      renderAll();
      toast('Nome atualizado.');
    });

    $('#passwordForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const errorBox = $('#passwordError');
      const successBox = $('#passwordSuccess');
      errorBox.hidden = true; successBox.hidden = true;
      const result = await auth.changePassword($('#currentPassword').value, $('#newPassword').value, $('#confirmPassword').value);
      if (!result.success) { errorBox.textContent = result.message; errorBox.hidden = false; return; }
      successBox.textContent = result.message + ' Redirecionando para o login...';
      successBox.hidden = false;
      window.setTimeout(() => { window.location.href = 'login.html'; }, 1600);
    });

    $('#deleteAccountBtn').addEventListener('click', handleDeleteAccount);
    $('#resetLearningProfileBtn').addEventListener('click', handleResetLearning);
  }

  function wireSettings() {
    $('#settingsChangePassword').addEventListener('click', () => {
      navigate('privacidade');
      $('#passwordEditPanel').hidden = false;
      $('#currentPassword').focus();
    });
    $('#learningPrefsForm').addEventListener('submit', handleSavePrefs);
    $$('#prefFormats .d-choice').forEach((label) => {
      const input = label.querySelector('input');
      if (!input) return;
      input.addEventListener('change', () => label.classList.toggle('is-selected', input.checked));
    });
  }

  function wireMentor() {
    const input = $('#mentorInput');
    $('#mentorForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      input.value = '';
      input.style.height = 'auto';
      sendMentorMessage(value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        input.value = '';
        input.style.height = 'auto';
        sendMentorMessage(value);
      }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(160, input.scrollHeight) + 'px';
    });
    $('#mentorSubject').addEventListener('change', renderMentor);
    $('#mentorStrategy').addEventListener('change', renderMentor);
    $('#mentorNewChat').addEventListener('click', () => {
      state.mentor.messages = [];
      state.mentor.pending = null;
      state.mentor.lastStrategy = null;
      renderMentorLog();
      toast('Nova conversa iniciada.');
    });
  }

  // ---------- 11. Boot ----------
  async function boot() {
    hydrateIcons();
    wireModal();
    initSidebar();
    $('#scheduleDate').value = todayISO();
    wireNavigation();
    wireShell();
    wireForms();
    wireWellbeing();
    wirePrivacy();
    wireSettings();
    wireMentor();

    let user = null;
    try {
      user = await auth.hydrateFromServer();
    } catch (err) {
      user = null;
    }
    if (!user) {
      window.location.href = 'login.html';
      return;
    }
    refreshUser();
    renderHeaderUser();
    $('#scheduleSubject').innerHTML = subjectsOptions();
    $('#goalSubject').innerHTML = '<option value="">Geral</option>' + subjectsOptions();
    navigateFromHash();
  }

  // Exponibiliza utilitarios internos para verificacao manual (sem expor dados sensiveis).
  window.SynaraCentral = {
    navigate: navigate,
    getSection: () => state.section,
    getStrategy: (subject) => chooseStrategy(subject || 'Geral', 'auto')
  };

  boot();
})();



















