import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";

/**
 * Area of the project a member belongs to (Tecnologia, Comunicação...). Managed by coordination
 * through /departments: the list is data, not code. Drives the "department" permission scope.
 */
@Entity({ name: "departments" })
@Index("uq_departments_name", ["name"], { unique: true })
export class Department extends BaseEntity {
  @Column({ name: "name", type: "varchar", length: 100 })
  name: string;
}
