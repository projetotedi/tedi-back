import { Column, Entity, ForeignKey, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { ArchivableColumns } from "@shared/entities/archivable.columns";
import { AccessibilityNeed } from "../enums/accessibility-need.enum";

/**
 * Student data of a Person (RF-003). 1:1 with people through the unique person_id,
 * so the same Person can be student and member without a second record (RN-09).
 * accessibilityNeed, supportResource and classNeeds describe what the person needs
 * in class, never a diagnosis (RNF-13). Phone and emergency contact are never logged.
 *
 * Foreign keys are declared on the class, by table name, and without relations: this
 * keeps every constraint name under our control (the SQL of the migration is written
 * by hand) and archived_by_id comes from the ArchivableColumns embedded, where a
 * @ForeignKey would be ignored.
 */
@Entity({ name: "student_profiles" })
@Index("uq_student_profiles_person_id", ["personId"], { unique: true })
@ForeignKey("people", ["person_id"], ["id"], { name: "fk_student_profiles_person_id" })
@ForeignKey("people", ["created_by_id"], ["id"], { name: "fk_student_profiles_created_by_id" })
@ForeignKey("people", ["archived_by_id"], ["id"], { name: "fk_student_profiles_archived_by_id" })
export class StudentProfile extends BaseEntity {
  @Column({ name: "person_id", type: "uuid" })
  personId: string;

  @Column({ name: "education", type: "varchar", length: 100, nullable: true, default: null })
  education: string | null;

  @Column({ name: "has_smartphone", type: "boolean", nullable: true, default: null })
  hasSmartphone: boolean | null;

  @Column({ name: "has_computer", type: "boolean", nullable: true, default: null })
  hasComputer: boolean | null;

  @Column({ name: "how_found_us", type: "varchar", length: 200, nullable: true, default: null })
  howFoundUs: string | null;

  @Column({
    name: "emergency_contact_name",
    type: "varchar",
    length: 200,
    nullable: true,
    default: null,
  })
  emergencyContactName: string | null;

  @Column({
    name: "emergency_contact_phone",
    type: "varchar",
    length: 20,
    nullable: true,
    default: null,
  })
  emergencyContactPhone: string | null;

  @Column({
    name: "accessibility_need",
    type: "enum",
    enum: AccessibilityNeed,
    enumName: "student_profiles_accessibility_need_enum",
    default: AccessibilityNeed.NONE,
  })
  accessibilityNeed: AccessibilityNeed;

  @Column({ name: "support_resource", type: "varchar", length: 500, nullable: true, default: null })
  supportResource: string | null;

  @Column({ name: "class_needs", type: "varchar", length: 500, nullable: true, default: null })
  classNeeds: string | null;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;

  @Column(() => ArchivableColumns, { prefix: false })
  archive: ArchivableColumns;
}
