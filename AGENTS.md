# Diretrizes do Repositório — tedi-back

## Estrutura do Projeto e Organização de Módulos

Stack: NestJS 11 + TypeORM 0.3 + PostgreSQL, TypeScript, gerenciado com Yarn. Arquitetura: **monólito modular**, um módulo por área do domínio. A referência completa (mapa de módulos, dependências permitidas, template de módulo, regras de Swagger) está em `docs/ARCHITECTURE.md` — leia antes de criar qualquer módulo.

```text
src/
├── main.ts                 bootstrap (ValidationPipe global + Swagger)
├── app.module.ts           módulo raiz (Config, TypeORM, I18n + módulos de domínio)
├── config/                 (a criar) env validada e tipada
├── database/
│   ├── data-source.ts       DataSource usado pelo Nest e pelo CLI do TypeORM
│   └── migrations/          migrations geradas pelo CLI — não editar migration já rodada
├── shared/                 transversal, sem conhecer domínio
│   ├── pagination/          pagination.util.ts + __tests__/
│   ├── swagger/             swagger.util.ts
│   └── i18n/                módulo nestjs-i18n + locales/{en-US,pt-BR}/common.json
└── modules/                um diretório por módulo de domínio (auth, pessoas, turmas, aulas, ...)
    └── <modulo>/
        ├── <modulo>.module.ts
        ├── controllers/  services/  entities/  dto/  enums/  listeners/
        └── __tests__/       testes do módulo (unitários *.spec.ts e e2e *.e2e.spec.ts)
```

`dist/` é gerado por `nest build` — não editar à mão. Aliases de import: `@config/*`, `@database/*`, `@shared/*`, `@modules/*` (ver `tsconfig.json`). Dentro de um módulo, import relativo; entre módulos, só o `*.module.ts` ou o que ele exporta.

## Comandos de Build, Teste e Desenvolvimento

Use Yarn.

- `yarn install`: instala dependências.
- `yarn dev`: sobe o Nest em watch mode (`nest start --watch`).
- `yarn build`: compila com `nest build` para `dist/`.
- `yarn test`: testes unitários (`*.spec.ts`, sem banco).
- `yarn test:e2e`: testes e2e (`*.e2e.spec.ts`, precisa de Postgres).
- `yarn test:all` / `yarn test:watch` / `yarn test:cov`: tudo, watch, cobertura.
- `yarn lint`: roda o oxlint.
- `yarn format` / `yarn format:check`: roda o oxfmt (aplica ou só verifica).
- `yarn migration:generate src/database/migrations/<NomeDaMigration>`: gera a migration a partir do diff entre entidades e banco local (revisar o arquivo antes de commitar).
- `yarn migration:create src/database/migrations/<NomeDaMigration>`: cria uma migration vazia, para escrever à mão (caminho completo, funciona em qualquer SO).
- `yarn migration:run` / `migration:revert` / `migration:show`: aplica, reverte ou lista migrations (usa `src/database/data-source.ts`).

## Estilo de Código e Convenções de Nomenclatura

- Linter/formatter: oxlint + oxfmt (sem `.oxlintrc.json` próprio — usa config padrão do oxlint).
- TypeScript: `strictNullChecks`, `noImplicitAny`, `strictBindCallApply`, `noFallthroughCasesInSwitch` ativados; decorators habilitados (`experimentalDecorators` + `emitDecoratorMetadata`) para Nest, TypeORM e class-validator funcionarem.
- Nomes de arquivo: kebab-case com sufixo de tipo (`pessoas.controller.ts`, `pessoas.service.ts`, `pessoa.entity.ts`, `criar-pessoa.dto.ts`, `*.spec.ts`, `*.e2e.spec.ts`).
- Nomes de domínio em português, sufixos técnicos em inglês. Classes/DTOs/Entities em PascalCase, seguindo a convenção padrão do Nest.

## Regras do Projeto

