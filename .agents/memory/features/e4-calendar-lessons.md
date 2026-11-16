---
feature: E4 Calendário e planejamento de aulas
epico: E4 Calendário e planejamento de aulas
modulo: lessons (back; o front entra nas GUS-152, GUS-156 e GUS-157)
status: GUS-151 no develop (PR #42); GUS-154 implementada no back em 2026-11-16 (branch feature/GUS-154-generate-lessons, a abrir PR para develop); GUS-152, 153, 156, 157, 158 e 166 destravadas
cards: GUS-151 (back), GUS-154 (back, gerar aulas da turma a partir do plano do curso). Dependentes: GUS-152 (front do CRUD), GUS-153 (listagem e calendário), GUS-156 (detalhe, front), GUS-157 (front do modal "Gerar aulas"), GUS-158 (alocação), GUS-166 (chamada), GUS-168 (horas pela presença de monitores)
atualizado: 2026-11-16
---

# E4 — Calendário e planejamento de aulas

## Contexto

A aula é a unidade que o resto do produto usa: a listagem e o calendário, a geração em série a partir da sequência do curso, a alocação de professor e monitor, a chamada e, mais adiante, as horas (E7). A GUS-151 é o primeiro card do módulo `lessons` e cria o ciclo de vida de uma aula avulsa: criar, ler, editar, cancelar e remarcar. Serve ao objetivo **O3** (turma completa, com aulas geradas e alocação, em menos de 15 min), épico **E4**, funcionalidades F4.1, F4.3 e F4.5, e atende RN-07, RN-18, RN-20, RN-21, RN-22 e RN-27.

A **GUS-154** é o segundo card do módulo: gera as aulas de uma turma a partir da sequência de planos de aula do curso dela (F4.2, RN-17). A coordenação escolhe o dia da semana, o horário e a primeira data, vê uma prévia que marca as aulas fora do período da turma e gera: uma aula por plano, copiando título e objetivo (RN-18), tudo ou nada. Serve ao mesmo **O3** (turma completa em menos de 15 min); o front é a GUS-157.

Valem também as decisões do card: remarcar é a mesma aula, e a data anterior vai para `originalDate` (decisão do Figma para a Q3.4); a aula nasce `planned` e cancelar a mantém, com status `cancelled` (F4.5).

## Posição no roadmap

- **Depende de:** GUS-101 (turmas, PR #37) e GUS-94 (planos de aula, PR #32). `lessons` lê a turma por `ClassesService.getClassSummary` e o catálogo por `LessonPlansService.getLessonPlanSummary`, `CourseLessonPlansService.findPosition` e `CoursesService.getCourseSummary`, todos acrescentados ou exportados nesta feature.
- **Bloqueia:** GUS-152 (front do CRUD), GUS-153 (listagem e calendário, que também pede o índice só por `date`), GUS-156 (detalhe), GUS-157 (front da geração), GUS-158 (alocação) e GUS-166 (chamada). A GUS-154 reusou o `LessonCreationService` e acrescentou `CourseLessonPlansService.getSequenceSummaries` ao contrato do `catalog`.

## Escopo

### Dentro

- `POST /lessons`, `GET /lessons/:id`, `PATCH /lessons/:id`, `PATCH /lessons/:id/cancel` e `PATCH /lessons/:id/reschedule`, todas respondendo `LessonResponseDto` (a aula com turma, curso, edição e plano de origem).
- Entidade `Lesson`, enum `LessonStatus`, migration `CreateLessons` (enum `lessons_status_enum`, seis `CHECK`, índice `(class_id, date)` e quatro FKs) e o e2e de schema do módulo.
- `LessonCreationService.createMany`, interno ao módulo, para a GUS-154.
- Shared: `time-of-day.ts`, `IsTimeOfDay`, `timeOfDayTransformer`, os eventos `LESSON_CREATED`, `LESSON_UPDATED`, `LESSON_CANCELLED` e `LESSON_RESCHEDULED` e o `LessonCancelledEvent` (`lesson.cancelled`).
- Contratos novos entre módulos: `ClassesService.getClassSummary`, `LessonPlansService.getLessonPlanSummary` e `CourseLessonPlansService.findPosition`, com `ClassesModule` e `CatalogModule` exportando os services.
- Requests do Bruno em `collections/lessons/` e a seção 14 de `docs/ARCHITECTURE.md`.

**GUS-154 (geração em série):**

- `POST /classes/:id/lessons/preview` (`previewClassLessons`, 200, não grava) e `POST /classes/:id/lessons/generate` (`generateClassLessons`, 201, tudo ou nada), com `lessons.manage` e o corpo `{ weekday, startTime, endTime, firstDate, location? }`, em `ClassLessonsController` (a turma é o recurso da URL).
- `LessonGenerationService`, `services/lesson-series.ts` (datas, funções puras), `lesson-audit.ts` (o payload do `LESSON_CREATED`, agora compartilhado com o `POST /lessons`), enum `Weekday` (só do corpo e do OpenAPI) e os erros `LESSONS_ALREADY_GENERATED`, `COURSE_WITHOUT_SEQUENCE`, `LESSONS_OUTSIDE_CLASS_PERIOD` e o 404 `CLASS_NOT_FOUND` da URL. **Sem migration, sem entidade, sem índice novo** (a `Lesson` já tem `lessonPlanId` e `sequenceOrder`, e `idx_lessons_class_id_date` atende a consulta "a turma já tem aulas geradas?").
- `CourseLessonPlansService.getSequenceSummaries(courseId, manager?, { forShare? })`, exportado pelo `catalog`.
- Requests `preview-class-lessons.bru` e `generate-class-lessons.bru`, `docs/openapi.json` e a seção 14 de `docs/ARCHITECTURE.md`.

### Fora (explicitamente)

- Listagem, filtros, paginação e calendário (GUS-153); alocação e candidatura (GUS-158); chamada e presença (GUS-166); o listener de estorno de horas (E7), de que só o evento `lesson.cancelled` existe.
- Descancelar, excluir ou arquivar aula; regras de transição de status (quem marca `done`, `done` só depois da data) e bloqueio de remarcar aula `done`.
- Da geração em série (GUS-154): o front, modal "Gerar aulas" (GUS-157); estender o período da turma pelo modal; desfazer, apagar ou regerar aulas já geradas; mais de um dia por semana, feriados e datas a pular; `expectedStudents`, `expectedMonitors` e `subject` no corpo da geração; conflito de horário ou de local e checar a data contra "hoje"; mudança na matriz de permissões.
- Validar as aulas contra a mudança de período da turma (risco P9 da GUS-101), conflito de horário ou de local entre aulas, seed de dados de desenvolvimento, o front (GUS-152, GUS-156), mudança na matriz de permissões e i18n.

## Decisões

Decisões L1 a L12 do plano da GUS-151, propostas pelo planejador e **aprovadas em 2026-11-11** como recomendadas, e G1 a G13 do plano da GUS-154, **aprovadas em 2026-11-16** com as opções recomendadas (a), por pré-autorização do usuário para a execução da esteira (o CRIT foi pulado). A justificativa vai junto de cada uma.

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

Decisões G1 a G13 da GUS-154 (geração em série):

| #   | Data       | Pergunta                                    | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ---------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | 2026-11-16 | O que conta como "já gerada"?               | **Qualquer aula da turma com `sequenceOrder IS NOT NULL`, cancelada inclusive**: a posição é a marca de "veio da sequência" e a cancelada continua existindo (F4.5). Aula avulsa, sem `sequenceOrder`, não bloqueia. Gerar de novo: 409 `LESSONS_ALREADY_GENERATED`.                                                                                                                                                                    |
| G2  | 2026-11-16 | Duplicação em corrida?                      | **`pg_advisory_xact_lock(hashtext('lessons.generate:<classId>'))` dentro da transação, com a checagem de G1 refeita sob a trava** (precedente: o grafo de pré-requisitos do catálogo; não muda o `classes`). Limite: não serializa contra um `POST /lessons` manual com `sequenceOrder` no mesmo instante, caso raro que se corrige cancelando a aula. Índice único parcial foi descartado: exige migration e quebra a aula substituta. |
| G3  | 2026-11-16 | `firstDate` fora do `weekday`?              | **Avança até o primeiro `weekday` a partir da data** ("a partir de"); a prévia mostra a data real. Não é 400.                                                                                                                                                                                                                                                                                                                           |
| G4  | 2026-11-16 | Aula antes do início ou depois do fim?      | **Fora do período (RN-21): a prévia marca `outsideClassPeriod`, o `generate` responde 409 `LESSONS_OUTSIDE_CLASS_PERIOD` antes de qualquer insert** (o Figma confirma que o sistema não grava aula fora do período). 409 e não 400 porque o corpo está certo, quem briga é o período da turma. `details[].field = "firstDate"`.                                                                                                         |
| G5  | 2026-11-16 | Duração na prévia?                          | **`expectedDurationMinutes` do plano em cada item** (o "1h30" do Figma) **e `durationMinutes` do horário** (`endTime - startTime`, a duração real de cada aula) no topo. A aula gravada usa o horário do corpo.                                                                                                                                                                                                                         |
| G6  | 2026-11-16 | Plano arquivado na sequência?               | **Pula**: não origina aula (L1, RN-27) e aparece em `skippedLessonPlans`. As datas seguem consecutivas e o `sequenceOrder` das demais mantém a posição real (pode haver lacuna). Tudo arquivado ou sequência vazia: 409 `COURSE_WITHOUT_SEQUENCE`.                                                                                                                                                                                      |
| G7  | 2026-11-16 | Erros da prévia?                            | **Os mesmos 404 e 409 do generate, menos o de período, que só marca**: a prévia é "o que o generate faria".                                                                                                                                                                                                                                                                                                                             |
| G8  | 2026-11-16 | Evento de auditoria?                        | **Um `LESSON_CREATED` por aula, depois do commit**, com o payload do `POST /lessons` (`lessonCreatedPayload`). Nenhum `AuditableAction` novo.                                                                                                                                                                                                                                                                                           |
| G9  | 2026-11-16 | Resposta do generate?                       | **201 com `{ classId, lessons }`**: objeto, que pode crescer sem quebrar o Orval, e não array cru.                                                                                                                                                                                                                                                                                                                                      |
| G10 | 2026-11-16 | Curso arquivado?                            | **Não bloqueia**: a turma de curso arquivado continua editável (seção 13) e a sequência continua legível.                                                                                                                                                                                                                                                                                                                               |
| G11 | 2026-11-16 | Status da turma (`completed`, `cancelled`)? | **Não bloqueia** (L9 herdada): só a turma arquivada é somente leitura.                                                                                                                                                                                                                                                                                                                                                                  |
| G12 | 2026-11-16 | Como ler os planos da sequência?            | **Método novo `CourseLessonPlansService.getSequenceSummaries`**: uma leitura em ordem de posição, com o objetivo e `FOR SHARE` quando pedido. O `readSequence` não traz o objetivo, e `getLessonPlanSummary` por plano seria N+1. **Mexe no `catalog` (de outro time): avisar no PR.**                                                                                                                                                  |
| G13 | 2026-11-16 | Onde mora o cálculo das datas?              | **`services/lesson-series.ts`, funções puras testáveis sem Nest nem banco**, e `lesson-generation.service.ts` como orquestrador injetável (precedente: `lesson-schedule.ts`).                                                                                                                                                                                                                                                           |

## Regras de negócio confirmadas

- RN-07: cancelar a aula estorna as horas já lançadas. Aqui só sai o evento `lesson.cancelled`; o estorno é do `hours` (E7).
- RN-17: a sequência de planos do curso tem uma ordem, e a geração em série a segue: a primeira aula é o plano da posição 1, e assim por diante (aqui, a posição de um plano arquivado só some da lista, não renumera as outras).
- RN-18: título e objetivo são copiados do plano na criação e são da aula depois; mudar ou arquivar o plano não muda aula já criada. Vale para a geração em série, que copia o objetivo de cada plano (`null` inclusive).
- RN-20: a aula pertence a uma turma, e a turma, o plano de origem e a posição na sequência não mudam depois de criada.
- RN-21: a data da aula cai no período da turma, extremos incluídos. Na geração em série o sistema **não grava** aula fora dele: a prévia a marca e o `generate` recusa a série inteira (409).
- RN-22: a turma não tem turno; o horário mora em cada aula.
- RN-27: turma arquivada é somente leitura, e isso vale para as aulas dela (409 `CLASS_ARCHIVED`), inclusive para a prévia e a geração em série. Plano arquivado não origina aula nova: a geração o pula.
- F4.5: o status da aula é `planned`, `confirmed`, `done` ou `cancelled`; a cancelada é definitiva.

## Permissões

| Ação                                                       | Membro | Diretor | Coordenadora |
| ---------------------------------------------------------- | ------ | ------- | ------------ |
| Ler uma aula (`lessons.view`)                              | ✅     | ✅      | ✅           |
| Criar, editar, cancelar e remarcar aula (`lessons.manage`) | ❌     | ✅      | ✅           |
| Prévia e geração em série das aulas (`lessons.manage`)     | ❌     | ✅      | ✅           |

Superadmin passa em tudo. O escopo é só `all` ou `none`, então o guard decide e o service não usa `PermissionPolicy`. A matriz de permissões não mudou nesta feature.

## Riscos e pendências

- **P9 da GUS-101:** `PATCH /classes/:id` encurta o período da turma sem olhar as aulas. Depois desta feature, uma turma pode ficar com aulas fora do período (e a geração em série, com a série já gravada dentro do período antigo, deixa isso mais provável). Não corrigido aqui: abrir issue para a F2.6 ou a GUS-153 decidir se bloqueia com 409 ou avisa. Remarcar uma aula assim exige data dentro do período novo.
- **L5 a confirmar no Figma** (modal Editar aula, node 662-33222) pelo revisor humano no PR.
- **GUS-154 (feita):** o `LessonGenerationService` monta os `LessonDraft` a partir de `CourseLessonPlansService.getSequenceSummaries` (o `readSequence` não traz o objetivo, G12) e chama `LessonCreationService.createMany` dentro da própria transação, com a turma lida por `getClassSummary(..., { forShare: true })`, e emite `LESSON_CREATED` de cada aula depois do commit. A ordem das travas é turma `FOR SHARE`, advisory lock da turma, curso `FOR SHARE`, planos `FOR SHARE`, insert; qualquer escrita nova que trave turma, curso ou plano deve respeitá-la.
- **GUS-157 (front, modal "Gerar aulas"):** consome `previewClassLessons` e `generateClassLessons`. O aviso "A turma termina em 24/04/2026" lê `classEndDate` e `outsideClassPeriodCount` da prévia; não há rota de "estender período" no modal, então o front leva o usuário ao `PATCH /classes/:id`. Os 409 chegam pelo `error` (`LESSONS_OUTSIDE_CLASS_PERIOD`, `LESSONS_ALREADY_GENERATED`, `COURSE_WITHOUT_SEQUENCE`, `CLASS_ARCHIVED`); `skippedLessonPlans` diz quais planos arquivados ficaram de fora.
- **Advisory lock (G2):** a geração serializa contra outra geração da mesma turma, mas não contra um `POST /lessons` manual com `sequenceOrder` no mesmo instante. Raro; se acontecer, a coordenação cancela a aula repetida.
- **Mudança no `catalog` (G12):** `getSequenceSummaries` é um método novo exportado por um módulo de outro time. Avisar no PR; o contrato é o que o `lessons` lê, e o `catalog` não conhece o `lessons`.
- **Sequência do curso mudando depois da geração:** não muda as aulas (fotografia, RN-18 e RN-20), e gerar de novo responde 409. Um plano acrescentado depois vira aula à mão, por `POST /lessons`.
- **E7 (`hours`):** ouvir `lesson.cancelled` (`LessonCancelledEvent`) e estornar as horas da aula; hoje ninguém ouve.
- **GUS-108 (matrícula):** vai travar a turma `FOR UPDATE`; convive com o `FOR SHARE` das aulas, e não há espera em círculo porque `classes` nunca trava aula.
- **Conflito de horário** entre aulas da mesma turma não é checado (as aulas geradas podem coincidir com aulas avulsas que a turma já tinha); remarcar aula `done` é permitido; não há regra de transição de status.
- **Seed de dados de desenvolvimento** (L12): a infraestrutura não existe; sugerir uma issue.

## Issues no Linear

GUS-151 Aulas: módulo, entidade e CRUD, criar, editar, cancelar e remarcar (back). GUS-154 Gerar aulas da turma a partir do plano do curso (back). Destravadas: GUS-152, GUS-153, GUS-156, GUS-157 (front da geração), GUS-158, GUS-166. Sugeridas: período da turma contra as aulas (P9) e infraestrutura de seed de desenvolvimento.

## Referências

- Arquitetura: `docs/ARCHITECTURE.md` seção 3 (`catalog ← lessons`, `classes ← lessons`, `lessons ──evento──▶ hours`), seção 10 (arquivar em vez de excluir), seção 13 (turmas) e seção 14 (aulas, com o item da geração em série da GUS-154).
- Memória vizinha: `e2-classes-enrollments.md` (a turma, o P9 e o `FOR UPDATE` da matrícula) e `e9a-acesso-ao-sistema.md` (decisão 6: módulos não importam `auth`; decisão 35: código em inglês).
