# Deploy — tedi-back

Ambiente de **testes no ar** com custo zero: banco no **Neon** (Postgres gerenciado), API no **Render** (plano free), front no **Vercel** (ver `docs/DEPLOY.md` do `tedi-front`). Deploy automático a cada push em `main`.

> **Aviso sobre dados reais.** Nenhum plano gratuito hospeda no Brasil. Enquanto o ambiente servir para a equipe testar com dados fictícios, tudo bem. Antes de cadastrar participantes reais, o RNF-16 (dados em território nacional) e a LGPD exigem decidir a hospedagem definitiva (Q8.1): infraestrutura da universidade ou provedor pago com região em São Paulo.

## 1. Banco: Neon

1. Criar conta em https://neon.tech (login com GitHub). Plano **Free**: 0,5 GB de armazenamento, o banco hiberna sem uso e acorda em menos de 1 s.
2. **New project** → nome `tedi`, Postgres 16, região **AWS US East (Ohio)** (a mais próxima do Render Oregon entre as gratuitas; não há Brasil no free).
3. Em **Connection details**, escolher **Pooled connection** desligado (a API usa conexão direta com TypeORM) e copiar a string. Formato:
   ```
   postgresql://<usuario>:<senha>@<host>.neon.tech/neondb?sslmode=require
   ```
4. Guardar como `DATABASE_URL`. Não commitar.

Alternativa gratuita se o Neon não servir: **Aiven for PostgreSQL** (plano free, 1 vCPU, 5 GB). Mesmo formato de `DATABASE_URL`, SSL obrigatório.

## 2. API: Render

1. Criar conta em https://render.com (login com GitHub) e autorizar a organização `projetotedi`.
2. **New → Blueprint** → selecionar `projetotedi/tedi-back`. O Render lê o `render.yaml` da raiz.
3. Preencher as variáveis pedidas:
   - `DATABASE_URL`: a string do Neon.
   - `CORS_ORIGINS`: `https://tedi-front.vercel.app,https://*.vercel.app` (ajustar ao domínio real do front; o curinga cobre os previews de PR do Vercel).
4. **Apply**. O primeiro deploy roda `yarn install && yarn build`, depois `yarn start:prod`, que aplica as migrations pendentes e sobe a API.
5. Conferir: `https://tedi-back.onrender.com/health` deve responder `{"status":"ok","database":"up",...}` e `https://tedi-back.onrender.com/api/docs` deve abrir o Swagger.

O que o plano free implica:

- **Hibernação** após 15 minutos sem requisições. O primeiro acesso depois disso leva de 30 a 60 segundos. O front deve tolerar isso (mensagem de "acordando o servidor" é melhor que erro).
- **750 horas/mês** de instância, o suficiente para um serviço.
- Sem **pre-deploy command**, por isso as migrations rodam no `startCommand`. Se uma migration falhar, o serviço não sobe e o log mostra o erro.
- Sem **preview environments**. Toda validação de PR acontece no CI; o ambiente reflete só a `main`.

## 3. Variáveis de ambiente

| Variável         | Onde            | Valor                                                        |
| ---------------- | --------------- | ------------------------------------------------------------ |
| `DATABASE_URL`   | Render (secret) | string do Neon                                               |
| `DB_SSL`         | Render          | `true` (já no blueprint)                                     |
| `CORS_ORIGINS`   | Render (secret) | domínios do front, separados por vírgula                     |
| `JWT_SECRET`     | Render (secret) | string aleatória segura (`openssl rand -base64 48`)          |
| `ADMIN_RA`       | Render (secret) | RA da coordenadora inicial (ex.: `a1234567`)                 |
| `ADMIN_NAME`     | Render (secret) | nome completo da coordenadora inicial                        |
| `ADMIN_EMAIL`    | Render (secret) | e-mail da coordenadora inicial                               |
| `ADMIN_PASSWORD` | Render (secret) | senha inicial (mín. 8 chars); trocar após o primeiro login   |
| `APP_URL`        | Render (secret) | URL base do front-end (ex.: `https://tedi-front.vercel.app`) |
| `NODE_ENV`       | Render          | `production` (já no blueprint)                               |
| `NODE_VERSION`   | Render          | `22.12.0` (já no blueprint)                                  |
| `PORT`           | Render define   | não configurar                                               |

> **`APP_URL` antes do deploy:** se não configurada, o campo `url` retornado por `POST /invites`
> fica com valor errado. Configure antes do primeiro deploy que usará o endpoint de convite.

Ao adicionar uma variável nova no código: `.env.example`, `render.yaml` (com `sync: false` se for segredo) e esta tabela.

## 4. Cadeia de boot em produção

`yarn start:prod` executa a seguinte sequência antes de iniciar a API:

```
migration:run:prod   → aplica migrations pendentes (TypeORM)
seed:prod            → cria a coordenadora inicial (idempotente: no-op se já existe)
node dist/main.js    → sobe a API
```

O mesmo vale para o `Dockerfile` (que chama `node` diretamente, sem `yarn`).

- **Migrations:** TypeORM lê `dist/database/data-source.js`. Para inspecionar no Render Shell:
  `node ./node_modules/typeorm/cli.js migration:show -d ./dist/database/data-source.js`
- **Seed idempotente:** o seed verifica a existência do RA antes de criar. Rodar 2× não duplica.
- **Reverter migration:** `node ./node_modules/typeorm/cli.js migration:revert -d ./dist/database/data-source.js`. Nunca editar migration já aplicada.

## 5. Rodando o build de produção localmente

```bash
yarn build
DATABASE_URL=postgresql://tedi:tedi@localhost:5432/tedi DB_SSL=false CORS_ORIGINS=http://localhost:5173 yarn start:prod
```

## 6. Docker (outros provedores)

O `Dockerfile` continua válido para qualquer host com Docker (Koyeb, Fly, VPS da universidade). O `CMD` já roda as migrations antes de subir e o healthcheck aponta para `/health`. Variáveis iguais às da tabela acima.

## 7. Quando sair do free

Sinais: hibernação incomodando nas aulas, banco perto de 0,5 GB, ou entrada de dados reais. Caminhos, em ordem de esforço: Render Starter (sem hibernação) mantendo o Neon; ou VPS/infra da universidade com `docker compose` e Postgres local, que também resolve a residência dos dados.
