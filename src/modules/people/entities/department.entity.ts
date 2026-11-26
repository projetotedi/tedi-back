import { Column, Entity } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";

/**
 * Area of the project a member belongs to (Tecnologia, Comunicação...). Managed by coordination
 * through /departments: the list is data, not code. Drives the "department" permission scope.
 *
 * The name is unique ignoring case: the migration creates `uq_departments_name` as a unique
 * index on `LOWER("name")`. TypeORM cannot declare an expression index (`@Index` only takes
 * columns), so the index is NOT declared here, on purpose: this repo never runs
 * `synchronize` or `migration:generate` (see ci.yml), so nothing would drop or recreate it.
 * The schema e2e (`people.repository.e2e.spec.ts`) checks it straight in `pg_indexes`
 * (unique, on lower(name)) and proves a second name differing only in case is rejected (23505).
 * DepartmentsService maps that violation to 409 DEPARTMENT_ALREADY_EXISTS.
 */
@Entity({ name: "departments" })
export class Department extends BaseEntity {
  @Column({ name: "name", type: "varchar", length: 100 })
  name: string;
}
