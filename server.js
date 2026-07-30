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

function fallbackResponse(message) {
  const text = message.toLowerCase();
  if (/foco|concentra|distração|atenção/.test(text)) {
    return 'Para manter o foco, faça blocos de estudo de 25 minutos e revise em intervalos curtos. A SYNARA sugere pausas curtas sempre que o foco cair.';
  }
  if (/ansiedade|estresse|cansaço/.test(text)) {
    return 'Quando o estresse aumentar, diminua o ritmo e faça uma pausa consciente. Uma pequena caminhada ou exercício de respiração ajuda a manter sua energia.';
  }
  if (/plano|rotina|agenda/.test(text)) {
    return 'Seu plano deve equilibrar revisão e novo conteúdo. Priorize os tópicos mais difíceis e reveja o que já estudou recentemente.';
  }
  if (/revisão|exercício|questão/.test(text)) {
    return 'Revisar com frequência ajuda a fixar conteúdo. Alterne entre teoria e prática para melhorar retenção.';
  }
  if (/começar|ajuda|o que/.test(text)) {
    return 'Vamos começar! Diga qual matéria ou tema você quer revisar hoje para eu te ajudar a montar o melhor plano.';
  }
  return 'Ótimo questionamento! A SYNARA sugere criar um objetivo claro para hoje e focar no próximo passo pequeno do seu estudo.';
}

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Mensagem inválida' });
  }

  if (!openai) {
    return res.json({ reply: fallbackResponse(message) });
  }

  try {
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: `Você é um assistente de estudos chamado SYNARA. Responda de forma acolhedora, breve e útil ao pedido do usuário. Usuário: ${message}`
    });

    const reply = (response.output || [])
      .flatMap(item => item?.content || [])
      .map(chunk => chunk?.text || '')
      .filter(Boolean)
      .join(' ') || fallbackResponse(message);

    res.json({ reply });
  } catch (error) {
    console.error('OpenAI error:', error);
    res.json({ reply: fallbackResponse(message) });
  }
});

app.listen(PORT, () => {
  console.log(`SYNARA API rodando em http://localhost:${PORT}`);
});
