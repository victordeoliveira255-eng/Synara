# Deploy notes — resolução do 404 no Render

## Estado atual (após PR #2)

Commit `1490d56` em `origin/main` contém o cache-busting e o endpoint
`/healthz`. `autoDeploy: true` no `render.yaml` deveria ter disparado
um deploy automático.

## Sintoma observado

```
$ curl -sI https://synara.onrender.com/
HTTP/2 404
x-render-routing: no-server
cf-cache-status: DYNAMIC
```

`x-render-routing: no-server` significa que o Render não conseguiu
rotear a requisição para nenhum serviço. Isso **não** é cache — é o
sinalizador padrão do Render quando nenhum serviço está escutando
na porta esperada.

## Diagnóstico

`server.js:46-57` chama `process.exit(1)` quando
`process.env.JWT_SECRET` não está definido. Isso significa que o
processo Node encerra **antes** do `app.listen()`. O Render detecta
o crash na inicialização e marca o serviço como indisponível,
devolvendo `x-render-routing: no-server` para qualquer requisição.

NÃO é bug do cache do navegador, do CDN Cloudflare, do Express, do
`@import tokens.css`, nem dos arquivos do redesign. O redesign
(commit `37b5d14`, merge do PR #1) está correto e bem formado.
**O serviço está morto por falta de segredo.**

## Ação obrigatória no painel do Render

1. Abrir: https://dashboard.render.com/web/srv-XXXXXXX
2. Menu lateral: **Environment**
3. Verificar se a variável `JWT_SECRET` existe. **Se não existir:**
   - Clicar **Add Environment Variable**
   - Key: `JWT_SECRET`
   - Value: executar em um terminal seguro do utilizador:
     `openssl rand -hex 32`
   - (colar o valor; **não** compartilhar aqui)
4. Confirmar que `NODE_ENV=production` também existe (vem do
   `render.yaml`).
5. Clicar **Save Changes** — Render dispara um redeploy automático.
6. Acompanhar a aba **Logs**; procure por
   `SYNARA API rodando em http://localhost:XXXX`. Quando essa linha
   aparecer, o serviço está vivo.

## Verificação pós-redeploy

```
$ curl -sI https://synara.onrender.com/healthz
HTTP/2 200
x-render-routing: service          # agora sim
```

Se o `healthz` responder **200** com `x-render-routing: service`,
o problema está resolvido e o redesign passa a aparecer.

Se continuar `no-server`, copiar os **Logs** do Render e me enviar
para diagnóstico mais profundo.

## Por que esta correção (PR #2) ainda é útil

Mesmo depois do `JWT_SECRET` ser configurado, cada deploy pode
sofrer cache do navegador do utilizador final ou de um CDN entre
origem e cliente. Os cabeçalhos `Cache-Control: no-store` adicionados
em CSS/JS/fonts/HTML garantem que **toda versão deployada aparece de
imediato** — equivalente a ter `style.css?v=<commit_hash>` em cada
`<link>`, sem precisar editar o HTML.
