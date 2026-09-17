# Arquitetura — tedi-back

Monólito modular em NestJS. Um módulo por área do domínio, espelhando os épicos do plano de produto (Linear). Este documento é a referência de **onde cada coisa mora** e **quem pode depender de quem**.

## 1. Princípios

1. **Um módulo por área do domínio.** Quem lê o Linear encontra a pasta correspondente em `src/modules/`.
2. **Módulo é uma caixa fechada.** Só o que está em `exports` do `@Module` pode ser usado por outro módulo. Nunca importar entidade, repositório ou service interno de outro módulo.
3. **Comunicação entre módulos por service exportado ou por evento.** Efeito colateral entre áreas diferentes (ex.: presença confirmada gera horas) usa evento, não chamada direta.
4. **`shared/` só recebe o que é transversal** e não conhece domínio nenhum: paginação, base entity, guards, filtros, i18n, swagger.
5. **Nomes de domínio em português, sufixos técnicos em inglês.** `pessoas.controller.ts`, `turmas.service.ts`, `aula.entity.ts`.
6. **Testes vivem dentro do módulo.** Não existe pasta `test/` global.

## 2. Mapa de módulos

| Módulo         | Épico   | Conteúdo                                                                                            |
| -------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `auth`         | E9      | Login, sessão JWT, perfis, guards, gestão de usuários                                               |
| `pessoas`      | E1      | Pessoa, Membro, Aluno, busca, duplicidade, inativação                                               |
| `importacao`   | E2      | Upload CSV/XLSX, mapeamento de colunas, pré-visualização, fila de pré-inscrição, formulário público |
| `turmas`       | E3      | Edição, Turma, Matrícula                                                                            |
| `aulas`        | E4, E10 | Aula, geração em série, status, calendário, catálogo de conteúdo                                    |
| `alocacoes`    | E5      | Candidatura, alocação, cobertura, agenda do membro                                                  |
| `presencas`    | E6      | Chamada de alunos, presença de membros, frequência                                                  |
| `horas`        | E7      | Lançamento de horas, validação, extrato, consolidado                                                |
| `relatorios`   | E8      | Relatórios, PDF, exportações                                                                        |
| `auditoria`    | E9      | Log de auditoria, consentimento LGPD, anonimização                                                  |
| `notificacoes` | E11     | Só se for priorizado                                                                                |

## 3. Dependências permitidas

```
auth       ← todos (para guards). auth não depende de ninguém.
pessoas    ← turmas, alocacoes, horas, importacao
turmas     ← aulas, presencas
aulas      ← alocacoes, presencas
alocacoes  ← presencas
presencas  ──evento──▶ horas        (PresencaMembroConfirmada / PresencaMembroRevertida)
horas      ← relatorios
auditoria  ← ninguém importa. Ouve eventos (AcaoAuditavel) de qualquer módulo.
```

A seta só aponta "para baixo". `horas` nunca importa `presencas`; se precisa reagir a algo de lá, escuta o evento.

## 4. Estrutura de pastas

```
src/
├── main.ts
├── app.module.ts                    # importa Config, TypeORM, I18n e os módulos de domínio
│
├── config/                          # (próximo passo) env validada e tipada
│
├── database/
│   ├── data-source.ts               # DataSource usado pelo Nest e pelo CLI do TypeORM
│   ├── migrations/                  # geradas pelo CLI; nunca editar migration já rodada
│   └── seeds/                       # (próximo passo) dados de desenvolvimento
│
├── shared/                          # transversal, sem conhecer domínio
│   ├── pagination/
│   │   ├── pagination.util.ts
│   │   └── __tests__/pagination.util.spec.ts
│   ├── swagger/swagger.util.ts
│   ├── i18n/                        # módulo nestjs-i18n + locales/{pt-BR,en-US}
│   ├── entities/base.entity.ts      # (próximo passo) id, createdAt, updatedAt, deletedAt
│   ├── filters/                     # (próximo passo) HttpExceptionFilter → ErroApiDto
│   ├── interceptors/                # (próximo passo) logging
│   ├── decorators/                  # (próximo passo) @CurrentUser(), @Roles()
│   ├── guards/                      # (próximo passo) RolesGuard
│   ├── events/                      # (próximo passo) eventos de domínio compartilhados
│   └── health/                      # (próximo passo) GET /health
│
└── modules/
    └── <modulo>/                    # ver template abaixo
```

### 4.1 Template de um módulo

```
modules/pessoas/
├── pessoas.module.ts                # único *.module.ts; declara imports, providers, exports
├── controllers/
│   ├── pessoas.controller.ts        # @ApiTags('pessoas'); só traduz HTTP → service
│   └── membros.controller.ts
├── services/
│   ├── pessoas.service.ts           # regras de negócio; usa repositórios TypeORM injetados
│   └── duplicidade.service.ts
├── entities/
│   ├── pessoa.entity.ts             # *.entity.ts é o que o DataSource carrega
│   └── membro.entity.ts
├── dto/
│   ├── criar-pessoa.dto.ts          # entrada: class-validator
│   └── pessoa.response.dto.ts       # saída: nunca devolver entidade
├── enums/
├── listeners/                       # se o módulo reage a eventos de outros
└── __tests__/
    ├── pessoas.service.spec.ts      # unitário (sem banco)
    ├── pessoas.controller.e2e.spec.ts   # e2e (Postgres real)
    └── fixtures/
```

