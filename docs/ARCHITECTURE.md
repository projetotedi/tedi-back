# Arquitetura — tedi-back

Monólito modular em NestJS. Um módulo por área do domínio, espelhando os épicos do plano de produto (Linear). Este documento é a referência de **onde cada coisa mora** e **quem pode depender de quem**.

## 1. Princípios

1. **Um módulo por área do domínio.** Quem lê o Linear encontra a pasta correspondente em `src/modules/`.
2. **Módulo é uma caixa fechada.** Só o que está em `exports` do `@Module` pode ser usado por outro módulo. Nunca importar entidade, repositório ou service interno de outro módulo.
3. **Comunicação entre módulos por service exportado ou por evento.** Efeito colateral entre áreas diferentes (ex.: presença confirmada gera horas) usa evento, não chamada direta.
4. **`shared/` só recebe o que é transversal** e não conhece domínio nenhum: paginação, base entity, guards, filtros, swagger. Sem i18n no backend — mensagens em inglês literal, tradução é responsabilidade do front.
5. **Todo código em inglês** (decisão 35 da E9.a). Módulos, entidades, colunas, enums, DTOs, métodos e nomes de teste: `people.controller.ts`, `classes.service.ts`, `lesson.entity.ts`. Documentação, mensagens de commit e template de PR seguem em pt-BR.
6. **Testes vivem dentro do módulo.** Não existe pasta `test/` global.
7. **Toda entidade estende `BaseEntity` (`src/shared/entities/base.entity.ts`)**, que já traz `id` UUID v7 gerado no app, `createdAt`, `updatedAt` e `deletedAt` (soft delete).

## 2. Mapa de módulos

| Módulo          | Épico   | Conteúdo                                                                                            |
| --------------- | ------- | --------------------------------------------------------------------------------------------------- |
| `auth`          | E9      | Login, sessão (cookie httpOnly + JWT), guard global, convites por link, gestão de acessos           |
| `people`        | E1      | `Person` (com credenciais e perfil), membro, aluno, busca, duplicidade, inativação                  |
| `imports`       | E2      | Upload CSV/XLSX, mapeamento de colunas, pré-visualização, fila de pré-inscrição, formulário público |
| `classes`       | E3      | Edição, turma, matrícula                                                                            |
| `lessons`       | E4, E10 | Aula, geração em série, status, calendário, catálogo de conteúdo                                    |
| `assignments`   | E5      | Candidatura, alocação, cobertura, agenda do membro                                                  |
| `attendance`    | E6      | Chamada de alunos, presença de membros, frequência                                                  |
| `hours`         | E7      | Lançamento de horas, validação, extrato, consolidado                                                |
| `reports`       | E8      | Relatórios, PDF, exportações                                                                        |
| `audit`         | E9      | Log de auditoria, consentimento LGPD, anonimização                                                  |
| `notifications` | E11     | Só se for priorizado                                                                                |

Login, perfil e flags de acesso são colunas de `Person`, sem entidade de usuário separada (decisões 1 e 6). Convite e redefinição de senha são links de uso único gerados pelo sistema, que a coordenadora repassa; o MVP não tem provedor de e-mail (decisões 31 a 34).

## 3. Dependências permitidas

```
auth       → people   (o guard carrega a Person do banco a cada request)
people       ← classes, assignments, hours, imports
classes      ← lessons, attendance
lessons      ← assignments, attendance
assignments  ← attendance
attendance   ──evento──▶ hours        (MemberAttendanceConfirmed / MemberAttendanceReverted)
hours        ← reports
audit        ← ninguém importa. Ouve eventos (AuditableActionEvent) de qualquer módulo.
```

A seta só aponta "para baixo". `hours` nunca importa `attendance`; se precisa reagir a algo de lá, escuta o evento.

**Regra do AuthModule (decisão 6):** `auth` importa `PeopleModule`, e nenhum outro módulo importa `AuthModule`. O guard é global (registrado como `APP_GUARD`) e protege todos os endpoints automaticamente. Se um módulo precisar de funcionalidade de `auth`, a solução é exportar o necessário do módulo que detém a informação (ex.: `PeopleModule` exporta `PeopleService`), não importar `AuthModule`.

## 4. Estrutura de pastas

