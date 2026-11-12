---
feature: E4 Calendário e planejamento de aulas
epico: E4 Calendário e planejamento de aulas
modulo: lessons (back; o front entra nas GUS-152 e GUS-156)
status: GUS-151 implementada no back em 2026-11-11 (branch feature/GUS-151-lessons-crud, a abrir PR para develop); GUS-152, 153, 154, 156, 158 e 166 destravadas
cards: GUS-151 (back). Dependentes: GUS-152 (front do CRUD), GUS-153 (listagem e calendário), GUS-154 (gerar aulas da turma a partir do plano do curso), GUS-156 (detalhe, front), GUS-158 (alocação), GUS-166 (chamada), GUS-168 (horas pela presença de monitores)
atualizado: 2026-11-11
---

# E4 — Calendário e planejamento de aulas

## Contexto

A aula é a unidade que o resto do produto usa: a listagem e o calendário, a geração em série a partir da sequência do curso, a alocação de professor e monitor, a chamada e, mais adiante, as horas (E7). A GUS-151 é o primeiro card do módulo `lessons` e cria o ciclo de vida de uma aula avulsa: criar, ler, editar, cancelar e remarcar. Serve ao objetivo **O3** (turma completa, com aulas geradas e alocação, em menos de 15 min), épico **E4**, funcionalidades F4.1, F4.3 e F4.5, e atende RN-07, RN-18, RN-20, RN-21, RN-22 e RN-27.

Valem também as decisões do card: remarcar é a mesma aula, e a data anterior vai para `originalDate` (decisão do Figma para a Q3.4); a aula nasce `planned` e cancelar a mantém, com status `cancelled` (F4.5).

## Posição no roadmap

