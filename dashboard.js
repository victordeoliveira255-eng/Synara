const currentUser = auth.getCurrentUser();

async function ensureAuthenticated() {
  const user = currentUser || await auth.hydrateFromServer();
  if (!user) {
    window.location.href = 'login.html';
    return false;
  }
  return user;
}

ensureAuthenticated().then((user) => {
  if (!user) return;
  const state = { user, selectedSubject: user.subjects[0]?.name || 'Geral', mode: 'explain', topic: '', difficulty: 'médio', sessionStartedAt: Date.now(), challenge: null };
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const today = new Date().toISOString().slice(0, 10);

  function refreshUser() {
    state.user = auth.getCurrentUser();
    return state.user;
  }

  function showStatus(message) {
    const status = $('#statusMessage');
    status.textContent = message;
    status.classList.add('visible');
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => status.classList.remove('visible'), 2600);
  }

  function formatMinutes(minutes) {
    const value = Math.round(Number(minutes) || 0);
    return value >= 60 ? `${Math.floor(value / 60)}h ${value % 60}min` : `${value}min`;
  }

  function initials(name) {
    return (name || 'Aluno').trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function renderUser() {
    const user = state.user;
    const name = user.name || 'Aluno';
    const shortName = name.split(' ')[0];
    ['#greetingName', '#headerName', '#sidebarName', '#settingsName'].forEach((selector) => { const element = $(selector); if (element) element.textContent = selector === '#greetingName' ? shortName : name; });
    ['#headerAvatar', '#sidebarAvatar'].forEach((selector) => { const element = $(selector); if (element) element.textContent = initials(name); });
    $('#profileEmail').textContent = user.email;
    $('#settingsEmail').textContent = user.email;
    if ($('#mentorGreetingName')) $('#mentorGreetingName').textContent = shortName;
  }

  function totalProgress() {
    const subjects = state.user.subjects;
    return subjects.length ? Math.round(subjects.reduce((sum, subject) => sum + Number(subject.progress || 0), 0) / subjects.length) : 0;
  }

  function renderStats() {
    const goals = state.user.goals;
    const completed = goals.filter((goal) => goal.completed).length;
    const sessions = state.user.studySessions;
    const streakDates = new Set(sessions.map((session) => session.completedAt.slice(0, 10)));
    let streak = 0;
    const cursor = new Date();
    while (streakDates.has(cursor.toISOString().slice(0, 10))) { streak += 1; cursor.setDate(cursor.getDate() - 1); }
    const stats = [
      ['Tempo estudado', formatMinutes(auth.getStudyMinutes()), '▣'],
      ['Metas', `${completed} / ${goals.length}`, '◎'],
      ['Constância', `${streak} ${streak === 1 ? 'dia' : 'dias'}`, '↗'],
      ['Progresso', `${totalProgress()}%`, '◔']
    ];
    $('#statGrid').innerHTML = stats.map(([label, value, icon]) => `<article class="stat-card"><span>${icon} ${label}</span><strong>${value}</strong></article>`).join('');
  }

  function subjectOptions(selected = '') {
    return state.user.subjects.length ? state.user.subjects.map((subject) => `<option value="${subject.id}" ${String(subject.id) === String(selected) ? 'selected' : ''}>${escapeHtml(subject.name)}</option>`).join('') : '<option value="">Adicione uma matéria primeiro</option>';
  }

  function renderContinue() {
    const latest = [...state.user.studySessions].sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];
    const subject = latest && state.user.subjects.find((item) => item.id === latest.subjectId);
    if (!subject) { $('#continuePanel').innerHTML = `<span class="eyebrow">Continue de onde parou</span><h2>Nenhum estudo registrado ainda</h2><p>Adicione uma matéria e registre sua primeira sessão para acompanhar seu avanço.</p><button class="button-primary" data-section="materias">Adicionar matéria</button>`; return; }
    $('#continuePanel').innerHTML = `<span class="eyebrow">Continue de onde parou</span><h2>${escapeHtml(subject.name)}</h2><p>${escapeHtml(latest.topic)} · última sessão ${new Date(latest.completedAt).toLocaleDateString('pt-BR')}</p><div class="progress-track"><div class="progress-fill" style="width:${subject.progress}%"></div></div><div class="progress-meta"><span>${subject.progress}% concluído</span><span>${formatMinutes(latest.minutes)} registrados</span></div><button class="button-primary" data-section="mentora">Continuar estudando</button>`;
  }

  function renderToday() {
    const items = state.user.schedule.filter((item) => item.date === today).sort((a, b) => a.time.localeCompare(b.time));
    $('#todaySchedule').innerHTML = items.length ? items.slice(0, 3).map((item) => { const subject = state.user.subjects.find((entry) => String(entry.id) === String(item.subjectId)); return `<div class="mini-item"><span><strong>${item.time} · ${escapeHtml(subject?.name || 'Matéria')}</strong><br><span class="muted">${escapeHtml(item.topic)} · ${item.duration} min</span></span><span class="muted">${item.completed ? 'Concluído' : item.priority}</span></div>`; }).join('') : '<div class="empty-state">Nenhum estudo planejado para hoje.</div>';
  }

  function renderHome() {
    const goals = state.user.goals.slice(0, 3);
    $('#homeGoals').innerHTML = `<div class="panel-heading"><h2>Metas de hoje</h2><button class="text-button" data-section="metas">Gerenciar</button></div>${goals.length ? goals.map((goal) => `<div class="mini-item"><span>${goal.completed ? '✓' : '○'} ${escapeHtml(goal.text)}</span></div>`).join('') : '<div class="empty-state">Você ainda não criou uma meta.</div>'}`;
    const mood = state.user.wellbeing.mood;
    $('#homeWellbeing').innerHTML = `<div class="panel-heading"><h2>Seu ritmo</h2><button class="text-button" data-section="bem-estar">Acompanhar</button></div><p class="muted">${mood ? `Hoje você marcou seu ritmo como <strong>${mood}</strong>.` : 'Como você está se sentindo para estudar hoje?'}</p><button class="button-primary" data-section="bem-estar">${mood ? 'Atualizar ritmo' : 'Responder agora'}</button>`;
  }

  function renderSubjects() {
    const grid = $('#subjectsGrid');
    grid.innerHTML = state.user.subjects.length ? state.user.subjects.map((subject) => `<article class="subject-card"><header><strong>${escapeHtml(subject.name)}</strong><span class="muted">${subject.progress}%</span></header><span class="muted">${subject.targetHours ? `${subject.completedHours.toFixed(1)} / ${subject.targetHours} horas` : 'Defina uma meta de horas'}</span><div class="progress-track"><div class="progress-fill" style="width:${subject.progress}%"></div></div><div class="subject-actions"><button type="button" data-start-subject="${subject.id}">Estudar</button><button type="button" data-edit-subject="${subject.id}">Editar</button><button type="button" data-remove-subject="${subject.id}">Excluir</button></div></article>`).join('') : '<div class="empty-state">📚 Você ainda não adicionou nenhuma matéria.<br><button class="button-primary" data-open-subject="true">Adicionar primeira matéria</button></div>';
  }

  function renderGoals() {
    const goals = state.user.goals;
    const done = goals.filter((goal) => goal.completed).length;
    $('#goalSummary').textContent = `${done} de ${goals.length} concluídas`;
    $('#goalsList').innerHTML = goals.length ? goals.map((goal) => `<div class="goal-item"><label><input type="checkbox" data-toggle-goal="${goal.id}" ${goal.completed ? 'checked' : ''}> <span>${escapeHtml(goal.text)}</span></label><span><button class="button-quiet" type="button" data-edit-goal="${goal.id}">Editar</button><button class="button-quiet" type="button" data-remove-goal="${goal.id}">Excluir</button></span></div>`).join('') : '<div class="empty-state">Você ainda não possui metas.</div>';
  }

  function renderSchedule() {
    const list = [...state.user.schedule].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
    $('#scheduleList').innerHTML = list.length ? list.map((item) => { const subject = state.user.subjects.find((entry) => String(entry.id) === String(item.subjectId)); return `<div class="schedule-item ${item.completed ? 'completed' : ''}"><span class="schedule-time">${item.time}<br><small>${new Date(`${item.date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</small></span><span><strong>${escapeHtml(subject?.name || 'Matéria')}</strong><br><span class="muted">${escapeHtml(item.topic)} · ${item.duration} min · <span class="priority-${item.priority}">${item.priority}</span></span></span><span><button class="button-quiet" type="button" data-toggle-schedule="${item.id}">${item.completed ? 'Reabrir' : 'Concluir'}</button><button class="button-quiet" type="button" data-remove-schedule="${item.id}">Excluir</button></span></div>`; }).join('') : '<div class="empty-state">Seu cronograma está vazio.</div>';
  }

  function renderProgress() {
    $('#progressSubjects').innerHTML = state.user.subjects.length ? state.user.subjects.map((subject) => `<div class="progress-row"><header><span>${escapeHtml(subject.name)}</span><strong>${subject.progress}%</strong></header><div class="progress-track"><div class="progress-fill" style="width:${subject.progress}%"></div></div></div>`).join('') : '<div class="empty-state">Adicione matérias para visualizar seu progresso.</div>';
    const days = [...Array(7)].map((_, index) => { const date = new Date(); date.setDate(date.getDate() - (6 - index)); const key = date.toISOString().slice(0, 10); return { label: date.toLocaleDateString('pt-BR', { weekday: 'short' }).slice(0, 3), minutes: state.user.studySessions.filter((session) => session.completedAt.slice(0, 10) === key).reduce((sum, session) => sum + Number(session.minutes), 0) }; });
    const max = Math.max(...days.map((day) => day.minutes), 1);
    $('#weeklyChart').innerHTML = days.map((day) => `<div class="chart-bar" style="height:${Math.max(4, day.minutes / max * 180)}px" title="${day.minutes} minutos"><span>${day.label}</span></div>`).join('');
    const total = auth.getStudyMinutes(); const achievements = [['✓', 'Primeiro estudo', state.user.studySessions.length > 0], ['✓', '5 dias de constância', new Set(state.user.studySessions.map((session) => session.completedAt.slice(0, 10))).size >= 5], ['◷', '10 horas estudadas', total >= 600], ['◎', '10 exercícios concluídos', state.user.exerciseResults?.length >= 10]];
    $('#achievements').innerHTML = achievements.map(([icon, label, unlocked]) => `<div class="achievement ${unlocked ? '' : 'locked'}">${icon} <strong>${label}</strong><br><span class="muted">${unlocked ? 'Conquistada' : 'Ainda não desbloqueada'}</span></div>`).join('');
  }

  function renderMentorContext() {
    $('#mentorSubject').innerHTML = `<option value="Geral">Geral</option>${state.user.subjects.map((subject) => `<option value="${escapeHtml(subject.name)}">${escapeHtml(subject.name)}</option>`).join('')}`;
    $('#mentorSubject').value = state.selectedSubject;
    window.synaraSubject = state.selectedSubject;
    $('#currentContext').textContent = `Contexto: ${state.selectedSubject} · ${totalProgress()}% de progresso geral`;
    $('#mentorContext').innerHTML = `<p class="muted">${state.user.subjects.length} matéria(s) cadastrada(s).</p><p class="muted">${state.user.goals.filter((goal) => !goal.completed).length} meta(s) em aberto.</p><p class="muted">${formatMinutes(auth.getStudyMinutes())} de estudo registrado.</p>`;
    $('#mentorSubjects').innerHTML = state.user.subjects.length ? state.user.subjects.map((subject) => `<button type="button" class="mentor-subject-button ${state.selectedSubject === subject.name ? 'active' : ''}" data-mentor-subject="${escapeHtml(subject.name)}"><span>◈</span>${escapeHtml(subject.name)}</button>`).join('') : '<div class="mentor-subject-empty">Ainda não há matérias. Adicione a primeira para personalizar a mentora.</div>';
    const progress = totalProgress();
    $('#mentorProgressValue').textContent = `${progress}%`;
    $('#mentorProgressBar').style.width = `${progress}%`;
    $('#mentorProgressHint').textContent = state.user.subjects.length ? `${state.user.subjects.length} matéria(s) acompanhada(s)` : 'Adicione matérias para começar';
    const completedGoals = state.user.goals.filter((goal) => goal.completed).length;
    $('#mentorProgress').innerHTML = `<div class="progress-fact"><span>Metas concluídas</span><strong>${completedGoals}/${state.user.goals.length}</strong></div><div class="progress-fact"><span>Tempo estudado</span><strong>${formatMinutes(auth.getStudyMinutes())}</strong></div><div class="progress-fact"><span>Sessões registradas</span><strong>${state.user.studySessions.length}</strong></div>`;
    const nextGoal = state.user.goals.find((goal) => !goal.completed);
    $('#mentorNextGoal').textContent = nextGoal ? nextGoal.text : (state.user.goals.length ? 'Todas as metas concluídas' : 'Crie sua primeira meta');
    renderMentorTools();
  }

  function renderMentorTools() {
    const panel = $('.mentor-panel');
    let tools = $('.mentor-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'mentor-tools';
      panel.querySelector('.context-row').after(tools);
    }
    const stats = state.selectedSubject !== 'Geral' && state.topic ? auth.getContentStats(state.selectedSubject, state.topic) : null;
    tools.innerHTML = `<div class="mentor-tool-grid"><label>Modo de estudo<select id="mentorMode"><option value="explain">📚 Explicar</option><option value="understand">🧩 Me ajude a entender</option><option value="summary">📝 Resumir</option><option value="practice">❓ Praticar</option><option value="review">🔄 Revisar</option><option value="tip">💡 Dica</option><option value="exam">🎯 Preparar para prova</option></select></label><label>Conteúdo atual<input id="mentorTopic" value="${escapeHtml(state.topic)}" placeholder="Ex.: Função quadrática"></label><label>Nível<select id="mentorDifficulty"><option value="iniciante">Iniciante</option><option value="médio">Intermediário</option><option value="avançado">Avançado</option></select></label></div><div class="mentor-context-actions"><button type="button" class="button-primary" data-recommend-study>✨ O que estudar agora?</button><button type="button" class="button-quiet" data-start-challenge>⚡ Desafio Synara</button><button type="button" class="button-quiet" data-finish-session>📊 Finalizar sessão</button>${stats ? `<span class="content-mastery">Domínio: ${stats.mastery}% · ${stats.correct}/${stats.attempts} acertos${stats.errors?.length ? ' · revise seus erros' : ''}</span>` : ''}</div>`;
    $('#mentorMode').value = state.mode; $('#mentorDifficulty').value = state.difficulty;
  }

  function renderWellbeing() {
    const mood = state.user.wellbeing.mood;
    $$('[data-mood]').forEach((button) => button.classList.toggle('selected', button.dataset.mood === mood));
    const suggestions = { tranquilo: 'Aproveite o ritmo: experimente um bloco de 40 minutos e uma revisão curta.', normal: 'Um bloco de 25 minutos com 5 minutos de pausa pode manter seu foco.', sobrecarregado: 'Que tal começar com 15 minutos e uma tarefa pequena? Pausas e água também contam.' };
    $('#wellbeingSuggestion').textContent = suggestions[mood] || 'Escolha uma opção para receber uma sugestão simples de organização.';
  }

  function renderPrivacy() {
    if (!state.user) return;
    const createdAt = state.user.createdAt ? new Date(state.user.createdAt).toLocaleDateString('pt-BR') : '-';
    $('#privacyName').textContent = state.user.name || '-';
    $('#privacyEmail').textContent = state.user.email || '-';
    $('#privacyCreatedAt').textContent = createdAt;
  }

  function renderQuestion(data) {
    const challengeLabel = state.challenge ? `Questão ${state.challenge.index + 1}/${state.challenge.questions.length}` : 'Questão';
    $('#exerciseResult').innerHTML = `<strong>${challengeLabel}</strong><p>${escapeHtml(data.question)}</p><div class="question-options">${data.options.map((option, index) => `<button type="button" data-answer-option="${index}">${String.fromCharCode(65 + index)}) ${escapeHtml(option)}</button>`).join('')}</div><div id="questionFeedback" class="muted"></div>`;
    $('#exerciseResult').dataset.correctOption = data.correctOption;
    $('#exerciseResult').dataset.explanation = data.explanation;
  }

  function renderAll() {
    refreshUser(); renderUser(); renderStats(); renderContinue(); renderToday(); renderHome(); renderSubjects(); renderGoals(); renderSchedule(); renderProgress(); renderMentorContext(); renderWellbeing(); renderPrivacy();
    window.synaraStudyContext = { mode: state.mode, topic: state.topic, difficulty: state.difficulty, subject: state.selectedSubject, progress: totalProgress(), contentStats: state.selectedSubject !== 'Geral' && state.topic ? auth.getContentStats(state.selectedSubject, state.topic) : null, recentSchedule: state.user.schedule.slice(-5), goals: state.user.goals.map((goal) => ({ text: goal.text, completed: goal.completed })) };
    $('#scheduleSubject').innerHTML = subjectOptions(); $('#goalSubject').innerHTML = `<option value="">Geral</option>${subjectOptions()}`;
  }

  function navigate(section) { $$('[data-view]').forEach((view) => view.classList.toggle('active', view.dataset.view === section)); $$('.sidebar-link').forEach((link) => link.classList.toggle('active', link.dataset.section === section)); $('#sidebar').classList.remove('open'); $('#menuToggle').setAttribute('aria-expanded', 'false'); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  function logout() { auth.logout(); window.location.href = 'login.html'; }

  document.addEventListener('click', async (event) => {
    const answer = event.target.closest('[data-answer-option]');
    if (answer) {
      const result = $('#exerciseResult');
      const correct = Number(result.dataset.correctOption);
      const selected = Number(answer.dataset.answerOption);
      const feedback = $('#questionFeedback');
      $$('.question-options button').forEach((button) => { button.disabled = true; });
      feedback.textContent = selected === correct ? `✓ Correto! ${result.dataset.explanation}` : `✕ Vamos revisar. A alternativa correta é ${String.fromCharCode(65 + correct)}. ${result.dataset.explanation}`;
      auth.recordExercise({ subject: state.selectedSubject, topic: state.topic || state.selectedSubject, correct: selected === correct, answer: answer.textContent });
      renderProgress();
      showStatus(selected === correct ? 'Resposta correta registrada.' : 'Resposta registrada para revisão.');
      if (state.challenge) {
        state.challenge.correct += selected === correct ? 1 : 0;
        if (state.challenge.index + 1 < state.challenge.questions.length) {
          window.setTimeout(() => { state.challenge.index += 1; renderQuestion(state.challenge.questions[state.challenge.index]); }, 500);
        } else {
          const score = state.challenge.correct;
          $('#exerciseResult').innerHTML = `<strong>🎉 Desafio concluído!</strong><p>${score}/${state.challenge.questions.length} acertos. ${score >= 4 ? 'Seu desempenho foi excelente.' : 'Revise os erros e tente novamente.'}</p>`;
          state.challenge = null;
        }
      }
      return;
    }
    const sectionButton = event.target.closest('[data-section]'); if (sectionButton) navigate(sectionButton.dataset.section);
    const mentorSubject = event.target.closest('[data-mentor-subject]'); if (mentorSubject) { state.selectedSubject = mentorSubject.dataset.mentorSubject; window.synaraSubject = state.selectedSubject; renderMentorContext(); showStatus(`Contexto alterado para ${state.selectedSubject}.`); return; }
    const recommend = event.target.closest('[data-recommend-study]'); if (recommend) { const subject = state.selectedSubject === 'Geral' ? state.user.subjects[0]?.name : state.selectedSubject; const nextTopic = state.topic || 'o próximo conteúdo pendente'; $('#chatInput').value = `Recomende o que devo estudar agora em ${subject || 'minhas matérias'}, considerando meu progresso e dificuldades em ${nextTopic}.`; $('#chatForm').requestSubmit(); }
    const challenge = event.target.closest('[data-start-challenge]'); if (challenge) { const subject = state.selectedSubject === 'Geral' ? state.user.subjects[0]?.name : state.selectedSubject; if (!subject) { showStatus('Adicione uma matéria para iniciar um desafio.'); return; } state.mode = 'practice'; state.topic = state.topic || 'revisão geral'; $('#exerciseResult').classList.remove('hidden'); $('#exerciseResult').textContent = 'Preparando desafio...'; try { const questions = await Promise.all([...Array(5)].map(() => fetch('/api/generate-exercise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userEmail: state.user.email, subject, topic: state.topic, difficulty: state.difficulty }) }).then((response) => response.json()))); state.challenge = { questions: questions.filter((item) => item.question && item.options), index: 0, correct: 0 }; if (state.challenge.questions.length) renderQuestion(state.challenge.questions[0]); else $('#exerciseResult').textContent = 'Não foi possível preparar o desafio agora.'; } catch (error) { $('#exerciseResult').textContent = 'Não foi possível preparar o desafio agora.'; } }
    const finishSession = event.target.closest('[data-finish-session]'); if (finishSession) { const minutes = Math.max(1, Math.round((Date.now() - state.sessionStartedAt) / 60000)); const subject = state.user.subjects.find((item) => item.name === state.selectedSubject); if (subject) auth.addStudySession(subject.id, minutes, state.topic || 'Estudo com a Mentora'); const results = state.user.exerciseResults.filter((item) => new Date(item.createdAt) >= new Date(state.sessionStartedAt)); const correct = results.filter((item) => item.correct).length; const errors = results.filter((item) => !item.correct).map((item) => item.topic).filter(Boolean); $('#exerciseResult').classList.remove('hidden'); $('#exerciseResult').innerHTML = `<strong>Resumo da sessão</strong><p>Você estudou: <b>${minutes} minutos</b><br>Questões: <b>${results.length}</b><br>Acertos: <b>${correct}</b><br>Desempenho: <b>${results.length ? Math.round(correct / results.length * 100) : 0}%</b></p><p><b>Próximo passo recomendado:</b> ${errors.length ? `revisar ${escapeHtml([...new Set(errors)].join(', '))} e praticar novamente.` : 'fazer uma questão de aplicação e revisar os pontos principais.'}</p>`; state.sessionStartedAt = Date.now(); renderAll(); showStatus('Sessão registrada no progresso.'); }
    const openForm = event.target.closest('#openSubjectForm, [data-open-subject]'); if (openForm) { $('#subjectForm').classList.remove('hidden'); $('#subjectName').focus(); }
    if (event.target.closest('#cancelSubject')) { $('#subjectForm').classList.add('hidden'); $('#subjectForm').reset(); }
    const removeSubject = event.target.closest('[data-remove-subject]'); if (removeSubject && confirm('Excluir esta matéria e seus estudos planejados?')) { auth.removeSubject(Number(removeSubject.dataset.removeSubject)); renderAll(); showStatus('Matéria excluída.'); }
    const editSubject = event.target.closest('[data-edit-subject]'); if (editSubject) { const subject = state.user.subjects.find((item) => item.id === Number(editSubject.dataset.editSubject)); $('#subjectId').value = subject.id; $('#subjectName').value = subject.name; $('#subjectTarget').value = subject.targetHours; $('#subjectForm').classList.remove('hidden'); $('#subjectName').focus(); }
    const studySubject = event.target.closest('[data-start-subject]'); if (studySubject) { state.selectedSubject = state.user.subjects.find((item) => item.id === Number(studySubject.dataset.startSubject))?.name || 'Geral'; navigate('mentora'); }
    const removeGoal = event.target.closest('[data-remove-goal]'); if (removeGoal) { auth.removeGoal(Number(removeGoal.dataset.removeGoal)); renderAll(); showStatus('Meta excluída.'); }
    const toggleGoal = event.target.closest('[data-toggle-goal]'); if (toggleGoal) { auth.completeGoal(Number(toggleGoal.dataset.toggleGoal)); renderAll(); showStatus('Meta atualizada.'); }
    const editGoal = event.target.closest('[data-edit-goal]'); if (editGoal) { const goal = state.user.goals.find((item) => item.id === Number(editGoal.dataset.editGoal)); const text = window.prompt('Atualize sua meta:', goal?.text || ''); if (text?.trim()) { auth.editGoal(goal.id, text, goal.subject); renderAll(); showStatus('Meta atualizada.'); } }
    const removeSchedule = event.target.closest('[data-remove-schedule]'); if (removeSchedule) { auth.removeScheduleItem(Number(removeSchedule.dataset.removeSchedule)); renderAll(); showStatus('Item removido do cronograma.'); }
    const toggleSchedule = event.target.closest('[data-toggle-schedule]'); if (toggleSchedule) { const item = state.user.schedule.find((entry) => entry.id === Number(toggleSchedule.dataset.toggleSchedule)); auth.toggleScheduleItem(Number(toggleSchedule.dataset.toggleSchedule)); if (item && !item.completed) auth.addStudySession(item.subjectId, item.duration, item.topic); renderAll(); showStatus('Sessão registrada no progresso.'); }
    const quickAction = event.target.closest('.quick-action'); if (quickAction && quickAction.dataset.action === 'question') { event.preventDefault(); const subject = state.selectedSubject === 'Geral' ? state.user.subjects[0]?.name : state.selectedSubject; const topic = state.topic || subject; if (!subject) { showStatus('Adicione uma matéria para gerar uma questão.'); return; } $('#exerciseResult').classList.remove('hidden'); $('#exerciseResult').textContent = 'Gerando questão...'; try { const response = await fetch('/api/generate-exercise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userEmail: state.user.email, subject, topic, difficulty: state.difficulty }) }); const data = await response.json(); if (data.question && data.options) renderQuestion(data); else $('#exerciseResult').textContent = data.exercise || data.error || 'Não foi possível gerar a questão.'; } catch (error) { $('#exerciseResult').textContent = 'Não conseguimos gerar a questão agora.'; } }
    if (quickAction && quickAction.dataset.action !== 'question') {
      const prompts = { explain: 'Explique o conteúdo atual para mim.', summary: 'Crie um resumo organizado do conteúdo atual.', tips: 'Dê dicas de estudo para o conteúdo atual.', review: 'Faça uma revisão rápida do conteúdo atual.' };
      $('#chatInput').value = prompts[quickAction.dataset.action] || '';
      if ($('#chatInput').value) $('#chatForm').requestSubmit();
    }
    if (event.target.closest('#headerLogout, #settingsLogout')) logout();
  });

  $('#subjectForm').addEventListener('submit', (event) => { event.preventDefault(); const id = Number($('#subjectId').value); const name = $('#subjectName').value.trim(); const target = Number($('#subjectTarget').value) || 0; if (id) auth.editSubject(id, name, target); else auth.addSubject(name, target); $('#subjectForm').reset(); $('#subjectForm').classList.add('hidden'); renderAll(); showStatus(id ? 'Matéria atualizada.' : 'Matéria adicionada.'); });
  $('#goalForm').addEventListener('submit', (event) => { event.preventDefault(); auth.addGoal($('#goalText').value.trim(), $('#goalSubject').selectedOptions[0]?.textContent === 'Geral' ? '' : $('#goalSubject').selectedOptions[0]?.textContent); event.target.reset(); renderAll(); showStatus('Meta criada.'); });
  $('#scheduleForm').addEventListener('submit', (event) => { event.preventDefault(); auth.addScheduleItem({ subjectId: Number($('#scheduleSubject').value), topic: $('#scheduleTopic').value.trim(), date: $('#scheduleDate').value, time: $('#scheduleTime').value, duration: Number($('#scheduleDuration').value), priority: $('#schedulePriority').value }); event.target.reset(); $('#scheduleDate').value = today; renderAll(); showStatus('Estudo adicionado ao cronograma.'); });
  $('#mentorSubject').addEventListener('change', (event) => { state.selectedSubject = event.target.value; window.synaraSubject = state.selectedSubject; renderMentorContext(); });
  const mentorInput = $('#chatInput');
  const resizeMentorInput = () => { mentorInput.style.height = 'auto'; mentorInput.style.height = `${Math.min(mentorInput.scrollHeight, 130)}px`; };
  mentorInput.addEventListener('input', resizeMentorInput);
  mentorInput.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('#chatForm').requestSubmit(); } });
  $('#chatPlus').addEventListener('click', () => { const menu = $('#attachmentMenu'); menu.hidden = !menu.hidden; $('#chatPlus').setAttribute('aria-expanded', String(!menu.hidden)); });
  document.addEventListener('click', (event) => { if (!event.target.closest('.chat-input-wrap')) { $('#attachmentMenu').hidden = true; $('#chatPlus').setAttribute('aria-expanded', 'false'); } });
  document.querySelector('[data-attachment="text"]')?.addEventListener('click', () => { $('#mentorTopic').focus(); $('#attachmentMenu').hidden = true; });
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  $('#chatMic').addEventListener('click', () => { if (!SpeechRecognition) { showStatus('Entrada por voz não é compatível com este navegador.'); return; } const recognition = new SpeechRecognition(); recognition.lang = 'pt-BR'; recognition.interimResults = false; $('#chatMic').classList.add('listening'); recognition.onresult = (event) => { mentorInput.value = `${mentorInput.value} ${event.results[0][0].transcript}`.trim(); resizeMentorInput(); }; recognition.onerror = () => showStatus('Não foi possível usar a entrada por voz.'); recognition.onend = () => $('#chatMic').classList.remove('listening'); recognition.start(); });
  document.addEventListener('change', (event) => { if (event.target.id === 'mentorMode') state.mode = event.target.value; if (event.target.id === 'mentorTopic') state.topic = event.target.value.trim(); if (event.target.id === 'mentorDifficulty') state.difficulty = event.target.value; window.synaraStudyContext = { ...window.synaraStudyContext, mode: state.mode, topic: state.topic, difficulty: state.difficulty, subject: state.selectedSubject }; });
  $$('[data-mood]').forEach((button) => button.addEventListener('click', () => { auth.setWellbeing(button.dataset.mood); renderAll(); showStatus('Seu ritmo foi atualizado.'); }));
  $('#profileTrigger').addEventListener('click', () => { const menu = $('#profileMenu'); menu.hidden = !menu.hidden; $('#profileTrigger').setAttribute('aria-expanded', String(!menu.hidden)); });
  $('#menuToggle').addEventListener('click', () => { const open = $('#sidebar').classList.toggle('open'); $('#menuToggle').setAttribute('aria-expanded', String(open)); });
  $('#mobileBackdrop').addEventListener('click', () => $('#menuToggle').click());
  
  // Privacy & Account Deletion
  document.addEventListener('click', (event) => {
    const deleteBtn = event.target.closest('#deleteAccountBtn');
    if (deleteBtn) {
      const confirmed = confirm('Você tem certeza que deseja excluir sua conta? Esta ação é permanente e não pode ser desfeita. Todos os seus dados serão removidos.');
      if (confirmed) {
        const doubleConfirm = prompt('Digite "CONFIRMAR EXCLUSÃO" para confirmar definitivamente:');
        if (doubleConfirm === 'CONFIRMAR EXCLUSÃO') {
          deleteAccount();
        } else {
          showStatus('Exclusão cancelada.');
        }
      }
    }
  });
  
  async function deleteAccount() {
    try {
      showStatus('Excluindo sua conta...');
      const response = await fetch('/api/account', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (response.ok) {
        showStatus('Conta excluída com sucesso. Redirecionando...');
        sessionStorage.clear();
        setTimeout(() => {
          window.location.href = 'login.html';
        }, 1500);
      } else {
        const data = await response.json();
        showStatus(data.message || 'Não foi possível excluir a conta.');
      }
    } catch (error) {
      console.error('Delete account error:', error);
      showStatus('Erro ao excluir a conta. Tente novamente.');
    }
  }
  
  $('#scheduleDate').value = today;
  renderAll();
});
