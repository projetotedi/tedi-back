import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { isUUID } from "class-validator";
import { DeepPartial, In, Repository } from "typeorm";
import { PersonRefDto } from "../dto/person-ref.response.dto";
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
}
