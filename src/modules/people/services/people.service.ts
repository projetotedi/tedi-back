import { HttpException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import { DeepPartial, EntityManager, In, Repository } from "typeorm";
import { Role } from "@shared/enums/role.enum";
import { PersonRefDto } from "../dto/person-ref.response.dto";
import { Person } from "../entities/person.entity";

/**
 * The one place that builds the 409 LAST_COORDINATOR: removing the role or the access of the last
 * active coordinator is refused, by /access and by the member deactivation alike.
 */
export function lastCoordinator(): HttpException {
  return new HttpException(
    {
      error: "LAST_COORDINATOR",
      message: "Cannot demote or disable the last active coordinator.",
    },
    409,
  );
}

@Injectable()
export class PeopleService {
  constructor(
    @InjectRepository(Person)
    private readonly repository: Repository<Person>,
  ) {}

  findById(id: string): Promise<Person | null> {
    return this.repository.findOne({ where: { id } });
  }

  findByRa(ra: string): Promise<Person | null> {
    const normalized = ra.trim().toLowerCase();
    if (!normalized) return Promise.resolve(null);
    return this.repository.findOne({ where: { ra: normalized } });
  }

  /**
   * Records a successful login (GUS-122): the login that was the last one becomes the previous
   * one and the last one is now. A single UPDATE, so the right side of every SET reads the OLD
   * row and the row lock serializes two concurrent logins of the same person.
   *
   * Raw SQL on purpose: a login is not a change to the person's data, so `updated_at` must not
   * move (repository.save would bump it through @UpdateDateColumn). The id is a bound parameter.
   * Called by AuthService.login only after every check passed (decision 29).
   */
  async recordLogin(personId: string): Promise<void> {
    await this.repository.query(
      `UPDATE "people" SET "previous_login_at" = "last_login_at", "last_login_at" = now() WHERE "id" = $1`,
      [personId],
    );
  }

  /**
   * {id, name} of each Person found, for other modules that show who did something (catalog: who
   * created a lesson plan). Soft-deleted people and ids that are not uuids are left out, with no
   * error, and the order is not guaranteed: callers index by `id`. No entity leaves `people`.
   */
  async findRefsByIds(ids: readonly string[]): Promise<PersonRefDto[]> {
    // A value that is not a uuid cannot be a person; sending it to Postgres would fail (22P02).
    const unique = [...new Set(ids)].filter((id) => isUUID(id));
    if (unique.length === 0) return [];

    const people = await this.repository.find({
      select: { id: true, name: true },
      where: { id: In(unique) },
    });

    return people.map((person) => ({ id: person.id, name: person.name }));
  }

  save(person: DeepPartial<Person>): Promise<Person> {
    // repository.create() returns a real Person instance, which is what
    // triggers TypeORM lifecycle hooks like @BeforeInsert on BaseEntity
    // (the uuid v7 generator). Plain objects don't fire the hooks.
    const entity = this.repository.create(person);
    if (entity.email != null) {
      entity.email = entity.email.trim().toLowerCase();
    }
    if (entity.ra != null) {
      entity.ra = entity.ra.trim().toLowerCase();
    }
    return this.repository.save(entity);
  }

  /**
   * 409 LAST_COORDINATOR when at most one coordinator with access enabled exists (decision 10 of
   * E9.a): the system must keep somebody who can manage access. Superadmin is not counted.
   *
   * Runs on the `manager` of the caller's transaction, before the write that would remove a
   * coordinator, with the target row already locked. The caller decides when it applies (target
   * is a coordinator, actor is not superadmin). Every caller runs SERIALIZABLE: two coordinators
   * removing each other at the same time lock different rows, so only Postgres SSI catches that
   * write skew.
   */
  async assertNotLastActiveCoordinator(manager: EntityManager): Promise<void> {
    const count = await manager.count(Person, {
      where: { role: Role.COORDINATOR, accessEnabled: true },
    });
    if (count <= 1) {
      throw lastCoordinator();
    }
  }
}
