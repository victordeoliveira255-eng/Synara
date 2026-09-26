const chatMessages = document.getElementById('chatMessages');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const heroInput = document.getElementById('heroInput');
const heroSendBtn = document.getElementById('heroSendBtn');
let conversationHistory = [];
let awaitingClarification = false;
let pendingOriginalMessage = null;
let isLoading = false;

function setLoading(flag) {
  isLoading = !!flag;
  const sendBtn = document.getElementById('sendBtn');
  const quickActions = document.querySelectorAll('.quick-action');
  const spinner = document.getElementById('global-spinner');
  if (sendBtn) sendBtn.disabled = isLoading;
  quickActions.forEach((button) => {
    if (isLoading) button.setAttribute('disabled', 'true');
    else button.removeAttribute('disabled');
  });
  if (spinner) spinner.style.display = isLoading ? 'inline-block' : 'none';
}

function addToHistory(sender, message) {
  conversationHistory.push({ sender, message, time: new Date() });
  if (conversationHistory.length > 10) {
    conversationHistory.shift();
  }
}

function getRecentContext() {
  return conversationHistory
    .slice(-6)
    .map((m) => `${m.sender.toUpperCase()}: ${m.message}`)
    .join('\n');
}

function getRecentMessages(limit = 12) {
  return conversationHistory.slice(-limit).map((m) => ({
    role: m.sender === 'user' ? 'user' : 'assistant',
    content: m.message
  }));
}

