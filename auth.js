// Sistema simples de autenticação com localStorage

class SynaraAuth {
  constructor() {
    this.storageKey = 'synara_users';
    this.currentUserKey = 'synara_current_user';
  }

  // Obter todos os usuários
  getAllUsers() {
    const data = localStorage.getItem(this.storageKey);
    return data ? JSON.parse(data) : {};
  }

  // Obter usuário atual
  getCurrentUser() {
    const user = localStorage.getItem(this.currentUserKey);
    if (!user) return null;
    return this.normalizeUser(JSON.parse(user));
  }

  normalizeUser(user) {
    return {
      ...user,
      subjects: Array.isArray(user.subjects) ? user.subjects : [],
      goals: Array.isArray(user.goals) ? user.goals : [],
      studySessions: Array.isArray(user.studySessions) ? user.studySessions : [],
      schedule: Array.isArray(user.schedule) ? user.schedule : [],
      exerciseResults: Array.isArray(user.exerciseResults) ? user.exerciseResults : [],
      contentStats: user.contentStats && typeof user.contentStats === 'object' ? user.contentStats : {},
      wellbeing: user.wellbeing || { mood: '', updatedAt: null }
    };
  }

  // Salvar usuário atual
  setCurrentUser(user) {
    localStorage.setItem(this.currentUserKey, JSON.stringify(user));
  }

  // Cadastrar novo usuário
  register(email, password, name) {
    if (!email || !password || !name) {
      return { success: false, message: 'Preencha nome, email e senha' };
    }

    if (password.length < 6) {
      return { success: false, message: 'A senha precisa ter ao menos 6 caracteres' };
    }

    const users = this.getAllUsers();
    
    if (users[email]) {
      return { success: false, message: 'Email já cadastrado' };
    }

    const user = {
      email,
      password, // Em produção, usar hash!
      name,
      createdAt: new Date().toISOString(),
      subjects: [],
      goals: [],
      dailyProgress: [],
      studySessions: [],
      schedule: [],
      exerciseResults: [],
      contentStats: {},
      wellbeing: { mood: '', updatedAt: null }
    };

    users[email] = user;
    localStorage.setItem(this.storageKey, JSON.stringify(users));
    return { success: true, message: 'Cadastro realizado com sucesso' };
  }

  // Fazer login
  login(email, password) {
    if (!email || !password) {
      return { success: false, message: 'Informe email e senha' };
    }

    const users = this.getAllUsers();
    const user = users[email];

    if (!user || user.password !== password) {
      return { success: false, message: 'Email ou senha incorretos' };
    }

    this.setCurrentUser(user);
    return { success: true, user, message: 'Login realizado com sucesso' };
  }

  // Fazer logout
  logout() {
    localStorage.removeItem(this.currentUserKey);
  }

  // Salvar dados do usuário
  saveUser(user) {
    user = this.normalizeUser(user);
    const users = this.getAllUsers();
    users[user.email] = user;
    localStorage.setItem(this.storageKey, JSON.stringify(users));
    this.setCurrentUser(user);
  }

