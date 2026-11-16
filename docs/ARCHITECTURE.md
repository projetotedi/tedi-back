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
| `catalog`       | E12     | Plano de aula, curso, sequência de planos (catálogo de conteúdo)                                    |
| `classes`       | E3      | Edição, turma, matrícula                                                                            |
| `lessons`       | E4, E10 | Aula, geração em série, status, calendário                                                          |
| `assignments`   | E5      | Candidatura, alocação, cobertura, agenda do membro                                                  |
| `attendance`    | E6      | Chamada de alunos, presença de membros, frequência                                                  |
| `hours`         | E7      | Lançamento de horas, validação, extrato, consolidado                                                |
| `reports`       | E8      | Relatórios, PDF, exportações                                                                        |
| `audit`         | E9      | Log de auditoria, consentimento LGPD, anonimização                                                  |
| `notifications` | E11     | Só se for priorizado                                                                                |

Login, perfil e flags de acesso são colunas de `Person`, sem entidade de usuário separada (decisões 1 e 6). Convite e redefinição de senha são links de uso único gerados pelo sistema, que a coordenadora repassa; o MVP não tem provedor de e-mail (decisões 31 a 34).

## 3. Dependências permitidas

```
auth       → people   (o guard carrega a Person e a situação do cadastro de membro a cada request)
people       ← classes, assignments, hours, imports, catalog   (catalog: nome de quem criou o plano de aula, GUS-96, e o curso, GUS-100, via PeopleService.findRefsByIds; classes, GUS-104, via PeopleService.findRefsByIds: quem criou a turma e os alunos da prévia; assignments, GUS-158: MembersService.getMemberSummary, o membro e se está ativo, e PeopleService.findRefsByIds, o nome de quem foi alocado)
catalog      ← classes, lessons   (classes: validar o curso da turma e mostrar o curso e a categoria dele, GUS-102, via CoursesService.getCourseSummary; GUS-104: CourseLessonPlansService.readSequence para a carga na ficha da turma; lessons, GUS-151: LessonPlansService.getLessonPlanSummary, CourseLessonPlansService.findPosition e CoursesService.getCourseSummary; lessons, GUS-154: CourseLessonPlansService.getSequenceSummaries, a sequência do curso com título, objetivo e duração de cada plano)
classes      ← lessons, attendance   (lessons, GUS-151: ClassesService.getClassSummary; GUS-153: ClassesService.listClassRefs)
lessons      ← assignments, attendance   (assignments, GUS-158: LessonsService.getLessonSummary e findLessonSummaries, e a porta de cobertura, LessonCoverageRegistry, ver seção 15)
assignments  ← attendance
attendance   ──evento──▶ hours        (MemberAttendanceConfirmed / MemberAttendanceReverted)
lessons      ──evento──▶ hours        (LessonCancelled, RN-07, a partir do E7: o hours ouve e estorna as horas da aula cancelada)
hours        ← reports
audit        ← ninguém importa. Ouve eventos (AuditableActionEvent) de qualquer módulo.
```

A seta só aponta "para baixo". `hours` nunca importa `attendance`; se precisa reagir a algo de lá, escuta o evento.

**Quando o de baixo precisa de um dado do de cima (porta).** A resposta de toda aula traz a cobertura (`coverage`), que é contada sobre as alocações, mas `lessons` não pode importar `assignments`: a seta é `assignments → lessons`. Nesse caso o módulo de baixo define uma **porta** (uma interface, mais um registro exportado pelo módulo) e o de cima a implementa e se registra no `onModuleInit`; sem implementação registrada, a porta responde "nada" (objeto nulo). É o caso de `LessonStaffCounter` e `LessonCoverageRegistry` (GUS-158, seção 15), o primeiro do repositório. Evento é para efeito colateral, e a porta é para leitura: a contagem de quem está confirmado numa aula é uma leitura, síncrona, e não pode divergir da fonte.

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
│   ├── search/
│   │   ├── search.util.ts           # normalizeSearchTerm, applyTextSearch, applyTextSearchAllWords, applyDigitsSearch: busca textual, ver seção 12
│   │   └── __tests__/               # search.util.spec.ts (unitário) e search-normalize.e2e.spec.ts (extensões e função no banco)
│   ├── swagger/swagger.util.ts
│   ├── entities/
│   │   ├── base.entity.ts           # id (UUID v7), createdAt, updatedAt, deletedAt
│   │   ├── archivable.columns.ts    # archivedAt, archivedById, archiveReason reutilizáveis (RN-27), ver seção 10
│   │   └── time-of-day.transformer.ts # coluna time do Postgres lida como "HH:mm" (GUS-151), ver seção 14
│   ├── dto/
│   │   ├── api-error.dto.ts         # ApiErrorDto, formato único de erro
│   │   ├── archive.dto.ts           # corpo comum de PATCH .../archive ({ reason? })
│   │   └── transforms.ts            # trim, trimToNull, trimLowerToNull (class-transformer)
│   ├── dates/
│   │   ├── calendar-date.ts         # APP_TIME_ZONE, todayInAppTimeZone, ageOn, isValidCalendarDate, calendarDaysBetween (GUS-153)
│   │   ├── is-calendar-date.validator.ts # decorator IsCalendarDate: AAAA-MM-DD que existe no calendário
│   │   ├── time-of-day.ts           # hora "HH:mm": TIME_OF_DAY_PATTERN, isValidTimeOfDay, minutesOfDay, minutesBetween (GUS-151)
│   │   ├── is-time-of-day.validator.ts # decorator IsTimeOfDay, o par do IsCalendarDate para a hora
│   │   └── clock.ts                 # Clock injetável: service testável com um instante fixo
│   ├── enums/
│   │   └── role.enum.ts             # enum Role + roleSatisfies()
│   ├── permissions/                 # matriz de permissões (perfil × ação × escopo), ver seção 9
│   │   ├── permission.enum.ts       # enum Permission (uma entrada por ação da matriz)
│   │   ├── permission-matrix.ts     # PERMISSION_MATRIX + scopeFor() + buildPermissionMap()
│   │   ├── permission.policy.ts     # PermissionPolicy: can, assertCan, assertCanAny, listFilter
│   │   ├── require-permission.decorator.ts # @RequirePermission(permission) — metadata key 'auth:permission'
│   │   ├── permissions.module.ts    # PermissionsModule (exporta a policy)
│   │   └── __tests__/
│   ├── decorators/
│   │   ├── auth-user.type.ts        # interface AuthUser { id, role, accessEnabled, departmentIds? }
│   │   ├── roles.decorator.ts       # @Roles(minRole) — metadata key 'auth:roles'
│   │   ├── public.decorator.ts      # @Public() — metadata key 'auth:public'
│   │   └── current-user.decorator.ts # @CurrentUser() — extrai AuthUser do request
│   ├── filters/                     # HttpExceptionFilter global → ApiErrorDto
│   ├── interceptors/                # (próximo passo) logging
│   ├── events/                      # eventos compartilhados (auditable-action.event.ts, lesson-cancelled.event.ts)
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
│   ├── people.controller.ts         # @ApiTags('people'); @RequirePermission/@Public por endpoint; só traduz HTTP → service
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

O `assignments` (GUS-158) é o exemplo de um módulo com mais de um controller e com uma porta implementada (seção 15):

```
modules/assignments/
├── assignments.module.ts            # importa LessonsModule, PeopleModule e PermissionsModule; não exporta nada ainda
├── controllers/
│   ├── lesson-assignments.controller.ts   # POST e GET /lessons/:id/assignments
│   ├── assignments.controller.ts          # PATCH /assignments/:id/confirm e /cancel
│   └── member-assignments.controller.ts   # GET /members/:id/assignments (escopo de departamento)
├── services/
│   ├── assignments.service.ts             # criar, listar, confirmar, cancelar; locks e índices únicos parciais
│   ├── lesson-staff-counter.service.ts    # implementa a porta de cobertura do lessons e se registra no onModuleInit
│   ├── assignment-errors.ts               # um helper por erro de negócio (404, 409 e o 400 do corpo)
│   └── assignment-response.mapper.ts
├── entities/lesson-assignment.entity.ts   # tabela lesson_assignments, com os dois índices únicos parciais
├── dto/                                   # CreateAssignmentDto e os DTOs de resposta
├── enums/                                 # AssignmentRole, AssignmentStatus, AssignmentSource
└── __tests__/                             # unitários, e2e das rotas, e2e da cobertura e e2e de schema
```

Controller de exemplo, com o contrato de autorização (seção 9):