- **Módulo é caixa fechada.** Só o que está em `exports` do `@Module` pode ser usado por outro módulo. Nunca importar entidade, repositório ou service interno de outro módulo. Efeito colateral entre módulos usa evento (ver `docs/ARCHITECTURE.md`, seção 3).
- **Entidades** ficam em `src/modules/<modulo>/entities/*.entity.ts`. É esse glob que o `data-source.ts` carrega; entidade fora dele não é registrada.
- Validação de entrada é feita com **class-validator** + **class-transformer**, já plugados globalmente em `main.ts` via `ValidationPipe({ whitelist: true, transform: true })`. Todo DTO novo deve usar decorators do class-validator — não escrever validação manual em controllers/services.
- **Swagger é contrato.** O frontend gera o cliente com Orval a partir do `openapi.json`. Todo controller tem `@ApiTags('<modulo>')`; toda resposta é tipada com DTO de saída (`*.response.dto.ts`), nunca a entidade. Regras completas em `docs/ARCHITECTURE.md`, seção 6.
- i18n é feito via `nestjs-i18n`, com `pt-BR` como locale padrão e `en-US` como fallback (`src/shared/i18n/index.ts`). Toda chave nova de tradução deve ser adicionada nos dois locales em `src/shared/i18n/locales/`.
- Configuração do Swagger é centralizada em `src/shared/swagger/swagger.util.ts` (`setupSwagger`) — não duplicar `DocumentBuilder` em outro lugar.
- Alteração de schema exige migration (`yarn migration:create`) — nunca editar uma migration que já rodou em `develop`/`staging`/`main`; criar uma nova em vez disso.

## Diretrizes de Teste

- **Todo teste fica dentro do módulo que testa**, em `__tests__/`. Não existe pasta `test/` global.
- **Unitários** (`*.spec.ts`): service com repositórios e outros services mockados via `Test.createTestingModule`. Não precisam de banco.
- **E2E** (`*.e2e.spec.ts`): sobe o módulo em teste (+ `auth` se a rota é protegida) com Postgres real e testa por HTTP com `supertest`. É o vocabulário do NestJS: "e2e" aqui é HTTP até o banco, não navegador. Não há e2e de navegador no projeto. Precisam de Postgres (no CI é um serviço `postgres:16-alpine`).
- **Fluxo entre módulos**: testado no módulo que **reage** ao evento (ex.: `horas/__tests__/presenca-gera-horas.e2e.spec.ts`).
- Teste e2e importa apenas o `*.module.ts` dos módulos envolvidos. Fixtures são do módulo (`__tests__/fixtures/`).
- Cada teste e2e limpa as tabelas que tocou.

### Restrições de Execução para Agentes

- Ao iterar, rode apenas o spec do arquivo alterado (`yarn test <caminho-do-spec>`); rode a suíte completa (`yarn test`) antes de abrir o PR.
- Testes e2e assumem um Postgres real (como no CI) — não assumir que rodam sem banco disponível.
- Rode migrations pendentes (`yarn migration:run`) antes de rodar `yarn test:e2e` localmente, como o CI faz.

## Diretrizes de Commit e Pull Request

- Fluxo de branches: `feature/* → develop → staging → main`. O CI (`.github/workflows/ci.yml`) roda em push/PR para `main`, `staging` e `develop` em jobs paralelos: **quality** (lint, format:check, typecheck), **unit** (`yarn test:cov`, sem banco), **e2e** (Postgres → migration:run → `yarn test:e2e`), **schema-drift** (migrations num banco limpo + `migration:generate` deve não gerar nada) e **build** (depende dos quatro). O `docker.yml` só roda em push para `main`.
- Antes de abrir PR, rodar localmente: `yarn lint`, `yarn format:check`, `yarn typecheck`, `yarn test`, `yarn build`; com o Postgres do compose de pé, `yarn test:e2e`.
- Usar o template em `.github/pull_request_template.md` (em português): Resumo, Impacto funcional, Migração (indicar se houve/foi necessário rodar), Validações (checklist de lint/format/test/build), Observações.

## Dicas de Segurança e Configuração

- Não commitar `.env`. Usar `.env.example` como referência. Local: `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE`. Produção: `DATABASE_URL` (tem prioridade), `DB_SSL`, `CORS_ORIGINS`. Variável nova entra também em `render.yaml` e em `docs/DEPLOY.md`.
- Deploy: Neon (Postgres) + Render (API, blueprint em `render.yaml`, migrations rodam no `yarn start:prod`). Passo a passo e limites do plano free em `docs/DEPLOY.md`. `GET /health` é o health check da plataforma.
- Desenvolvimento local: `docker compose up -d` sobe só o Postgres (`docker-compose.yml`, credenciais `tedi`/`tedi`, porta 5432); a API roda fora do container com `yarn dev` para manter hot reload. `docker compose down -v` apaga os dados.

## Artefatos do Agente

Use `AGENTS.md` como ponto de entrada compartilhado para todos os agentes de IA.
Mantenha os arquivos do agente em `.agents/` e evite diretórios específicos de fornecedor.

- Conhecimento persistente (versionado) → `.agents/memory/`.
- Prompts reutilizáveis (versionado) → `.agents/prompts/`.
- Artefatos temporários (não versionado) → `.agents/artifacts/`.
- Não crie artefatos markdown na raiz do repositório, a menos que explicitamente solicitado. Documentação de arquitetura vai em `docs/`.
