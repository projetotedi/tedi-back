import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { AuthGuard } from "../guards/auth.guard";
import { PeopleService } from "@modules/people/services/people.service";
import { Role } from "@shared/enums/role.enum";
import { SESSION_COOKIE_NAME, REQUEST_USER_KEY } from "../auth.constants";
import { PUBLIC_KEY } from "@shared/decorators/public.decorator";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(cookies: Record<string, string> = {}): Record<string, unknown> {
  return { cookies };
}

function makeContext(
  request: Record<string, unknown>,
  handlerMeta: Record<string, unknown> = {},
  classMeta: Record<string, unknown> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => {
      const fn = () => undefined;
      Object.assign(fn, handlerMeta);
      return fn;
    },
    getClass: () => {
      const cls = class {};
      Object.assign(cls, classMeta);
      return cls;
    },
  } as unknown as ExecutionContext;
}

function makeGuard(overrides: {
  isPublic?: boolean;
  minRole?: Role;
  jwtPayload?: { sub: string } | null;
  person?: { id: string; role: Role | null; accessEnabled: boolean } | null;
  configSecret?: string;
}): AuthGuard {
  const { isPublic = false, minRole, jwtPayload, person, configSecret = "test-secret" } = overrides;

  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === PUBLIC_KEY) return isPublic;
      if (key === ROLES_KEY) return minRole;
      return undefined;
    }),
  } as unknown as Reflector;

  const jwt = {
    verifyAsync: jest.fn(() => {
      if (jwtPayload === null) return Promise.reject(new Error("invalid"));
      return Promise.resolve(jwtPayload ?? { sub: "user-123" });
    }),
  } as unknown as JwtService;

  const people = {
    findById: jest.fn(() => Promise.resolve(person ?? null)),
  } as unknown as PeopleService;

  const config = {
    getOrThrow: jest.fn(() => configSecret),
  } as unknown as ConfigService;

  return new AuthGuard(reflector, jwt, people, config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AuthGuard", () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv["NODE_ENV"] = process.env.NODE_ENV;
    savedEnv["DEV_FAKE_ROLE"] = process.env.DEV_FAKE_ROLE;
    delete process.env.DEV_FAKE_ROLE;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv["NODE_ENV"];
    if (savedEnv["DEV_FAKE_ROLE"] === undefined) {
      delete process.env.DEV_FAKE_ROLE;
    } else {
      process.env.DEV_FAKE_ROLE = savedEnv["DEV_FAKE_ROLE"];
    }
  });

  describe("public route", () => {
    it("bypasses guard when @Public() is set", async () => {
      const guard = makeGuard({ isPublic: true });
      const req = makeRequest();
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe("missing cookie", () => {
    it("throws 401 when no tedi_session cookie is present", async () => {
      const guard = makeGuard({
        jwtPayload: { sub: "user-123" },
        person: { id: "user-123", role: Role.MEMBER, accessEnabled: true },
      });
      const req = makeRequest({});
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("invalid JWT", () => {
    it("throws 401 when JWT verification fails", async () => {
      const guard = makeGuard({ jwtPayload: null });
      const req = makeRequest({ [SESSION_COOKIE_NAME]: "bad-token" });
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("person not found", () => {
    it("throws 401 when person does not exist in DB", async () => {
      const guard = makeGuard({ jwtPayload: { sub: "ghost-id" }, person: null });
      const req = makeRequest({ [SESSION_COOKIE_NAME]: "valid-jwt" });
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("accessEnabled=false", () => {
    it("throws 401 when person has accessEnabled=false (immediate revocation)", async () => {
      const guard = makeGuard({
        jwtPayload: { sub: "user-123" },
        person: { id: "user-123", role: Role.DIRECTOR, accessEnabled: false },
      });
      const req = makeRequest({ [SESSION_COOKIE_NAME]: "valid-jwt" });
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("role=null", () => {
    it("throws 401 when person.role is null (not fully provisioned)", async () => {
      const guard = makeGuard({
        jwtPayload: { sub: "user-123" },
        person: { id: "user-123", role: null, accessEnabled: true },
      });
      const req = makeRequest({ [SESSION_COOKIE_NAME]: "valid-jwt" });
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe("default protected (no @Roles)", () => {
    it("returns true for any authenticated user with valid role", async () => {
      const guard = makeGuard({
        jwtPayload: { sub: "user-123" },
        person: { id: "user-123", role: Role.MEMBER, accessEnabled: true },
      });
      const req = makeRequest({ [SESSION_COOKIE_NAME]: "valid-jwt" });
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req[REQUEST_USER_KEY]).toEqual({
        id: "user-123",
        role: Role.MEMBER,
        accessEnabled: true,
      });
    });
  });

  describe("role hierarchy with @Roles", () => {
    it("throws 403 when member calls @Roles(DIRECTOR) route", async () => {
      const guard = makeGuard({
        minRole: Role.DIRECTOR,
        jwtPayload: { sub: "user-123" },
        person: { id: "user-123", role: Role.MEMBER, accessEnabled: true },
      });
      const req = makeRequest({ [SESSION_COOKIE_NAME]: "valid-jwt" });
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("returns true when director calls @Roles(DIRECTOR) route", async () => {
      const guard = makeGuard({
        minRole: Role.DIRECTOR,
        jwtPayload: { sub: "user-123" },
        person: { id: "user-123", role: Role.DIRECTOR, accessEnabled: true },
      });
      const req = makeRequest({ [SESSION_COOKIE_NAME]: "valid-jwt" });
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it("returns true when coordinator calls @Roles(DIRECTOR) route", async () => {
      const guard = makeGuard({
        minRole: Role.DIRECTOR,
        jwtPayload: { sub: "user-123" },
        person: { id: "user-123", role: Role.COORDINATOR, accessEnabled: true },
      });
      const req = makeRequest({ [SESSION_COOKIE_NAME]: "valid-jwt" });
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe("SUPERADMIN satisfies any @Roles", () => {
    it("SUPERADMIN passes @Roles(COORDINATOR)", async () => {
      const guard = makeGuard({
        minRole: Role.COORDINATOR,
        jwtPayload: { sub: "user-123" },
        person: { id: "user-123", role: Role.SUPERADMIN, accessEnabled: true },
      });
      const req = makeRequest({ [SESSION_COOKIE_NAME]: "valid-jwt" });
      const ctx = makeContext(req);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe("DEV_FAKE_ROLE", () => {
    it("injects fake user in non-production when DEV_FAKE_ROLE is set", async () => {
      process.env.DEV_FAKE_ROLE = "director";
      process.env.NODE_ENV = "test";

      const guard = makeGuard({ minRole: Role.DIRECTOR });
      const req = makeRequest({});
      const ctx = makeContext(req);

      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect((req[REQUEST_USER_KEY] as { id: string }).id).toBe("dev-fake-user");
    });

    it("ignores DEV_FAKE_ROLE in production and requires cookie", async () => {
      process.env.DEV_FAKE_ROLE = "coordinator";
      process.env.NODE_ENV = "production";

      const guard = makeGuard({});
      const req = makeRequest({});
      const ctx = makeContext(req);

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("ignores invalid DEV_FAKE_ROLE value and falls through to cookie check", async () => {
      process.env.DEV_FAKE_ROLE = "not-a-real-role";
      process.env.NODE_ENV = "test";

      const guard = makeGuard({});
      const req = makeRequest({});
      const ctx = makeContext(req);

      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
