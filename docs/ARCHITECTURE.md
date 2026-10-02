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
auth       → people   (o guard carrega a Person e a situação do cadastro de membro a cada request)
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
│   ├── entities/
│   │   ├── base.entity.ts           # id (UUID v7), createdAt, updatedAt, deletedAt
│   │   └── archivable.columns.ts    # archivedAt, archivedById, archiveReason reutilizáveis (RN-27), ver seção 10
│   ├── dto/
│   │   ├── api-error.dto.ts         # ApiErrorDto, formato único de erro
│   │   ├── archive.dto.ts           # corpo comum de PATCH .../archive ({ reason? })
│   │   └── transforms.ts            # trim, trimToNull, trimLowerToNull (class-transformer)
│   ├── dates/
│   │   ├── calendar-date.ts         # APP_TIME_ZONE, todayInAppTimeZone, ageOn, isValidCalendarDate
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
- Fixtures são do módulo. Se dois módulos precisam do mesmo dado, o módulo dono exporta uma função; nada vai para `shared/`.
- Cada teste e2e limpa as tabelas que tocou.
- **Entidade × migration.** A CI não compara entidade com o SQL das migrations: o job "Entidades × migrations" só faz `migration:run`, `migration:revert` e `migration:run`, porque o `migration:generate` do TypeORM é inutilizável com enums (ver o comentário no `ci.yml`). O guarda de drift é um e2e de schema, que compara colunas, índice único e FKs de cada entidade com o que as migrations criaram; o primeiro é `people/__tests__/people.repository.e2e.spec.ts`. Cada módulo mantém o próprio e2e de schema no seu `__tests__`, com o mesmo padrão de comparação (o módulo não edita o e2e de outro).

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
- A **listagem padrão filtra na consulta**: `where: { archive: { archivedAt: IsNull() } }` com o repositório, ou `archived_at IS NULL` no query builder. Quem precisa dos arquivados (histórico, ficha) pede explicitamente.
- Evento `AuditableActionEvent` `<ENTITY>_ARCHIVED` e `<ENTITY>_UNARCHIVED`, depois do commit e só quando houve mudança. O motivo do arquivamento (`archiveReason`) entra no evento; não registre informação de saúde nele (RNF-13).
- Regras que impedem arquivar (por exemplo, aluno com matrícula ativa) respondem 409 com código próprio e ficam no service do recurso.
- Permissão por `@RequirePermission`: arquivar e reativar costumam ser mais restritos que editar (alunos: `students.archive`, só coordenação).

## 11. Cadastro de membro e validação (GUS-91)

Ninguém vira membro sem a aprovação da coordenação (RN-08). O aceite de um convite de acesso (`POST /auth/invites/accept`) manda o objeto `registration` com os dados do RF-004 e cria o cadastro **A validar**: a `Person` nasce sem acesso (`role` nulo, `accessEnabled` falso). Só a aprovação, em `PATCH /member-registrations/:id/approve`, define o perfil de acesso, o departamento, a função principal e a data de entrada e libera o login.

`member_profiles` é a tabela do vínculo de membro, 1:1 com `people` (como `student_profiles` é a do aluno). Não existe card da E1.b: os cards futuros de membro (inativação com data de saída, edição) estendem essa tabela em vez de criar outra.

### 11.1 Onde cada campo mora

| Campo                                                      | Onde                                                             | Por quê                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Nome, RA                                                   | `Person.name`, `Person.ra`                                       | O RA é o login e a chave do reuso (RN-09)                                             |
| Data de nascimento, telefone                               | `Person.birthDate`, `Person.phone`                               | Contato comum a aluno e membro (GUS-105); nada duplicado                              |
| E-mail pessoal                                             | `Person.email` (único)                                           | Mesmo significado do e-mail do aluno                                                  |
| CPF                                                        | `MemberProfile.cpf`                                              | Só o membro coleta (minimização, RNF-10). Um lugar só para restringir (RNF-14)        |
| Endereço, cidade, UF                                       | `MemberProfile`                                                  | Só o cadastro de membro coleta                                                        |
| E-mail institucional, curso, período, turma, link do termo | `MemberProfile`                                                  | Dado acadêmico do vínculo (RF-004, RF-011)                                            |
| Departamento                                               | `MemberProfile.departmentId` → `departments`                     | Sugerido no aceite, decidido na aprovação; é chave de autorização                     |
| Função principal, data de entrada                          | `MemberProfile.mainFunction`, `joinedAt`                         | Definidas pela coordenação na aprovação                                               |
| Situação, observação, quem validou e quando                | `registrationStatus`, `reviewNote`, `reviewedById`, `reviewedAt` | Ciclo da validação do vínculo                                                         |
| Perfil de acesso                                           | `Person.role`                                                    | Fica nulo até a aprovação; o perfil do convite vai para `MemberProfile.requestedRole` |

O nome do departamento é único sem diferenciar maiúsculas: `uq_departments_name` é um índice único sobre `LOWER("name")`, criado só na migration (o TypeORM não declara índice de expressão na entidade; o e2e de schema o confere em `pg_indexes`). A violação (23505) vira 409 `DEPARTMENT_ALREADY_EXISTS`.

CPF, endereço e telefone são dados pessoais (RNF-13/14): nunca em log, nunca em evento (`MEMBER_AUDIT_FIELDS` é uma allow-list) e o CPF completo só aparece em `GET /member-registrations/:id`, que é da coordenação. A listagem da fila não traz CPF, endereço, telefone nem e-mails.

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

`auth` só usa o que o `PeopleModule` exporta: `MembersService`, `DepartmentsService` e os tipos do contrato desses services (`MemberRegistrationFormDto`, `DepartmentResponseDto`, `MemberRegistrationStatus`, `MemberAccessFacts`). `InvitesService.accept` abre a transação e chama `MembersService.submitFromInvite(manager, ...)`, para a `Person`, o perfil e o `invite.usedAt` saírem no mesmo commit; o evento é montado em `people` (dono da allow-list) e emitido por `auth` depois do commit. `GET /auth/invites/:token` devolve `departments` para o formulário público (só quem tem um convite válido vê os nomes).
