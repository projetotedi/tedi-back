---
feature: E2 Turmas e matrículas
epico: E2 Turmas e matrículas
modulo: classes (back; o front entra na GUS-133)
status: GUS-101 implementada no back em 2026-10-27; GUS-102 (vínculo curso x turma) implementada no back em 2026-11-11; GUS-103, 104, 108, 133, 134, 151 e 170 destravadas
cards: GUS-101 (back), GUS-102 (back). Dependentes: GUS-103 (listagem), GUS-104 (detalhe), GUS-108 (matrícula), GUS-133 e GUS-134 (front), GUS-151 (aulas), GUS-170
atualizado: 2026-11-11
---

# E2 — Turmas e matrículas

## Contexto

A turma é a oferta de um curso dentro de uma edição (semestre), com período, local, vagas e situação. Este arquivo nasce com a GUS-101, o primeiro card do módulo `classes`: edição, entidade, criar, editar, arquivar e reativar. Serve ao objetivo **O3** (turma completa criada em menos de 15 min), épico **E2**, funcionalidades F2.1 e F2.6, e atende RF-024, RF-034, RN-10, RN-13, RN-21, RN-22 e RN-27.

Valem também as decisões do card: a edição vem no próprio formulário da turma (30/09) e a turma é arquivada em vez de excluída, sem responsável (01/10).

A GUS-102 fecha o vínculo entre turma e curso: só se cria turma de um curso existente e ativo (RF-020, RN-27), a turma mostra a categoria do curso, que ela não pode contrariar (RN-13, RN-14, RF-029), e o catálogo ganha as turmas de cada curso sem N+1 (F2.1, F2.4 e F12.7). Atende ao objetivo **O3**.

## Posição no roadmap

- **Depende de:** GUS-97 (cursos): `classes` aponta para `courses` por FK e, desde a GUS-102, valida o curso pelo `CoursesService.getCourseSummary`. A GUS-102 depende também da GUS-98 (sequência do curso), já em develop.
- **Bloqueia:** GUS-103 (listagem), GUS-104 (detalhe), GUS-108 (matrícula, que troca o `EnrollmentCountsService`), GUS-133 e GUS-134 (telas), GUS-151 (geração de aulas a partir da turma) e GUS-170.

## Escopo

### Dentro

- `POST /classes`, `PATCH /classes/:id`, `PATCH /classes/:id/archive`, `PATCH /classes/:id/unarchive` e `GET /editions`.
- Entidades `Edition` e `SchoolClass` (tabela `classes`), migration `CreateClasses` e o e2e de schema do módulo.
- Eventos `CLASS_CREATED`, `CLASS_UPDATED`, `CLASS_ARCHIVED` e `CLASS_UNARCHIVED`.

### Fora (explicitamente)

- Listagem com busca, filtros e paginação (GUS-103) e detalhe `GET /classes/:id` (GUS-104).
- Tabela de matrícula e a regra real de matriculados ativos (GUS-108).
- Geração de aulas (GUS-151), edição encerrada somente leitura (RN-11, RF-028), CRUD de edição, regras de transição de status (F2.6), turno (RN-22), responsável pela turma e persistência da auditoria (E9.b).

### GUS-102 (vínculo curso e turma)

**Dentro:** validação do curso na criação e na troca (existe e não está arquivado, com `FOR SHARE`); `PATCH` com `courseId` condicionado; `course { id, name, category, status }` em toda resposta de turma; `GET /courses/:id/classes` e `GET /classes/summary-by-course`; `getCourseSummary` com `forShare` e os enums reexportados pelo service do catalog; `countActiveByClass` no `EnrollmentCountsService`. **Sem migration**: a turma não ganhou coluna de categoria.

**Fora:** listagem e detalhe de turmas (GUS-103 e GUS-104) e o método em lote `CoursesService.getCourseSummaries` (GUS-103); matrícula (GUS-108); a rota de arquivar curso (outro card do catálogo; o e2e arquiva o curso por SQL); a coluna "Turmas" da listagem de cursos (GUS-99) e o front (GUS-134); regras de transição de status (F2.6); efeito da troca de curso sobre aulas já geradas (GUS-151); mudanças na matriz de permissões.

## Decisões

Decisões P1 a P10 do plano da GUS-101, propostas pelo planejador e **aprovadas em 2026-10-27** como propostas. A justificativa vai junto de cada uma.

