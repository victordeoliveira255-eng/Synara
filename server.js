import express from 'express';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('.'));

const openAiKey = process.env.OPENAI_API_KEY;
const openai = openAiKey ? new OpenAI({ apiKey: openAiKey }) : null;

function fallbackResponse(message, subject = 'Geral') {
  // Respostas locais mais variadas e com pequenas sugestões de plano
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

  // Caso geral: ofereça sugestão de objetivo e um próximo passo
  return variations([
    `Boa! Um objetivo claro ajuda: defina 20–40 minutos para focar em um tópico de ${subject} e faça um exercício ao final. Qual tópico você prefere?`,
    `Ótima pergunta! Posso explicar brevemente ou propor um exercício para ${subject}. O que prefere agora?`,
    `Vamos focar no próximo passo: escolha um ponto pequeno em ${subject} e praticamos juntos.`
  ]);
}

app.post('/api/chat', async (req, res) => {
  const { message, subject, history, subjects, goals } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Mensagem inválida' });
  }

  if (!openai) {
    return res.json({ reply: fallbackResponse(message, subject) });
  }

  try {
    const systemPrompt = `Você é a mentora de estudos SYNARA. Sua missão é ajudar o aluno a aprender melhor, organizar matérias, criar planos de estudo e responder dúvidas de forma clara, acolhedora e prática. Use linguagem empática, explicações passo a passo, exemplos simples e, sempre que possível, proponha um pequeno plano de estudo baseado nas metas e nas matérias registradas. Se houver metas informadas, recomende próximos passos práticos para atingi-las, incluindo revisão, prática e pausas. Se não houver metas, sugira um plano geral de revisão para a matéria atual.`;
    const details = [
      subject ? `Matéria atual: ${subject}` : 'Matéria atual: Geral',
      subjects && subjects.length ? `Matérias do estudante: ${subjects.join(', ')}` : null,
      goals && goals.length ? `Metas do dia: ${goals.join(' | ')}` : 'Sem metas registradas no momento.',
      history ? `Histórico recente: ${history}` : null,
      `Pergunta: ${message}`
    ].filter(Boolean).join('\n');

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: `${systemPrompt}\n\n${details}`
    });

    const reply = response.output_text || (response.output || [])
      .flatMap(item => item?.content || [])
      .map(chunk => chunk?.text || '')
      .filter(Boolean)
      .join(' ') || fallbackResponse(message, subject);

    res.json({ reply });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.json({ reply: fallbackResponse(message, subject) });
  }
});

app.listen(PORT, () => {
  console.log(`SYNARA API rodando em http://localhost:${PORT}`);
});