```ts
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { Permission } from "@shared/permissions/permission.enum";
import { Public } from "@shared/decorators/public.decorator";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { AuthUser } from "@shared/decorators/auth-user.type";

@ApiTags("people")
@Controller("people")
export class PeopleController {
  constructor(private readonly peopleService: PeopleService) {}

  @Get()
  @RequirePermission(Permission.MEMBERS_LIST) // o guard nega quando o escopo do perfil é "none"
  listPeople(@Query() query: ListPeopleQueryDto, @CurrentUser() user: AuthUser) {
    return this.peopleService.list(query, user); // o service filtra na consulta (policy.listFilter)
  }

  @Post()
  @RequirePermission(Permission.MEMBERS_EDIT)
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
- **Módulo protegido não importa `AuthModule`.** O guard é global; anotar os endpoints com `@RequirePermission()` (de `shared/permissions/`) ou `@Public()` (de `shared/decorators/`) é suficiente. Se o módulo precisar do usuário logado, use o parâmetro decorado com `@CurrentUser()`.

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
- Fixtures são do módulo. Se dois módulos precisam do mesmo dado, o módulo dono exporta uma função; nada vai para `shared/`. O e2e do `assignments` (GUS-158) é o primeiro a importar fixture de outro módulo: `insertDepartment` e `insertMemberProfile` do `people`, `lessonBody` e `CLASS_PERIOD` do `lessons`, reexportadas pelo `assignments/__tests__/fixtures/assignments.fixture.ts` para os testes do módulo importarem de um lugar só.
- Cada teste e2e limpa as tabelas que tocou.
- **Entidade × migration.** A CI não compara entidade com o SQL das migrations: o job "Entidades × migrations" só faz `migration:run`, `migration:revert` e `migration:run`, porque o `migration:generate` do TypeORM é inutilizável com enums (ver o comentário no `ci.yml`). O guarda de drift é um e2e de schema, que compara colunas, índice único e FKs de cada entidade com o que as migrations criaram; o primeiro é `people/__tests__/people.repository.e2e.spec.ts`. Cada módulo mantém o próprio e2e de schema no seu `__tests__`, com o mesmo padrão de comparação (o módulo não edita o e2e de outro). Índice de expressão (`uq_departments_name`, `uq_courses_name`, `uq_classes_edition_id_code`, `idx_people_name_search`, `idx_lessons_title_search`) o TypeORM não declara na entidade; esse e2e o confere em `pg_indexes`. A função `search_normalize` e as extensões da busca textual têm e2e próprio em `shared/search/__tests__/search-normalize.e2e.spec.ts` (seção 12). O de `lessons` (`lessons/__tests__/lessons.repository.e2e.spec.ts`) confere também o enum e os seis `CHECK` da aula, os índices de busca (`idx_lessons_title_search` e `idx_lessons_subject_search`, em `pg_indexes` e no plano de uma consulta com `enable_seqscan = off`) e o `idx_lessons_date`, e monta o cenário (curso, turma e plano) pelos services que os outros módulos exportam, não pelas tabelas deles (seção 14). O de `assignments` (`assignments/__tests__/lesson-assignments.repository.e2e.spec.ts`) confere os três enums, os quatro `CHECK` e os dois **índices únicos parciais**: a entidade declara o `where`, mas só o banco prova o predicado, então o teste compara o `indexdef` de `pg_indexes` (como o Postgres o normaliza) com o texto esperado e prova cada violação (23505, 23514, 23503) com o nome da constraint (seção 15).

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
- **`@CurrentUser()`** — parâmetro do handler que retorna `AuthUser { id, role, accessEnabled, departmentIds? }` depois que o guard validou a requisição.
- **Sem decorator** — o endpoint exige que o usuário esteja autenticado (cookie `tedi_session` com JWT válido), mas aceita qualquer role.
- **Revogação imediata** — o guard consulta `PeopleService.findById` e `MembersService.findAccessFacts` a cada requisição; se `accessEnabled` for `false`, o guard retorna 401 mesmo com JWT válido (decisão 19). O mesmo vale para o cadastro de membro `pending` ou `rejected` (GUS-91, seção 11): responde 401, e a mesma consulta traz o departamento do `AuthUser`.
- **Bypass de desenvolvimento** — com `NODE_ENV !== 'production'` e `DEV_FAKE_ROLE=<role>`, o guard injeta um usuário fake sem exigir cookie. Em produção a variável é ignorada e um aviso é emitido no boot.

### 9.1 Permissões por perfil e escopo (GUS-114)

A matriz de permissões (quem pode fazer o quê, e dentro de qual escopo) vive em um único lugar: `src/shared/permissions/permission-matrix.ts`. O documento legível `docs/PERMISSIONS.md` é gerado dela (`yarn permissions:export`) e um teste falha se ele ficar desatualizado.

- **`Permission`** — enum com uma entrada por ação da matriz (`members.view`, `hours.viewOthers`, `attendance.takeStudents`...). O valor é a chave estável que o front lê.
- **`Scope`** — `all | own | department | allocated | lessonTeacher | none`. `PERMISSION_MATRIX` mapeia `Permission × Role` para um `Scope`. `Role.SUPERADMIN` tem `all` em tudo (função `scopeFor`), exceto a regra de própria presença.
- **`@RequirePermission(Permission.X)`** — o `AuthGuard` nega com 403 `FORBIDDEN` quando o escopo do perfil é `none`. Só olha o perfil; o escopo fino é do service.
- **`PermissionPolicy`** (exportada por `PermissionsModule`, que cada módulo de domínio importa; não é global):
  - `can(user, permission, target?)` e `assertCan(...)`: resolvem `own`, `department`, `allocated` e `lessonTeacher` contra os fatos do alvo (`PermissionTarget`: `personId`, `departmentIds`, `lessonTeacherIds`, `lessonMonitorIds`). A policy não consulta o domínio: o service carrega os fatos e os passa. Faltou dado, nega.
  - `assertCanAny(user, permissions, target?)`: passa se qualquer uma cobre o alvo (ex.: horas próprias ou de outro membro).
  - `listFilter(user, permission)`: devolve o `ListScopeFilter` que o service traduz no `WHERE` da consulta. Listagem com escopo `department` filtra na consulta, nunca depois de carregar.
- **Erros** (todos 403, no formato `ApiErrorDto`): `FORBIDDEN` (guard: o perfil não tem a permissão), `FORBIDDEN_SCOPE` (policy: tem a permissão, mas o alvo está fora do escopo) e `SELF_ATTENDANCE_NOT_ALLOWED` (policy: `attendance.confirmMember` sobre a própria pessoa, em qualquer perfil, inclusive coordenação e superadmin).
- **Departamento** (GUS-91) — o escopo `department` funciona de verdade:
  - `AuthUser.departmentIds` vem do perfil de membro **aprovado** da pessoa (0 ou 1 id), preenchido pelo guard. Vazio quer dizer sem departamento: o escopo `department` nega terceiros. O departamento sugerido no cadastro nunca dá escopo antes da aprovação. O campo continua opcional no tipo, para não quebrar os literais de `AuthUser` nos testes e o usuário do `DEV_FAKE_ROLE`.
  - Os departamentos são a tabela `departments`, gerida pela coordenação em `GET/POST /departments`. A lista é dado, não código.
  - O service de domínio carrega os departamentos do **alvo** com `MembersService.findAccessFacts(targetId).departmentIds` e os passa à `PermissionPolicy` em `PermissionTarget.departmentIds`.
  - A ficha do membro (`MembersService.getMember`, `GET /members/:id`, GUS-144) é o primeiro uso real de `assertCan` com escopo `department` fora do test-support: carrega o alvo, responde 404 se ele não existe e só então confere o escopo, com os `departmentIds` do alvo vindos de `departmentScopeOf` (o departamento do perfil **aprovado**, a mesma regra de `findAccessFacts`). Por isso o `PeopleModule` importa o `PermissionsModule`.
  - A listagem com escopo `department` filtra na consulta: `member_profiles.department_id IN (:...departmentIds)`, com os `departmentIds` do `ListScopeFilter`.
- **`GET /auth/me` e `POST /auth/login`** devolvem `permissions: { [permission]: scope }` do perfil logado (`MeResponseDto.permissions`), para o front não repetir a matriz.
- **`@Roles` continua funcionando** (os dois decorators coexistem e os dois precisam passar), mas as rotas novas usam `@RequirePermission`. As rotas de acessos e convites já foram migradas.

## 10. Arquivar em vez de excluir (RN-27)

Aluno, plano de aula, curso e turma não são excluídos: são **arquivados**. O arquivado sai das listagens padrão e das listas de disponíveis (por exemplo, alunos disponíveis na matrícula), continua acessível por id e vira somente leitura. Criado na GUS-105 (alunos); GUS-94, GUS-116 e GUS-101 reutilizam.

### 10.1 Colunas

`src/shared/entities/archivable.columns.ts` define a classe `ArchivableColumns`, um _embedded_ do TypeORM (sem herança múltipla):

| Propriedade     | Coluna           | Tipo          | Nulo |
| --------------- | ---------------- | ------------- | ---- |
| `archivedAt`    | `archived_at`    | `timestamptz` | sim  |
| `archivedById`  | `archived_by_id` | `uuid`        | sim  |
| `archiveReason` | `archive_reason` | `text`        | sim  |

Na entidade, use `prefix: false` (o nome no banco é exatamente o de cada `@Column`) e declare o FK de `archived_by_id` **na classe**. `@ForeignKey` em propriedade do embedded é ignorado pelo TypeORM, e o alvo é a string `"people"` porque o módulo dono da entidade não importa `Person` (seção 1, item 2). A string só resolve se o DataSource carregar a entidade `Person`: o e2e de um módulo que usa `ArchivableColumns` precisa carregar o glob de todas as entidades (`join(__dirname, "..", "..", "..", "**", "*.entity.{ts,js}")`), não só as do próprio módulo.

```ts
@Entity({ name: "student_profiles" })
@ForeignKey("people", ["archived_by_id"], ["id"], { name: "fk_student_profiles_archived_by_id" })
export class StudentProfile extends BaseEntity {
  // ...demais colunas...

  @Column(() => ArchivableColumns, { prefix: false })
  archive: ArchivableColumns;
}
```

Na migration (escrita à mão; o nome do FK é `fk_<tabela>_archived_by_id`):

```sql
"archived_at"    TIMESTAMP WITH TIME ZONE,
"archived_by_id" uuid,
"archive_reason" text,
-- ...
ALTER TABLE "<tabela>" ADD CONSTRAINT "fk_<tabela>_archived_by_id"
  FOREIGN KEY ("archived_by_id") REFERENCES "people"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
