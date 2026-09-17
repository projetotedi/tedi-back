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
    const data = { ...person };
    if (data.email != null) {
      data.email = data.email.trim().toLowerCase();
    }
    if (data.ra != null) {
      data.ra = data.ra.trim().toLowerCase();
    }
    return this.repository.save(data);
  }
}