```
src/
├── main.ts
├── app.module.ts                    # importa Config, TypeORM, AuthModule e os módulos de domínio; registra APP_FILTER global
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
│   ├── entities/base.entity.ts      # id (UUID v7), createdAt, updatedAt, deletedAt
│   ├── enums/
│   │   └── role.enum.ts             # enum Role + roleSatisfies()
│   ├── decorators/
│   │   ├── auth-user.type.ts        # interface AuthUser { id, role, accessEnabled }
│   │   ├── roles.decorator.ts       # @Roles(minRole) — metadata key 'auth:roles'
│   │   ├── public.decorator.ts      # @Public() — metadata key 'auth:public'
│   │   └── current-user.decorator.ts # @CurrentUser() — extrai AuthUser do request
│   ├── filters/                     # HttpExceptionFilter global → ApiErrorDto
│   ├── interceptors/                # (próximo passo) logging
│   ├── events/                      # eventos compartilhados (auditable-action.event.ts)
│   └── health/                      # GET /health (marcado com @Public())
│
└── modules/
    └── <modulo>/                    # ver template abaixo
```

### 4.1 Template de um módulo

```
modules/people/
├── people.module.ts                 # único *.module.ts; declara imports, providers, exports
├── controllers/
│   ├── people.controller.ts         # @ApiTags('people'); @Roles/@Public por endpoint; só traduz HTTP → service
│   └── members.controller.ts
├── services/
│   ├── people.service.ts            # regras de negócio; usa repositórios TypeORM injetados
│   └── duplicates.service.ts
├── entities/
│   ├── person.entity.ts             # *.entity.ts é o que o DataSource carrega
│   └── member.entity.ts
├── dto/
│   ├── create-person.dto.ts         # entrada: class-validator
│   └── person.response.dto.ts       # saída: nunca devolver entidade
├── enums/
├── listeners/                       # se o módulo reage a eventos de outros
└── __tests__/
    ├── people.service.spec.ts       # unitário (sem banco)
    ├── people.controller.e2e.spec.ts    # e2e (HTTP + Postgres real)
    └── fixtures/
```

Controller de exemplo, com o contrato de autorização (seção 9):

```ts
import { Roles } from "@shared/decorators/roles.decorator";
import { Public } from "@shared/decorators/public.decorator";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Role } from "@shared/enums/role.enum";

@ApiTags("people")
@Controller("people")
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get()
  @Roles(Role.DIRECTOR) // director, coordinator ou superadmin
  listPeople(@Query() query: ListPeopleQueryDto) {
    return this.peopleService.list(query);
  }

  @Post()
  @Roles(Role.COORDINATOR)
  createPerson(@Body() dto: CreatePersonDto, @CurrentUser() user: AuthUser) {
    return this.peopleService.create(dto, user);
  }

  @Get("public-form")
  @Public() // sem cookie
  getPublicForm() {
    return this.peopleService.publicForm();
  }
}
```

Regras:

- `controllers/` sem regra de negócio. `services/` sem `@Res()`/`@Req()`.
- `entities/` pertence ao módulo. Outro módulo que precisa dos dados chama o service exportado.
- Eventos compartilhados vivem em `shared/events/` como classes com payload tipado, publicados via `@nestjs/event-emitter`.
- Registrar o módulo em `app.module.ts`.
- **Módulo protegido não importa `AuthModule`.** O guard é global; anotar os endpoints com `@Roles()` ou `@Public()` de `shared/decorators/` é suficiente. Se o módulo precisar do usuário logado, use o parâmetro decorado com `@CurrentUser()`.

## 5. Testes

| Tipo                                                                                                                                                                                                                                                                                                                                                                                                                                            | Sufixo          | Onde                                                | Banco | Cobre                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | --------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------ |
| Unitário                                                                                                                                                                                                                                                                                                                                                                                                                                        | `*.spec.ts`     | `modules/<m>/__tests__/` ou `shared/<x>/__tests__/` | Não   | Regras do service com repositórios e outros services mockados (`Test.createTestingModule`)             |
| E2E                                                                                                                                                                                                                                                                                                                                                                                                                                             | `*.e2e.spec.ts` | `modules/<m>/__tests__/`                            | Sim   | Controller até o banco, subindo só o módulo em teste (+ `auth` se a rota é protegida), com `supertest` |
| Fluxo entre módulos                                                                                                                                                                                                                                                                                                                                                                                                                             | `*.e2e.spec.ts` | módulo que **reage** ao evento                      | Sim   | Ex.: `hours/__tests__/attendance-creates-hours.e2e.spec.ts`                                            |
| **O que "e2e" significa aqui.** É o vocabulário do NestJS: o teste sobe o módulo (ou a aplicação) com Postgres real e exercita por HTTP com `supertest`, do controller ao banco. Não existe e2e de navegador no projeto; o front tem só unitários. A pergunta que cada tipo responde: unitário, "a regra está certa?"; e2e, "o endpoint funciona com o banco?"; smoke, "está de pé?" (coberto pelo health check do deploy e pelo teste abaixo). |

