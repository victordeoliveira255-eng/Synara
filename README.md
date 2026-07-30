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
