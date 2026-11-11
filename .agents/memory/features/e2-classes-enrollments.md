---
feature: E2 Turmas e matrículas
epico: E2 Turmas e matrículas
modulo: classes (back; o front entra na GUS-133)
status: GUS-101 implementada no back em 2026-10-27 (PR stackado sobre a GUS-97); GUS-102, 103, 104, 108, 133 e 151 destravadas
cards: GUS-101 (back). Dependentes: GUS-102 (nível herdado do curso), GUS-103 (listagem), GUS-104 (detalhe), GUS-108 (matrícula), GUS-133 (front), GUS-151 (aulas)
atualizado: 2026-10-27
---

# E2 — Turmas e matrículas

## Contexto

A turma é a oferta de um curso dentro de uma edição (semestre), com período, local, vagas e situação. Este arquivo nasce com a GUS-101, o primeiro card do módulo `classes`: edição, entidade, criar, editar, arquivar e reativar. Serve ao objetivo **O3** (turma completa criada em menos de 15 min), épico **E2**, funcionalidades F2.1 e F2.6, e atende RF-024, RF-034, RN-10, RN-13, RN-21, RN-22 e RN-27.

Valem também as decisões do card: a edição vem no próprio formulário da turma (30/09) e a turma é arquivada em vez de excluída, sem responsável (01/10).

## Posição no roadmap

