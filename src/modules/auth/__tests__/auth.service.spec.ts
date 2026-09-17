import { HttpException, UnauthorizedException } from "@nestjs/common";
import { AuthService } from "../services/auth.service";
import { PasswordService } from "../services/password.service";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { Person } from "@modules/people/entities/person.entity";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "uuid-1",
    name: "Alice",
    ra: "a2210001",
    email: "alice@example.com",
    role: Role.MEMBER,
    accessEnabled: true,
    passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$fake-hash",
    ...overrides,
  } as Person;
}

function makeService(overrides: {
  person?: Person | null;
  passwordOk?: boolean;
  dummyHash?: string;
}): AuthService {
  const { person = makePerson(), passwordOk = true, dummyHash = "dummy-hash" } = overrides;

  const people = {
    findByRa: jest.fn(() => Promise.resolve(person)),
    findById: jest.fn(() => Promise.resolve(person)),
  } as unknown as PeopleService;

  const password = {
    verify: jest.fn(() => Promise.resolve(passwordOk)),
    getDummyHash: jest.fn(() => Promise.resolve(dummyHash)),
  } as unknown as PasswordService;

  return new AuthService(people, password);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthService", () => {
  const VALID_DTO = { ra: "a2210001", password: "Senha@123" };

  describe("login", () => {
    it("CA1: returns MeResponseDto on happy path", async () => {
      const service = makeService({});
      const result = await service.login(VALID_DTO);
      expect(result).toMatchObject({
        id: "uuid-1",
        name: "Alice",
        ra: "a2210001",
        email: "alice@example.com",
        role: Role.MEMBER,
      });
    });

    it("CA1: does not include passwordHash in the response", async () => {
      const service = makeService({});
      const result = await service.login(VALID_DTO);
      expect(result).not.toHaveProperty("passwordHash");
    });

    describe("CA2: INVALID_CREDENTIALS errors", () => {
      it("throws INVALID_CREDENTIALS when RA does not exist", async () => {
        const service = makeService({ person: null });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const httpErr = error as HttpException;
        expect(httpErr.getStatus()).toBe(401);
        const body = httpErr.getResponse() as { error: string; message: string };
        expect(body.error).toBe("INVALID_CREDENTIALS");
        expect(body.message).toBe("Invalid credentials.");
      });

      it("CA2: INVALID_CREDENTIALS for wrong RA and wrong password are identical", async () => {
        const serviceRaNotFound = makeService({ person: null });
        const serviceWrongPassword = makeService({ passwordOk: false });

        const errorRa = await serviceRaNotFound.login(VALID_DTO).catch((e: unknown) => e);
        const errorPwd = await serviceWrongPassword.login(VALID_DTO).catch((e: unknown) => e);

        const bodyRa = (errorRa as HttpException).getResponse() as {
          error: string;
          message: string;
        };
        const bodyPwd = (errorPwd as HttpException).getResponse() as {
          error: string;
          message: string;
        };

        expect(bodyRa.error).toBe(bodyPwd.error);
        expect(bodyRa.message).toBe(bodyPwd.message);
        expect((errorRa as HttpException).getStatus()).toBe(
          (errorPwd as HttpException).getStatus(),
        );
      });

      it("throws INVALID_CREDENTIALS when passwordHash is null", async () => {
        const service = makeService({ person: makePerson({ passwordHash: null }) });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const body = (error as HttpException).getResponse() as { error: string };
        expect(body.error).toBe("INVALID_CREDENTIALS");
      });

      it("throws INVALID_CREDENTIALS when password is wrong", async () => {
        const service = makeService({ passwordOk: false });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const body = (error as HttpException).getResponse() as { error: string };
        expect(body.error).toBe("INVALID_CREDENTIALS");
      });

      it("throws INVALID_CREDENTIALS when role is null", async () => {
        const service = makeService({ person: makePerson({ role: null }) });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const body = (error as HttpException).getResponse() as { error: string };
        expect(body.error).toBe("INVALID_CREDENTIALS");
      });
    });

    describe("CA3: ACCESS_DISABLED", () => {
      it("throws ACCESS_DISABLED when accessEnabled is false and password is correct", async () => {
        const service = makeService({ person: makePerson({ accessEnabled: false }) });
        const error = await service.login(VALID_DTO).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(HttpException);
        const httpErr = error as HttpException;
        expect(httpErr.getStatus()).toBe(401);
        const body = httpErr.getResponse() as { error: string; message: string };
        expect(body.error).toBe("ACCESS_DISABLED");
        expect(body.message).toBe("Access disabled. Contact coordination.");
      });
    });

    it("verifies dummy hash when person is not found (constant-time)", async () => {
      const passwordService = {
        verify: jest.fn(() => Promise.resolve(false)),
        getDummyHash: jest.fn(() => Promise.resolve("dummy-hash")),
      } as unknown as PasswordService;

      const people = {
        findByRa: jest.fn(() => Promise.resolve(null)),
      } as unknown as PeopleService;

      const service = new AuthService(people, passwordService);
      await service.login(VALID_DTO).catch(() => undefined);

      expect(passwordService.getDummyHash).toHaveBeenCalledTimes(1);
      expect(passwordService.verify).toHaveBeenCalledWith("dummy-hash", VALID_DTO.password);
    });
  });

  describe("getMe", () => {
    it("CA4: returns MeResponseDto without passwordHash", async () => {
      const service = makeService({});
      const result = await service.getMe("uuid-1");
      expect(result).toMatchObject({ id: "uuid-1", name: "Alice", role: Role.MEMBER });
      expect(result).not.toHaveProperty("passwordHash");
    });

    it("throws UNAUTHORIZED when person not found", async () => {
      const service = makeService({ person: null });
      await expect(service.getMe("ghost-id")).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("throws UNAUTHORIZED when person.role is null", async () => {
      const service = makeService({ person: makePerson({ role: null }) });
      await expect(service.getMe("uuid-1")).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
