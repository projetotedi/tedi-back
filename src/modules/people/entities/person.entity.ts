import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { Role } from "@shared/enums/role.enum";

@Entity({ name: "people" })
@Index("uq_people_email", ["email"], { unique: true, where: '"email" IS NOT NULL' })
@Index("uq_people_ra", ["ra"], { unique: true, where: '"ra" IS NOT NULL' })
export class Person extends BaseEntity {
  @Column({ name: "name", type: "varchar", length: 200 })
  name: string;

  @Column({ name: "email", type: "varchar", length: 200, nullable: true, default: null })
  email: string | null;

  @Column({ name: "ra", type: "varchar", length: 20, nullable: true, default: null })
  ra: string | null;

  @Column({
    name: "password_hash",
    type: "varchar",
    length: 255,
    nullable: true,
    default: null,
  })
  passwordHash: string | null;

  @Column({
    name: "role",
    type: "enum",
    enum: Role,
    enumName: "people_role_enum",
    nullable: true,
    default: null,
  })
  role: Role | null;

  @Column({ name: "access_enabled", type: "boolean", default: true })
  accessEnabled: boolean;
}
