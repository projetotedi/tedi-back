import { Check, Column, Entity, ForeignKey } from "typeorm";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { BaseEntity } from "@shared/entities/base.entity";

@Entity({ name: "lesson_plans" })
@Check("ck_lesson_plans_expected_duration_minutes", '"expected_duration_minutes" > 0')
@ForeignKey("people", ["created_by_id"], ["id"], { name: "fk_lesson_plans_created_by_id" })
@ForeignKey("people", ["archived_by_id"], ["id"], { name: "fk_lesson_plans_archived_by_id" })
export class LessonPlan extends BaseEntity {
  @Column({ name: "title", type: "varchar", length: 200 })
  title: string;

  @Column({ name: "objective", type: "text", nullable: true, default: null })
  objective: string | null;

  @Column({ name: "expected_duration_minutes", type: "integer" })
  expectedDurationMinutes: number;

  @Column({ name: "material_url", type: "varchar", length: 500, nullable: true, default: null })
  materialUrl: string | null;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;

  @Column(() => ArchivableColumns, { prefix: false })
  archive: ArchivableColumns;
}
