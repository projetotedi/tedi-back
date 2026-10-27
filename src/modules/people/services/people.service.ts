import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DeepPartial, Repository } from "typeorm";
import { Person } from "../entities/person.entity";

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
}
