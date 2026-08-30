class SynaraAuth {
  constructor() {
    this.currentUserKey = 'synara_current_user';
  }

  normalizeUser(user = {}) {
    if (!user || typeof user !== 'object') return null;
    return {
      id: user.id,
      name: user.name || 'Aluno',
      email: user.email || '',
      profile: user.profile && typeof user.profile === 'object' ? user.profile : {},
      createdAt: user.createdAt || user.created_at || new Date().toISOString(),
      updatedAt: user.updatedAt || user.updated_at || new Date().toISOString(),
      subjects: Array.isArray(user.subjects) ? user.subjects : [],
      goals: Array.isArray(user.goals) ? user.goals : [],
      studySessions: Array.isArray(user.studySessions) ? user.studySessions : [],
      schedule: Array.isArray(user.schedule) ? user.schedule : [],
      exerciseResults: Array.isArray(user.exerciseResults) ? user.exerciseResults : [],
      contentStats: user.contentStats && typeof user.contentStats === 'object' ? user.contentStats : {},
      wellbeing: user.wellbeing || { mood: '', updatedAt: null }
    };
  }

  setCurrentUser(user) {
    if (!user) {
      sessionStorage.removeItem(this.currentUserKey);
      return;
    }
    const normalized = this.normalizeUser(user);
    if (!normalized) return;
    sessionStorage.setItem(this.currentUserKey, JSON.stringify(normalized));
  }

  getCurrentUser() {
    try {
      const raw = sessionStorage.getItem(this.currentUserKey);
      if (!raw) return null;
      return this.normalizeUser(JSON.parse(raw));
    } catch (error) {
      console.warn('Could not read current user session:', error);
      return null;
    }
  }

  async request(endpoint, options = {}) {
    const response = await fetch(endpoint, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || 'Operação não concluída.');
    }
    return data;
  }

  async login(email, password) {
    if (!email || !password) {
      return { success: false, message: 'Informe e-mail e senha.' };
    }

    try {
      const result = await this.request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: String(email).trim().toLowerCase(), password })
      });

      const user = this.normalizeUser(result.user || {});
      if (user) this.setCurrentUser(user);
      return { success: true, user, message: result.message || 'Login realizado com sucesso.' };
    } catch (error) {
      return { success: false, message: error.message || 'E-mail ou senha incorretos.' };
    }
  }

  async register(email, password, name) {
    if (!email || !password || !name) {
      return { success: false, message: 'Preencha nome, e-mail e senha.' };
    }

    if (String(password).length < 6) {
      return { success: false, message: 'A senha precisa ter ao menos 6 caracteres.' };
    }

    try {
      const result = await this.request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: String(email).trim().toLowerCase(), password, name: String(name).trim() })
      });

      const user = this.normalizeUser(result.user || {});
      if (user) this.setCurrentUser(user);
      return { success: true, user, message: result.message || 'Cadastro realizado com sucesso.' };
    } catch (error) {
      return { success: false, message: error.message || 'Não foi possível concluir o cadastro.' };
    }
  }

  async requestPasswordReset(email) {
    try {
      const result = await this.request('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: String(email || '').trim().toLowerCase() })
      });
      return { success: true, message: result.message || 'Se o e-mail existir, enviaremos instruções.', resetToken: result.resetToken };
    } catch (error) {
      return { success: false, message: error.message || 'Não foi possível solicitar a recuperação.' };
    }
  }

  async resetPassword(token, password) {
    try {
      const result = await this.request('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, password })
      });
      return { success: true, message: result.message || 'Senha redefinida com sucesso.' };
    } catch (error) {
      return { success: false, message: error.message || 'Não foi possível redefinir a senha.' };
    }
  }

  async logout() {
    try {
      await this.request('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.warn('Logout request failed:', error);
    }
    sessionStorage.removeItem(this.currentUserKey);
    return true;
  }

  async syncUser(user) {
    const normalized = this.normalizeUser(user);
    if (!normalized) return null;

    const payload = {
      profile: {
        ...normalized.profile,
        name: normalized.name,
        email: normalized.email,
        subjects: normalized.subjects,
        goals: normalized.goals,
        studySessions: normalized.studySessions,
        schedule: normalized.schedule,
        exerciseResults: normalized.exerciseResults,
        contentStats: normalized.contentStats,
        wellbeing: normalized.wellbeing
      }
    };

    const result = await this.request('/api/user/profile', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    const updatedUser = this.normalizeUser(result.user || normalized);
    if (updatedUser) this.setCurrentUser(updatedUser);
    return updatedUser;
  }

  async hydrateFromServer() {
    try {
      const result = await this.request('/api/auth/me', { method: 'GET' });
      const user = this.normalizeUser(result.user || {});
      if (user) this.setCurrentUser(user);
      return user;
    } catch (error) {
      sessionStorage.removeItem(this.currentUserKey);
      return null;
    }
  }

  getCurrentUserFromServer() {
    return this.hydrateFromServer();
  }

  getAllUsers() {
    return {};
  }

  saveUser(user) {
    const normalized = this.normalizeUser(user);
    if (!normalized) return null;
    this.setCurrentUser(normalized);
    return this.syncUser(normalized);
  }

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

    try {
      fetch('/api/embeddings/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: user.email, content: `Matéria: ${subjectName}`, metadata: { type: 'subject', name: subjectName } })
      }).catch((error) => console.warn('Index subject failed', error));
    } catch (error) {
      console.warn('Index subject error', error);
    }
    return subject;
  }

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

    try {
      fetch('/api/embeddings/index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userEmail: user.email, content: `Meta: ${goalText}${subject ? ` (Matéria: ${subject})` : ''}`, metadata: { type: 'goal', subject } })
      }).catch((error) => console.warn('Index goal failed', error));
    } catch (error) {
      console.warn('Index goal error', error);
    }
    return goal;
  }

  updateSubjectProgress(subjectId, newHours) {
    const user = this.getCurrentUser();
    if (!user) return false;

    const subject = user.subjects.find((item) => item.id === subjectId);
    if (!subject) return false;

    const hours = Math.max(0, Number(newHours) || 0);
    subject.completedHours = hours;
    subject.progress = subject.targetHours > 0 ? Math.min(100, Math.round((hours / subject.targetHours) * 100)) : 0;
    this.saveUser(user);
    return true;
  }

  completeGoal(goalId) {
    const user = this.getCurrentUser();
    if (!user) return false;

    const goal = user.goals.find((item) => item.id === goalId);
    if (!goal) return false;

    goal.completed = !goal.completed;
    this.saveUser(user);
    return true;
  }

  removeSubject(subjectId) {
    const user = this.getCurrentUser();
    if (!user) return false;

    user.subjects = user.subjects.filter((item) => item.id !== subjectId);
    this.saveUser(user);
    return true;
  }

  removeGoal(goalId) {
    const user = this.getCurrentUser();
    if (!user) return false;

    user.goals = user.goals.filter((item) => item.id !== goalId);
    this.saveUser(user);
    return true;
  }

  editGoal(goalId, text, subject = '') {
    const user = this.getCurrentUser();
    if (!user) return false;

    const goal = user.goals.find((item) => item.id === goalId);
    if (!goal || !String(text).trim()) return false;

    goal.text = String(text).trim();
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
    if (!user) return false;

    const subject = user.subjects.find((item) => item.id === subjectId);
    if (!subject || !subjectName.trim()) return false;

    subject.name = subjectName.trim();
    subject.targetHours = Math.max(0, Number(targetHours) || 0);
    this.updateSubjectProgress(subjectId, subject.completedHours);
    return true;
  }

  addStudySession(subjectId, minutes, topic = '') {
    const user = this.getCurrentUser();
    const subject = user?.subjects.find((item) => item.id === subjectId);
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
    subject.progress = subject.targetHours > 0 ? Math.min(100, Math.round((completedHours / subject.targetHours) * 100)) : 0;
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
    const item = user?.schedule.find((entry) => entry.id === itemId);
    if (!item) return false;

    item.completed = !item.completed;
    this.saveUser(user);
    return true;
  }

  removeScheduleItem(itemId) {
    const user = this.getCurrentUser();
    if (!user) return false;

    user.schedule = user.schedule.filter((item) => item.id !== itemId);
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
    return (this.getCurrentUser()?.studySessions || []).reduce((total, session) => total + Number(session.minutes || 0), 0);
  }

  getDailyProgress() {
    const user = this.getCurrentUser();
    if (!user) return 0;

    if (user.subjects.length === 0) return 0;
    const average = user.subjects.reduce((sum, subject) => sum + (Number(subject.progress) || 0), 0) / user.subjects.length;
    return Math.round(average);
  }
}

const auth = new SynaraAuth();