```

### 10.2 Helpers

No mesmo arquivo, funções puras sobre o embedded:

- `isArchived(columns)`: `archivedAt != null`.
- `markArchived(columns, actorId, reason, now)`: preenche as três colunas e devolve `true`. Se já estava arquivado não mexe em nada e devolve `false`: o primeiro arquivamento vale.
- `markUnarchived(columns)`: zera as três colunas e devolve `true`; se não estava arquivado, devolve `false`.

O corpo comum das rotas de arquivar é `ArchiveDto` (`src/shared/dto/archive.dto.ts`, `{ reason?: string | null }`, até 500 caracteres). Um tipo só no cliente gerado pelo Orval.

### 10.3 Contrato padrão das rotas

- `PATCH /<recurso>/:id/archive` com `ArchiveDto` (corpo opcional) e `PATCH /<recurso>/:id/unarchive`, sem corpo. Não existe `DELETE`.
- Respondem **200 com o DTO do recurso**. Repetir a operação é no-op: arquivar quem já está arquivado ou reativar quem está ativo responde 200 sem escrever e sem emitir evento.
- Editar um recurso arquivado responde **409 `<ENTITY>_ARCHIVED`** (`STUDENT_ARCHIVED`, por exemplo).
- O 404 de recurso de domínio é **`<ENTITY>_NOT_FOUND`** (`STUDENT_NOT_FOUND`, por exemplo), criado por um helper único no service do recurso (`studentNotFound()`), que o pipe de id do controller e as rotas de leitura reaproveitam. O 404 do roteador (rota que não existe, como um `DELETE`) continua `NOT_FOUND`. Documente o código com `@ApiNotFoundResponse({ type: ApiErrorDto, description: "<ENTITY>_NOT_FOUND" })`.
- Quando o id do recurso vem **no corpo** e não na URL (uma lista de ids que o service resolve), `<ENTITY>_NOT_FOUND` e `<ENTITY>_ARCHIVED` respondem **400** (única exceção: `COURSE_ARCHIVED` ao criar ou mover uma turma, que é 409 por pedido do card, seção 13), com helper próprio no service que recebe o corpo: em `PUT /courses/:id/lesson-plans`, `LESSON_PLAN_NOT_FOUND` e `LESSON_PLAN_ARCHIVED` são 400, e continuam 404 e 409 nas rotas do próprio plano. Se o corpo e a URL são do mesmo tipo (os pré-requisitos de um curso), o código leva o nome do papel (`PREREQUISITE_NOT_FOUND`), para não se confundir com o `COURSE_NOT_FOUND` da URL. Um id repetido na lista é `DUPLICATE_<ENTITY>` (400), respondido pelo service antes de abrir a transação: o `@ArrayUnique` responderia `VALIDATION_FAILED`, o único código que o `ValidationPipe` global emite.
- A **listagem padrão filtra na consulta**: `where: { archive: { archivedAt: IsNull() } }` com o repositório, ou `archived_at IS NULL` no query builder. Quem precisa dos arquivados (histórico, ficha) pede explicitamente.
- Evento `AuditableActionEvent` `<ENTITY>_ARCHIVED` e `<ENTITY>_UNARCHIVED`, depois do commit e só quando houve mudança. O motivo do arquivamento (`archiveReason`) entra no evento; não registre informação de saúde nele (RNF-13).
- Regras que impedem arquivar (por exemplo, aluno com matrícula ativa) respondem 409 com código próprio e ficam no service do recurso.
- Permissão por `@RequirePermission`: arquivar e reativar costumam ser mais restritos que editar (alunos: `students.archive`, só coordenação).

## 11. Cadastro de membro e validação (GUS-91)

Ninguém vira membro sem a aprovação da coordenação (RN-08). O aceite de um convite de acesso (`POST /auth/invites/accept`) manda o objeto `registration` com os dados do RF-004 e cria o cadastro **A validar**: a `Person` nasce sem acesso (`role` nulo, `accessEnabled` falso). Só a aprovação, em `PATCH /member-registrations/:id/approve`, define o perfil de acesso, o departamento, a função principal e a data de entrada e libera o login.

`member_profiles` é a tabela do vínculo de membro, 1:1 com `people` (como `student_profiles` é a do aluno). Não existe card da E1.b: os cards futuros de membro (inativação com data de saída, edição) estendem essa tabela em vez de criar outra.

### 11.1 Onde cada campo mora

| Campo                                                      | Onde                                                                                             | Por quê                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Nome, RA                                                   | `Person.name`, `Person.ra`                                                                       | O RA é o login e a chave do reuso (RN-09)                                             |
| Data de nascimento, telefone                               | `Person.birthDate`, `Person.phone`                                                               | Contato comum a aluno e membro (GUS-105); nada duplicado                              |
| E-mail pessoal                                             | `Person.email` (único)                                                                           | Mesmo significado do e-mail do aluno                                                  |
| CPF                                                        | `MemberProfile.cpf`                                                                              | Só o membro coleta (minimização, RNF-10). Um lugar só para restringir (RNF-14)        |
| Endereço, cidade, UF                                       | `MemberProfile`                                                                                  | Só o cadastro de membro coleta                                                        |
| E-mail institucional, curso, período, turma, link do termo | `MemberProfile`                                                                                  | Dado acadêmico do vínculo (RF-004, RF-011)                                            |
| Departamento                                               | `MemberProfile.departmentId` → `departments`                                                     | Sugerido no aceite, decidido na aprovação; é chave de autorização                     |
| Função principal, data de entrada                          | `MemberProfile.mainFunction`, `joinedAt`                                                         | Definidas pela coordenação na aprovação                                               |
| Situação, observação, quem validou e quando                | `registrationStatus`, `reviewNote`, `reviewedById`, `reviewedAt`                                 | Ciclo da validação do vínculo                                                         |
| Perfil de acesso                                           | `Person.role`                                                                                    | Fica nulo até a aprovação; o perfil do convite vai para `MemberProfile.requestedRole` |
| Último acesso                                              | `Person.lastLoginAt`, `Person.previousLoginAt`                                                   | O login grava os dois (`recordLogin`); Meu perfil mostra o anterior (GUS-122)         |
| Participação e saída do projeto                            | `MemberProfile.status`, `exitDate`, `exitReason`, `exitNote`, `deactivatedAt`, `deactivatedById` | Inativação encerra a participação (GUS-147); o acesso continua na `Person`            |

O nome do departamento é único sem diferenciar maiúsculas: `uq_departments_name` é um índice único sobre `LOWER("name")`, criado só na migration (o TypeORM não declara índice de expressão na entidade; o e2e de schema o confere em `pg_indexes`). A violação (23505) vira 409 `DEPARTMENT_ALREADY_EXISTS`.

CPF, endereço e telefone são dados pessoais (RNF-13/14): nunca em log, nunca em evento (`MEMBER_AUDIT_FIELDS` é uma allow-list) e o CPF completo só aparece em `GET /member-registrations/:id`, que é da coordenação. A listagem da fila não traz CPF, endereço, telefone nem e-mails. Quem mostra o CPF a quem não é coordenação o mostra mascarado, com `maskCpf` (`validators/cpf.ts`, o único lugar que mascara: `52998224725` vira `***.***.247-25`); é o caso de `GET /members/me` (Meu perfil, GUS-122), que devolve só `cpfMasked` e só os dados de quem está logado, e de `GET /members/:id` (ficha do membro, GUS-144, `members.view`), que devolve só `cpfMasked` também para a coordenação: o formato da resposta não muda por perfil, e o CPF completo continua em um lugar só. Telefone, endereço e e-mails aparecem na ficha para quem pode lê-la, inclusive a diretoria do departamento do membro (Q9.4, respondida em 11/11/2026).

A ficha do membro junta `people` e `member_profiles`, com o departamento e quem aprovou o cadastro (`reviewedBy`, nulo enquanto `pending`, no backfill ou se o revisor foi removido). Responde 200 para toda linha de `GET /members`, inclusive cadastros `pending`/`rejected` (com `role` nulo) e quem não tem perfil de membro, como o admin do seed (campos de membro nulos e `registrationStatus` nulo), e 404 `MEMBER_NOT_FOUND` para o resto, antes de conferir o escopo. O diretor lê só o departamento do perfil **aprovado** do alvo (`departmentScopeOf`, a mesma regra de `findAccessFacts`): o departamento sugerido de um cadastro `pending` nunca dá escopo, e um diretor sem departamento recebe 403 `FORBIDDEN_SCOPE` até na própria ficha (os próprios dados ficam em `GET /members/me`).

### 11.2 Situação × acesso

A situação mora no perfil; o acesso continua na `Person`.

| Situação                                                 | `Person.role`                           | `Person.accessEnabled`                          | Login (senha certa)                     | Guard                      | Em `/access`         |
| -------------------------------------------------------- | --------------------------------------- | ----------------------------------------------- | --------------------------------------- | -------------------------- | -------------------- |
| sem perfil de membro (seed, coordenação, contas antigas) | o que tiver                             | o que tiver                                     | como antes                              | como antes                 | se `role` não é nulo |
| `pending`                                                | nulo (o pedido fica em `requestedRole`) | falso                                           | 401 `REGISTRATION_PENDING`              | 401                        | não                  |
| `approved`                                               | o escolhido na aprovação                | verdadeiro; a coordenação pode desativar depois | 200, ou `ACCESS_DISABLED` se desativado | passa, com `departmentIds` | sim                  |
| `rejected`                                               | nulo                                    | falso                                           | 401 `REGISTRATION_REJECTED`             | 401                        | não                  |

- **Sem perfil de membro = fora da validação.** O seed da coordenadora roda depois das migrations e não tem perfil; as fixtures de e2e e as contas anteriores à GUS-91 também não. A migration `CreateMemberProfiles` faz o backfill: quem tinha `role` `member` ou `director` ganha um perfil `approved` (`reviewedAt` nulo marca "aprovado antes da validação existir"). Coordenação e superadmin ficam sem perfil. A coluna nasce com `DEFAULT 'pending'`, o lado seguro.
- **Login:** primeiro a senha, depois a situação (decisão 29). Com senha errada a resposta é sempre `INVALID_CREDENTIALS`; `REGISTRATION_PENDING` e `REGISTRATION_REJECTED` (401, como `ACCESS_DISABLED`) só aparecem com a senha certa.
- **Aceite:** RA de pessoa com perfil de acesso, ou com cadastro `pending`/`approved`, responde 409 `RA_ALREADY_IN_USE` (um cadastro em análise não é sobrescrito). RA com cadastro `rejected` é **reenvio**: mesma `Person`, mesmo perfil, de volta a `pending`. Pessoa com RA e sem perfil de acesso nem de membro é reaproveitada (RN-09). O e-mail pessoal de outra pessoa responde 409 `EMAIL_ALREADY_IN_USE`. Nos erros o convite não é consumido.
- **Aprovar e recusar** travam a `Person` e o perfil (nessa ordem, a mesma do aceite), exigem `pending` (senão 409 `REGISTRATION_NOT_PENDING`) e emitem `MEMBER_REGISTRATION_APPROVED` ou `MEMBER_REGISTRATION_REJECTED` depois do commit. A recusa exige a observação.
- O 404 do cadastro é `MEMBER_REGISTRATION_NOT_FOUND` (seção 10.3), com um helper único no `MembersService` que o pipe de id do controller reaproveita.

### 11.3 Fronteira entre `auth` e `people`

`auth` só usa o que o `PeopleModule` exporta: `PeopleService` (a `Person` que o guard e o login leem, e `assertNotLastActiveCoordinator`, a regra de última coordenação que `/access` e a inativação de membro dividem), `MembersService`, `DepartmentsService` e os tipos do contrato desses services (`MemberRegistrationFormDto`, `DepartmentResponseDto`, `MemberRegistrationStatus`, `MemberAccessFacts`). `InvitesService.accept` abre a transação e chama `MembersService.submitFromInvite(manager, ...)`, para a `Person`, o perfil e o `invite.usedAt` saírem no mesmo commit; o evento é montado em `people` (dono da allow-list) e emitido por `auth` depois do commit. `GET /auth/invites/:token` devolve `departments` para o formulário público (só quem tem um convite válido vê os nomes).

`catalog` também importa o `PeopleModule` (GUS-96), só para `PeopleService.findRefsByIds`, que devolve `PersonRefDto { id, name }`: o nome de quem criou um plano de aula ou um curso (GUS-100), no detalhe de cada um. É a mesma regra: nenhuma entidade `Person` sai de `people`, e `PersonRefDto` é um tipo do contrato do `PeopleService`, como os da lista acima. `catalog` não lê a tabela `people` por SQL.

### 11.4 Inativar e reativar membro (GUS-147)

`PATCH /members/:id/deactivate` (`deactivateMember`) encerra a participação de um membro no projeto (RF-011) e `PATCH /members/:id/reactivate` (`reactivateMember`) a reabre. As duas usam `members.deactivate` (só coordenação e superadmin); a matriz não mudou.

- **Dono das colunas.** A participação (`status`, `active`/`inactive`) e a saída (`exitDate`, `exitReason`, `exitNote`, `deactivatedAt`, `deactivatedById`) moram em `member_profiles`; o acesso continua em `Person.accessEnabled`. Como `people` é dono dos dois, `MembersService` grava o perfil e a `Person` na mesma transação, sem evento entre módulos (o acesso é gravado direto) e sem importar `auth`. O guard já recusa a próxima requisição de quem teve o acesso desligado (decisão 19). O `CHECK ck_member_profiles_exit_date` amarra `status = 'inactive'` a `exit_date` preenchido, como o `ck_lessons_cancellation`.
- **Transação.** A inativação roda em `SERIALIZABLE`, como `/access`: duas coordenações tirando uma à outra ao mesmo tempo (uma aqui, outra em `/access`) é um _write skew_ que só o SSI do Postgres pega, e só quando os dois lados são `SERIALIZABLE`. O preço é o que `/access` já paga: um duplo envio sobreposto pode responder 500 (40001) em vez de 409; o front desabilita o botão durante o envio. A reativação usa o isolamento padrão, porque não reduz coordenações nem mexe no acesso. As duas travam a `Person` e depois o perfil.
- **Ordem dos erros da inativação.** 404 `MEMBER_NOT_FOUND` (id mal formado) e 403 `OWN_ACCOUNT` antes da transação; dentro dela, 404 `MEMBER_NOT_FOUND` (mesmo predicado da ficha), 409 `NO_MEMBER_PROFILE` (perfil de acesso sem perfil de membro, como o admin do seed), 409 `REGISTRATION_NOT_APPROVED` (cadastro `pending` ou `rejected`), 409 `MEMBER_INACTIVE` (inativar de novo sobrescreveria a primeira saída), 400 `EXIT_DATE_BEFORE_JOINED_AT` e 409 `LAST_COORDINATOR`. O perfil de membro não é criado na hora.
- **Data de saída.** O DTO (`IsExitDate`) aceita AAAA-MM-DD entre 2000-01-01 e hoje (`America/Sao_Paulo`): a inativação desliga o acesso agora, então uma data futura não faz sentido. O service recusa uma saída antes de `joinedAt`, com `details` em `exitDate`; sair no dia da entrada vale, e um perfil aprovado pelo backfill (`joinedAt` nulo) fica só com o piso do DTO.
- **Última coordenação.** A regra tem um dono só: `PeopleService.assertNotLastActiveCoordinator(manager)` (409 `LAST_COORDINATOR`), que `/access` também usa. Coordenação ativa continua sendo `role = coordinator` e `access_enabled = true`; a regra não olha `status`, porque protege quem consegue entrar no sistema. Na inativação, roda só quando o alvo é coordenação com o acesso ainda ligado e o ator não é superadmin: uma coordenação já sem acesso não entra na contagem, então inativá-la não muda o conjunto de coordenações ativas, e o fluxo "desligar o acesso em `/access`, depois registrar a saída" passa. Com uma coordenadora como atora, o 409 não aparece em sequência; a checagem fica como a leitura que deixa o `SERIALIZABLE` pegar duas coordenações se tirando ao mesmo tempo. `/access` mantém o próprio comportamento.
- **Própria conta.** 403 `OWN_ACCOUNT`, com o mesmo corpo de `/access` (`OwnAccountException`, em `shared/permissions/permission.errors.ts`), nas duas rotas. O card pedia 409; um código estável não deve ter dois status.
- **Leitura.** `GET /members` e `GET /members/:id` devolvem `status`, `exitDate` e `exitReason`. `status` nunca é nulo: quem não tem perfil de membro conta como `active` (`COALESCE` na listagem, default no mapper), e um cadastro `pending` ou `rejected` também é `active`. O filtro `?status` omitido lista todas as situações, para a coordenação achar os inativos e reativá-los.
- **O que não sai.** `exitReason` (texto livre, `varchar(200)`) aparece na API e no evento, como `reviewNote`. `exitNote` é gravada e nunca sai, nem na API nem no evento (RNF-13); `deactivatedAt` e `deactivatedById` também não saem. Os eventos são `MEMBER_DEACTIVATED` (com `status`, `accessEnabled`, `exitDate` e `exitReason`) e `MEMBER_REACTIVATED`, depois do commit e só quando houve mudança.
- **Reativar.** Volta para `active` e limpa a saída; o acesso **não** volta (é `PATCH /access/:id/enabled`). Reativar quem já está ativo, um cadastro pendente ou quem não tem perfil responde 200 sem escrita (seção 10.3). A saída anterior só sobrevive no evento `MEMBER_DEACTIVATED`: até a E9.b persistir os eventos, o histórico de saídas se perde ao reativar. `/access` não impede religar o acesso de um membro ainda inativo; se isso precisar ser bloqueado, é outro card.
- **Fora daqui.** Cancelar as alocações futuras de quem sai é da GUS-158 (E5).

## 12. Busca textual (GUS-115)

Buscas textuais devem ignorar diferenças de caixa e acentuação e tratar `%` e `_` como caracteres literais. Para isso, a aplicação normaliza coluna e termo com `public.search_normalize` e usa `LIKE` com busca por trecho. A função fixa a normalização usada tanto pela consulta quanto pelo índice.

A busca por trecho é acelerada por índices GIN com `gin_trgm_ops` sobre a expressão `public.search_normalize(coluna)`. A expressão da consulta precisa corresponder à expressão indexada; `LOWER(...) LIKE`, `ILIKE` e `unaccent(...)` não aproveitam esses índices. Termos com menos de três caracteres podem resultar em varredura, pois não produzem trigramas suficientes.

### 12.1 Implementação

- As extensões `unaccent` e `pg_trgm` e a função `search_normalize` são criadas pela migration `CreateSearchNormalizeFunction`.
- Cada coluna pesquisável recebe um índice GIN próprio, no formato `idx_<tabela>_<coluna>_search`, criado depois da função. A GUS-115 cria os índices de `people.name` e `people.ra` em `CreateTextSearchIndexes`, e a GUS-153 os de `lessons.title` e `lessons.subject` em `CreateLessonListIndexes`.
- No service, use `applyTextSearch` de `src/shared/search/search.util.ts`. Para combinar condições de texto e dígitos em OR, use `textSearchCondition` e `digitsSearchCondition` dentro de `Brackets`.
- **Busca por palavras** (GUS-153): `applyTextSearchAllWords` (ou `textSearchAllWordsCondition`, para montar a condição à mão) separa o termo por espaço e exige que **todas** as palavras apareçam, cada uma em qualquer das colunas: OR entre as colunas, AND entre as palavras. "senhas privacidade" acha o título "Senhas e privacidade", e também uma aula de título "Segurança" com assunto "Privacidade e senhas". Palavra repetida vale uma vez, e o parâmetro da palavra `i` é `<prefixo><i>`, contado de 0 (o prefixo padrão é `textSearchWord`; dois usos na mesma consulta precisam de prefixos diferentes). A expressão por palavra é a mesma do `applyTextSearch`, então os mesmos índices GIN a atendem. Use quando a pessoa digita várias palavras que não precisam estar coladas (as aulas); `applyTextSearch` segue sendo a busca por trecho contínuo, que pessoas e acessos usam. Palavra de menos de três caracteres não gera trigrama e varre a tabela.
- Ao adicionar uma coluna pesquisável, crie sua migration de índice e atualize o e2e de schema do módulo para verificar o índice em `pg_indexes` e seu uso quando pertinente.
- Para listas de textos pesquisáveis, use uma tabela filha com uma linha por texto; índice GIN de array não atende busca por trecho.

O termo é normalizado e escapado pelo utilitário compartilhado antes da consulta. Parâmetros de buscas distintas no mesmo `QueryBuilder` devem ter nomes diferentes; o utilitário falha explicitamente quando um nome já está em uso.

## 13. Turmas e edições (GUS-101, GUS-102, GUS-104)

O módulo `classes` guarda a **turma** (a oferta de um curso numa edição, RN-13) e a **edição**. Esta seção registra o que o código sozinho não conta.

- **Edição criada sob demanda.** Não há tela nem rota para cadastrar edição: `POST /classes` (e o `PATCH` que troca `editionName`) recebe o nome, e `EditionsService.findOrCreate` devolve a edição que existe ou cria uma, dentro da transação da turma (se a turma falha, a edição nova volta junto). A criação é um `INSERT ... ON CONFLICT ("name") DO NOTHING` seguido de um `SELECT`, e não "consulta e depois insere": em READ COMMITTED o insert da segunda requisição espera a primeira terminar, então duas criações da mesma edição nova ao mesmo tempo terminam com uma linha só. O nome é `AAAA.N` (`^\d{4}\.[1-9]$`, aparado): com esse formato a ordem alfabética é a cronológica, e `GET /editions` ordena por `name` decrescente (`2026.2` antes de `2026.1`), não por criação.
- **Código da turma.** Único dentro da edição, sem diferenciar maiúsculas de minúsculas, arquivadas inclusive: `uq_classes_edition_id_code` é um índice único sobre `(edition_id, LOWER(code))`, criado só na migration (o TypeORM não declara índice de expressão; o e2e de schema o confere em `pg_indexes`, como o `uq_courses_name`). O service faz a pré-checagem e a violação 23505 (corrida) vira o mesmo 409 `CLASS_CODE_TAKEN`.
- **Entidade `SchoolClass`.** A tabela é `classes` e os DTOs são `Class*`, mas a classe TypeScript é `SchoolClass` (arquivo `class.entity.ts`), porque `Class` lê mal ao lado da palavra-chave `class`. O nome da entidade não chega ao contrato que o Orval gera.
- **Troca de curso condicionada** (RN-13, GUS-102): o `PATCH` aceita `courseId`, mas só enquanto a turma está `planned` e sem matrícula ativa (`countActive === 0`); senão responde 409 `COURSE_CHANGE_NOT_ALLOWED`. Vale o status **gravado**, não o do corpo (a regra protege a turma que já começou), e mandar o mesmo curso que a turma já tem é no-op, mesmo com a turma em andamento, porque o front reenvia o formulário inteiro. O curso de destino segue a regra do próximo item. A ordem dos erros do `PATCH` é `CLASS_NOT_FOUND`, `CLASS_ARCHIVED`, `INVALID_PERIOD`, `COURSE_CHANGE_NOT_ALLOWED`, `COURSE_NOT_FOUND`, `COURSE_ARCHIVED`, `CLASS_CODE_TAKEN` e `CAPACITY_BELOW_ENROLLED`. O `courseId` entra no `CLASS_UPDATED`. O FK para `courses` é declarado pelo nome da tabela, porque `classes` não importa `Course` (seção 10.1).
- **Curso existente e ativo, com `FOR SHARE`** (RF-020, RN-27): a criação (e a troca) lê o curso com `CoursesService.getCourseSummary(id, manager, { forShare: true })`, dentro da transação da turma e antes da edição e do código. `courseId` que não existe responde 400 `COURSE_NOT_FOUND`, e curso arquivado responde 409 `COURSE_ARCHIVED` com a mensagem própria "An archived course cannot receive new classes." É a **exceção** à seção 10.3, que daria 400 a um `<ENTITY>_ARCHIVED` com o id no corpo: o card pede 409. O `FOR SHARE` conflita com o `FOR UPDATE` de quem edita ou arquiva o curso, então não nasce turma num curso que acaba de ser arquivado: se o arquivamento commita primeiro, a criação espera e responde 409; se a turma trava primeiro, o arquivamento espera e a turma criada antes dele fica (RF-020). **Risco:** o card de arquivar curso precisa travar a linha do curso com `FOR UPDATE`, como o `CoursesService.update` já faz. O 23503 em `fk_classes_course_id` continua como rede de segurança. Os erros de curso moram em `services/class-course.errors.ts`: `COURSE_NOT_FOUND` é 400 quando o id vem no corpo e 404 quando vem na URL (`/courses/:id/classes`). Uma turma de curso arquivado continua editável, arquivável e reativável enquanto o curso não muda (RN-27).
- **Nível herdado, sem coluna** (RN-14, RF-029): a turma não tem categoria. Toda resposta de turma (criar, editar, arquivar e reativar) traz `course: { id, name, category, status }`, lido do curso na mesma transação (`getCourseSummary`, sem lock); mudar a categoria do curso muda o que as turmas dele mostram, as que já existem também (o texto antigo da RN-18 dizia o contrário, e o card manda o que está aqui). `courseId` continua na resposta, igual a `course.id`. Uma `category` enviada no corpo é descartada pelo `whitelist`. O `classes` importa os enums `CourseCategory` e `CourseStatus` de `catalog/services/courses.service`, que os reexporta, e nunca de `catalog/enums/*`.
- **Turmas por curso** (GUS-102), no `CourseClassesController` (`@ApiTags("classes")`, `classes.view`), porque o `catalog` não conhece `classes`. `GET /courses/:id/classes` (`listCourseClasses`) lista as turmas do curso, paginado, sem as arquivadas e sem opção de pedi-las, por edição decrescente, depois o código sem diferenciar caixa, depois o id, com o filtro `status` de valor único; curso desconhecido ou id mal formado responde 404 `COURSE_NOT_FOUND`, e curso arquivado responde 200. `GET /classes/summary-by-course?courseIds=a,b,c` (`getClassesSummaryByCourse`) responde `{ courseId, total, active }`, um item por id pedido, na ordem pedida, sem repetir id, de 1 a 100 UUIDs (CSV no contrato; o parâmetro repetido também vale), com zeros para curso sem turma e para id que não é curso (o catalog não é consultado). `total` conta as turmas não arquivadas, como o `total` da listagem sem filtro, e `active` as que estão `planned` ou `in_progress`. O `ClassesModule` registra esse controller **antes** do `ClassesController`, para o `GET /classes/:id` da GUS-104 nunca capturar `summary-by-course`.
- **Detalhe da turma** (GUS-104), `GET /classes/:id` (`getClass`, no `ClassesController`, `classes.view` e não o `@Roles(Role.MEMBER)` do card, como as outras leituras). O `ClassDetailService` e o `class-detail.mapper.ts` montam a ficha em uma chamada (dados, `edition`, `createdBy`, `course`, `summary`, `enrollmentsPreview` e `enrollmentsTotal`) só com leituras: sem transação, sem lock e sem evento, no padrão do `CourseDetailService`. Um valor que muda entre duas leituras pode aparecer misturado, o que vale para uma ficha. A turma arquivada responde 200 com `archivedAt` e o `status` que tinha (RN-27); id desconhecido, mal formado ou apagado da tabela responde 404 `CLASS_NOT_FOUND`. O curso vem de `CoursesService.getCourseSummary`, então `course.category` é sempre a atual (P20). `course.lessonPlanCount` e `course.plannedWorkloadMinutes` vêm de `CourseLessonPlansService.readSequence`, a mesma leitura do `GET /courses/:id`: os números são idênticos, e um plano arquivado que ficou na sequência conta (RN-24). `summary.occupancyRate` é matriculados ativos ÷ vagas com duas casas e sem teto (`Math.round(n * 100 / vagas) / 100`): a turma acima da capacidade passa de 1, e vagas menores que 1 (inalcançável, por `ck_classes_capacity_positive`) dariam 0, nunca `NaN`. `lessonsDone`, `lessonsTotal` e `averageAttendance` são obrigatórios e anuláveis (nunca `required: false`, para o Orval gerar `number | null`) e saem `null` mesmo com o módulo `lessons` existindo: `lessons` importa `classes`, e `classes` ler `lessons` fecharia um ciclo. O card de F2.6 (RF-035) escolhe entre uma interface com token definida em `classes` e implementada por `lessons`, ou uma projeção alimentada por evento. A prévia traz até 5 matrículas ativas, da mais antiga para a mais nova (`enrolledAt`, depois o id), cada uma com `{ id, student: { id, name }, enrolledAt }`, e `enrollmentsTotal`, igual a `summary.enrolledCount`, porque um `total` solto na raiz do detalhe seria ambíguo. As linhas vêm de `EnrollmentCountsService.listActivePreview`, que só leva ids; os nomes são lidos do `people` por `PeopleService.findRefsByIds`, em uma chamada só junto com quem criou a turma (sem JOIN entre módulos). Aluno que não é mais encontrado fica de fora da prévia, e `createdBy` vira `null` se quem criou a turma foi removido. A resposta tem só os campos da lista do card: sem `courseId`, `archivedById`, `archiveReason` e `updatedAt`. O `getClass` é declarado depois das mutações porque o schema compartilhado `ClassStatus` do contrato leva a descrição da primeira propriedade que o usa, e essa tem de continuar sendo `CreateClassDto.status`. **Risco:** a GUS-108 troca os corpos de `countActive`, `countActiveByClass` e `listActivePreview`, mantém a ordem `enrolledAt, id`, alinha `enrollmentsTotal` com o `total` de `GET /classes/:id/enrollments` e remove o override do `class-detail.e2e.spec.ts`.
- **Período** (RN-21): `endDate >= startDate`. A checagem vem antes da transação (400 `INVALID_PERIOD`, com `details` apontando `endDate`) e, no `PATCH`, usa as datas que ficam (a enviada contra a gravada). `ck_classes_period` é a rede de segurança no banco. As datas são colunas `date` e strings `AAAA-MM-DD`, sem fuso; o decorator `IsCalendarDate` (`shared/dates/`) as valida.
- **`EnrollmentCountsService`** é o ponto de extensão das matrículas: `countActive` devolve 0 até a GUS-108, que troca o corpo por um `count(*)` e passa a travar a linha da turma (`FOR UPDATE`) ao matricular. Sem esse lock, uma matrícula e um arquivamento (ou um corte de vagas, ou uma troca de curso) passariam juntos pelas próprias checagens. Ele alimenta o 409 `CLASS_HAS_ACTIVE_ENROLLMENTS` (arquivar), o 409 `CAPACITY_BELOW_ENROLLED` (reduzir vagas) e o 409 `COURSE_CHANGE_NOT_ALLOWED` (trocar de curso). `countActiveByClass(manager, classIds)` devolve de uma vez o mapa turma -> matrículas ativas de uma página (é o que preenche `enrolledCount` em `GET /courses/:id/classes` sem N+1; quem lê usa `map.get(id) ?? 0`) e é sempre vazio até a GUS-108, que troca o corpo por um `SELECT class_id, count(*) ... GROUP BY class_id`. `listActivePreview(manager, classId, limit)` (GUS-104) devolve as primeiras matrículas ativas para a ficha da turma, também vazio até a GUS-108 (ver "Detalhe da turma"). O e2e substitui o provider para provar as regras, e a GUS-108 remove o override.
- **Arquivar** segue a seção 10: a turma arquivada sai da listagem padrão (a GUS-103 filtra `archived_at IS NULL`; as leituras por curso da GUS-102 já a deixam de fora), continua por id e vira somente leitura (409 `CLASS_ARCHIVED`). `status` é coluna e independe do arquivamento (RF-034).
- **Permissões:** `classes.manage` (diretoria, coordenação e superadmin) nas quatro mutações; `classes.view` (todos os perfis) em `GET /editions`, `GET /courses/:id/classes`, `GET /classes/summary-by-course` e `GET /classes/:id` (GUS-102 e GUS-104, que usam `@RequirePermission` e não `@Roles(Role.MEMBER)`: uma mudança futura de quem lê fica só na matriz). A matriz não mudou.

## 14. Aulas (GUS-151, GUS-154)

O módulo `lessons` guarda a **aula**: um encontro de uma turma, em um dia e um horário, criado a partir de um plano de aula ou avulso. Esta seção registra o que o código sozinho não conta. As decisões L1 a L12 do plano estão na tabela do fim; a geração em série (GUS-154) tem o item próprio logo antes de "Fora do card", e as decisões dela (G1 a G13) ficam na memória da feature, em `.agents/memory/features/e4-calendar-lessons.md`; a listagem e o calendário (GUS-153, decisões L13 a L26) estão na subseção 14.1.

- **Ciclo de vida.** A aula nasce `planned`. `PATCH /lessons/:id` troca entre `planned`, `confirmed` e `done`, sem regra de transição por enquanto (quem marca `done`, e quando, é a chamada, GUS-166). `cancelled` só vem de `PATCH /lessons/:id/cancel`, que grava `cancelReason`, `cancelledAt` (o mesmo instante de `updatedAt`) e `cancelledById`. Não existe `DELETE` nem arquivar aula: o estado final é `cancelled`, a linha fica, e a aula cancelada não é mais editada nem remarcada (409 `LESSON_CANCELLED`). Cancelar de novo é no-op (200, vale o primeiro motivo, sem evento e sem olhar a turma). `ck_lessons_cancellation` garante no banco que `status = 'cancelled'` e `cancelled_at` andam juntos.
- **Título e objetivo são cópia (RN-18).** Com `lessonPlanId`, o `POST` copia título e objetivo do plano quando o corpo os omite (um valor enviado vale mais, e `objective: null` deixa o objetivo vazio). A partir daí são da aula: editar ou arquivar o plano não muda aula já criada, e a resposta mostra em `lessonPlan.title` o título que o plano tem agora, que pode ser outro. `classId`, `lessonPlanId` e `sequenceOrder` são imutáveis (RN-20): o `PATCH` não os declara e o `whitelist` os descarta.
- **Plano de origem (L1, L2).** O plano precisa estar ativo (arquivado: 400 `LESSON_PLAN_ARCHIVED`); uma aula que já existe continua mostrando o plano arquivado, com `archivedAt`. Com `sequenceOrder`, o plano precisa estar exatamente nessa posição da sequência do curso da turma (`CourseLessonPlansService.findPosition`), senão 400 `LESSON_PLAN_NOT_IN_COURSE_SEQUENCE`; `sequenceOrder` sem plano é 400 `VALIDATION_FAILED`. Sem `sequenceOrder`, qualquer plano ativo vale (aula extra). A posição é uma fotografia: reordenar a sequência depois não muda a aula.
- **Dia e horário (L5, L6).** `date` e `originalDate` são colunas `date` ("AAAA-MM-DD", sem fuso, como as datas da turma). `startTime` e `endTime` são colunas `time` lidas como "HH:mm" pelo `timeOfDayTransformer`: o `pg` devolve "HH:mm:ss", e sem o transformer a comparação de uma edição veria mudança onde não há. A entrada é "HH:mm" estrito (`IsTimeOfDay`: "9:00", "14:00:00" e "24:00" são recusados). A aula não atravessa a meia-noite: `endTime > startTime`, senão 400 `INVALID_TIME_RANGE` (o nome do código não vem do card), com `ck_lessons_time_range` como rede de segurança. A duração (`durationMinutes`) é calculada na resposta, não é coluna. A data precisa cair no período da turma, extremos incluídos (RN-21): 400 `LESSON_OUTSIDE_CLASS_PERIOD`.
- **Remarcar é a mesma aula (L5, L8).** `date`, `startTime` e `endTime` só mudam por `PATCH /lessons/:id/reschedule`, que guarda a data anterior em `originalDate`: o `PATCH` comum não os aceita, para o histórico não ser contornado. `originalDate` guarda a **primeira** data (`??=`): remarcar de novo não a troca, e uma remarcação que só muda o horário também a preenche (é o que marca "esta aula foi remarcada"). `rescheduleReason` e `rescheduleNote` descrevem a última remarcação (omitidos viram null). O corpo traz a agenda nova inteira; `location` só muda quando vem (null limpa). A mesma agenda é no-op (200, sem evento). O `status` não muda, e remarcar aula `done` é permitido por enquanto.
- **Turma arquivada: 409 nas quatro escritas (L9).** Inclusive no `POST`, onde a seção 10.3 daria 400 (o id da turma está no corpo): o card fixa 409 e o front já mapeia assim. É a exceção à regra. O status da turma (`completed`, `cancelled`) é independente do arquivamento e não bloqueia aula (RF-034). Os outros ids do corpo seguem a seção 10.3: `CLASS_NOT_FOUND`, `LESSON_PLAN_NOT_FOUND`, `LESSON_PLAN_ARCHIVED` e `LESSON_PLAN_NOT_IN_COURSE_SEQUENCE` respondem 400 em `POST /lessons`, com `details` apontando o campo.
- **Ordem dos erros.** `POST`: `VALIDATION_FAILED`, `INVALID_TIME_RANGE`, `CLASS_NOT_FOUND`, `CLASS_ARCHIVED`, `LESSON_OUTSIDE_CLASS_PERIOD`, `LESSON_PLAN_NOT_FOUND`, `LESSON_PLAN_ARCHIVED`, `LESSON_PLAN_NOT_IN_COURSE_SEQUENCE`. `PATCH`: 404, `LESSON_CANCELLED`, `CLASS_ARCHIVED`. `cancel`: 404 e, se a aula já está cancelada, no-op; senão `CLASS_ARCHIVED`. `reschedule`: `VALIDATION_FAILED`, `INVALID_TIME_RANGE`, 404, `LESSON_CANCELLED`, `CLASS_ARCHIVED`, `LESSON_OUTSIDE_CLASS_PERIOD`.
- **Travas entre módulos.** `lessons` lê a turma por `ClassesService.getClassSummary(id, manager, { forShare: true })` e o plano por `LessonPlansService.getLessonPlanSummary(id, manager, { forShare: true })`, dentro da transação da aula. O `FOR SHARE` conflita com o `FOR UPDATE` do `update` e do `archive` da turma (e do plano): criar uma aula e arquivar a turma (ou mudar o período dela, ou editar o plano) ao mesmo tempo são feitos um depois do outro. Assim a aula nunca é gravada contra uma turma que acabou de ser arquivada, nem com o título de uma versão do plano e o "ativo" de outra. `FOR SHARE` não conflita com `FOR SHARE`: aulas da mesma turma não esperam umas pelas outras. A ordem é sempre a mesma, para não haver espera em círculo: ao criar, a turma, depois o plano, depois o insert; nas outras escritas, a aula `FOR UPDATE` e depois a turma `FOR SHARE`. `classes` e `catalog` nunca travam aula, e o `FOR UPDATE` que a matrícula (GUS-108) vai tomar na turma convive com isso pelo mesmo motivo. O lock só existe dentro de uma transação: o `manager` de quem chama é obrigatório quando se pede `forShare`.
- **`LessonCreationService` é o ponto de reuso da GUS-154.** `createMany(manager, schoolClass, drafts, actorId)` transforma rascunhos (`LessonDraft`, com título e objetivo já resolvidos) em aulas `planned`, valida o lote inteiro antes de gravar (turma arquivada, `INVALID_TIME_RANGE`, `LESSON_OUTSIDE_CLASS_PERIOD`) e não abre transação nem emite evento: quem chama passa o `manager` da sua transação, lê a turma com `forShare` e emite o `LESSON_CREATED` de cada aula depois do commit. É interno ao módulo (`LessonsModule` não o exporta), porque a geração em série também mora em `lessons`.
- **Auditoria e dados pessoais (L10).** Os eventos saem depois do commit e só quando algo mudou. `postNotes`, `cancelReason`, `rescheduleReason` e `rescheduleNote` são texto livre e podem conter dado de saúde do aluno (RNF-13): `postNotes` aparece no evento do `PATCH` só em `changedFields`, sem o valor, e os outros três não vão para evento nenhum. Título, data, horário, local e status entram com valor.
- **`lesson.cancelled` (RN-07).** Ao cancelar (só quando a aula foi cancelada agora), `lessons` emite `LessonCancelledEvent` (`shared/events/lesson-cancelled.event.ts`) além do evento de auditoria. É o gancho do estorno das horas já lançadas: o `hours` (E7) vai ouvi-lo e estornar, sem que `lessons` o conheça. Hoje ninguém ouve.
- **Permissões.** `lessons.view` (todos os perfis) em `GET /lessons/:id`; `lessons.manage` (diretoria, coordenação e superadmin) nas quatro escritas. O escopo é só `all` ou `none`: o guard decide e o service não usa `PermissionPolicy`. A matriz não mudou. Os escopos `allocated` e `lessonTeacher` passam a ter dado com a alocação (GUS-158, seção 15): quem está alocado vive em `lesson_assignments`; exportar os professores e os monitores da aula para a `PermissionTarget` (`lessonTeacherIds` e `lessonMonitorIds`) é da chamada (GUS-166).
- **Cobertura e exports (GUS-158).** As cinco respostas de aula trazem `coverage` e `belowExpectedMonitors`, contados pelo `LessonCoverageRegistry` sobre as alocações confirmadas (seção 15); a aula recém-criada nem consulta, porque ninguém está alocado a ela. O `LessonsModule` agora exporta `LessonsService` (`getLessonSummary`, com `FOR SHARE` opcional, e `findLessonSummaries`, várias aulas numa consulta, o contrato de que o `assignments` precisa, com `LessonStatus` reexportado de `lessons.service.ts`) e o `LessonCoverageRegistry`; o `LessonCreationService` continua interno. O `FOR SHARE` de `getLessonSummary` conflita com o `FOR UPDATE` de `update`, `cancel` e `reschedule`, e a aula nunca trava uma alocação. A listagem e o calendário (14.1) usam a mesma porta, pela leitura `findConfirmedStaff`, que traz também o professor confirmado.
- **Geração em série (GUS-154).** `POST /classes/:id/lessons/preview` (`previewClassLessons`, 200) e `POST /classes/:id/lessons/generate` (`generateClassLessons`, 201), as duas com `lessons.manage` e o mesmo corpo `{ weekday, startTime, endTime, firstDate, location? }`, num controller próprio (`ClassLessonsController`) porque a turma é o recurso da URL. A coordenação escolhe o dia da semana, o horário e a primeira data, olha a prévia e gera: uma aula por plano **ativo** da sequência do curso, na ordem dela (RN-17), uma por semana, copiando título e objetivo do plano (RN-18) e gravando `lessonPlanId` e `sequenceOrder` (a posição do plano). O cálculo das datas é puro (`services/lesson-series.ts`, só sobre "AAAA-MM-DD", testável sem Nest nem banco) e o `LessonGenerationService` orquestra a leitura, as travas e a gravação. A prévia **não grava nada, não trava e não emite evento**; o `generate` grava tudo ou nada em uma transação (via `LessonCreationService.createMany`) e emite um `LESSON_CREATED` por aula depois do commit, com o mesmo payload do `POST /lessons` (`lesson-audit.ts`). A resposta do `generate` é `{ classId, lessons }`, e a da prévia traz o período da turma, a duração do horário (`durationMinutes`), a contagem de aulas fora do período e, por item, `expectedDurationMinutes` (a do plano, que o Figma mostra) e `outsideClassPeriod`.
  - **`weekday` e `firstDate` (G3).** A primeira aula cai no primeiro `weekday` **a partir de** `firstDate`: a própria data quando já é aquele dia, senão o próximo (segunda com `weekday` terça começa na terça seguinte, nunca na anterior); a prévia mostra a data real. Cada aula seguinte, uma semana depois. Sem feriados, sem datas a pular, um dia por semana.
  - **Aula fora do período (G4, RN-21).** O sistema não grava aula fora do período da turma, antes do primeiro dia ou depois do último, extremos dentro. A prévia **marca** (`outsideClassPeriod`, e `outsideClassPeriodCount`) e responde 200; o `generate` responde 409 `LESSONS_OUTSIDE_CLASS_PERIOD` (`details[].field = "firstDate"`, com as posições na mensagem) **antes de qualquer insert**. É 409, e não o 400 da aula avulsa, porque o corpo está certo: ele briga com o período da turma, que a coordenação estende (`PATCH /classes/:id`) ou cuja série move (`firstDate`). Não há rota de estender o período pelo modal.
  - **"Já geradas" (G1).** A turma já tem as aulas da sequência quando existe uma aula dela com `sequenceOrder`, **cancelada inclusive**: a posição é a marca de "veio da sequência", e a cancelada continua existindo (F4.5). Aula avulsa, sem `sequenceOrder`, não conta. Gerar de novo responde 409 `LESSONS_ALREADY_GENERATED` sem duplicar, e a prévia também (ela é "o que o generate faria"). Não existe desfazer nem regerar.
  - **Plano arquivado na sequência (G6).** Não origina aula (L1, RN-27): é pulado, listado em `skippedLessonPlans` (`sequenceOrder`, `lessonPlanId`, `title`, `archivedAt`) e **não abre buraco nas datas**. As outras aulas guardam a posição real, então pode faltar um número (1, 3 e 4). Sequência vazia ou toda arquivada: 409 `COURSE_WITHOUT_SEQUENCE`.
  - **Corrida e travas (G2).** Duas gerações da mesma turma ao mesmo tempo seriam duas séries. `pg_advisory_xact_lock(hashtext('lessons.generate:<id da turma>'))` dentro da transação as serializa (a mesma técnica do grafo de pré-requisitos do catálogo), e a checagem de "já geradas" é refeita **depois** da trava, em `READ COMMITTED`, então a que esperou enxerga o que a outra gravou: uma responde 201 e a outra 409. A ordem das travas é sempre a mesma, para não haver espera em círculo: **a turma `FOR SHARE`, o advisory lock da turma, o curso `FOR SHARE`, os planos `FOR SHARE`, o insert**. É a ordem do `POST /lessons` (turma, depois plano) e a do `PUT /courses/:id/lesson-plans` (curso `FOR UPDATE`, depois planos `FOR SHARE`). O `FOR SHARE` do curso é o que impede a sequência de ser substituída entre a leitura e o insert, e o dos planos, que um plano seja editado ou arquivado no meio. O limite: o advisory lock não serializa contra um `POST /lessons` manual **com** `sequenceOrder` no mesmo instante, um caso raro que se corrige cancelando a aula.
  - **Erros, na ordem.** 401, 403 `FORBIDDEN`, 404 `CLASS_NOT_FOUND` (id mal formado, pelo pipe) e 400 `VALIDATION_FAILED` (os pipes, antes de ler qualquer coisa), 400 `INVALID_TIME_RANGE` (antes da transação), 404 `CLASS_NOT_FOUND` (turma inexistente, que aqui é 404 porque a turma está na URL), 409 `CLASS_ARCHIVED`, 409 `LESSONS_ALREADY_GENERATED`, 409 `COURSE_WITHOUT_SEQUENCE` e, só no `generate`, 409 `LESSONS_OUTSIDE_CLASS_PERIOD`. A prévia responde os mesmos, menos o do período (G7).
  - **O que não bloqueia (G10, G11).** Curso arquivado (continua sendo lido, e as turmas dele continuam editáveis, seção 13) e turma `completed` ou `cancelled` (o status é independente do arquivamento, RF-034) geram normalmente; só a turma arquivada é somente leitura (RN-27).
  - **Contrato entre módulos (G12).** `CourseLessonPlansService.getSequenceSummaries(courseId, manager?, { forShare? })` devolve a sequência em ordem de posição, um `SequencedLessonPlanSummary` por plano (título, objetivo, duração, `archivedAt` e `position`), já com `FOR SHARE` nos planos quando pedido (sem `manager`, lança, como `getCourseSummary`). Um plano removido (soft delete) fica de fora, o que `readSequence` já fazia; o `readSequence` não serve porque não traz o objetivo, e ler cada plano à parte seria uma consulta por plano. `lessons` não toca tabela do `catalog`.
  - **Fotografia.** Depois de gerar, mexer na sequência do curso ou nos planos não muda as aulas (RN-18, RN-20), e um plano acrescentado à sequência depois não gera aula sozinho: gerar de novo responde 409, e a aula dele se cria à mão, por `POST /lessons`.
- **Fora do card.** Alocação (GUS-158), chamada (GUS-166), listener de estorno de horas (E7), descancelar, regras de transição de status e de remarcar aula `done`, conflito de horário ou de local entre aulas, seed de dados de desenvolvimento e, da geração em série, o front (GUS-157), desfazer ou regerar, mais de um dia por semana, feriados e datas a pular, e estender o período da turma pelo modal. A listagem, os filtros e o calendário eram a GUS-153: subseção 14.1.
- **Riscos e pendências.** (1) `PATCH /classes/:id` pode encurtar o período da turma sem olhar as aulas, e depois disso uma turma pode ter aula fora do período (P9 da GUS-101), caso que a geração em série torna mais provável (a série pode ter sido gerada dentro do período que depois encolheu): a F2.6 decide se bloqueia com 409 ou avisa (a GUS-153 não decide: a listagem não filtra pelo período da turma, então essas aulas continuam aparecendo); remarcar uma aula assim exige uma data dentro do período novo. (2) A L5 está a confirmar no Figma (modal Editar aula, node 662-33222): se o modal tiver data e hora, o PO decide entre mandar o front para `rescheduleLesson` ou aceitar a mudança no `PATCH` sem histórico. (3) Não há conflito de horário: duas aulas da mesma turma no mesmo dia e hora são aceitas.

| #   | Pergunta                                       | Decisão                                                                                                                                                   |
| --- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | Plano arquivado pode originar aula nova?       | Não: 400 `LESSON_PLAN_ARCHIVED` (RN-27). A aula que já existe continua mostrando o plano arquivado.                                                       |
| L2  | `sequenceOrder` precisa bater com a sequência? | Sim, por `findPosition`; sem plano é `VALIDATION_FAILED`; sem `sequenceOrder`, qualquer plano ativo vale (aula extra).                                    |
| L3  | `expectedStudents` e `expectedMonitors`        | Opcionais, inteiros de 0 a 1000 e de 0 a 100, com `CHECK` no banco; null é "não informado"; não copiam da turma.                                          |
| L4  | O que o `PATCH` aceita                         | `title`, `objective`, `location`, `expectedStudents`, `expectedMonitors`, `subject`, `postNotes` e `status` em {planned, confirmed, done}, sem transição. |
| L5  | O `PATCH` muda data e horário?                 | Não: só por `reschedule`, para o `originalDate` não ser contornado. A confirmar no Figma.                                                                 |
| L6  | Formatos                                       | `date` AAAA-MM-DD; horário "HH:mm" estrito em colunas `time` com transformer; `endTime > startTime` (`INVALID_TIME_RANGE`).                               |
| L7  | O `POST` aceita `status`?                      | Não: nasce `planned`. `subject` entra no `POST`; `postNotes`, só no `PATCH`.                                                                              |
| L8  | Remarcar aula já remarcada                     | `originalDate` guarda a primeira data; motivo e nota são os da última; `status` não muda; mesma agenda é no-op; remarcar `done` é permitido por ora.      |
| L9  | `CLASS_ARCHIVED`: quais rotas e qual status?   | 409 nas quatro escritas, inclusive no `POST`; o status da turma (`completed`, `cancelled`) não bloqueia.                                                  |
| L10 | Dados no evento de auditoria                   | `postNotes` só em `changedFields`; `cancelReason`, `rescheduleReason` e `rescheduleNote` fora dos eventos.                                                |
| L11 | Nome do enum no banco                          | `lessons_status_enum`, a convenção do repositório, e não o `lesson_status_enum` do card.                                                                  |
| L12 | O que é "seed de exemplo"                      | As requests do Bruno com corpos de exemplo e o `example` do Swagger; a infraestrutura de seed de desenvolvimento fica fora do card.                       |

### 14.1 Listagem e calendário (GUS-153)

`GET /lessons` (`listLessons`) e `GET /lessons/calendar` (`listLessonsCalendar`) leem aulas em lote, no `LessonListingService`, separado do `LessonsService` (que já passa de 600 linhas). Esta subseção registra o que o código sozinho não conta; as decisões L13 a L26 estão na tabela do fim.

- **Duas rotas, um item.** A lista é paginada (padrão 20, no máximo 100). O calendário devolve um array simples com todas as aulas do período, sem página, de até 42 dias contando as duas pontas (a grade de um mês tem seis semanas). As duas respondem `LessonListItemResponseDto` (`id`, `class { id, code, name, colorIndex }`, `date`, `startTime`, `endTime`, `title`, `status`, `teacher`, `belowExpectedMonitors`), com `lessons.view`, e na mesma ordem: `date`, `startTime` e `id`, crescente. O `id` fecha o desempate, então a página nunca repete aula. O item é mais leve que o `LessonResponseDto` do detalhe.
- **Filtros.** `classId`, `courseId`, `lessonPlanId`, `status` (um valor só), `from`, `to` e `search` valem nas duas rotas e se combinam com E. No calendário `from` e `to` são obrigatórios e `page` e `limit` caem no `whitelist`; na lista, `from` e `to` são opcionais, cada um sozinho. `from` depois de `to` é 400 `INVALID_DATE_RANGE` e mais de 42 dias no calendário é 400 `DATE_RANGE_TOO_LONG`, os dois com `details` em `to` e respondidos antes de qualquer leitura. Id de filtro que não existe responde 200 vazio, não 404. Sem `status`, as aulas canceladas aparecem.
- **A turma vem do `classes`, sem join.** O `LessonListingService` chama `ClassesService.listClassRefs` (contrato novo de `classes`: `ClassRef { id, code, name, courseId, archivedAt, creationRank }`) e pede as aulas com `class_id IN (...)` das turmas devolvidas. Assim o `courseId` e a turma de cada item não leem a tabela `classes` (módulo é caixa fechada, seção 1) e o filtro fica na consulta, então o `total` sai certo. Sem filtro de turma, o `IN` leva todas as turmas não arquivadas: dezenas por semestre. Se crescer, a saída é restringir às turmas cujo período cruza `[from, to]`, o que depende de resolver a P9.
- **Turma arquivada** (RN-27): as aulas dela ficam fora por padrão (lista, calendário e `courseId`) e aparecem quando `classId` é a turma (`includeArchived` só é verdadeiro com `classId`). Turma `completed` ou `cancelled` (status) não esconde aula: só o arquivamento esconde.
- **Cor estável por turma.** `colorIndex = (creationRank - 1) mod 8`, em que `creationRank` é a posição da turma por `created_at, id` entre **todas** as turmas, arquivadas e excluídas inclusive: o `ROW_NUMBER()` roda numa subconsulta sobre a tabela inteira e os filtros vêm por fora. Por isso a cor não muda com o filtro, a página, o período nem quando outra turma é arquivada, e uma turma nova só toma o próximo número. O front usa `calendar/event-(colorIndex + 1)`. **N = 8 a confirmar com os tokens do Figma**: o front ainda não tem `calendar/event-*`.
- **Busca por todas as palavras** (CA3 do card): `applyTextSearchAllWords` (seção 12.1) exige que cada palavra do termo apareça no título **ou** no assunto, em qualquer ordem: "senhas privacidade" acha "Senhas e privacidade". `applyTextSearch` não mudou. Os índices GIN `idx_lessons_title_search` e `idx_lessons_subject_search` e o B-tree `idx_lessons_date` vêm da migration `CreateLessonListIndexes`; só o `idx_lessons_date` é declarado na entidade.
- **`teacher` e `belowExpectedMonitors`** (GUS-158, A19). Entraram no contrato desde a GUS-153, com valor fixo (`null` e `false`), e a alocação os preencheu sem mudar o contrato. `teacher` é o professor **confirmado** da aula, `{ id, name }` e nada mais da pessoa: o professor pendente é candidato e não aparece, e a aula cancelada mantém o dele, porque cancelar a aula não cancela as alocações (A13). `belowExpectedMonitors` segue a regra do detalhe (`isBelowExpectedMonitors`, a A2): só monitores confirmados contam, e é falso para aula cancelada e para `expectedMonitors` nulo. O `LessonListingService` não conhece o `assignments` nem o `people`: pergunta ao `LessonCoverageRegistry` (a porta da seção 15), **uma vez por página** na lista e **uma vez por período** no calendário, com os ids das aulas que acabou de ler (`findConfirmedStaff`), nunca uma vez por aula; página ou período sem aula não pergunta nada. Sem contador registrado (um app sem o módulo de alocação), toda aula lê como "ninguém confirmado": `teacher` nulo e `belowExpectedMonitors` verdadeiro para quem espera monitores, que é o que o detalhe responde.
- **A ordem dos métodos do controller é a ordem das rotas.** `listLessons` e `listLessonsCalendar` vêm **antes** de `getLesson`: o Express casa na ordem de registro e, com `:id` primeiro, "calendar" seria tomado por id e responderia 404 `LESSON_NOT_FOUND`. O spec do controller confere a ordem e o e2e confere a resposta (400 `VALIDATION_FAILED` sem a query).
- **Permissão.** `lessons.view` (todos os perfis), escopo `all`, sem `PermissionPolicy`. A matriz não mudou.
- **Fora do card.** Chamada (GUS-166) e horas (E7), filtro com vários status, bloquear ou avisar sobre o período da turma encurtado (P9, continua aberto para a F2.6), listagem e detalhe de turmas (GUS-103 e GUS-104, que devem reaproveitar `listClassRefs` em vez de criar um segundo caminho), geração em série (GUS-154), exportar o `LessonsModule`, agenda do membro, exportação iCal, PDF ou relatório, mudança na matriz de permissões e seed de desenvolvimento.

| #   | Pergunta                                           | Decisão                                                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| L13 | De onde vêm `courseId` e a turma do item?          | De `ClassesService.listClassRefs` (service exportado), sem SQL nem join na tabela `classes`. Resolver os ids de turma antes e filtrar por `class_id IN (...)` cabe no volume (RNF-40/41) e deixa o filtro na consulta, então o `total` sai certo.                        |
| L14 | `class.name` pode ser null?                        | Não: é o `name` da turma ou, se ele for null, o `code`. `code` também vem no item. O front mostra um rótulo só, e o `code` fica para o chip.                                                                                                                             |
| L15 | Como se escolhe a cor da turma?                    | `colorIndex = (creationRank − 1) mod 8`, com o rank por `created_at, id` entre todas as turmas. Turmas do mesmo semestre nascem em sequência e recebem cores diferentes até 8 (com hash, 5 turmas em 8 cores colidem em cerca de 79% dos casos). N a confirmar no Figma. |
| L16 | Como é o período da lista e do calendário?         | Calendário: `from` e `to` obrigatórios, `from <= to` (400 `INVALID_DATE_RANGE`) e até 42 dias contando as pontas (400 `DATE_RANGE_TOO_LONG`). Lista: opcionais, cada um sozinho vale, e `from <= to` quando vêm os dois. `details` aponta `to`.                          |
| L17 | Qual é a ordem e a paginação?                      | `date`, `startTime` e `id`, crescente, nas duas rotas. Paginação padrão do projeto (20, no máximo 100). A ordem é estável: as páginas não repetem aula.                                                                                                                  |
| L18 | `status` aceita quantos valores? E as canceladas?  | Um valor só. Sem filtro, as canceladas **aparecem** (o calendário as mostra com estilo próprio, e o front filtra se quiser).                                                                                                                                             |
| L19 | O que acontece com aula de turma arquivada?        | Fica **fora** por padrão (lista, calendário e `courseId`) e **aparece** quando `classId` é essa turma. RN-27: a turma arquivada sai das listagens e continua acessível por id.                                                                                           |
| L20 | Como se chama o responsável?                       | `teacher: LessonPersonRefDto \| null`, o professor **confirmado** (GUS-158, A19); null quando não há, e o front mostra "—". Nome **confirmado** na GUS-158: `responsible` foi descartado, pois o campo é o professor e a cobertura já diz `teacher`.                     |
| L21 | O que é `belowExpectedMonitors`?                   | A regra da cobertura (A2), preenchida na GUS-158 (A19): `true` com menos monitores **confirmados** que `expectedMonitors`; `false` para aula cancelada e para `expectedMonitors` nulo, como no detalhe.                                                                  |
| L22 | Como a busca casa as palavras?                     | Todas as palavras, cada uma no título ou no assunto (`applyTextSearchAllWords`, novo). `applyTextSearch` não muda: mudar o padrão global alteraria a busca de pessoas, fora do card.                                                                                     |
| L23 | Que índices a busca e o calendário pedem?          | Migration `CreateLessonListIndexes`: `idx_lessons_title_search` e `idx_lessons_subject_search` (GIN, só na migration) e `idx_lessons_date` (B-tree, declarado também na entidade).                                                                                       |
| L24 | Qual é a permissão? E id de filtro que não existe? | `lessons.view` (todos os perfis), escopo `all`, sem `PermissionPolicy`. Id de filtro desconhecido responde 200 vazio, não 404 (o mesmo padrão da GUS-151 e do `summary-by-course`).                                                                                      |
| L25 | Que formato tem o calendário?                      | Um array simples com o mesmo item da lista, e aceita `search`: um tipo só no Orval. "Os mesmos filtros", como pede o card.                                                                                                                                               |
| L26 | Onde mora o código? E a ordem das rotas?           | `LessonListingService` separado do `LessonsService`. As duas rotas são declaradas antes de `GET /lessons/:id`: sem a ordem certa, `/lessons/calendar` responderia 404 `LESSON_NOT_FOUND`.                                                                                |

## 15. Alocações (GUS-158)

O módulo `assignments` guarda a **alocação**: o membro, como professor ou monitor, numa aula. Esta seção registra o que o código sozinho não conta. As decisões A1 a A17 do plano, mais a A18 e a A19, das revisões, estão na tabela do fim e a memória da feature em `.agents/memory/features/e5-assignments.md`.

- **A porta de cobertura (A1, A2).** Toda resposta de aula traz `coverage` e `belowExpectedMonitors` (F5.4), contados sobre as alocações. Só que `lessons` não pode importar `assignments`: a seta é `assignments → lessons` (seção 3), e importar nos dois sentidos seria um ciclo. A saída é uma **porta**, a primeira do repositório: o `lessons` define a interface `LessonStaffCounter` (`countConfirmedStaff(lessonIds, manager?)`, que devolve um `Map` de aula para `{ teachers, monitors }`, com uma entrada só por aula que tem alguém confirmado) e o `LessonCoverageRegistry`, que o `LessonsModule` exporta; o `assignments` implementa a porta (`LessonStaffCounterService`) e se registra no `onModuleInit`. Sem contador registrado, o registry devolve um mapa vazio e toda aula lê "ninguém confirmado" (objeto nulo): uma aplicação que carrega `lessons` sem `assignments` continua servindo as suas aulas. Um segundo contador lança erro ao se registrar. A contagem é **uma consulta agregada** (`COUNT(*) FILTER` por papel, `GROUP BY` aula), então quem lê várias aulas pede os ids da página inteira numa chamada só, nunca uma por aula (a listagem e o calendário da GUS-153, no item A19 abaixo). Recusados: `forwardRef` ou import mútuo (ciclo); SQL de `lessons` na tabela `lesson_assignments` (quebra a caixa fechada); contadores desnormalizados por evento (podem divergir da fonte, e o card pede consulta agregada); e uma rota `GET /lessons/:id/coverage` (não atende a listagem em lote e contraria o card).
- **Só a confirmada conta (A2).** `coverage.teacher.expected` é sempre 1; `coverage.monitors.expected` é o `expectedMonitors` da aula, que pode ser nulo (L3). `belowExpectedMonitors` é verdadeiro só quando a aula não está `cancelled`, o `expectedMonitors` não é nulo e há menos monitores confirmados do que isso. O professor fica fora dele (a falta de professor se lê em `coverage.teacher`), e a alocação `pending` nunca conta. A aula cancelada mostra a cobertura, mas não acusa falta.
- **Listagem e calendário (A19).** `GET /lessons` e `GET /lessons/calendar` mostram o professor confirmado de cada aula (`teacher`, `{ id, name }`) e `belowExpectedMonitors` (14.1). O `LessonListingService` pergunta ao `LessonCoverageRegistry` **uma vez por página** (lista) e **uma vez por período** (calendário), com os ids das aulas lidas, nunca uma vez por aula, e a página ou o período sem aula não pergunta nada. Para isso a porta ganhou **uma segunda leitura em vez de um professor dentro de `countConfirmedStaff`**: `countConfirmedStaff` segue devolvendo só as contagens, que é o que o detalhe da aula (`GET /lessons/:id`) e as respostas das escritas precisam; as escritas leem **de dentro da transação da aula**, e `PeopleService.findRefsByIds` não aceita `manager`, então pagar o nome ali seria uma segunda conexão do pool pedida por quem já segura uma, e uma consulta que essas cinco rotas jogariam fora. `findConfirmedStaff(lessonIds)` devolve as contagens **e** o professor confirmado (`ConfirmedStaff`, com `teacher: { id, name } | null`), para as leituras simples que desenham uma linha, e por isso não leva `manager`. O `LessonStaffCounterService` implementa as duas sobre a mesma consulta agregada (o id do professor confirmado vem no mesmo `GROUP BY`: o índice único parcial garante no máximo um) e resolve os nomes da página inteira numa só chamada a `PeopleService.findRefsByIds`, com os professores sem repetir; página sem professor confirmado não lê nome. Pessoa removida vira `teacher: null`, e as contagens ficam como estão. O objeto nulo `NO_CONFIRMED_STAFF` (sem professor, zero monitores) vale para as duas leituras: sem contador registrado, a lista responde `teacher: null` e `belowExpectedMonitors` verdadeiro para quem espera monitores, o mesmo que o detalhe. A regra do indicador mora num lugar só, `isBelowExpectedMonitors`, usada pelo detalhe, pela lista e pelo calendário.
- **Membro ativo (A3).** "Ativo" é papel de acesso, acesso habilitado e, havendo perfil de membro, perfil aprovado e com `status = active` (`isActiveMember`, em `people/services/members.service.ts`, o único lugar que diz "membro ativo"). A inativação (GUS-147) já desliga o acesso, mas `PATCH /access/:id/enabled` pode religá-lo com o membro ainda inativo; o `status` o mantém fora. `MembersService.getMemberSummary` devolve `{ id, name, active, departmentIds }` e `null` para quem não é membro (aluno, id desconhecido ou mal formado: o mesmo predicado de `getMember`). Aluno é 400 `MEMBER_NOT_FOUND`; membro sem acesso, inativado, ou com cadastro `pending` ou `rejected`, é 409 `MEMBER_INACTIVE`.
- **Dois índices únicos parciais (A4, A5).** São eles que garantem as duas regras, porque dois pedidos ao mesmo tempo passam juntos pelas pré-checagens do service: `uq_lesson_assignments_lesson_id_person_id_active` (um lugar por membro na aula: `pending` e `confirmed` ocupam, `cancelled` e `declined` liberam) e `uq_lesson_assignments_lesson_id_confirmed_teacher` (um professor confirmado por aula: vários professores `pending` são candidatos, e monitor nunca entra). Os dois ignoram linha apagada (`deleted_at`). O papel não entra no primeiro: o mesmo membro como professor e como monitor da mesma aula também é `DUPLICATE_ROLE_IN_LESSON`. O service pré-checa e responde primeiro com o erro de negócio; a violação (23505) cai no mesmo 409 quando a corrida passa pelas pré-checagens, e o e2e prova isso desligando as pré-checagens. O predicado fica na entidade e na migration, e o e2e de schema o confere em `pg_indexes` (seção 5).
- **Locks.** Criar: a aula `FOR SHARE` (`LessonsService.getLessonSummary(..., { forShare: true })`), depois o membro `FOR SHARE` (`MembersService.getMemberSummary(..., { forShare: true })`), depois o insert. Confirmar: a alocação `FOR UPDATE`, depois a aula `FOR SHARE`, depois o membro `FOR SHARE`. Cancelar: só a alocação `FOR UPDATE`. O `FOR SHARE` da aula conflita com o `FOR UPDATE` de `LessonsService.update`, `cancel` e `reschedule`, então não nasce alocação numa aula que acabou de ser cancelada; o do membro conflita com o `FOR UPDATE` de `AccessService` e da inativação do membro (`MembersService.deactivateMember`, GUS-147, que trava a pessoa antes do perfil), então não nasce alocação de um membro que acabou de perder o acesso ou de ser inativado. `FOR SHARE` não conflita com `FOR SHARE`: duas alocações na mesma aula, ou do mesmo membro, não esperam uma pela outra. Não há espera em círculo, porque `lessons` e `people` nunca travam uma alocação. O nome do membro na resposta de confirmar e cancelar é lido depois do commit (`PeopleService.findRefsByIds` não aceita `manager`, e uma leitura de outra conexão não espera dentro de uma transação que segura uma).
- **Ordem dos erros.** `POST`: `VALIDATION_FAILED`, `LESSON_NOT_FOUND` (404), `LESSON_CANCELLED`, `MEMBER_NOT_FOUND` (400: o `personId` vem no corpo, então leva `details`, seção 10.3), `MEMBER_INACTIVE`, `DUPLICATE_ROLE_IN_LESSON`, `LESSON_TEACHER_TAKEN`. `confirm`: `ASSIGNMENT_NOT_FOUND`, no-op se já está confirmada, `ASSIGNMENT_NOT_PENDING`, `LESSON_CANCELLED`, `MEMBER_INACTIVE`, `LESSON_TEACHER_TAKEN`. `cancel`: `ASSIGNMENT_NOT_FOUND`, no-op se já está cancelada, `ASSIGNMENT_NOT_ACTIVE` (recusada). `GET /members/:id/assignments`: `MEMBER_NOT_FOUND` (404) antes do escopo (403 `FORBIDDEN_SCOPE`).
- **Confirmar e cancelar (A6, A7).** O card pede a cobertura mudando "ao confirmar ou cancelar", mas só a candidatura (GUS-160) criaria uma alocação `pending` para confirmar, então entra `PATCH /assignments/:id/confirm` com `assignments.create`. Recusar (`declined`) e aprovar candidatura (`assignments.review`) ficam na GUS-160. Confirmar grava `reviewedById` e `reviewedAt` (a criação já `confirmed` também); cancelar grava `cancelledById` e `cancelledAt` (as colunas `cancelled_*` não estão na lista do card) e mantém `reviewed_*`. Não existe `DELETE`. Confirmar o que já está confirmado e cancelar o que já está cancelado respondem 200 sem escrever e sem evento, como o cancelamento da aula (seção 14). Cancelar é permitido também numa aula cancelada, e cancelar a aula não cancela as alocações dela (A13).
- **Listas (A10).** `GET /lessons/:id/assignments` e `GET /members/:id/assignments` trazem todo status e não são paginadas. A do membro não traz turma nem curso da aula (viriam dos outros módulos), só `{ id, title, date, startTime, endTime, status }`; pede as aulas numa chamada só (`LessonsService.findLessonSummaries`) e ordena por dia e horário de início decrescentes. **Risco:** a lista do membro cresce sem limite; paginar exige ordenar pela data da aula, que mora em `lessons`.
- **Auditoria e dados pessoais (A15).** `LESSON_ASSIGNMENT_CREATED`, `LESSON_ASSIGNMENT_CONFIRMED` e `LESSON_ASSIGNMENT_CANCELLED` saem depois do commit e só quando algo mudou, com `targetType` `lesson_assignment`. A `note` é texto livre e pode ter dado pessoal (RNF-13): nunca vai para o evento, como o motivo do cancelamento da aula (L10), e só é lida por quem tem `assignments.create` (A18): `GET /lessons/:id/assignments`, que todo perfil lê, devolve `note: null` em todo item para os outros. A decisão sai de `PermissionPolicy.can(ator, assignments.create)` no `AssignmentsService.listByLesson`, e não do perfil escrito no código, então mudar a matriz muda quem lê a nota; o mapper exige a decisão como argumento, sem valor padrão, para nenhuma resposta nova esquecer dela. As rotas de escrita já exigem a permissão, então respondem a nota; a lista do membro não a tem.
- **Permissões.** `assignments.create` (diretoria, coordenação e superadmin, escopo `all`: o diretor aloca membro de qualquer departamento, A14) em `POST /lessons/:id/assignments` e nas duas rotas `PATCH`; `lessons.view` (todos os perfis) em `GET /lessons/:id/assignments`, sem a `note` para quem não tem `assignments.create` (A18); `members.view` em `GET /members/:id/assignments`, com o escopo `department` resolvido no service por `PermissionPolicy.assertCan` (coordenação lê qualquer membro; o diretor só o do próprio departamento aprovado, `FORBIDDEN_SCOPE` fora dele e para quem não tem departamento; o membro recebe 403 `FORBIDDEN`). A matriz não mudou: só o texto de `assignments.create` no catálogo.
- **Gancho da GUS-147 (inativação de membro).** Desativar o acesso em `/access` (auth) e inativar o membro (GUS-147) impedem alocação nova, mas hoje **não** cancelam as alocações futuras que ele já tem. O plano é um evento `member.deactivated` (`MemberDeactivatedEvent`, em `shared/events/`), emitido por `people` depois do commit, e um listener em `assignments` que cancela as alocações ativas de aulas com `date >= todayInAppTimeZone()`. Nada disso é implementado aqui.
- **Fora do card e pendências.** Candidatura, recusar e "Minhas aulas" (GUS-160); cancelar as alocações ao cancelar a aula (sugerido como issue: ouvir `lesson.cancelled` em `assignments`); bloquear alocação em turma arquivada (A11); conflito de horário do membro entre aulas; exportar professores e monitores para os escopos `allocated` e `lessonTeacher` e a presença que gera horas (GUS-166, GUS-168); paginação das listas e seed de desenvolvimento.

| #   | Pergunta                                          | Decisão                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Como a aula conta quem está alocado sem ciclo?    | Uma porta em `lessons` (`LessonStaffCounter` + `LessonCoverageRegistry`, exportada), implementada em `assignments` (`LessonStaffCounterService`, que se registra no `onModuleInit`). Sem contador, a cobertura é zero (objeto nulo).              |
| A2  | O que entra na cobertura?                         | Só `confirmed`. `teacher.expected` é sempre 1; `monitors.expected` é o `expectedMonitors` da aula (nulo herda a L3). `belowExpectedMonitors` é falso para aula cancelada e para `expectedMonitors` nulo.                                          |
| A3  | O que é "membro ativo", e a inativação (GUS-147)? | Papel de acesso, acesso habilitado e, havendo perfil, aprovado. Cancelar as alocações futuras na inativação do membro fica para a GUS-147, por um evento `member.deactivated`. Risco: desativar o acesso em `/access` hoje não cancela alocações. |
| A4  | Como as duas regras resistem a concorrência?      | Dois índices únicos parciais; o 23505 vira o 409 do card. A aula e o membro são lidos `FOR SHARE`; ordem fixa dos locks (aula, membro, insert; no confirmar, alocação, aula, membro).                                                             |
| A5  | Um código ou dois para o papel duplo?             | Um só, `DUPLICATE_ROLE_IN_LESSON`, para qualquer segunda alocação ativa do membro na aula, com o mesmo papel ou com o outro. `cancelled` e `declined` não contam.                                                                                 |
| A6  | O card tem rota para confirmar?                   | Entra `PATCH /assignments/:id/confirm` (`assignments.create`), para o CA3 ser literal. Recusar e aprovar candidatura (`assignments.review`) ficam na GUS-160. Se o PO recusar a rota, o CA3 se prova com a criação `confirmed` e o cancelar.      |
| A7  | Colunas e no-ops de cancelar e confirmar          | `cancelled_at` e `cancelled_by_id` (fora da lista do card); `reviewed_*` no confirmar e na criação `confirmed`. Cancelar não tem corpo nem motivo. Repetir confirmar ou cancelar é no-op 200.                                                     |
| A8  | O `status` do `POST` tem padrão?                  | Não: é obrigatório, sem padrão escondido. O padrão do banco é `pending`, o lado seguro.                                                                                                                                                           |
| A9  | Códigos de erro que o card não nomeia             | `MEMBER_NOT_FOUND` é 400 quando o id vem no corpo (seção 10.3); `MEMBER_INACTIVE` e `LESSON_CANCELLED` são 409.                                                                                                                                   |
| A10 | As listas são paginadas? Trazem o quê?            | Não são paginadas, trazem todo status e não trazem turma nem curso da aula. Risco: a lista do membro cresce sem limite. A confirmar com o front (GUS-159).                                                                                        |
| A11 | Aula de turma arquivada recebe alocação?          | Pendente com o PO: não é bloqueada aqui. A RN-27 sugere bloquear, mas isso pediria que `getLessonSummary` trouxesse o arquivamento da turma.                                                                                                      |
| A12 | Aula `done` ou do passado recebe alocação?        | Recebe: é o registro retroativo de que a GUS-168 precisa.                                                                                                                                                                                         |
| A13 | Cancelar a aula cancela as alocações dela?        | Não. Ouvir `lesson.cancelled` em `assignments` fica sugerido como issue. Enquanto isso, a cobertura da aula cancelada aparece, mas não acusa falta.                                                                                               |
| A14 | Quem pode ser alocado, e por quem?                | Qualquer membro ativo com papel. O diretor aloca membro de qualquer departamento (`assignments.create` com escopo `all`).                                                                                                                         |
| A15 | Dados nos eventos de auditoria                    | `LESSON_ASSIGNMENT_CREATED`, `_CONFIRMED` e `_CANCELLED`, sem a `note` (texto livre, RNF-13, como a L10).                                                                                                                                         |
| A16 | De onde o e2e tira as fixtures?                   | Das que `people` e `lessons` exportam (seção 5): é o primeiro import de fixture entre módulos.                                                                                                                                                    |
| A17 | Nome dos enums                                    | No banco, `lesson_assignments_role_enum`, `lesson_assignments_status_enum` e `lesson_assignments_source_enum` (a convenção da L11); no Swagger, `AssignmentRole`, `AssignmentStatus` e `AssignmentSource`.                                        |
| A18 | Quem lê a `note` da alocação?                     | Só quem tem `assignments.create`, perguntado à `PermissionPolicy` e não ao perfil. A lista da aula devolve `note: null` aos outros, e o campo segue no contrato, nullable. Decisão do usuário na revisão (RNF-13: texto livre e sensível).        |
| A19 | Como a listagem mostra o professor, sem N+1?      | Segunda leitura na porta, `findConfirmedStaff` (contagens e professor com nome), uma chamada por página ou período e o nome numa só ao `people`; `countConfirmedStaff` fica só com as contagens (detalhe e escritas, dentro da transação).        |
