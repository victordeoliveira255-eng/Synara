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
    return user ? JSON.parse(user) : null;
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
      dailyProgress: []
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
      subject.completedHours = newHours;
      subject.progress = Math.min(100, Math.round((newHours / subject.targetHours) * 100));
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
      goal.completed = true;
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