**Exceção única à regra "teste mora no módulo":** `src/__tests__/app.e2e.spec.ts` sobe o `AppModule` inteiro e chama `/health`. O objeto dele é a montagem da aplicação, não um módulo: pega módulo esquecido no `AppModule` e configuração global quebrada.

- `yarn test` roda só unitários (rápido, sem banco).
- `yarn test:e2e` roda só os `*.e2e.spec.ts`, em série, contra o Postgres do ambiente.
- `yarn test:all` roda tudo.
- Teste e2e importa apenas o `*.module.ts` dos módulos envolvidos. Nunca arquivos internos de outro módulo.
- Fixtures são do módulo. Se dois módulos precisam do mesmo dado, o módulo dono exporta uma função; nada vai para `shared/`.
- Cada teste e2e limpa as tabelas que tocou.

## 6. Swagger como contrato

O frontend gera o cliente HTTP com **Orval** a partir do `openapi.json` desta API. O que a API não descreve, o front não tem. Regras por endpoint:

| Regra                                                                       | Como                                                                                                      |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `operationId` = nome do método (`listPeople`, não `PeopleController_list`)  | `operationIdFactory: (_c, m) => m` em `shared/swagger/swagger.util.ts` (implementado em GUS-77)           |
| `@ApiTags('<modulo>')` no controller, um tag por módulo                     | Tag igual ao nome da pasta em `modules/`. O Orval gera um arquivo por tag                                 |
| Toda resposta tipada (`@ApiOkResponse({ type })`, `@ApiCreatedResponse`...) | Sem isso o Orval gera `unknown`                                                                           |
| Resposta paginada com `@ApiOkResponsePaginated(Dto)`                        | Decorator em `shared/pagination/` (próximo passo)                                                         |
| DTO de saída explícito (`*.response.dto.ts`), nunca a entidade              | Entidade expõe coluna interna e quebra contrato a cada migration                                          |
| Enums de TS exportados e anotados com `@ApiProperty({ enum })`              | Orval gera o union type                                                                                   |
| Erro sempre no formato `ApiErrorDto`                                        | Emitido pelo `HttpExceptionFilter` global; mensagens em inglês literal (front traduz pelo código `error`) |

`yarn openapi:export` gera `docs/openapi.json` sem subir a API; `yarn openapi:check` falha no CI se o arquivo estiver desatualizado (implementado em GUS-77).

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
2. `LoggingInterceptor` em `shared/interceptors/`.
3. ~~`@nestjs/event-emitter` e `shared/events/` com os primeiros eventos.~~ (`AuditableActionEvent` entregue na E9.a; persistência fica para E9.b).
4. ~~Swagger para Orval: `operationIdFactory`, `scripts/export-openapi.ts`, `openapi:export`/`openapi:check`~~ (entregue em GUS-77; `@ApiOkResponsePaginated` vem com o primeiro endpoint paginado).
5. ~~Módulo `auth` — emissão de JWT (login, `/auth/me`, logout)~~ (entregue em GUS-78; convites e gestão de acessos em GUS-80/81).
6. `audit` como referência para os demais.
7. `dependency-cruiser` no CI para falhar quando um módulo importar interno de outro.

## 9. Contrato de autorização

O contrato de autorização é definido em `src/shared/decorators/` e aplicado pelo `AuthGuard` global em `src/modules/auth/`:

- **`@Roles(minRole: Role)`** — declara o nível mínimo para acessar o endpoint. O `AuthGuard` usa `roleSatisfies(userRole, minRole)` para verificar. `Role.SUPERADMIN` satisfaz qualquer `@Roles`.
- **`@Public()`** — marca o endpoint como público; o guard devolve `true` imediatamente, sem exigir cookie ou JWT.
- **`@CurrentUser()`** — parâmetro do handler que retorna `AuthUser { id, role, accessEnabled }` depois que o guard validou a requisição.
- **Sem decorator** — o endpoint exige que o usuário esteja autenticado (cookie `tedi_session` com JWT válido), mas aceita qualquer role.
- **Revogação imediata** — o guard consulta `PeopleService.findById` a cada requisição; se `accessEnabled` for `false`, o guard retorna 401 mesmo com JWT válido (decisão 19).
- **Bypass de desenvolvimento** — com `NODE_ENV !== 'production'` e `DEV_FAKE_ROLE=<role>`, o guard injeta um usuário fake sem exigir cookie. Em produção a variável é ignorada e um aviso é emitido no boot.
