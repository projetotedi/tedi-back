import { PERMISSION_CATALOG, PERMISSION_SECTIONS } from "./permission-catalog";
import { MATRIX_ROLES, PERMISSION_MATRIX } from "./permission-matrix";
import { Permission } from "./permission.enum";
import { Scope } from "./scope.type";
import { Role } from "@shared/enums/role.enum";

const SCOPE_LABELS: Record<Scope, string> = {
  all: "✅",
  none: "❌",
  own: "próprio",
  department: "depto",
  allocated: "alocado",
  lessonTeacher: "professor da aula",
};

const ROLE_HEADERS: Record<(typeof MATRIX_ROLES)[number], string> = {
  [Role.MEMBER]: "Membro",
  [Role.DIRECTOR]: "Diretor",
  [Role.COORDINATOR]: "Coordenação",
};

const NEVER_OWN_SUFFIX = ", nunca a própria";

function cell(permission: Permission, scope: Scope): string {
  const label = SCOPE_LABELS[scope];
  if (permission === Permission.ATTENDANCE_CONFIRM_MEMBER) return `${label}${NEVER_OWN_SUFFIX}`;
  return label;
}

/**
 * Renders docs/PERMISSIONS.md from PERMISSION_MATRIX.
 * Deterministic and ends with a newline; a test fails when the committed file is stale.
 */
export function renderPermissionsDoc(): string {
  const lines: string[] = [
    "<!-- Gerado por yarn permissions:export a partir de src/shared/permissions/permission-matrix.ts. Não editar à mão. -->",
    "",
    "# Matriz de permissões",
    "",
    "Fonte única: `src/shared/permissions/permission-matrix.ts`. O `GET /auth/me` devolve o escopo de cada permissão para o perfil logado.",
    "",
    "## Legenda dos escopos",
    "",
    `- ${SCOPE_LABELS.all} \`all\`: qualquer alvo`,
    `- ${SCOPE_LABELS.none} \`none\`: não pode`,
    `- ${SCOPE_LABELS.own} \`own\`: só os próprios dados`,
    `- ${SCOPE_LABELS.department} \`department\`: só membros do próprio departamento`,
    `- ${SCOPE_LABELS.allocated} \`allocated\`: só em aulas em que está alocado como professor ou monitor`,
    `- ${SCOPE_LABELS.lessonTeacher} \`lessonTeacher\`: só em aulas em que está alocado como professor`,
    "",
    "## Regras fixas",
    "",
    "- **Ninguém confirma a própria presença.** A presença de membro gera horas, então quem está na lista nunca marca a si mesmo, em nenhum perfil. A presença de um monitor é confirmada pelo professor da aula, por diretor ou por coordenação. A do professor é confirmada por diretor ou por coordenação. A API responde 403 `SELF_ATTENDANCE_NOT_ALLOWED`.",
    `- Superadmin (${SCOPE_LABELS.all}) em tudo, exceto a própria presença.`,
    "- Sem permissão para o perfil: 403 `FORBIDDEN`. Com permissão, mas alvo fora do escopo: 403 `FORBIDDEN_SCOPE`.",
    "",
  ];

  const permissions = Object.values(Permission);

  for (const section of PERMISSION_SECTIONS) {
    lines.push(`## ${section}`, "");
    lines.push(
      `| Permissão | Ação | ${MATRIX_ROLES.map((role) => ROLE_HEADERS[role]).join(" | ")} |`,
    );
    lines.push(`| -- | -- | ${MATRIX_ROLES.map(() => "--").join(" | ")} |`);

    for (const permission of permissions) {
      const entry = PERMISSION_CATALOG[permission];
      if (entry.section !== section) continue;
      const cells = MATRIX_ROLES.map((role) =>
        cell(permission, PERMISSION_MATRIX[permission][role]),
      );
      lines.push(`| \`${permission}\` | ${entry.action} | ${cells.join(" | ")} |`);
    }

    lines.push("");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
