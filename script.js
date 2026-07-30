const scrollLinks = document.querySelectorAll('a[href^="#"]');
const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const subjectAddForm = document.getElementById('subjectAddForm');
const newSubjectInput = document.getElementById('newSubject');
const currentSubjectLabel = document.getElementById('currentSubjectLabel');
let currentSubject = 'Geral';
let conversationHistory = [];
let awaitingClarification = false;
let pendingOriginalMessage = null;

function getSavedSubjects() {
  return auth.getCurrentUser()?.subjects?.map(subject => subject.name) || [];
}

function getSavedGoals() {
  return auth.getCurrentUser()?.goals?.map(goal => goal.text) || [];
}

function populateSavedSubjects() {
  const selection = document.querySelector('.subject-selection');
  if (!selection) return;

  const existingSubjects = new Set(
    Array.from(selection.querySelectorAll('.subject-selection-button')).map(button => button.dataset.subject)
  );

  getSavedSubjects().forEach(subjectName => {
    if (!existingSubjects.has(subjectName)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'subject-selection-button button-secondary';
      button.dataset.subject = subjectName;
      button.textContent = subjectName;
      selection.appendChild(button);
    }
  });
}

function attachSubjectSelectionHandlers() {
  document.body.addEventListener('click', (event) => {
    const target = event.target;
    if (target.matches('.subject-selection-button')) {
      event.preventDefault();
      setCurrentSubject(target.dataset.subject);
    }
  });
}

attachSubjectSelectionHandlers();
populateSavedSubjects();

// Histórico de conversa para contexto
function addToHistory(sender, message) {
  conversationHistory.push({ sender, message, time: new Date() });
  if (conversationHistory.length > 10) {
    conversationHistory.shift();
  }
}

function getRecentContext() {
  // Envia mais contexto (últimas 6 mensagens) com papel do autor para melhor coesão
  return conversationHistory.slice(-6).map(m => `${m.sender.toUpperCase()}: ${m.message}`).join('\n');
}

function getRecentMessages(limit = 12) {
  // Retorna um array de mensagens no formato { role, content } para few-shot/chat
  return conversationHistory.slice(-limit).map(m => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: m.message
  }));
}

function updateChatSummary() {
  const subjects = getSavedSubjects();
  const goals = getSavedGoals();
  const subjectSummary = document.getElementById('chatSubjectSummary');
  const goalSummary = document.getElementById('chatGoalSummary');

  if (subjectSummary) {
    subjectSummary.innerHTML = `<strong>Matérias:</strong> ${subjects.length ? subjects.join(', ') : 'Nenhuma matéria adicionada'}`;
  }
  if (goalSummary) {
    goalSummary.innerHTML = `<strong>Metas:</strong> ${goals.length ? goals.join(' | ') : 'Sem metas definidas'}`;
  }
}

function scrollToSection(event) {
  const href = this.getAttribute('href');
  if (href === '#') return;
  event.preventDefault();
  const target = document.querySelector(href);
  if (target) {
    const headerHeight = document.querySelector('.site-header').offsetHeight;
    const targetPosition = target.offsetTop - headerHeight;
    window.scrollTo({ top: targetPosition, behavior: 'smooth' });
  }
}