function appendMessage(sender, message) {
  if (!chatMessages) return;
  const messageEl = document.createElement('div');
  messageEl.className = `chat-message ${sender}`;
  messageEl.innerHTML = `<div class="chat-bubble">${message}</div>`;
  chatMessages.appendChild(messageEl);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function fallbackResponse(userMessage) {
  const text = userMessage.toLowerCase();

  if (/preciso de ajuda|não entendi|me explica|como|qual é a diferença|qual a diferença/.test(text)) {
    const replies = [
      'Claro! Vou explicar de forma simples. Qual é sua dúvida específica?',
      'Sem problema! Posso ajudar você a entender isso melhor. Me diz qual parte ficou confusa.',
      'Vou descomplicar para você! O que exatamente você gostaria de saber?'
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (/equações|1º grau|2º grau|sistemas lineares|substituição|adição|escalonamento|polinomiais|matemática|conta|número|cálculo|álgebra|geometria/.test(text)) {
    const replies = [
      'Matemática é nosso forte! Posso ajudar com equações, sistemas, polinômios e muito mais. Qual tópico você quer dominar?',
      'Vamos resolver isso junto! Preciso saber se é sobre álgebra, geometria, trigonometria ou cálculo.',
      'Equações, gráficos, operações... Diga-me qual conteúdo está dificultando e vou simplificar para você.'
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (/física|força|energia|movimento|sistema|mecânica|campo|velocidade|aceleração|termodinâmica/.test(text)) {
    return 'Física é incrível! Posso ajudar com mecânica clássica, termodinâmica, eletromagnetismo e óptica. O que você quer aprender?';
  }

  if (/química|moléculas|reação|elemento|tabela periódica|ácido|base|sal|combustão|oxidação/.test(text)) {
    return 'Química é essencial! Vamos trabalhar com reações químicas, estrutura molecular, estequiometria ou termoquímica. Escolha um!';
  }

  if (/biologia|célula|organismo|genes|evolução|ecossistema|reprodução|dna|cromossomo/.test(text)) {
    return 'Biologia fascinante! Posso explorar citologia, genética, fisiologia, ecologia ou evolução. Qual área te interessa?';
  }

  if (/artes|pintura|escultura|arte|renascimento|barroco|impressionismo|artista|obra|movimento artístico/.test(text)) {
    return 'Artes é criatividade! Posso discutir movimentos artísticos, técnicas, artistas históricos ou análise de obras. O que te atrai?';
  }

  if (/foco|concentra|distração|atenção|produtiv|cansaço|sono|ritmo de estudo/.test(text)) {
    const replies = [
      'Para manter o foco: use blocos de 25 minutos (Pomodoro), elimine distrações e faça pequenas pausas. Está funcionando para você?',
      'Dica de ouro: estude em um ambiente calmo, desligue notificações e beba água. Como está seu ritmo?',
      'Concentração é treino! Comece com 15 minutos, aumente gradualmente e celebre pequenas vitórias.'
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (/ansiedade|estresse|cansaço|motivação|desanimo|depressão|medo|preocupado|nervoso/.test(text)) {
    const replies = [
      'Respire fundo! Ansiedade é normal antes de provas. Vamos fazer um plano de estudo positivo juntos?',
      'Sua saúde mental é importante. Se o estresse persiste, considere falar com um profissional. Posso ajudar seu cronograma?',
      'Você é capaz! Comece com metas pequenas, celebre cada progresso e descanse bem. Vamos juntos!'
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  if (/plano|rotina|agenda|cronograma|horário|programa|semana|organiza|estrutura/.test(text)) {
    return 'Ótimo pensar em organização! Recomendo: divida as matérias, estude 50 min por matéria e pause 10 min. Quer um plano detalhado?';
  }

  if (/meta|objetivo|progresso|resultado|consegui|alcança|sucesso|nota|prova|exame/.test(text)) {
    return 'Metas claras = sucesso! Defina alvos específicos por semana, acompanhe o progresso e ajuste conforme necessário. Qual é sua meta?';
  }

  const genericReplies = [
    'Ótima pergunta! Posso ajudar de forma mais precisa se você me disser qual matéria estamos abordando.',
    'Entendi! Vou focar em ajudar você. Quer que eu explique melhor ou prefere um exercício prático?',
    'Você está no caminho certo! Continue estudando assim. Tem mais alguma dúvida?',
    'Essa é uma ótima estratégia. A SYNARA recomenda sempre praticar com exercícios depois da teoria.',
    'Vamos aprofundar nesse assunto! Qual aspecto específico você quer dominar?'
  ];
  return genericReplies[Math.floor(Math.random() * genericReplies.length)];
}

async function getApiResponse(message) {
  try {
    const user = auth.getCurrentUser();
    const userEmail = user?.email;
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
          knowledge = jd.items?.map((item) => item.content) || [];
        }
      }
    } catch (e) {
      console.warn('RAG query failed', e);
    }

    const bodyObj = {
      message,
      subject: window.synaraSubject || 'Geral',
      subjects: user?.subjects?.map((item) => item.name) || [],
      ...(window.synaraStudyContext || {}),
      history: getRecentContext(),
      messageHistory: getRecentMessages(),
      knowledge,
      userEmail,
      goals: user?.goals?.map((goal) => goal.text) || []
    };

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
    if (data && data.clarify) {
      return { clarify: true, question: data.question };
    }
    return { text: data.reply || fallbackResponse(message) };
  } catch (error) {
    console.warn('API unavailable, using local fallback', error);
    return fallbackResponse(message);
  }
}

async function sendChatMessage(text) {
  if (!text || !text.trim()) return;
  appendMessage('user', text);
  addToHistory('user', text);
  chatInput.value = '';
  chatInput.disabled = true;
  setLoading(true);

  appendMessage('bot', 'Pensando...');

  if (awaitingClarification) {
    const low = text.toLowerCase();
    if (/exercic|exercício|exercicio|pratic/.test(low)) {
      try {
        const resp = await fetch('/api/generate-exercise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userEmail: auth.getCurrentUser()?.email, topic: pendingOriginalMessage || text })
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
      setLoading(false);
      chatInput.disabled = false;
      chatInput.focus();
      return;
    }
  }

  let botResponse;
  try {
    botResponse = await getApiResponse(text);
  } catch (err) {
    console.error('Chat error', err);
    botResponse = fallbackResponse(text);
  }

  const lastBotMessage = [...chatMessages.querySelectorAll('.chat-message.bot')].pop();
  if (botResponse?.clarify) {
    if (lastBotMessage) lastBotMessage.querySelector('.chat-bubble').textContent = botResponse.question;
    awaitingClarification = true;
    pendingOriginalMessage = text;
    addToHistory('bot', botResponse.question);
  } else {
    const replyText = (botResponse && botResponse.text) ? botResponse.text : (typeof botResponse === 'string' ? botResponse : fallbackResponse(text));
    if (lastBotMessage) lastBotMessage.querySelector('.chat-bubble').textContent = replyText;
    addToHistory('bot', replyText);
    awaitingClarification = false;
    pendingOriginalMessage = null;
  }

  chatInput.disabled = false;
  setLoading(false);
  chatInput.focus();
}

function onChatSubmit(event) {
  event.preventDefault();
  const value = chatInput.value.trim();
  if (!value) return;
  sendChatMessage(value);
}

chatForm?.addEventListener('submit', onChatSubmit);

document.addEventListener('click', (event) => {
  const actionButton = event.target.closest && event.target.closest('.quick-action');
  if (!actionButton) return;
  if (isLoading) return;

  const action = actionButton.dataset.action;
  let text = '';
  switch (action) {
    case 'explain':
      text = 'Explique isso para mim.';
      break;
    case 'summary':
      text = 'Faça um resumo curto.';
      break;
    case 'question':
      text = 'Gere uma questão prática.';
      break;
    case 'tips':
      text = 'Dê dicas de estudo.';
      break;
    default:
      text = '';
  }
  if (!text) return;
  chatInput.value = text;
  if (heroInput) heroInput.value = text;
  chatInput.focus();
  try { chatInput.setSelectionRange(chatInput.value.length, chatInput.value.length); } catch (e) {}
});

if (heroSendBtn) {
  heroSendBtn.addEventListener('click', () => {
    if (!heroInput) return;
    const text = heroInput.value.trim();
    if (!text) return;
    chatInput.value = text;
    sendChatMessage(text);
    heroInput.value = '';
  });
}
