import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";

/**
 * The semester in which classes (turmas) are offered, named "<year>.<term>" (for example
 * "2026.1"). It is created on demand by `POST /classes` the first time a name is used, and it is
 * never deleted: the classes that point to it keep their history.
 *
 * The name is unique (`uq_editions_name`). That index is also the conflict target of the
 * `INSERT ... ON CONFLICT ("name") DO NOTHING` that EditionsService.findOrCreate runs, so two
 * requests that create the same new edition at once end up sharing one row.
 */
@Entity({ name: "editions" })
@Index("uq_editions_name", ["name"], { unique: true })
export class Edition extends BaseEntity {
  @Column({ name: "name", type: "varchar", length: 20 })
  name: string;
}
