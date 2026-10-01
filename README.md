# tedi-back

API do TEDI — sistema de gestão do projeto de extensão (pessoas, turmas, aulas, alocação de voluntários e banco de horas).

Stack: NestJS 11 + TypeORM 0.3 + PostgreSQL 16, TypeScript, Yarn 1.

## Rodando localmente

Pré-requisitos: **Node 22+**, **Yarn 1** (`corepack enable` ou `npm i -g yarn`) e **Docker Desktop** aberto.

```bash
git clone https://github.com/projetotedi/tedi-back.git
cd tedi-back

docker compose up -d        # 1. Postgres 16 em localhost:5432 (usuário, senha e banco: tedi)
cp .env.example .env        # 2. já aponta para esse Postgres
yarn install                # 3. dependências
yarn migration:run          # 4. cria/atualiza as tabelas
yarn dev                    # 5. API em http://localhost:3000, com hot reload
```

> **JWT_SECRET obrigatório:** o guard de autenticação falha no boot se `JWT_SECRET` não estiver definido.
> Para desenvolvimento, adicione `JWT_SECRET=dev` ao seu `.env` (o `.env.example` já tem a chave).
> Em produção, gere um valor aleatório seguro (ex.: `openssl rand -hex 32`).

Confira se está tudo de pé:

- http://localhost:3000/health → `{"status":"ok","database":"up",...}`
- http://localhost:3000/api/docs → Swagger

O front (`tedi-front`) em `yarn dev` na porta 5173 já é aceito pelo CORS sem configurar nada.

### Banco de dados local

| Ação                    | Comando                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| Subir                   | `docker compose up -d`                                            |
| Ver status              | `docker compose ps`                                               |
| Parar (mantém os dados) | `docker compose down`                                             |
| Parar e apagar os dados | `docker compose down -v`                                          |
| Abrir um `psql`         | `docker exec -it tedi-postgres psql -U tedi -d tedi`              |
| Porta 5432 ocupada      | `DB_PORT=5433 docker compose up -d` e ajustar `DB_PORT` no `.env` |

Para conectar com Beekeeper, DBeaver ou similar: host `localhost`, porta `5432`, usuário `tedi`, senha `tedi`, banco `tedi`, sem SSL.

A API roda **fora** do container, direto no Node, para manter o hot reload. O `Dockerfile` da raiz é a imagem de produção, não é usado no dia a dia.

## Migrations

O schema do banco é versionado por migrations do TypeORM em `src/database/migrations/`. O `synchronize` está desligado e deve continuar assim: a única forma de alterar o banco é por migration.

### Fluxo do dia a dia

1. Crie ou altere a entidade em `src/modules/<modulo>/entities/*.entity.ts`.
2. Gere a migration a partir da diferença entre as entidades e o banco local:

   ```bash
   yarn migration:generate src/database/migrations/CriarPessoas
   ```

   O TypeORM adiciona o timestamp ao nome e escreve `up` e `down` em SQL. **Abra o arquivo e revise**: às vezes o diff recria um índice ou altera um tipo por diferença irrelevante.

3. Aplique:

   ```bash
   yarn migration:run
   ```

4. Rode os testes e2e, que usam o banco local: `yarn test:e2e`.
5. Commite a entidade **e** a migration no mesmo PR, com a label `Migration` e a seção "Migração" do template preenchida.

### Migration escrita à mão

Para migração de dados, índices que a entidade não expressa ou SQL que você prefere controlar:

```bash
yarn migration:create src/database/migrations/PopularCategoriasDeHora
```

O arquivo nasce vazio, com `up` e `down` para preencher usando o `queryRunner` (`createTable`, `addColumn`, `createIndex`, `createForeignKey` ou `query("SQL")`).

### Comandos

| Comando                                  | O que faz                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `yarn migration:generate <caminho/Nome>` | gera a migration a partir das entidades (precisa do banco local de pé)   |
| `yarn migration:create <caminho/Nome>`   | cria uma migration vazia                                                 |
| `yarn migration:run`                     | aplica as pendentes                                                      |
| `yarn migration:show`                    | lista aplicadas (`[X]`) e pendentes (`[ ]`)                              |
| `yarn migration:revert`                  | desfaz a **última** aplicada (roda o `down`)                             |
| `yarn migration:run:prod`                | aplica a partir de `dist/`; é o que roda em produção, não use localmente |

O caminho é sempre `src/database/migrations/<NomeEmPascalCase>`; o TypeORM completa com o timestamp.

### Regras

- **Nunca edite uma migration que já rodou** em `develop`, `staging` ou `main`. Crie outra que corrija.
- Toda migration precisa de `down` funcional. É ele que o `revert` executa.
- Entidade só é enxergada se estiver em `src/modules/**/*.entity.ts`. Fora desse caminho o `generate` não a vê e a tabela não nasce.
- As pendentes rodam em **uma única transação**: se a terceira falhar, as duas anteriores são desfeitas junto.
- Para testar uma migration do zero: `docker compose down -v && docker compose up -d && yarn migration:run`.

### Em produção

Não há passo manual. O `yarn start:prod`, usado pelo Render e pelo `Dockerfile`, executa `migration:run:prod` antes de subir a API. Se uma migration falhar, o deploy falha e o log mostra o erro. Detalhes, incluindo como reverter em produção, em [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Contrato OpenAPI

O arquivo `docs/openapi.json` é o contrato que o `tedi-front` consome com **Orval** para gerar hooks tipados (`useCheck`, `useLogin`, etc.).

| Comando               | O que faz                                                                      |
| --------------------- | ------------------------------------------------------------------------------ |
| `yarn openapi:export` | gera `docs/openapi.json` sem subir servidor nem precisar de banco              |
| `yarn openapi:check`  | falha (exit 1) se o arquivo commitado divergir do que `openapi:export` geraria |

`openapi:check` roda no CI (job `qualidade`). Se você alterar um DTO ou controller, rode `yarn openapi:export` e inclua `docs/openapi.json` no commit.

> **Nota:** após um rebase, sempre rode `yarn openapi:export` antes do merge para evitar conflito no `openapi.json`.

## Comandos do dia a dia

| Comando                                           | O que faz                                      |
| ------------------------------------------------- | ---------------------------------------------- |
| `yarn dev`                                        | sobe a API em watch mode                       |
| `yarn test`                                       | testes unitários (sem banco)                   |
| `yarn test:e2e`                                   | testes e2e (HTTP + Postgres, precisa do banco) |
| `yarn test:all`                                   | os dois                                        |
| `yarn lint` / `yarn format` / `yarn format:check` | qualidade                                      |
| `yarn build`                                      | compila para `dist/`                           |

Antes de abrir PR: `yarn lint && yarn format:check && yarn typecheck && yarn test && yarn build && yarn openapi:check`, e `yarn test:e2e` com o Postgres do compose de pé. É o que o CI roda.

## Arquitetura

Monólito modular: um módulo por área do domínio em `src/modules/`, transversal em `src/shared/`. Mapa de módulos, dependências permitidas, template de módulo e regras de teste e de Swagger em [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Convenções para quem contribui (humano ou agente) em [`AGENTS.md`](AGENTS.md). Deploy (Neon + Render) em [`docs/DEPLOY.md`](docs/DEPLOY.md).
