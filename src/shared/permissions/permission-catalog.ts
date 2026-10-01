import { Permission } from "./permission.enum";

export type PermissionSection =
  | "Conta"
  | "Membros e acessos"
  | "Catálogo"
  | "Turmas e matrículas"
  | "Aulas"
  | "Chamada"
  | "Alunos"
  | "Horas";

/** Sections in the order they appear in the matrix and in docs/PERMISSIONS.md. */
export const PERMISSION_SECTIONS: readonly PermissionSection[] = [
  "Conta",
  "Membros e acessos",
  "Catálogo",
  "Turmas e matrículas",
  "Aulas",
  "Chamada",
  "Alunos",
  "Horas",
];

/**
 * Human labels (pt-BR, documentation content) for each permission.
 * Holds no scopes: PERMISSION_MATRIX is the only place for those.
 */
export const PERMISSION_CATALOG: Readonly<
  Record<Permission, { section: PermissionSection; action: string }>
> = {
  [Permission.ACCOUNT_MANAGE_OWN]: {
    section: "Conta",
    action: "Ver e editar meus dados, lançar horas, extrato, remover lançamento pendente",
  },
  [Permission.MEMBERS_LIST]: {
    section: "Membros e acessos",
    action: "Ver o item Membros na sidebar e a listagem de membros",
  },
  [Permission.MEMBERS_VIEW]: {
    section: "Membros e acessos",
    action: "Ver ficha e banco de horas de outro membro",
  },
  [Permission.MEMBERS_EDIT]: { section: "Membros e acessos", action: "Editar membro" },
  [Permission.MEMBERS_DEACTIVATE]: { section: "Membros e acessos", action: "Inativar membro" },
  [Permission.ASSIGNMENTS_CREATE]: {
    section: "Membros e acessos",
    action: "Nova alocação (membro numa aula)",
  },
  [Permission.INVITES_MANAGE]: {
    section: "Membros e acessos",
    action: "Gerar convite, convites pendentes, revogar, validar cadastro",
  },
  [Permission.ACCESS_MANAGE]: {
    section: "Membros e acessos",
    action:
      "Alterar perfil, link de redefinição de senha, desativar acesso (e listar acessos, GET /access)",
  },
  [Permission.CATALOG_VIEW]: {
    section: "Catálogo",
    action: "Ver cursos e planos de aula (listagem, detalhe, material)",
  },
  [Permission.LESSON_PLANS_MANAGE]: {
    section: "Catálogo",
    action: "Criar, editar e excluir plano de aula",
  },
  [Permission.COURSES_MANAGE]: {
    section: "Catálogo",
    action: "Criar, editar e excluir curso; montar sequência",
  },
  [Permission.COURSES_DUPLICATE_ARCHIVE]: {
    section: "Catálogo",
    action: "Duplicar e arquivar curso",
  },
  [Permission.CLASSES_VIEW]: {
    section: "Turmas e matrículas",
    action: "Ver turmas (listagem e detalhe)",
  },
  [Permission.CLASSES_MANAGE]: {
    section: "Turmas e matrículas",
    action: "Criar, editar e excluir turma; gerar aulas",
  },
  [Permission.ENROLLMENTS_MANAGE]: {
    section: "Turmas e matrículas",
    action: "Matricular, alterar situação e remover matrícula",
  },
  [Permission.LESSONS_VIEW]: {
    section: "Aulas",
    action: "Ver listagem de aulas, calendário geral e detalhe de qualquer aula",
  },
  [Permission.ASSIGNMENTS_MANAGE_OWN]: {
    section: "Aulas",
    action: "Minhas aulas e candidatar-se como monitor ou professor",
  },
  [Permission.LESSONS_MANAGE]: {
    section: "Aulas",
    action: "Criar, editar, cancelar e remarcar aula",
  },
  [Permission.ASSIGNMENTS_REVIEW]: {
    section: "Aulas",
    action: "Aprovar ou recusar candidaturas",
  },
  [Permission.ATTENDANCE_TAKE_STUDENTS]: {
    section: "Chamada",
    action: "Fazer a chamada de alunos e justificar falta",
  },
  [Permission.ATTENDANCE_CONFIRM_MEMBER]: {
    section: "Chamada",
    action: "Confirmar presença de monitores e professores (gera horas)",
  },
  [Permission.ATTENDANCE_CORRECT]: {
    section: "Chamada",
    action: "Corrigir presença já registrada",
  },
  [Permission.STUDENTS_VIEW]: {
    section: "Alunos",
    action: "Ver listagem e ficha de alunos",
  },
  [Permission.STUDENTS_MANAGE]: { section: "Alunos", action: "Cadastrar e editar aluno" },
  [Permission.STUDENTS_DELETE]: {
    section: "Alunos",
    action: "Excluir ou anonimizar aluno (LGPD)",
  },
  [Permission.HOURS_VIEW_OTHERS]: {
    section: "Horas",
    action: "Ver a tela Banco de horas (visão por membro)",
  },
  [Permission.HOURS_LOG_FOR_OTHERS]: {
    section: "Horas",
    action: "Lançar horas em nome de outro membro",
  },
  [Permission.HOURS_REVIEW]: {
    section: "Horas",
    action: "Validar, ajustar ou rejeitar lançamentos",
  },
  [Permission.HOURS_EXPORT]: { section: "Horas", action: "Exportar relatório de horas" },
};
