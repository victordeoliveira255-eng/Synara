# SYNARA Plataforma

Protótipo da plataforma SYNARA com chat de IA funcional via API, painel administrativo e controle de roles.

## Como usar

### Configuração Local

1. Copie `.env.example` para `.env`.
2. Instale as dependências:

```bash
npm install
```

3. (Opcional) Defina sua chave de API OpenAI em `.env`:

```
OPENAI_API_KEY=your-openai-api-key-here
```

4. Inicie o servidor:

```bash
npm start
```

5. Abra no navegador:

```
http://localhost:3000/index.html
```

### Cadastrar e fazer login

1. Clique em "Criar conta" ou vá para `http://localhost:3000/login.html`
2. Cadastre uma conta com seu email e senha
3. Acesse o dashboard em `http://localhost:3000/dashboard.html`

Todas as contas começam como usuários comuns (`role: user`).

### Configurar primeira conta de administrador

Por motivos de segurança, nenhuma conta é promovida a administrador automaticamente.

Para configurar o primeiro administrador **após fazer deploy em produção**:

1. **Crie uma conta normal** na plataforma com o email desejado para admin
2. **Via banco de dados ou script administrativo**, atualize a role dessa conta:

   **PostgreSQL:**
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'admin@exemplo.com';
   ```

   **SQLite:**
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'admin@exemplo.com';
   ```

3. **No próximo login**, a conta terá acesso ao painel administrativo em:
   ```
   http://localhost:3000/admin
   ```

### Bootstrap seguro (em produção)

Para automatizar a criação do primeiro admin em produção:

1. Crie um script administrativo que:
   - Conecta ao banco de dados
   - Encontra o usuário pelo email em `ADMIN_EMAIL` (variável de ambiente)
   - Atualiza sua role para `admin`

2. Execute esse script **uma única vez** após o deploy

3. Nunca mantenha o `ADMIN_EMAIL` em `.env` permanentemente em produção - defina apenas para bootstrap inicial

**Exemplo com variável de ambiente:**
```bash
# Defina temporariamente para bootstrap
ADMIN_EMAIL=seu-admin@empresa.com npm start
```

## Painel Administrativo

O painel administrativo está disponível em `/admin` (requer role `admin`).

Funcionalidades:
- **Visão Geral**: Estatísticas gerais do sistema (total de usuários, interações da IA, etc)
- **Usuários**: Lista de todos os usuários cadastrados
- **Sistema**: Status de saúde da API e do banco de dados
- **Logs**: Registro de ações administrativas
- **BNCC**: Gerenciamento de conteúdos educacionais

## Sistema de Roles

### User (padrão)
- Acesso ao dashboard
- Uso da central de estudos
- Interação com a mentora IA
- Gerenciamento de sua própria conta

### Admin
- Acesso ao painel administrativo
- Visualização de estatísticas
- Gerenciamento de usuários
- Visualização de logs de auditoria
- Gerenciamento de conteúdos BNCC

## Autenticação e Segurança

- Senhas com hash bcryptjs (10 rounds)
- JWT com expiração de 7 dias
- Cookies HTTP-only
- Rate limiting em endpoints de autenticação
- CORS configurável
- Helmet para headers de segurança

## Proteção de dados (LGPD)

- Exclusão segura de contas de usuários
- Recuperação de senha via token com expiração
- Dados sensíveis nunca são retornados desnecessariamente
- Logs administrativos auditados

## Banco de dados

- PostgreSQL em produção (`DATABASE_URL`)
- SQLite como fallback local (`/.data/synara.db`)

### Tabelas principais
- `users`: Contas de usuários com role
- `admin_logs`: Registro de ações administrativas
- `bncc_items`: Conteúdos da Base Nacional Comum Curricular
- `mentor_events`: Eventos de interação com a mentora IA
- `password_reset_tokens`: Tokens para recuperação de senha
- `user_memories`: Memórias educacionais dos usuários

## Deploy no Render

1. Crie uma conta no Render e conecte seu GitHub.
2. No painel do Render clique em **New → Web Service** e selecione este repositório (`victordeoliveira255-eng/Synara`).
3. Em **Build Command** use: `npm install`
4. Em **Start Command** use: `npm start`
5. Defina as variáveis de ambiente:
   - `OPENAI_API_KEY`: Sua chave da OpenAI (se usar IA)
   - `JWT_SECRET`: String segura para assinar JWTs (gere com `openssl rand -hex 32`)
   - `DATABASE_URL`: URL do PostgreSQL (se usar, caso contrário usa SQLite)
   - `ADMIN_EMAIL`: (opcional) Email para bootstrap do primeiro admin
6. Salve — o Render fará o deploy automático

**Importante:** Nunca coloque valores reais de `JWT_SECRET` ou `ADMIN_EMAIL` no repositório Git. Use apenas as variáveis de ambiente do Render.

## Variáveis de ambiente

```env
# Porta do servidor (padrão: 3000)
PORT=3000

# Ambiente (development ou production)
NODE_ENV=production

# JWT Secret para assinar tokens (generate com: openssl rand -hex 32)
JWT_SECRET=seu-secret-aleatorio-seguro

# URL do banco de dados PostgreSQL (opcional)
DATABASE_URL=

# Chave de API OpenAI (opcional)
OPENAI_API_KEY=

# Email para bootstrap do primeiro admin (opcional)
ADMIN_EMAIL=

# CORS: origens permitidas (separadas por vírgula)
ALLOWED_ORIGINS=https://seu-dominio.com
```

## O que foi implementado

- `server.js`: API Node/Express com autenticação, roles e painel admin
- `auth.js`: Sistema de autenticação frontend
- `dashboard.js` e `dashboard.html`: Central de estudos dos usuários
- `admin.html`: Painel administrativo protegido
- `script.js`: Interface de chat com a mentora IA
- `package.json`: Dependências (Express, PostgreSQL, SQLite, JWT, bcryptjs, OpenAI, etc)
- `.env.example`: Modelo de variáveis de ambiente

## Observações

- Se não houver `OPENAI_API_KEY`, o chat usa respostas de fallback locais
- O sistema suporta múltiplos dispositivos - sessão é global via JWT
- Admin logs registram ações administrativas para auditoria
- A plataforma está otimizada para dispositivos móveis

## Testes

Execute na seção de autenticação para testar:

1. Cadastro com novo email
2. Login com conta criada
3. Logout e novo login
4. Recuperação de senha
5. Exclusão de conta (LGPD)
6. Tentar acessar `/admin` como usuário comum → deve bloquear (403)
7. Com admin, acessar `/admin` → deve funcionar
8. Verificar que endpoints `/api/admin/*` retornam 403 para usuários comuns
