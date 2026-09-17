import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Person } from "../entities/person.entity";
import { PeopleService } from "../services/people.service";

const mockRepository = (): Partial<Repository<Person>> => ({
  findOne: jest.fn(),
  save: jest.fn(),
  // The service uses repository.create() so the @BeforeInsert hook fires
  // on the real entity; for unit tests we just echo the input back.
  create: jest.fn((data) => data) as unknown as Repository<Person>["create"],
});

describe("PeopleService", () => {
  let service: PeopleService;
  let repo: jest.Mocked<Partial<Repository<Person>>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PeopleService,
        {
          provide: getRepositoryToken(Person),
          useValue: mockRepository(),
        },
      ],
    }).compile();

    service = module.get<PeopleService>(PeopleService);
    repo = module.get(getRepositoryToken(Person));
  });

  describe("findByRa", () => {
    it("normalizes ra to lowercase before calling the repository", async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      await service.findByRa("A2210001");
      expect(repo.findOne).toHaveBeenCalledWith({ where: { ra: "a2210001" } });
    });

    it("returns null when the repository finds nothing", async () => {
      (repo.findOne as jest.Mock).mockResolvedValue(null);
      const result = await service.findByRa("nao-existe");
      expect(result).toBeNull();
    });

    it("returns null without calling the repository when ra is blank after trim", async () => {
      const result = await service.findByRa("   ");
      expect(result).toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    });
  });

  describe("save", () => {
    it("normalizes email to lowercase before saving", async () => {
      const saved = { id: "uuid-1", name: "Maria", email: "maria@x.com" } as Person;
      (repo.save as jest.Mock).mockResolvedValue(saved);

      await service.save({ name: "Maria", email: "Maria@X.com" });

      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ email: "maria@x.com" }));
    });

    it("normalizes ra to lowercase before saving", async () => {
      const saved = { id: "uuid-2", name: "Joao", ra: "a2210001" } as Person;
      (repo.save as jest.Mock).mockResolvedValue(saved);

      await service.save({ name: "Joao", ra: "A2210001" });

      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ ra: "a2210001" }));
    });
  });

  describe("findById", () => {
    it("forwards the id directly to the repository", async () => {
      const person = { id: "uuid-1" } as Person;
      (repo.findOne as jest.Mock).mockResolvedValue(person);

      const result = await service.findById("uuid-1");

      expect(repo.findOne).toHaveBeenCalledWith({ where: { id: "uuid-1" } });
      expect(result).toBe(person);
    });
  });
});