| #   | Data       | Pergunta                                              | Decisão                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | 2026-10-27 | `@Roles` ou `@RequirePermission` nas rotas de turma?  | **`@RequirePermission(CLASSES_MANAGE / CLASSES_VIEW)`.** A seção 9.1 da arquitetura manda usar `@RequirePermission` nas rotas novas; as duas permissões já existem na matriz (membro `none`/`all`, diretoria e coordenação `all`) com a semântica do card, e a GUS-97 fez igual.                                                                                                                                                                                     |
| P2  | 2026-10-27 | Nome da entidade TypeScript                           | **`SchoolClass` em `class.entity.ts`** (tabela `classes`); os DTOs seguem `*Class*`. `Class` é um identificador válido, mas confunde ao lado da palavra-chave `class` e impede variáveis legíveis. O nome da entidade não entra no contrato do Orval.                                                                                                                                                                                                                |
| P3  | 2026-10-27 | A GUS-101 expõe `GET /classes` e `GET /classes/:id`?  | **Não.** O CA4 é provado no banco (`archived_at` preenchido, `deleted_at` nulo, PATCH 409 e reativar por id), que é o filtro que a seção 10.3 obriga a GUS-103 a aplicar; a prova por HTTP fica para a GUS-103 e a GUS-104. Um `getClass` mínimo fixaria cedo o contrato da GUS-104.                                                                                                                                                                                 |
| P4  | 2026-10-27 | Como tratar a matrícula, que ainda não existe?        | **`EnrollmentCountsService.countActive` devolve 0 hoje.** `CLASS_HAS_ACTIVE_ENROLLMENTS` e `CAPACITY_BELOW_ENROLLED` já estão no Swagger ("a partir da GUS-108") porque o front já mapeia os códigos, e o e2e prova as duas regras com override do provider. **Risco para a GUS-108:** a matrícula precisa travar a linha da turma (`FOR UPDATE`).                                                                                                                   |
| P5  | 2026-10-27 | Ordem e formato de `GET /editions`                    | **Por `name` decrescente, devolvendo `EditionResponseDto[]` (`{ id, name }`).** O padrão de P6 torna a ordem alfabética igual à cronológica, e ordenar por `createdAt` falharia com edição cadastrada depois. A resposta é DTO por regra do repositório, não `string[]`. **Risco:** se P6 afrouxar, a ordem quebra.                                                                                                                                                  |
| P6  | 2026-10-27 | Formato de `editionName`                              | **Aparado e `^\d{4}\.[1-9]$`, na coluna `varchar(20)`.** O Figma e o plano usam `2026.1` e `2026.2`; o padrão evita duplicata por digitação ("2026-1", "2026.01"). **A confirmar:** se existe edição de verão ou curso livre fora desse padrão.                                                                                                                                                                                                                      |
| P7  | 2026-10-27 | Resposta para `courseId` que não existe               | **400 `COURSE_NOT_FOUND`, pelo mapeamento da 23503 em `fk_classes_course_id`; mal formado responde 400 `VALIDATION_FAILED`.** Evita um 500 sem antecipar a GUS-102, que deve manter o código, acrescentar a pré-checagem e o erro de curso arquivado. O código colide em texto com o 404 `COURSE_NOT_FOUND` de `/courses/:id`; alternativa: `CLASS_COURSE_NOT_FOUND`.                                                                                                |
| P8  | 2026-10-27 | Escopo da unicidade do código                         | **Com trim, único por edição, sem diferenciar caixa e com as arquivadas incluídas** (índice de expressão sobre `LOWER(code)`, sem filtro por `deleted_at`). Mesmo padrão de `uq_courses_name`; contar as arquivadas impede o conflito ao reativar.                                                                                                                                                                                                                   |
| P9  | 2026-10-27 | O que o PATCH aceita                                  | **Substituída por P11 (GUS-102).** Era: todos os campos menos `courseId`, inclusive `editionName` (find-or-create) e `status` (sem regra de transição). Continua valendo para os outros campos: as datas (o risco de aulas fora do período, que a GUS-151 chama de "P9", segue aberto), `editionName` (mudar a edição corrige erro de digitação) e `status` (as regras de transição ficam para a F2.6). O `courseId` passou a ser aceito, com condição (P11).        |
| P10 | 2026-10-27 | O POST aceita `status`?                               | **Sim, opcional, padrão `planned`.** O modal do Figma tem o seletor de status.                                                                                                                                                                                                                                                                                                                                                                                       |
| P11 | 2026-11-11 | O PATCH aceita `courseId`? (substitui P9)             | **Sim, só enquanto a turma está `planned` e sem matrícula ativa; senão 409 `COURSE_CHANGE_NOT_ALLOWED`.** Segue o card, que é mais novo que a P9. Vale o status **gravado**, não o do corpo (a regra protege a turma que já começou), e mandar o mesmo curso é no-op, porque o front reenvia o formulário inteiro.                                                                                                                                                   |
| P12 | 2026-11-11 | `@Roles` ou `@RequirePermission` nas leituras?        | **`@RequirePermission(CLASSES_VIEW)`, não `@Roles(Role.MEMBER)`.** A seção 9.1 manda usar `@RequirePermission` nas rotas novas, e a P1 e o `GET /editions` já fazem assim. O efeito hoje é o mesmo do card (todos os perfis, escopo `all`), e uma mudança futura fica na matriz. **Avisar o autor do card.**                                                                                                                                                         |
| P13 | 2026-11-11 | O que contam `total` e `active` do resumo por curso   | **`total` = turmas não arquivadas; `active` = não arquivadas com status `planned` ou `in_progress`.** O `total` bate com o de `GET /courses/:id/classes` sem filtro (RN-27). `active` separa as ofertas correntes do histórico (`completed` e `cancelled`). **A confirmar com o PO e o front (GUS-134).**                                                                                                                                                            |
| P14 | 2026-11-11 | O que é "sem matrícula" e de onde vem `enrolledCount` | **`countActive === 0`, e `enrolledCount` vem de `countActiveByClass`, uma chamada por página.** Uma matrícula cancelada numa turma `planned` não amarra o conteúdo. As duas devolvem vazio/0 até a GUS-108, e o e2e prova o 409 com override do provider. **Risco para a GUS-108:** a matrícula precisa travar a linha da turma (`FOR UPDATE`, já na P4), também contra a troca de curso.                                                                            |
| P15 | 2026-11-11 | Ordem dos erros e concorrência                        | **Criação: `COURSE_NOT_FOUND`, `COURSE_ARCHIVED`, `CLASS_CODE_TAKEN`. PATCH: `CLASS_NOT_FOUND`, `CLASS_ARCHIVED`, `INVALID_PERIOD`, `COURSE_CHANGE_NOT_ALLOWED`, `COURSE_NOT_FOUND`, `COURSE_ARCHIVED`, `CLASS_CODE_TAKEN`, `CAPACITY_BELOW_ENROLLED`.** O curso de destino é lido `FOR SHARE` na transação, que conflita com o `FOR UPDATE` de quem edita ou arquiva o curso. **Risco:** o card de arquivar curso precisa travar a linha do curso com `FOR UPDATE`. |
| P16 | 2026-11-11 | Regras de `GET /courses/:id/classes`                  | **Curso desconhecido ou id mal formado: 404 `COURSE_NOT_FOUND`; curso arquivado: 200; turmas arquivadas ficam fora, sem flag; `status` de valor único; ordem: edição decrescente, código sem diferenciar caixa, id.** **Risco:** se a GUS-103 criar um filtro de arquivadas em `GET /classes`, replicar aqui com o mesmo nome.                                                                                                                                       |
| P17 | 2026-11-11 | Regras de `courseIds`                                 | **De 1 a 100 UUIDs (CSV no contrato; o parâmetro repetido também vale); duplicados saem sem erro; a resposta segue a ordem pedida; id que não é curso responde zeros, sem consultar o catalog.** O CSV, e não array, porque o cliente `fetch` do Orval escreve array como parâmetro repetido.                                                                                                                                                                        |
| P18 | 2026-11-11 | Onde nasce `course` na resposta                       | **Cada mutação chama `CoursesService.getCourseSummary` na própria transação.** Não há método em lote agora, porque nenhuma rota deste card lista turmas com curso (fica para a GUS-103). `courseId` continua na resposta. Os enums `CourseCategory` e `CourseStatus` são reexportados por `courses.service.ts`, para o `classes` não importar `catalog/enums/*`.                                                                                                     |
| P19 | 2026-11-11 | `COURSE_ARCHIVED` com id no corpo: 400 ou 409?        | **409.** Exceção à seção 10.3, que pede 400 para `<ENTITY>_ARCHIVED` com id no corpo; segue o card (CA1) e está registrada nas seções 10.3 e 13. A mensagem é própria: "An archived course cannot receive new classes."                                                                                                                                                                                                                                              |
| P20 | 2026-11-11 | RN-18 contra o CA2 do card                            | **A categoria é sempre a viva do curso: mudar a categoria do curso muda o que as turmas dele mostram.** O texto antigo da RN-18 ("nunca muda as turmas que já existem") dizia o contrário e foi corrigido no enum, no `CoursesService.update` e nas descrições do Swagger. **A confirmar com o PO** se a RN-18 pedia uma foto da categoria na criação da turma: se pedia, o card muda antes do merge (coluna e migration).                                           |