function appendMessage(sender, message) {
  if (!chatMessages) return;
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${sender}`;
  messageEl.innerHTML = `<div class="chat-bubble">${message}</div>`;
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function selectSubjectFromList(subjectName) {
  setCurrentSubject(subjectName);
  appendMessage('bot', `Agora você está conversando sobre ${subjectName}. Como posso ajudar nessa matéria?`);
}

function fallbackResponse(userMessage, subject = 'Geral') {
  const text = userMessage.toLowerCase();
  
  // Respostas contextuais baseadas no histórico
  if (/preciso de ajuda|não entendi|me explica|como|qual é a diferença|qual a diferença/.test(text)) {
    const contextResponses = [
      'Claro! Vou explicar de forma simples. Qual é sua dúvida específica?',
      'Sem problema! Posso ajudar você a entender isso melhor. Me diz qual parte ficou confusa.',
      'Vou descomplicar para você! O que exatamente você gostaria de saber?'
    ];
    return contextResponses[Math.floor(Math.random() * contextResponses.length)];
  }

  // Literatura e português
  if (/pré-modernismo|modernistas|manifesto antropófago|romances|realismo|poema|machado de assis|guimarães rosa|lygia f\. telles|reportagem|notícias que impactam|literatura|português/.test(text) || subject === 'Português') {
    const portugueseResponses = [
      'Ótimo! Na literatura brasileira, estudamos desde o Realismo até os Modernistas. Qual período ou autor você quer focar?',
      'Vamos explorar a literatura brasileira! Posso ajudá-lo com análise de textos, autores clássicos ou redação.',
      'Sobre português e literatura... Posso trabalhar interpretação, ortografia, sintaxe ou obras literárias. Qual é seu foco?'
    ];
    return portugueseResponses[Math.floor(Math.random() * portugueseResponses.length)];
  }

  // Matemática
  if (/equações|1º grau|2º grau|sistemas lineares|substituição|adição|escalonamento|polinomiais|matemática|conta|número|cálculo|álgebra|geometria/.test(text) || subject === 'Matemática') {
    const mathResponses = [
      'Matemática é nosso forte! Posso ajudar com equações, sistemas, polinômios e muito mais. Qual tópico você quer dominar?',
      'Vamos resolver isso junto! Preciso saber se é sobre álgebra, geometria, trigonometria ou cálculo.',
      'Equações, gráficos, operações... Diga-me qual conteúdo está dificultando e vou simplificar para você.'
    ];
    return mathResponses[Math.floor(Math.random() * mathResponses.length)];
  }

  // Física
  if (/física|força|energia|movimento|sistema|mecânica|campo|velocidade|aceleração|termodinâmica/.test(text) || subject === 'Física') {
    return 'Física é incrível! Posso ajudar com mecânica clássica, termodinâmica, eletromagnetismo e óptica. O que você quer aprender?';
  }

  // Química
  if (/química|moléculas|reação|elemento|tabela periódica|ácido|base|sal|combustão|oxidação/.test(text) || subject === 'Química') {
    return 'Química é essencial! Vamos trabalhar com reações químicas, estrutura molecular, estequiometria ou termoquímica. Escolha um!';
  }

  // Biologia
  if (/biologia|célula|organismo|genes|evolução|ecossistema|reprodução|dna|cromossomo/.test(text) || subject === 'Biologia') {
    return 'Biologia fascinante! Posso explorar citologia, genética, fisiologia, ecologia ou evolução. Qual área te interessa?';
  }

  // Artes
  if (/artes|pintura|escultura|arte|renascimento|barroco|impressionismo|artista|obra|movimento artístico/.test(text) || subject === 'Artes') {
    return 'Artes é criatividade! Posso discutir movimentos artísticos, técnicas, artistas históricos ou análise de obras. O que te atrai?';
  }

  // Foco e produtividade
  if (/foco|concentra|distração|atenção|produtiv|cansaço|sono|ritmo de estudo/.test(text)) {
    const focusResponses = [
      'Para manter o foco: use blocos de 25 minutos (Pomodoro), elimine distrações, e faça pequenas pausas. Está funcionando para você?',
      'Dica de ouro: estude em um ambiente calmo, desligue notificações e beba água. Como está seu ritmo?',
      'Concentração é treino! Comece com 15 minutos, aumente gradualmente, e celebre pequenas vitórias.'
    ];
    return focusResponses[Math.floor(Math.random() * focusResponses.length)];
  }

  // Emoções e bem-estar
  if (/ansiedade|estresse|cansaço|motivação|desanimo|depressão|medo|preocupado|nervoso/.test(text)) {
    const emotionalResponses = [
      'Respire fundo! Ansiedade é normal antes de provas. Vamos fazer um plano de estudo positivo juntos?',
      'Sua saúde mental é importante. Se o estresse persiste, considere falar com um profissional. Posso ajudar seu cronograma?',
      'Você é capaz! Comece com metas pequenas, celebre cada progresso e descanse bem. Vamos juntos!'
    ];
    return emotionalResponses[Math.floor(Math.random() * emotionalResponses.length)];
  }

  // Planejamento e cronograma
  if (/plano|rotina|agenda|cronograma|horário|programa|semana|organiza|estrutura/.test(text)) {
    return 'Ótimo pensar em organização! Recomendo: divida as matérias, estude 50 min por matéria, pause 10 min. Quer um plano detalhado?';
  }

  // Metas e objetivos
  if (/meta|objetivo|progresso|resultado|consegui|alcança|sucesso|nota|prova|exame/.test(text)) {
    return 'Metas claras = sucesso! Defina alvos específicos por semana, acompanhe o progresso e ajuste conforme necessário. Qual é sua meta?';
  }

  // Respostas gerais
  const genericResponses = [
    'Ótima pergunta! Posso ajudar de forma mais precisa se você me disser qual matéria estamos abordando.',
    'Entendi! Vou focar em ajudar você. Quer que eu explique melhor ou prefere um exercício prático?',
    'Você está no caminho certo! Continue estudando assim. Tem mais alguma dúvida?',
    'Essa é uma ótima estratégia. A SYNARA recomenda sempre praticar com exercícios depois da teoria.',
    'Vamos aprofundar nesse assunto! Qual aspecto específico você quer dominar?'
  ];
  
  return genericResponses[Math.floor(Math.random() * genericResponses.length)];
}

async function getApiResponse(message) {
  try {
    const user = auth.getCurrentUser();
    const userEmail = user?.email;

    // Retrieve relevant memories from RAG store
    let knowledge = [];
    try {
      if (userEmail) {
        const q = await fetch('/api/embeddings/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userEmail, query: message, topK: 3 })
        });
        if (q.ok) {
          const jd = await q.json();
          knowledge = jd.items?.map(i => i.content) || [];
        }
      }
    } catch (e) {
      console.warn('RAG query failed', e);
    }
    const bodyObj = {
      message,
      subject: currentSubject,
      history: getRecentContext(),
      messageHistory: getRecentMessages(),
      knowledge,
      userEmail,
      subjects: user?.subjects?.map(subject => subject.name) || [],
      goals: user?.goals?.map(goal => goal.text) || []
    };

    // If this message is a clarification to a prior ambiguous request, include original
    if (pendingOriginalMessage) {
      bodyObj.clarification = message;
      bodyObj.originalMessage = pendingOriginalMessage;
    }

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyObj)
    });

    if (!response.ok) {
      throw new Error('Erro ao chamar a API');
    }

    const data = await response.json();
    // If server asks for clarification
    if (data && data.clarify) {
      return { clarify: true, question: data.question };
    }
    return { text: data.reply || fallbackResponse(message, currentSubject) };
  } catch (error) {
    console.warn('API unavailable, using local fallback', error);
    return fallbackResponse(message, currentSubject);
  }
}

function setCurrentSubject(subject) {
  currentSubject = subject;
  if (currentSubjectLabel) {
    currentSubjectLabel.textContent = subject;
  }
  document.querySelectorAll('.subject-selection-button, .subject-option').forEach((button) => {
    button.classList.toggle('active', button.dataset.subject === subject);
  });
  updateChatSummary();
}

subjectAddForm?.addEventListener('submit', (event) => {
  event.preventDefault();
  const newSubject = newSubjectInput.value.trim();
  if (!newSubject) return;

  const subjectName = newSubject.charAt(0).toUpperCase() + newSubject.slice(1);
  const user = auth.getCurrentUser();

  if (user?.subjects?.some((subject) => subject.name === subjectName)) {
    setCurrentSubject(subjectName);
    updateChatSummary();
    newSubjectInput.value = '';
    return;
  }

  auth.addSubject(subjectName);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'subject-selection-button button-secondary active';
  button.dataset.subject = subjectName;
  button.textContent = subjectName;
  button.addEventListener('click', () => {
    setCurrentSubject(subjectName);
  });

  document.querySelector('.subject-selection').appendChild(button);
  setCurrentSubject(subjectName);
  updateChatSummary();
  newSubjectInput.value = '';

  if (typeof renderSubjects === 'function') {
    renderSubjects();
  }
  if (typeof updateStats === 'function') {
    updateStats();
  }
});

async function sendUserMessage(event) {
  event.preventDefault();
  const userMessage = chatInput.value.trim();
  if (!userMessage) return;

  appendMessage('user', userMessage);
  addToHistory('user', userMessage);
  chatInput.value = '';
  chatInput.disabled = true;

  appendMessage('bot', 'Pensando...');
  // If we are awaiting a clarification answer, check if user asked for an exercise
  if (awaitingClarification) {
    const low = userMessage.toLowerCase();
    if (/exercic|exercício|exercicio|pratic/.test(low)) {
      // call generate-exercise
      try {
        const resp = await fetch('/api/generate-exercise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userEmail: auth.getCurrentUser()?.email, subject: currentSubject, topic: pendingOriginalMessage || currentSubject })
        });
        const jd = await resp.json();
        const exerciseText = jd.exercise || jd.error || 'Não foi possível gerar o exercício.';
        addToHistory('bot', exerciseText);
        const lastBotMessage = [...chatMessages.querySelectorAll('.chat-message.bot')].pop();
        if (lastBotMessage) lastBotMessage.querySelector('.chat-bubble').textContent = exerciseText;
      } catch (e) {
        const err = 'Erro ao gerar exercício.';
        addToHistory('bot', err);
        const lastBotMessage = [...chatMessages.querySelectorAll('.chat-message.bot')].pop();
        if (lastBotMessage) lastBotMessage.querySelector('.chat-bubble').textContent = err;
      }
      awaitingClarification = false;
      pendingOriginalMessage = null;
      chatInput.disabled = false;
      chatInput.focus();
      return;
    }
  }

  const botResponse = await getApiResponse(userMessage);

  const lastBotMessage = [...chatMessages.querySelectorAll('.chat-message.bot')].pop();

  if (botResponse?.clarify) {
    // Server asks for clarification
    if (lastBotMessage) lastBotMessage.querySelector('.chat-bubble').textContent = botResponse.question;
    awaitingClarification = true;
    pendingOriginalMessage = userMessage;
    addToHistory('bot', botResponse.question);
  } else {
    const replyText = (botResponse && botResponse.text) ? botResponse.text : (typeof botResponse === 'string' ? botResponse : fallbackResponse(userMessage, currentSubject));
    if (lastBotMessage) lastBotMessage.querySelector('.chat-bubble').textContent = replyText;
    addToHistory('bot', replyText);
    awaitingClarification = false;
    pendingOriginalMessage = null;
  }

  chatInput.disabled = false;
  chatInput.focus();
}

chatForm?.addEventListener('submit', sendUserMessage);
// Quick action buttons: click to prefill and send a contextual prompt, or allow user to edit before sending
document.addEventListener('click', (e) => {
  const btn = e.target.closest && e.target.closest('.quick-action');
  if (!btn) return;
  const action = btn.dataset.action;
  let text = '';
  switch (action) {
    case 'explain':
      text = `Explique sobre ${currentSubject}`;
      break;
    case 'summary':
      text = `Faça um resumo curto sobre ${currentSubject}`;
      break;
    case 'question':
      text = `Gere uma questão prática sobre ${currentSubject}`;
      break;
    case 'tips':
      text = `Me dê dicas de estudo para ${currentSubject}`;
      break;
    default:
      text = '';
  }
  if (!text) return;
  // prefills input so the user can edit or press enviar
  chatInput.value = text;
  chatInput.focus();
  try { chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length); } catch (e) {}
});

async function sendMessageText(text) {
  if (!text || !text.trim()) return;
  appendMessage('user', text);
  addToHistory('user', text);
  chatInput.value = '';
  chatInput.disabled = true;

  appendMessage('bot', 'Pensando...');
  const botResponse = await getApiResponse(text);

  const lastBotMessage = [...chatMessages.querySelectorAll('.chat-message.bot')].pop();

  if (botResponse?.clarify) {
    if (lastBotMessage) lastBotMessage.querySelector('.chat-bubble').textContent = botResponse.question;
    awaitingClarification = true;
    pendingOriginalMessage = text;
    addToHistory('bot', botResponse.question);
  } else {
    const replyText = (botResponse && botResponse.text) ? botResponse.text : (typeof botResponse === 'string' ? botResponse : fallbackResponse(text, currentSubject));
    if (lastBotMessage) lastBotMessage.querySelector('.chat-bubble').textContent = replyText;
    addToHistory('bot', replyText);
    awaitingClarification = false;
    pendingOriginalMessage = null;
  }

  chatInput.disabled = false;
  chatInput.focus();
}
scrollLinks.forEach((link) => {
  link.addEventListener('click', scrollToSection);
});

window.addEventListener('scroll', () => {
  const header = document.querySelector('.site-header');
  if (window.scrollY > 50) {
    header.style.boxShadow = '0 10px 30px rgba(0, 0, 0, 0.1)';
  } else {
    header.style.boxShadow = 'none';
  }
});