- **Depende de:** GUS-101 (turmas, PR #37) e GUS-94 (planos de aula, PR #32). `lessons` lê a turma por `ClassesService.getClassSummary` e o catálogo por `LessonPlansService.getLessonPlanSummary`, `CourseLessonPlansService.findPosition` e `CoursesService.getCourseSummary`, todos acrescentados ou exportados nesta feature.
- **Bloqueia:** GUS-152 (front do CRUD), GUS-153 (listagem e calendário, que também pede o índice só por `date`), GUS-154 (gerar aulas da turma: reusa o `LessonCreationService`), GUS-156 (detalhe), GUS-158 (alocação) e GUS-166 (chamada).

## Escopo

### Dentro

- `POST /lessons`, `GET /lessons/:id`, `PATCH /lessons/:id`, `PATCH /lessons/:id/cancel` e `PATCH /lessons/:id/reschedule`, todas respondendo `LessonResponseDto` (a aula com turma, curso, edição e plano de origem).
- Entidade `Lesson`, enum `LessonStatus`, migration `CreateLessons` (enum `lessons_status_enum`, seis `CHECK`, índice `(class_id, date)` e quatro FKs) e o e2e de schema do módulo.
- `LessonCreationService.createMany`, interno ao módulo, para a GUS-154.
- Shared: `time-of-day.ts`, `IsTimeOfDay`, `timeOfDayTransformer`, os eventos `LESSON_CREATED`, `LESSON_UPDATED`, `LESSON_CANCELLED` e `LESSON_RESCHEDULED` e o `LessonCancelledEvent` (`lesson.cancelled`).
- Contratos novos entre módulos: `ClassesService.getClassSummary`, `LessonPlansService.getLessonPlanSummary` e `CourseLessonPlansService.findPosition`, com `ClassesModule` e `CatalogModule` exportando os services.
- Requests do Bruno em `collections/lessons/` e a seção 14 de `docs/ARCHITECTURE.md`.

### Fora (explicitamente)

- Listagem, filtros, paginação e calendário (GUS-153); geração em série a partir da sequência do curso (GUS-154); alocação e candidatura (GUS-158); chamada e presença (GUS-166); o listener de estorno de horas (E7), de que só o evento `lesson.cancelled` existe.
- Descancelar, excluir ou arquivar aula; regras de transição de status (quem marca `done`, `done` só depois da data) e bloqueio de remarcar aula `done`.
- Validar as aulas contra a mudança de período da turma (risco P9 da GUS-101), conflito de horário ou de local entre aulas, seed de dados de desenvolvimento, o front (GUS-152, GUS-156), mudança na matriz de permissões e i18n.

## Decisões

Decisões L1 a L12 do plano da GUS-151, propostas pelo planejador e **aprovadas em 2026-11-11** como recomendadas. A justificativa vai junto de cada uma.

| #   | Data       | Pergunta                                                       | Decisão                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | 2026-11-11 | Plano arquivado pode originar aula nova?                       | **Não: 400 `LESSON_PLAN_ARCHIVED`.** Coerente com o RN-27 (plano arquivado não entra em sequência nova) e com a seção 10.3 (id no corpo dá 400). Uma aula que já existe continua mostrando o plano arquivado, com `archivedAt`.                                                                                                           |
| L2  | 2026-11-11 | `lessonPlanId` precisa estar na sequência com `sequenceOrder`? | **Sim: a posição precisa bater com `findPosition`**, senão 400 `LESSON_PLAN_NOT_IN_COURSE_SEQUENCE`. `sequenceOrder` sem plano é `VALIDATION_FAILED`. Sem `sequenceOrder`, qualquer plano ativo vale (aula extra). É uma fotografia: trocar a sequência depois não muda a aula. Se o PO recusar, cai o `findPosition` e o export.         |
| L3  | 2026-11-11 | `expectedStudents` e `expectedMonitors`                        | **Opcionais e nullable, inteiros de 0 a 1000 e de 0 a 100, com `CHECK` no banco.** Null quer dizer "não informado". Não são copiados da turma.                                                                                                                                                                                            |
| L4  | 2026-11-11 | O que o `PATCH` aceita                                         | **`title`, `objective`, `location`, `expectedStudents`, `expectedMonitors`, `subject`, `postNotes` e `status` em {planned, confirmed, done}**, sem regra de transição (como a P9 da turma). `cancelled` só pela rota de cancelar. `classId`, `lessonPlanId` e `sequenceOrder` são imutáveis (RN-20).                                      |
| L5  | 2026-11-11 | O `PATCH` muda data e horário?                                 | **Não: só por `reschedule`**, para o `originalDate` nunca ser contornado. Corrigir o horário é uma remarcação com motivo opcional. **A confirmar no Figma** (modal Editar aula, node 662-33222): se ele tiver data e hora, o PO decide entre manter a regra e o front mandar para `rescheduleLesson`, ou o `PATCH` aceitar sem histórico. |
| L6  | 2026-11-11 | Formatos                                                       | **`date` em `AAAA-MM-DD`; `startTime` e `endTime` em `HH:mm` estrito**, colunas `date` e `time`, com transformer que devolve `HH:mm`. Aula não atravessa a meia-noite: `endTime > startTime`, 400 `INVALID_TIME_RANGE` (o nome do código não vem do card).                                                                                |
| L7  | 2026-11-11 | O `POST` aceita `status`?                                      | **Não: nasce `planned`** (o card diz "padrão planned"). `subject` também entra no `POST`; `postNotes` (as notas pós-aula) só pelo `PATCH`.                                                                                                                                                                                                |
| L8  | 2026-11-11 | Remarcar uma aula já remarcada                                 | **`originalDate` guarda a primeira data (`??=`).** `rescheduleReason` e `rescheduleNote` descrevem a última remarcação (omitido vira null). `status` não muda. A mesma agenda é no-op 200. Remarcar uma aula `done` é permitido por enquanto (pendente).                                                                                  |
| L9  | 2026-11-11 | `CLASS_ARCHIVED` em quais rotas, e com qual status?            | **409 nas quatro escritas, inclusive no `POST`**, onde a seção 10.3 daria 400: o card fixa 409 e o front já mapeia assim. Turma `cancelled` ou `completed` (status) não bloqueia: o status é independente (RF-034, F2.6).                                                                                                                 |
| L10 | 2026-11-11 | Dados no evento de auditoria                                   | **`postNotes` só em `changedFields`, sem o valor; `cancelReason`, `rescheduleReason` e `rescheduleNote` fora dos eventos** (texto livre que pode ter dado de saúde de aluno, RNF-13). Título, data, horário, local e status entram com valor.                                                                                             |
| L11 | 2026-11-11 | Nome do enum no banco                                          | **`lessons_status_enum`**, a convenção do repositório (`classes_status_enum`, `courses_category_enum`), e não o `lesson_status_enum` do texto do card.                                                                                                                                                                                    |
| L12 | 2026-11-11 | O que é "seed de exemplo"                                      | **As requests do Bruno com corpos de exemplo, mais o `example` do Swagger.** No repositório só existe o seed da coordenadora, e a infraestrutura de seed de desenvolvimento é "próximo passo" da seção 4 da arquitetura: fica fora deste card (sugerir uma issue).                                                                        |

## Regras de negócio confirmadas

- RN-07: cancelar a aula estorna as horas já lançadas. Aqui só sai o evento `lesson.cancelled`; o estorno é do `hours` (E7).
- RN-18: título e objetivo são copiados do plano na criação e são da aula depois; mudar ou arquivar o plano não muda aula já criada.
- RN-20: a aula pertence a uma turma, e a turma, o plano de origem e a posição na sequência não mudam depois de criada.
- RN-21: a data da aula cai no período da turma, extremos incluídos.
- RN-22: a turma não tem turno; o horário mora em cada aula.
- RN-27: turma arquivada é somente leitura, e isso vale para as aulas dela (409 `CLASS_ARCHIVED`).
- F4.5: o status da aula é `planned`, `confirmed`, `done` ou `cancelled`; a cancelada é definitiva.

## Permissões

| Ação                                                       | Membro | Diretor | Coordenadora |
| ---------------------------------------------------------- | ------ | ------- | ------------ |
| Ler uma aula (`lessons.view`)                              | ✅     | ✅      | ✅           |
| Criar, editar, cancelar e remarcar aula (`lessons.manage`) | ❌     | ✅      | ✅           |

Superadmin passa em tudo. O escopo é só `all` ou `none`, então o guard decide e o service não usa `PermissionPolicy`. A matriz de permissões não mudou nesta feature.

## Riscos e pendências

- **P9 da GUS-101:** `PATCH /classes/:id` encurta o período da turma sem olhar as aulas. Depois desta feature, uma turma pode ficar com aulas fora do período. Não corrigido aqui: abrir issue para a F2.6 ou a GUS-153 decidir se bloqueia com 409 ou avisa. Remarcar uma aula assim exige data dentro do período novo.
- **L5 a confirmar no Figma** (modal Editar aula, node 662-33222) pelo revisor humano no PR.
- **GUS-154:** montar os `LessonDraft` a partir de `CourseLessonPlansService.readSequence` e chamar `LessonCreationService.createMany` dentro da própria transação, com a turma lida por `getClassSummary(..., { forShare: true })`, e emitir `LESSON_CREATED` de cada aula depois do commit.
- **E7 (`hours`):** ouvir `lesson.cancelled` (`LessonCancelledEvent`) e estornar as horas da aula; hoje ninguém ouve.
- **GUS-108 (matrícula):** vai travar a turma `FOR UPDATE`; convive com o `FOR SHARE` das aulas, e não há espera em círculo porque `classes` nunca trava aula.
- **Conflito de horário** entre aulas da mesma turma não é checado; remarcar aula `done` é permitido; não há regra de transição de status.
- **Seed de dados de desenvolvimento** (L12): a infraestrutura não existe; sugerir uma issue.

## Issues no Linear

GUS-151 Aulas: módulo, entidade e CRUD, criar, editar, cancelar e remarcar (back). Destravadas: GUS-152, GUS-153, GUS-154, GUS-156, GUS-158, GUS-166. Sugeridas: período da turma contra as aulas (P9) e infraestrutura de seed de desenvolvimento.

## Referências

- Arquitetura: `docs/ARCHITECTURE.md` seção 3 (`catalog ← lessons`, `classes ← lessons`, `lessons ──evento──▶ hours`), seção 10 (arquivar em vez de excluir), seção 13 (turmas) e seção 14 (aulas).
- Memória vizinha: `e2-classes-enrollments.md` (a turma, o P9 e o `FOR UPDATE` da matrícula) e `e9a-acesso-ao-sistema.md` (decisão 6: módulos não importam `auth`; decisão 35: código em inglês).
