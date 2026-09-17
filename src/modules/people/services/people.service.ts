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