  // Adicionar matéria ao usuário
  addSubject(subjectName, targetHours = 0) {
    const user = this.getCurrentUser();
    if (!user) return false;

    const subject = {
      id: Date.now(),
      name: subjectName,
      targetHours,
      completedHours: 0,
      progress: 0,
      createdAt: new Date().toISOString()
    };

    user.subjects.push(subject);
    this.saveUser(user);

    // Tenta indexar a matéria no RAG store (fire-and-forget)
    try {
      fetch('/api/embeddings/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: user.email,
          content: `Matéria: ${subjectName}`,
          metadata: { type: 'subject', name: subjectName }
        })
      }).catch(err => console.warn('Index subject failed', err));
    } catch (e) {
      console.warn('Index subject error', e);
    }
    return subject;
  }

  // Adicionar meta do dia
  addGoal(goalText, subject = '') {
    const user = this.getCurrentUser();
    if (!user) return false;

    const goal = {
      id: Date.now(),
      text: goalText,
      subject,
      completed: false,
      createdAt: new Date().toISOString()
    };

    user.goals.push(goal);
    this.saveUser(user);

    // Tenta indexar a meta no RAG store (fire-and-forget)
    try {
      fetch('/api/embeddings/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userEmail: user.email,
          content: `Meta: ${goalText}` + (subject ? ` (Matéria: ${subject})` : ''),
          metadata: { type: 'goal', subject }
        })
      }).catch(err => console.warn('Index goal failed', err));
    } catch (e) {
      console.warn('Index goal error', e);
    }
    return goal;
  }

  // Atualizar progresso de matéria
  updateSubjectProgress(subjectId, newHours) {
    const user = this.getCurrentUser();
    if (!user) return false;

    const subject = user.subjects.find(s => s.id === subjectId);
    if (subject) {
      const hours = Math.max(0, Number(newHours) || 0);
      subject.completedHours = hours;
      subject.progress = subject.targetHours > 0
        ? Math.min(100, Math.round((hours / subject.targetHours) * 100))
        : 0;
      this.saveUser(user);
      return true;
    }
    return false;
  }

  // Marcar meta como completa
  completeGoal(goalId) {
    const user = this.getCurrentUser();
    if (!user) return false;

    const goal = user.goals.find(g => g.id === goalId);
    if (goal) {
      goal.completed = !goal.completed;
      this.saveUser(user);
      return true;
    }
    return false;
  }

  // Remover matéria
  removeSubject(subjectId) {
    const user = this.getCurrentUser();
    if (!user) return false;

    user.subjects = user.subjects.filter(s => s.id !== subjectId);
    this.saveUser(user);
    return true;
  }

  // Remover meta
  removeGoal(goalId) {
    const user = this.getCurrentUser();
    if (!user) return false;

    user.goals = user.goals.filter(g => g.id !== goalId);
    this.saveUser(user);
    return true;
  }

  editGoal(goalId, text, subject = '') {
    const user = this.getCurrentUser();
    const goal = user?.goals.find(item => item.id === goalId);
    if (!goal || !text.trim()) return false;
    goal.text = text.trim();
    goal.subject = subject;
    this.saveUser(user);
    return true;
  }

  recordExercise({ subject, topic, correct, answer = '' }) {
    const user = this.getCurrentUser();
    if (!user || !subject || !topic) return false;
    const key = `${subject}::${topic}`;
    const stats = user.contentStats[key] || { subject, topic, attempts: 0, correct: 0, errors: [] };
    stats.attempts += 1;
    if (correct) stats.correct += 1;
    if (!correct) stats.errors = [...(stats.errors || []), { answer, createdAt: new Date().toISOString() }].slice(-10);
    stats.mastery = Math.round((stats.correct / stats.attempts) * 100);
    user.contentStats[key] = stats;
    user.exerciseResults.push({ id: Date.now(), subject, topic, correct, answer, createdAt: new Date().toISOString() });
    this.saveUser(user);
    return stats;
  }

  getContentStats(subject, topic) {
    const user = this.getCurrentUser();
    return user?.contentStats?.[`${subject}::${topic}`] || { subject, topic, attempts: 0, correct: 0, errors: [], mastery: 0 };
  }

  editSubject(subjectId, subjectName, targetHours) {
    const user = this.getCurrentUser();
    const subject = user?.subjects.find(item => item.id === subjectId);
    if (!subject || !subjectName.trim()) return false;
    subject.name = subjectName.trim();
    subject.targetHours = Math.max(0, Number(targetHours) || 0);
    this.updateSubjectProgress(subjectId, subject.completedHours);
    return true;
  }

  addStudySession(subjectId, minutes, topic = '') {
    const user = this.getCurrentUser();
    const subject = user?.subjects.find(item => item.id === subjectId);
    const duration = Math.max(1, Number(minutes) || 0);
    if (!user || !subject) return false;
    const session = {
      id: Date.now(),
      subjectId,
      topic: topic.trim() || 'Sessão de estudo',
      minutes: duration,
      completedAt: new Date().toISOString()
    };
    user.studySessions.push(session);
    const completedHours = Number(subject.completedHours || 0) + duration / 60;
    subject.completedHours = completedHours;
    subject.progress = subject.targetHours > 0
      ? Math.min(100, Math.round((completedHours / subject.targetHours) * 100))
      : 0;
    this.saveUser(user);
    return session;
  }

  addScheduleItem(item) {
    const user = this.getCurrentUser();
    if (!user || !item.subjectId || !item.date || !item.time || !item.duration) return false;
    const scheduleItem = { ...item, id: Date.now(), completed: false };
    user.schedule.push(scheduleItem);
    this.saveUser(user);
    return scheduleItem;
  }

  toggleScheduleItem(itemId) {
    const user = this.getCurrentUser();
    const item = user?.schedule.find(entry => entry.id === itemId);
    if (!item) return false;
    item.completed = !item.completed;
    this.saveUser(user);
    return true;
  }

  removeScheduleItem(itemId) {
    const user = this.getCurrentUser();
    if (!user) return false;
    user.schedule = user.schedule.filter(item => item.id !== itemId);
    this.saveUser(user);
    return true;
  }

  setWellbeing(mood) {
    const user = this.getCurrentUser();
    if (!user) return false;
    user.wellbeing = { mood, updatedAt: new Date().toISOString() };
    this.saveUser(user);
    return true;
  }

  getStudyMinutes() {
    return (this.getCurrentUser()?.studySessions || [])
      .reduce((total, session) => total + Number(session.minutes || 0), 0);
  }

  // Obter progresso total do dia
  getDailyProgress() {
    const user = this.getCurrentUser();
    if (!user) return 0;

    if (user.subjects.length === 0) return 0;
    const average = user.subjects.reduce((sum, s) => sum + s.progress, 0) / user.subjects.length;
    return Math.round(average);
  }
}

const auth = new SynaraAuth();
