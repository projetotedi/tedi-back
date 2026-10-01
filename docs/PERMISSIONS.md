<!-- Gerado por yarn permissions:export a partir de src/shared/permissions/permission-matrix.ts. Não editar à mão. -->

# Matriz de permissões

Fonte única: `src/shared/permissions/permission-matrix.ts`. O `GET /auth/me` devolve o escopo de cada permissão para o perfil logado.

## Legenda dos escopos

- ✅ `all`: qualquer alvo
- ❌ `none`: não pode
- próprio `own`: só os próprios dados
- depto `department`: só membros do próprio departamento
- alocado `allocated`: só em aulas em que está alocado como professor ou monitor
- professor da aula `lessonTeacher`: só em aulas em que está alocado como professor

## Regras fixas

- **Ninguém confirma a própria presença.** A presença de membro gera horas, então quem está na lista nunca marca a si mesmo, em nenhum perfil. A presença de um monitor é confirmada pelo professor da aula, por diretor ou por coordenação. A do professor é confirmada por diretor ou por coordenação. A API responde 403 `SELF_ATTENDANCE_NOT_ALLOWED`.
- Superadmin (✅) em tudo, exceto a própria presença.
- Sem permissão para o perfil: 403 `FORBIDDEN`. Com permissão, mas alvo fora do escopo: 403 `FORBIDDEN_SCOPE`.

## Conta

| Permissão | Ação | Membro | Diretor | Coordenação |
| -- | -- | -- | -- | -- |
| `account.manageOwn` | Ver e editar meus dados, lançar horas, extrato, remover lançamento pendente | próprio | próprio | próprio |

## Membros e acessos

| Permissão | Ação | Membro | Diretor | Coordenação |
| -- | -- | -- | -- | -- |
| `members.list` | Ver o item Membros na sidebar e a listagem de membros | ❌ | ✅ | ✅ |
| `members.view` | Ver ficha e banco de horas de outro membro | ❌ | depto | ✅ |
| `members.edit` | Editar membro | ❌ | depto | ✅ |
| `members.deactivate` | Inativar membro | ❌ | ❌ | ✅ |
| `assignments.create` | Nova alocação (membro numa aula) | ❌ | ✅ | ✅ |
| `invites.manage` | Gerar convite, convites pendentes, revogar, validar cadastro | ❌ | ❌ | ✅ |
| `access.manage` | Alterar perfil, link de redefinição de senha, desativar acesso (e listar acessos, GET /access) | ❌ | ❌ | ✅ |

## Catálogo

| Permissão | Ação | Membro | Diretor | Coordenação |
| -- | -- | -- | -- | -- |
| `catalog.view` | Ver cursos e planos de aula (listagem, detalhe, material) | ✅ | ✅ | ✅ |
| `lessonPlans.manage` | Criar, editar e excluir plano de aula | ❌ | ✅ | ✅ |
| `courses.manage` | Criar, editar e excluir curso; montar sequência | ❌ | ✅ | ✅ |
| `courses.duplicateArchive` | Duplicar e arquivar curso | ❌ | ✅ | ✅ |

## Turmas e matrículas

| Permissão | Ação | Membro | Diretor | Coordenação |
| -- | -- | -- | -- | -- |
| `classes.view` | Ver turmas (listagem e detalhe) | ✅ | ✅ | ✅ |
| `classes.manage` | Criar, editar e excluir turma; gerar aulas | ❌ | ✅ | ✅ |
| `enrollments.manage` | Matricular, alterar situação e remover matrícula | ❌ | ✅ | ✅ |

## Aulas

| Permissão | Ação | Membro | Diretor | Coordenação |
| -- | -- | -- | -- | -- |
| `lessons.view` | Ver listagem de aulas, calendário geral e detalhe de qualquer aula | ✅ | ✅ | ✅ |
| `assignments.manageOwn` | Minhas aulas e candidatar-se como monitor ou professor | próprio | próprio | próprio |
| `lessons.manage` | Criar, editar, cancelar e remarcar aula | ❌ | ✅ | ✅ |
| `assignments.review` | Aprovar ou recusar candidaturas | ❌ | ✅ | ✅ |

## Chamada

| Permissão | Ação | Membro | Diretor | Coordenação |
| -- | -- | -- | -- | -- |
| `attendance.takeStudents` | Fazer a chamada de alunos e justificar falta | alocado | ✅ | ✅ |
| `attendance.confirmMember` | Confirmar presença de monitores e professores (gera horas) | professor da aula, nunca a própria | ✅, nunca a própria | ✅, nunca a própria |
| `attendance.correct` | Corrigir presença já registrada | ❌ | ✅ | ✅ |

## Alunos

| Permissão | Ação | Membro | Diretor | Coordenação |
| -- | -- | -- | -- | -- |
| `students.view` | Ver listagem e ficha de alunos | ✅ | ✅ | ✅ |
| `students.manage` | Cadastrar e editar aluno | ❌ | ✅ | ✅ |
| `students.delete` | Excluir ou anonimizar aluno (LGPD) | ❌ | ❌ | ✅ |

## Horas

| Permissão | Ação | Membro | Diretor | Coordenação |
| -- | -- | -- | -- | -- |
| `hours.viewOthers` | Ver a tela Banco de horas (visão por membro) | ❌ | depto | ✅ |
| `hours.logForOthers` | Lançar horas em nome de outro membro | ❌ | depto | ✅ |
| `hours.review` | Validar, ajustar ou rejeitar lançamentos | ❌ | ❌ | ✅ |
| `hours.export` | Exportar relatório de horas | ❌ | depto | ✅ |