Regras:

- `controllers/` sem regra de negócio. `services/` sem `@Res()`/`@Req()`.
- `entities/` pertence ao módulo. Outro módulo que precisa dos dados chama o service exportado.
- Eventos compartilhados vivem em `shared/events/` como classes com payload tipado, publicados via `@nestjs/event-emitter`.
- Registrar o módulo em `app.module.ts`.

## 5. Testes

| Tipo                | Sufixo          | Onde                                                | Banco | Cobre                                                                                                  |
| ------------------- | --------------- | --------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| Unitário            | `*.spec.ts`     | `modules/<m>/__tests__/` ou `shared/<x>/__tests__/` | Não   | Regras do service com repositórios e outros services mockados (`Test.createTestingModule`)             |
| E2E                 | `*.e2e.spec.ts` | `modules/<m>/__tests__/`                            | Sim   | Controller até o banco, subindo só o módulo em teste (+ `auth` se a rota é protegida), com `supertest` |
| Fluxo entre módulos | `*.e2e.spec.ts` | módulo que **reage** ao evento                      | Sim   | Ex.: `horas/__tests__/presenca-gera-horas.e2e.spec.ts`                                                 |

- `yarn test` roda só unitários (rápido, sem banco).
- `yarn test:e2e` roda só os `*.e2e.spec.ts`, em série, contra o Postgres do ambiente.
- `yarn test:all` roda tudo.
- Teste de integração importa apenas o `*.module.ts` dos módulos envolvidos. Nunca arquivos internos de outro módulo.
- Fixtures são do módulo. Se dois módulos precisam do mesmo dado, o módulo dono exporta uma função; nada vai para `shared/`.
- Cada teste de integração limpa as tabelas que tocou.

## 6. Swagger como contrato

O frontend gera o cliente HTTP com **Orval** a partir do `openapi.json` desta API. O que a API não descreve, o front não tem. Regras por endpoint:

| Regra                                                                            | Como                                                                      |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `operationId` = nome do método (`listarPessoas`, não `PessoasController_listar`) | `operationIdFactory` em `shared/swagger/` (próximo passo)                 |
| `@ApiTags('<modulo>')` no controller, um tag por módulo                          | Tag igual ao nome da pasta em `modules/`. O Orval gera um arquivo por tag |
| Toda resposta tipada (`@ApiOkResponse({ type })`, `@ApiCreatedResponse`...)      | Sem isso o Orval gera `unknown`                                           |
| Resposta paginada com `@ApiOkResponsePaginated(Dto)`                             | Decorator em `shared/pagination/` (próximo passo)                         |
| DTO de saída explícito (`*.response.dto.ts`), nunca a entidade                   | Entidade expõe coluna interna e quebra contrato a cada migration          |
| Enums de TS exportados e anotados com `@ApiProperty({ enum })`                   | Orval gera o union type                                                   |
| Erro sempre no formato `ErroApiDto`                                              | Emitido pelo `HttpExceptionFilter` (próximo passo)                        |

`yarn openapi:export` gera `docs/openapi.json` sem subir a API; `yarn openapi:check` falha no CI se o arquivo estiver desatualizado (próximo passo).

## 7. Aliases de import

| Alias         | Aponta para      |
| ------------- | ---------------- |
| `@config/*`   | `src/config/*`   |
| `@database/*` | `src/database/*` |
| `@shared/*`   | `src/shared/*`   |
| `@modules/*`  | `src/modules/*`  |

Dentro de um módulo, usar import relativo. Entre módulos, usar `@modules/<m>` e importar **só** o `*.module.ts` ou o que ele exporta.

## 8. Próximos passos previstos

Fora do escopo deste PR, na ordem sugerida:

1. `config/` com validação de env (Zod ou Joi).
2. `shared/entities/base.entity.ts`, `HttpExceptionFilter` + `ErroApiDto`, `LoggingInterceptor`, `enableCors`, `helmet`, `GET /health`; apontar o healthcheck do Docker para `/health`.
3. `docker-compose.yml` com Postgres para desenvolvimento local.
4. `@nestjs/event-emitter` e `shared/events/` com os primeiros eventos.
5. Swagger para Orval: `operationIdFactory`, `@ApiOkResponsePaginated`, `scripts/export-openapi.ts`, `openapi:export`/`openapi:check`.
6. Módulo `auth`, depois `auditoria`, depois `pessoas` como referência para os demais.
7. `dependency-cruiser` no CI para falhar quando um módulo importar interno de outro.