- **Depende de:** GUS-97 (cursos): `classes` aponta para `courses` por FK e, a partir da GUS-102, valida o curso pelo `CoursesService.getCourseSummary`. O PR da GUS-101 é stackado sobre o da GUS-97 (PR #33); se a GUS-97 mudar `courses`, rebasear.
- **Bloqueia:** GUS-102 (nível herdado do curso, RN-14), GUS-103 (listagem), GUS-104 (detalhe), GUS-108 (matrícula, que troca o `EnrollmentCountsService`), GUS-133 (tela) e GUS-151 (geração de aulas a partir da turma).

## Escopo

### Dentro

- `POST /classes`, `PATCH /classes/:id`, `PATCH /classes/:id/archive`, `PATCH /classes/:id/unarchive` e `GET /editions`.
- Entidades `Edition` e `SchoolClass` (tabela `classes`), migration `CreateClasses` e o e2e de schema do módulo.
- Eventos `CLASS_CREATED`, `CLASS_UPDATED`, `CLASS_ARCHIVED` e `CLASS_UNARCHIVED`.

### Fora (explicitamente)

- Listagem com busca, filtros e paginação (GUS-103) e detalhe `GET /classes/:id` (GUS-104).
- Validação de curso não arquivado, nível herdado (RN-14) e pré-checagem com `getCourseSummary` (GUS-102).
- Tabela de matrícula e a regra real de matriculados ativos (GUS-108).
- Geração de aulas (GUS-151), edição encerrada somente leitura (RN-11, RF-028), CRUD de edição, regras de transição de status (F2.6), turno (RN-22), responsável pela turma e persistência da auditoria (E9.b).

## Decisões

Decisões P1 a P10 do plano da GUS-101, propostas pelo planejador e **aprovadas em 2026-10-27** como propostas. A justificativa vai junto de cada uma.

| #   | Data       | Pergunta                                             | Decisão                                                                                                                                                                                                                                                                                                                                                               |
| --- | ---------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | 2026-10-27 | `@Roles` ou `@RequirePermission` nas rotas de turma? | **`@RequirePermission(CLASSES_MANAGE / CLASSES_VIEW)`.** A seção 9.1 da arquitetura manda usar `@RequirePermission` nas rotas novas; as duas permissões já existem na matriz (membro `none`/`all`, diretoria e coordenação `all`) com a semântica do card, e a GUS-97 fez igual.                                                                                      |
| P2  | 2026-10-27 | Nome da entidade TypeScript                          | **`SchoolClass` em `class.entity.ts`** (tabela `classes`); os DTOs seguem `*Class*`. `Class` é um identificador válido, mas confunde ao lado da palavra-chave `class` e impede variáveis legíveis. O nome da entidade não entra no contrato do Orval.                                                                                                                 |
| P3  | 2026-10-27 | A GUS-101 expõe `GET /classes` e `GET /classes/:id`? | **Não.** O CA4 é provado no banco (`archived_at` preenchido, `deleted_at` nulo, PATCH 409 e reativar por id), que é o filtro que a seção 10.3 obriga a GUS-103 a aplicar; a prova por HTTP fica para a GUS-103 e a GUS-104. Um `getClass` mínimo fixaria cedo o contrato da GUS-104.                                                                                  |
| P4  | 2026-10-27 | Como tratar a matrícula, que ainda não existe?       | **`EnrollmentCountsService.countActive` devolve 0 hoje.** `CLASS_HAS_ACTIVE_ENROLLMENTS` e `CAPACITY_BELOW_ENROLLED` já estão no Swagger ("a partir da GUS-108") porque o front já mapeia os códigos, e o e2e prova as duas regras com override do provider. **Risco para a GUS-108:** a matrícula precisa travar a linha da turma (`FOR UPDATE`).                    |
| P5  | 2026-10-27 | Ordem e formato de `GET /editions`                   | **Por `name` decrescente, devolvendo `EditionResponseDto[]` (`{ id, name }`).** O padrão de P6 torna a ordem alfabética igual à cronológica, e ordenar por `createdAt` falharia com edição cadastrada depois. A resposta é DTO por regra do repositório, não `string[]`. **Risco:** se P6 afrouxar, a ordem quebra.                                                   |
| P6  | 2026-10-27 | Formato de `editionName`                             | **Aparado e `^\d{4}\.[1-9]$`, na coluna `varchar(20)`.** O Figma e o plano usam `2026.1` e `2026.2`; o padrão evita duplicata por digitação ("2026-1", "2026.01"). **A confirmar:** se existe edição de verão ou curso livre fora desse padrão.                                                                                                                       |
| P7  | 2026-10-27 | Resposta para `courseId` que não existe              | **400 `COURSE_NOT_FOUND`, pelo mapeamento da 23503 em `fk_classes_course_id`; mal formado responde 400 `VALIDATION_FAILED`.** Evita um 500 sem antecipar a GUS-102, que deve manter o código, acrescentar a pré-checagem e o erro de curso arquivado. O código colide em texto com o 404 `COURSE_NOT_FOUND` de `/courses/:id`; alternativa: `CLASS_COURSE_NOT_FOUND`. |
| P8  | 2026-10-27 | Escopo da unicidade do código                        | **Com trim, único por edição, sem diferenciar caixa e com as arquivadas incluídas** (índice de expressão sobre `LOWER(code)`, sem filtro por `deleted_at`). Mesmo padrão de `uq_courses_name`; contar as arquivadas impede o conflito ao reativar.                                                                                                                    |
| P9  | 2026-10-27 | O que o PATCH aceita                                 | **Todos os campos menos `courseId`, inclusive `editionName` (find-or-create) e `status` (sem regra de transição).** RN-13: a turma é a oferta de um curso, e trocar o curso mudaria o nível herdado (GUS-102) e as aulas (GUS-151). Mudar a edição corrige erro de digitação. As regras de transição ficam para a F2.6. **A confirmar com o PO.**                     |
| P10 | 2026-10-27 | O POST aceita `status`?                              | **Sim, opcional, padrão `planned`.** O modal do Figma tem o seletor de status.                                                                                                                                                                                                                                                                                        |

## Regras de negócio confirmadas

- RN-13: a turma é a oferta de um curso e o curso não muda depois de criada a turma.
- RN-21: o término não pode ser antes do início; início e término no mesmo dia valem.
- RN-27: a turma é arquivada, não excluída; arquivada sai da listagem padrão, continua por id e vira somente leitura. O `status` é coluna e independe do arquivamento (RF-034).
- RN-10 e RN-22 (turno) são citadas pelo card; o turno não entra nesta feature.

## Permissões

| Ação                                                        | Membro | Diretor | Coordenadora |
| ----------------------------------------------------------- | ------ | ------- | ------------ |
| Criar, editar, arquivar e reativar turma (`classes.manage`) | ❌     | ✅      | ✅           |
| Listar edições (`classes.view`)                             | ✅     | ✅      | ✅           |

Superadmin passa em tudo. A matriz de permissões não mudou nesta feature.

## Riscos e pendências

- **GUS-108:** trocar o corpo de `EnrollmentCountsService.countActive` por um `count(*)` da tabela de matrícula, remover o override dos e2e e travar a linha da turma ao matricular; sem o lock há corrida entre matricular e arquivar ou reduzir vagas.
- **GUS-102:** manter `COURSE_NOT_FOUND`, acrescentar a pré-checagem por `getCourseSummary` e o erro de curso arquivado; avaliar `CLASS_COURSE_NOT_FOUND` se a colisão de texto com o 404 de `/courses/:id` incomodar o front.
- **PR stackado:** a GUS-97 (PR #33) ainda estava em revisão. Se ela mudar `courses` ou `CoursesService`, rebasear; o timestamp da migration `CreateClasses` precisa continuar depois de `CreateCourses`.
- **Edições órfãs:** uma edição criada por engano fica para sempre, porque não há rota para excluir nem para renomear. Aceitável no MVP.
- **Formato da edição (P6):** confirmar com o PO se há edição fora do padrão `AAAA.N`; afrouxar o padrão quebra a ordenação de P5.

## Issues no Linear

GUS-101 Turmas: módulo, entidade, edição e CRUD (back). Destravadas: GUS-102, GUS-103, GUS-104, GUS-108, GUS-133 (front), GUS-151.

## Referências

- Arquitetura: `docs/ARCHITECTURE.md` seção 3 (`catalog ← classes`, `people ← classes`), seção 10 (arquivar em vez de excluir) e seção 13 (turmas e edições).
- Memória vizinha: `e9a-acesso-ao-sistema.md` (decisão 6: módulos não importam `auth`; decisão 35: código em inglês).
