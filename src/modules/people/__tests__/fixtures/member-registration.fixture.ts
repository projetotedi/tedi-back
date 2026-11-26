import { DataSource } from "typeorm";

/**
 * Fixtures of the member registration (GUS-91) for the e2e of people and auth.
 * They use raw SQL on purpose: the e2e of auth must not import entities of people
 * (ARCHITECTURE section 5: the owner module exports a function, the other module calls it).
 */

/**
 * Valid `registration` body of POST /auth/invites/accept (Ana Torres, fictitious data,
 * CPF 529.982.247-25). No departmentId by default: an unknown id answers 400
 * DEPARTMENT_NOT_FOUND. Tests that need one call insertDepartment and pass the id in `overrides`.
 */
export function buildRegistration(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name: "Ana Torres",
    ra: "a2210001",
    personalEmail: "ana.torres@example.com",
    birthDate: "1999-07-22",
    cpf: "529.982.247-25",
    phone: "(11) 98181-3030",
    address: "Rua das Acácias, 120, apto 42",
    city: "São Paulo",
    state: "SP",
    institutionalEmail: "ana.torres@example.edu",
    course: "Sistemas de Informação",
    semester: 7,
    className: "SI-2024-N",
    volunteerTermUrl: "https://drive.google.com/file/d/exemplo/view",
    ...overrides,
  };
}

/**
 * Personal data of buildRegistration that only the detail for coordination may carry (RNF-13/14):
 * never in the validation queue, never in an audit event.
 */
export const REGISTRATION_PERSONAL_VALUES = [
  "52998224725",
  "529.982.247-25",
  "Rua das Acácias",
  "São Paulo",
  "11981813030",
  "98181-3030",
  "ana.torres@example.com",
  "ana.torres@example.edu",
  "1999-07-22",
  "drive.google.com",
];

/**
 * Everything of buildRegistration that must stay out of an audit event: the personal data above
 * plus the academic data (the queue shows course and class, the event does not).
 */
export const REGISTRATION_SENSITIVE_VALUES = [
  ...REGISTRATION_PERSONAL_VALUES,
  "Sistemas de Informação",
  "SI-2024-N",
];

/** INSERT INTO departments ... RETURNING id. */
export async function insertDepartment(dataSource: DataSource, name: string): Promise<string> {
  const rows: Array<{ id: string }> = await dataSource.query(
    `INSERT INTO departments (id, name) VALUES (gen_random_uuid(), $1) RETURNING id`,
    [name],
  );
  return rows[0].id;
}

/** INSERT INTO member_profiles for a person that already exists. */
export async function insertMemberProfile(
  dataSource: DataSource,
  input: {
    personId: string;
    status: "pending" | "approved" | "rejected";
    departmentId?: string | null;
    requestedRole?: string | null;
  },
): Promise<void> {
  await dataSource.query(
    `INSERT INTO member_profiles (id, person_id, registration_status, department_id, requested_role, submitted_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`,
    [input.personId, input.status, input.departmentId ?? null, input.requestedRole ?? null],
  );
}
