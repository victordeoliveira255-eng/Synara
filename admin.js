/* ============================================================
   SYNARA — Painel Administrativo (admin.js)
   Script externo (nao inline) para evitar redeclaracao de
   `auth` no escopo global e permitir validacao com node --check.
   Usa o `auth` global definido em auth.js.
   ============================================================ */
(function () {
  'use strict';

  const SIDEBAR_KEY = 'synara-admin-sidebar';
  const SECTION_TITLES = {
    overview: 'Visão geral',
    users: 'Usuários',
    mentor: 'Mentora',
    health: 'Sistema',
    logs: 'Logs',
    bncc: 'BNCC'
  };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function formatDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('pt-BR');
  }
  function initials(name) {
    const parts = String(name || 'Admin').trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p.charAt(0).toUpperCase()).join('') || 'A';
  }
  function icon(name) {
    return (window.SynaraIcons && window.SynaraIcons.icon(name)) || '';
  }
  function loadingHtml(label) {
    return '<div class="a-loading"><i></i> ' + escapeHtml(label) + '</div>';
  }
  function emptyHtml(iconName, title, text) {
    return '<div class="a-empty"><span class="a-empty__mark">' + icon(iconName) + '</span><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(text) + '</p></div>';
  }
  function errorHtml(message) {
    return '<div class="a-error">' + escapeHtml(message) + '</div>';
  }

  // ---------- Toast ----------
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

  // ---------- Modal ----------
  const modalState = { resolver: null };
  function confirmModal(options) {
    const modal = $('#confirmModal');
    if (!modal) return Promise.resolve(false);
    $('#confirmTitle').textContent = options.title || 'Confirmação';
    $('#confirmMessage').textContent = options.message || '';
    const okBtn = $('#confirmOk');
    okBtn.textContent = options.confirmLabel || 'Confirmar';
    okBtn.className = 'a-btn ' + (options.danger ? 'a-btn--danger' : 'a-btn--primary');
    modal.hidden = false;
    window.setTimeout(() => okBtn.focus(), 30);
    return new Promise((resolve) => { modalState.resolver = resolve; });
  }
  function closeConfirm(result) {
    const modal = $('#confirmModal');
    if (modal) modal.hidden = true;
    const resolver = modalState.resolver;
    modalState.resolver = null;
    if (resolver) resolver(result);
  }
  function wireModal() {
    $('#confirmOk').addEventListener('click', () => closeConfirm(true));
    $('#confirmCancel').addEventListener('click', () => closeConfirm(false));
    $('#confirmClose').addEventListener('click', () => closeConfirm(false));
    $('#confirmBackdrop').addEventListener('click', () => closeConfirm(false));
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const modal = $('#confirmModal');
      if (modal && !modal.hidden) closeConfirm(false);
    });
  }

  // ---------- Sidebar ----------
  function isMobile() { return window.matchMedia('(max-width: 900px)').matches; }
  function applySidebar(collapsed, persist) {
    const shell = $('#adminShell');
    const toggle = $('#sidebarToggle');
    shell.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', collapsed ? 'Expandir menu lateral' : 'Recolher menu lateral');
    if (persist) { try { localStorage.setItem(SIDEBAR_KEY, collapsed ? 'collapsed' : 'expanded'); } catch (e) {} }
  }
  function setMobileSidebar(open) {
    $('#adminSidebar').classList.toggle('is-open', open);
    $('#sidebarBackdrop').hidden = !open;
    $('#menuToggle').setAttribute('aria-expanded', String(open));
  }
  function initSidebar() {
    let stored = 'expanded';
    try { stored = localStorage.getItem(SIDEBAR_KEY) || 'expanded'; } catch (e) {}
    applySidebar(stored === 'collapsed', false);
  }

  // ---------- Navegacao ----------
  const loaded = {};
  function navigate(section) {
    const target = SECTION_TITLES[section] ? section : 'overview';
    $$('.admin-view[data-view]').forEach((view) => view.classList.toggle('is-active', view.getAttribute('data-view') === target));
    $$('.admin-nav-link').forEach((link) => {
      if (link.getAttribute('data-section') === target) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    $('#topbarTitle').textContent = SECTION_TITLES[target];
    if (isMobile()) setMobileSidebar(false);
    loadSection(target);
    return target;
  }
  function loadSection(section) {
    if (section === 'overview') { loadStats(); loadMentor(true); loadHealth(true); }
    else if (section === 'users') loadUsers();
    else if (section === 'mentor') loadMentor();
    else if (section === 'health') loadHealth();
    else if (section === 'logs') loadLogs();
    else if (section === 'bncc') loadBNCC();
  }

  // ---------- Dados ----------
  async function loadStats() {
    const subtitle = $('#overviewSubtitle');
    try {
      const data = await auth.request('/api/admin/stats');
      const stats = (data && data.stats) || {};
      $('#statTotalUsers').textContent = String(stats.totalUsers != null ? stats.totalUsers : 0);
      $('#statActiveUsers').textContent = String(stats.activeUsers != null ? stats.activeUsers : 0);
      $('#statMentorInteractions').textContent = String(stats.totalMentorInteractions != null ? stats.totalMentorInteractions : 0);
      $('#statContentItems').textContent = String(stats.totalContentItems != null ? stats.totalContentItems : 0);
      if (subtitle) subtitle.textContent = 'Atualizado em ' + formatDateTime(stats.lastUpdated || new Date().toISOString()) + '.';
    } catch (error) {
      ['statTotalUsers', 'statActiveUsers', 'statMentorInteractions', 'statContentItems'].forEach((id) => { const el = $('#' + id); if (el) el.textContent = '-'; });
      if (subtitle) subtitle.textContent = 'Não foi possível carregar os indicadores: ' + error.message;
    }
  }

  async function loadMentor() {
    const summaryBox = $('#mentorSummary');
    const latestBox = $('#mentorLatest');
    const overviewBox = $('#overviewMentor');
    if (summaryBox) summaryBox.innerHTML = loadingHtml('Carregando eventos...');
    if (latestBox) latestBox.innerHTML = '';
    if (overviewBox) overviewBox.innerHTML = loadingHtml('Carregando...');
    try {
      const data = await auth.request('/api/admin/mentor');
      const summary = Array.isArray(data.summary) ? data.summary : [];
      const latest = Array.isArray(data.latest) ? data.latest : [];
      if (summaryBox) {
        summaryBox.innerHTML = summary.length
          ? '<div class="a-stack" style="gap:.4rem">' + summary.map((row) => '<div class="a-info-row"><span>' + escapeHtml(row.event_type || 'evento') + '</span><strong>' + escapeHtml(row.total) + '</strong></div>').join('') + '</div>'
          : emptyHtml('activity', 'Sem eventos ainda', 'Nenhuma interação com a Mentora foi registrada até o momento.');
      }
      if (latestBox) {
        latestBox.innerHTML = latest.length
          ? '<div class="a-stack" style="gap:.4rem">' + latest.map((row) => '<div class="a-info-row"><span>' + escapeHtml(row.event_type || 'evento') + '</span><strong>' + escapeHtml(formatDateTime(row.created_at)) + '</strong></div>').join('') + '</div>'
          : emptyHtml('clock', 'Nada registrado ainda', 'Os eventos recentes aparecerão aqui.');
      }
      if (overviewBox) {
        overviewBox.innerHTML = summary.length
          ? '<div class="a-stack" style="gap:.4rem">' + summary.slice(0, 5).map((row) => '<div class="a-info-row"><span>' + escapeHtml(row.event_type || 'evento') + '</span><strong>' + escapeHtml(row.total) + '</strong></div>').join('') + '</div>'
          : '<p class="a-stat__label">Nenhum evento registrado ainda.</p>';
      }
    } catch (error) {
      const html = errorHtml('Erro ao carregar dados da Mentora: ' + error.message);
      if (summaryBox) summaryBox.innerHTML = html;
      if (latestBox) latestBox.innerHTML = '';
      if (overviewBox) overviewBox.innerHTML = html;
    }
  }

  let usersCache = [];
  function renderUsers() {
    const container = $('#usersContainer');
    const countEl = $('#usersCount');
    const term = ($('#usersSearch').value || '').trim().toLowerCase();
    const list = term
      ? usersCache.filter((u) => String(u.name || '').toLowerCase().includes(term) || String(u.email || '').toLowerCase().includes(term))
      : usersCache;
    if (countEl) countEl.textContent = term
      ? list.length + ' de ' + usersCache.length + ' usuário(s)'
      : usersCache.length + ' usuário(s) cadastrado(s)';
    if (!list.length) {
      container.innerHTML = usersCache.length
        ? emptyHtml('search', 'Nenhum resultado', 'Nenhum usuário corresponde ao filtro informado.')
        : emptyHtml('users', 'Nenhum usuário cadastrado', 'Assim que houver contas, elas aparecerão aqui.');
      return;
    }
    let html = '<div class="a-table-wrap"><table class="a-table"><thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Criado em</th><th>Atualizado em</th></tr></thead><tbody>';
    list.forEach((user) => {
      const isAdmin = user.role === 'admin';
      html += '<tr>' +
        '<td>' + escapeHtml(user.name || '-') + '</td>' +
        '<td>' + escapeHtml(user.email || '-') + '</td>' +
        '<td><span class="a-badge ' + (isAdmin ? 'a-badge--admin' : 'a-badge--user') + '">' + (isAdmin ? 'ADMIN' : 'USUÁRIO') + '</span></td>' +
        '<td>' + escapeHtml(formatDateTime(user.created_at || user.createdAt)) + '</td>' +
        '<td>' + escapeHtml(formatDateTime(user.updated_at || user.updatedAt)) + '</td>' +
        '</tr>';
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
  }
  async function loadUsers() {
    const container = $('#usersContainer');
    container.innerHTML = loadingHtml('Carregando usuários...');
    try {
      const data = await auth.request('/api/admin/users');
      usersCache = Array.isArray(data.users) ? data.users : [];
      renderUsers();
    } catch (error) {
      container.innerHTML = errorHtml('Erro ao carregar usuários: ' + error.message);
      const countEl = $('#usersCount');
      if (countEl) countEl.textContent = '';
    }
  }

  async function loadHealth() {
    const statusBox = $('#healthStatus');
    const infoBox = $('#systemInfo');
    const overviewBox = $('#overviewSystem');
    if (statusBox) statusBox.innerHTML = loadingHtml('Verificando...');
    if (infoBox) infoBox.innerHTML = '';
    if (overviewBox) overviewBox.innerHTML = loadingHtml('Verificando...');
    try {
      const data = await auth.request('/api/admin/health');
      const ok = !!(data && data.ok);
      if (statusBox) {
        statusBox.innerHTML = '<div class="a-info-row"><span>Status</span><strong><span class="a-badge ' + (ok ? 'a-badge--ok' : 'a-badge--warn') + '">' + (ok ? 'ONLINE' : 'INDISPONÍVEL') + '</span></strong></div>' +
          '<div class="a-info-row"><span>Endpoint</span><strong>/api/admin/health</strong></div>';
      }
      if (infoBox) {
        infoBox.innerHTML = '<div class="a-info-row"><span>Administrador autenticado</span><strong>' + escapeHtml(data.admin || '-') + '</strong></div>' +
          '<div class="a-info-row"><span>Verificado em</span><strong>' + escapeHtml(formatDateTime(new Date().toISOString())) + '</strong></div>' +
          '<div class="a-info-row"><span>Resposta da API</span><strong>' + (ok ? 'ok: true' : 'ok: false') + '</strong></div>';
      }
      if (overviewBox) {
        overviewBox.innerHTML = '<div class="a-info-row"><span>API</span><strong><span class="a-badge ' + (ok ? 'a-badge--ok' : 'a-badge--warn') + '">' + (ok ? 'ONLINE' : 'INDISPONÍVEL') + '</span></strong></div>' +
          '<div class="a-info-row"><span>Admin</span><strong>' + escapeHtml(data.admin || '-') + '</strong></div>';
      }
    } catch (error) {
      const html = errorHtml('Erro ao verificar o sistema: ' + error.message);
      if (statusBox) statusBox.innerHTML = html;
      if (infoBox) infoBox.innerHTML = '';
      if (overviewBox) overviewBox.innerHTML = html;
    }
  }

  async function loadLogs() {
    const container = $('#logsContainer');
    container.innerHTML = loadingHtml('Carregando logs...');
    try {
      const data = await auth.request('/api/admin/logs');
      const logs = Array.isArray(data.logs) ? data.logs : [];
      if (!logs.length) {
        container.innerHTML = emptyHtml('list', 'Não há registros ainda.', 'Ações administrativas aparecerão aqui quando ocorrerem.');
        return;
      }
      let html = '<div class="a-table-wrap"><table class="a-table"><thead><tr><th>Ação</th><th>Recurso</th><th>Detalhes</th><th>Data</th></tr></thead><tbody>';
      logs.forEach((log) => {
        let details = '-';
        try {
          const parsed = typeof log.details === 'string' ? JSON.parse(log.details) : log.details;
          if (parsed && Object.keys(parsed).length) details = JSON.stringify(parsed);
        } catch (e) { details = String(log.details || '-'); }
        html += '<tr>' +
          '<td>' + escapeHtml(log.action || '-') + '</td>' +
          '<td>' + escapeHtml(log.resource || '-') + '</td>' +
          '<td>' + escapeHtml(details) + '</td>' +
          '<td>' + escapeHtml(formatDateTime(log.created_at)) + '</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      container.innerHTML = html;
    } catch (error) {
      container.innerHTML = errorHtml('Erro ao carregar logs: ' + error.message);
    }
  }

  async function loadBNCC() {
    const container = $('#bnccContainer');
    container.innerHTML = loadingHtml('Carregando BNCC...');
    try {
      const data = await auth.request('/api/admin/bncc');
      const items = Array.isArray(data.items) ? data.items : [];
      if (!items.length) {
        container.innerHTML = emptyHtml('layers', 'Nenhum item BNCC cadastrado', 'Cadastre um conteúdo para que ele fique disponível na plataforma.');
        return;
      }
      let html = '<div class="a-table-wrap"><table class="a-table"><thead><tr><th>Disciplina</th><th>Área</th><th>Habilidade</th><th>Código</th><th>Status</th></tr></thead><tbody>';
      items.slice(0, 50).forEach((item) => {
        html += '<tr>' +
          '<td>' + escapeHtml(item.disciplina || '-') + '</td>' +
          '<td>' + escapeHtml(item.area || '-') + '</td>' +
          '<td>' + escapeHtml(item.habilidade || '-') + '</td>' +
          '<td>' + escapeHtml(item.codigo_habilidade || '-') + '</td>' +
          '<td><span class="a-badge ' + (item.status === 'active' ? 'a-badge--ok' : 'a-badge--user') + '">' + escapeHtml(item.status || 'active') + '</span></td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
      html += items.length > 50 ? '<p class="a-stat__label" style="margin-top:.7rem">Mostrando 50 de ' + items.length + ' itens.</p>' : '';
      container.innerHTML = html;
    } catch (error) {
      container.innerHTML = errorHtml('Erro ao carregar BNCC: ' + error.message);
    }
  }

  async function createBNCC(event) {
    event.preventDefault();
    const errorBox = $('#bnccError');
    errorBox.hidden = true;
    const payload = {
      disciplina: $('#bnccDisciplina').value.trim(),
      area: $('#bnccArea').value.trim(),
      etapa: $('#bnccEtapa').value.trim(),
      serie: $('#bnccSerie').value.trim(),
      codigoHabilidade: $('#bnccCodigo').value.trim(),
      habilidade: $('#bnccHabilidade').value.trim()
    };
    if (!payload.disciplina || !payload.area) {
      errorBox.textContent = 'Disciplina e área são obrigatórias.';
      errorBox.hidden = false;
      return;
    }
    try {
      await auth.request('/api/admin/bncc', { method: 'POST', body: JSON.stringify(payload) });
      $('#bnccForm').reset();
      $('#bnccFormCard').hidden = true;
      toast('Item BNCC cadastrado.');
      loadBNCC();
    } catch (error) {
      errorBox.textContent = error.message;
      errorBox.hidden = false;
    }
  }

  // ---------- Eventos ----------
  function wireEvents() {
    $$('.admin-nav-link').forEach((link) => {
      link.addEventListener('click', () => navigate(link.getAttribute('data-section')));
    });

    $('#sidebarToggle').addEventListener('click', () => {
      const collapsed = !$('#adminShell').classList.contains('is-collapsed');
      applySidebar(collapsed, true);
    });
    $('#menuToggle').addEventListener('click', () => setMobileSidebar(!$('#adminSidebar').classList.contains('is-open')));
    $('#sidebarBackdrop').addEventListener('click', () => setMobileSidebar(false));
    window.addEventListener('resize', () => { if (!isMobile()) setMobileSidebar(false); });

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

    $('#logoutButton').addEventListener('click', async () => {
      const confirmed = await confirmModal({ title: 'Sair da conta', message: 'Deseja encerrar a sessão administrativa?', confirmLabel: 'Sair', danger: true });
      if (!confirmed) return;
      try { await auth.logout(); } catch (e) { /* segue para o login de qualquer forma */ }
      sessionStorage.clear();
      window.location.href = 'login.html';
    });

    $('#usersSearch').addEventListener('input', renderUsers);
    $('#logsRefresh').addEventListener('click', loadLogs);
    $('#healthRefresh').addEventListener('click', loadHealth);

    $('#bnccToggleForm').addEventListener('click', () => {
      const card = $('#bnccFormCard');
      card.hidden = !card.hidden;
      if (!card.hidden) $('#bnccDisciplina').focus();
    });
    $('#bnccCancel').addEventListener('click', () => {
      $('#bnccFormCard').hidden = true;
      $('#bnccError').hidden = true;
    });
    $('#bnccForm').addEventListener('submit', createBNCC);
  }

  // ---------- Boot ----------
  async function ensureAdmin() {
    let user = null;
    try {
      user = await auth.hydrateFromServer();
    } catch (error) {
      user = null;
    }
    if (!user || user.role !== 'admin') {
      window.location.href = 'login.html';
      return null;
    }
    const name = user.name || 'Administrador';
    $('#accountAvatar').textContent = initials(name);
    $('#accountName').textContent = name.split(' ')[0];
    $('#accountMenuName').textContent = name;
    $('#accountMenuEmail').textContent = user.email || '-';
    navigate('overview');
    return user;
  }

  async function boot() {
    if (window.SynaraIcons) window.SynaraIcons.hydrate(document);
    wireModal();
    initSidebar();
    wireEvents();
    await ensureAdmin();
  }

  boot();
})();




