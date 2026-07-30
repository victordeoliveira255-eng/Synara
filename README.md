# SYNARA Plataforma

Protótipo da plataforma SYNARA com chat de IA funcional via API.

## Como usar

1. Copie `.env.example` para `.env`.
2. Defina sua chave de API OpenAI em `.env`:

```
OPENAI_API_KEY=your-openai-api-key-here
```

3. No terminal, instale as dependências:

```
npm install
```

4. Inicie o servidor:

```
npm start
```

5. Abra no navegador:

```
http://localhost:3000/index.html
```

## O que foi adicionado

- `server.js`: servidor Node/Express que expõe o endpoint `/api/chat`.
- `package.json`: dependências para rodar o servidor e usar a OpenAI.
- `script.js`: agora chama `/api/chat` para obter respostas reais da IA.
- `.env.example`: modelo de configuração de chave de API.

## Observação

Se não houver chave de API disponível, o chat continuará funcionando com respostas de fallback locais.

## Deploy no Render

1. Crie uma conta no Render e conecte seu GitHub.
2. No painel do Render clique em **New → Web Service** e selecione este repositório (`victordeoliveira255-eng/Synara`).
3. Em **Build Command** use: `npm install`
4. Em **Start Command** use: `npm start`
5. Adicione a variável de ambiente `OPENAI_API_KEY` com sua chave da OpenAI (se quiser respostas reais).
6. Salve — o Render fará o deploy automático e fornecerá uma URL pública.

Também é possível usar um arquivo de especificação `render.yaml` (exemplo no repositório) para configurar o serviço automaticamente.
