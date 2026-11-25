import { Check, Column, Entity, ForeignKey, Index } from "typeorm";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { BaseEntity } from "@shared/entities/base.entity";
import { ClassStatus } from "../enums/class-status.enum";
import { Edition } from "./edition.entity";

/**
 * A class (turma): the offering of one course in one edition, with a period, a place and a number
 * of seats (RF-024, RN-13, RN-21). Archived instead of deleted (RN-27), through `ArchivableColumns`.
 *
 * The TypeScript class is `SchoolClass` because `Class` reads badly next to the `class` keyword and
 * blocks a readable local variable. The table is `classes` and the DTOs keep the `Class` name, so
 * the contract the front generates with Orval does not see this name.
 *
 * The code is unique inside its edition, ignoring case, archived classes included: the migration
 * creates `uq_classes_edition_id_code` as a unique index on `(edition_id, LOWER("code"))`. TypeORM
 * cannot declare an expression index (`@Index` only takes columns), so the index is NOT declared
 * here, on purpose (same case as Course): this repo never runs `synchronize` or
 * `migration:generate` (see ci.yml), so nothing would drop or recreate it. The schema e2e
 * (`classes.repository.e2e.spec.ts`) checks it straight in `pg_indexes` and proves that the same
 * code is rejected in the same edition (23505) and accepted in another one. ClassesService maps
 * that violation to 409 CLASS_CODE_TAKEN.
 *
 * The foreign keys are declared on the class, by table name or by type, and without relations:
 * this keeps every constraint name under our control (the SQL of the migration is written by
 * hand), the same pattern as Course. The one to `courses` is a table name because `classes` does
 * not import `Course`: the catalog is another module (docs/ARCHITECTURE.md sections 1 and 10).
 * The string only resolves when the DataSource loads the `Course` entity too, so an e2e of this
 * module loads the entities of every module.
 *
 * `startDate` and `endDate` are calendar dates, "YYYY-MM-DD" strings (no time, no time zone). The
 * period is checked by `ck_classes_period` and, before it, by ClassesService (400 INVALID_PERIOD).
 */
@Entity({ name: "classes" })
@Index("idx_classes_course_id", ["courseId"])
@Check("ck_classes_capacity_positive", '"capacity" > 0')
@Check("ck_classes_period", '"end_date" >= "start_date"')
@ForeignKey("courses", ["course_id"], ["id"], { name: "fk_classes_course_id" })
@ForeignKey(() => Edition, ["edition_id"], ["id"], { name: "fk_classes_edition_id" })
@ForeignKey("people", ["created_by_id"], ["id"], { name: "fk_classes_created_by_id" })
@ForeignKey("people", ["archived_by_id"], ["id"], { name: "fk_classes_archived_by_id" })
export class SchoolClass extends BaseEntity {
  /** What people call the class, like "INFO-A". Unique inside its edition. */
  @Column({ name: "code", type: "varchar", length: 30 })
  code: string;

  /** Optional label. The form of the front has no field for it, but the API takes it. */
  @Column({ name: "name", type: "varchar", length: 200, nullable: true, default: null })
  name: string | null;

  /** The course this class offers. It never changes after the class is created (RN-13). */
  @Column({ name: "course_id", type: "uuid" })
  courseId: string;

  @Column({ name: "edition_id", type: "uuid" })
  editionId: string;

  @Column({ name: "start_date", type: "date" })
  startDate: string;

  @Column({ name: "end_date", type: "date" })
  endDate: string;

  @Column({ name: "location", type: "varchar", length: 200, nullable: true, default: null })
  location: string | null;

  @Column({ name: "capacity", type: "integer" })
  capacity: number;

  @Column({
    name: "status",
    type: "enum",
    enum: ClassStatus,
    enumName: "classes_status_enum",
    default: ClassStatus.PLANNED,
  })
  status: ClassStatus;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;

  @Column(() => ArchivableColumns, { prefix: false })
  archive: ArchivableColumns;
}