## Regras de negócio confirmadas

- RN-13: a turma é a oferta de exatamente um curso. O curso só pode mudar enquanto a turma está `planned` e sem matrícula ativa (GUS-102, P11); antes da GUS-102 valia "o curso não muda depois de criada a turma".
- RN-14, RF-029: a turma herda a categoria do curso e não pode alterá-la. Ela não guarda categoria: mostra sempre a atual do curso (P20).
- RF-020, RN-27: curso arquivado não recebe turma nova, nem por criação nem por troca de curso (409 `COURSE_ARCHIVED`); as turmas que ele já tem continuam editáveis e legíveis.
- RN-21: o término não pode ser antes do início; início e término no mesmo dia valem.
- RN-27: a turma é arquivada, não excluída; arquivada sai da listagem padrão, continua por id e vira somente leitura. O `status` é coluna e independe do arquivamento (RF-034).
- RN-10 e RN-22 (turno) são citadas pelo card; o turno não entra nesta feature.

## Permissões

| Ação                                                            | Membro | Diretor | Coordenadora |
| --------------------------------------------------------------- | ------ | ------- | ------------ |
| Criar, editar, arquivar e reativar turma (`classes.manage`)     | ❌     | ✅      | ✅           |
| Listar edições (`classes.view`)                                 | ✅     | ✅      | ✅           |
| Ver as turmas de um curso e o resumo por curso (`classes.view`) | ✅     | ✅      | ✅           |

