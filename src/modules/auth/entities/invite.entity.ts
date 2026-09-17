import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "@shared/entities/base.entity";
import { Role } from "@shared/enums/role.enum";

/**
 * Discriminates the purpose of an invite token.
 *  - ACCESS        — grants a new person access to the system
 *  - PASSWORD_RESET — allows resetting a person's password (GUS-81)
 */
export enum InviteType {
  ACCESS = "access",
  PASSWORD_RESET = "password_reset",
}

/**
 * Represents an invite token issued by a coordinator.
 *
 * Design decisions:
 *  - tokenHash is sha256(token_in_clear): the raw token is returned only once
 *    at creation (createInvite response) and never stored or re-sent.
 *  - usedAt / revokedAt enable idempotent acceptance checks without deleting rows.
 *  - role reuses `people_role_enum` (via its string values); no new enum column type.
 *  - personId is set after acceptance so the invite audit row links to the Person.
 *  - createdById links to the coordinator who created the invite (no FK to keep
 *    the entity lean; GUS-81 may add a relation).
 */
@Entity({ name: "invites" })
@Index("uq_invites_token_hash", ["tokenHash"], { unique: true })
export class Invite extends BaseEntity {
  @Column({
    name: "type",
    type: "enum",
    enum: InviteType,
    enumName: "invites_type_enum",
  })
  type: InviteType;

  @Column({
    name: "role",
    type: "enum",
    enum: Role,
    enumName: "people_role_enum",
    nullable: true,
    default: null,
  })
  role: Role | null;

  @Column({ name: "person_id", type: "uuid", nullable: true, default: null })
  personId: string | null;

  @Column({ name: "token_hash", type: "varchar", length: 64 })
  tokenHash: string;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt: Date;

  @Column({ name: "used_at", type: "timestamptz", nullable: true, default: null })
  usedAt: Date | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true, default: null })
  revokedAt: Date | null;

  @Column({ name: "created_by_id", type: "uuid" })
  createdById: string;
}