Superadmin passa em tudo. A matriz de permissões não mudou nesta feature.

## Riscos e pendências

- **GUS-108:** trocar o corpo de `EnrollmentCountsService.countActive` por um `count(*)` da tabela de matrícula e o de `countActiveByClass` por um `SELECT class_id, count(*) ... GROUP BY class_id`; remover o override dos e2e (os de `classes.controller` e `course-classes.controller`); e travar a linha da turma (`FOR UPDATE`) ao matricular. Sem o lock há corrida entre matricular e arquivar, reduzir vagas **ou trocar o curso** da turma.
- **Card de arquivar curso:** travar a linha do curso com `FOR UPDATE`, como o `CoursesService.update` já faz. É isso que faz o `FOR SHARE` da criação de turma segurar a regra do curso arquivado (P15). O e2e de `classes` arquiva o curso por SQL (`archiveCourse`) até a rota existir.
- **GUS-103:** criar o método em lote `CoursesService.getCourseSummaries` para a listagem de turmas com `course`; se a listagem ganhar um filtro de arquivadas, replicá-lo em `GET /courses/:id/classes` com o mesmo nome (P16).
- **GUS-104:** o `GET /classes/:id` fica no `ClassesController`, que o módulo registra depois do `CourseClassesController`, para não capturar `summary-by-course`. Um teste guarda essa ordem.
- **A confirmar com o PO:** P20 (se a RN-18 pedia foto da categoria na criação da turma; se pedia, o card muda antes do merge, porque passaria a existir uma coluna e uma migration), P13 (definição de `active`) e P6 (formato da edição).
- **Avisar o autor do card da GUS-102:** P12 trocou `@Roles(Role.MEMBER)` por `@RequirePermission(CLASSES_VIEW)` (mesmo efeito hoje).
- **Edições órfãs:** uma edição criada por engano fica para sempre, porque não há rota para excluir nem para renomear. Aceitável no MVP.
- **Formato da edição (P6):** confirmar com o PO se há edição fora do padrão `AAAA.N`; afrouxar o padrão quebra a ordenação de P5.

## Issues no Linear

GUS-101 Turmas: módulo, entidade, edição e CRUD (back). GUS-102 Vínculo curso e turma: validação, nível herdado e turmas por curso (back). Destravadas pela GUS-102: GUS-103, GUS-104, GUS-134 (front) e GUS-170.

## Referências

- Arquitetura: `docs/ARCHITECTURE.md` seção 3 (`catalog ← classes`, `people ← classes`), seção 10 (arquivar em vez de excluir, e a exceção do 409 na 10.3) e seção 13 (turmas, edições e vínculo com o curso).
- Memória vizinha: `e9a-acesso-ao-sistema.md` (decisão 6: módulos não importam `auth`; decisão 35: código em inglês).
