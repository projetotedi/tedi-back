import { Role, roleSatisfies } from "../role.enum";

describe("roleSatisfies", () => {
  describe("null / undefined userRole", () => {
    it("returns false for null", () => {
      expect(roleSatisfies(null, Role.MEMBER)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(roleSatisfies(undefined, Role.MEMBER)).toBe(false);
    });
  });

  describe("hierarchy: member < director < coordinator", () => {
    it("member satisfies MEMBER", () => {
      expect(roleSatisfies(Role.MEMBER, Role.MEMBER)).toBe(true);
    });

    it("member does not satisfy DIRECTOR", () => {
      expect(roleSatisfies(Role.MEMBER, Role.DIRECTOR)).toBe(false);
    });

    it("member does not satisfy COORDINATOR", () => {
      expect(roleSatisfies(Role.MEMBER, Role.COORDINATOR)).toBe(false);
    });

    it("director satisfies MEMBER", () => {
      expect(roleSatisfies(Role.DIRECTOR, Role.MEMBER)).toBe(true);
    });

    it("director satisfies DIRECTOR", () => {
      expect(roleSatisfies(Role.DIRECTOR, Role.DIRECTOR)).toBe(true);
    });

    it("director does not satisfy COORDINATOR", () => {
      expect(roleSatisfies(Role.DIRECTOR, Role.COORDINATOR)).toBe(false);
    });

    it("coordinator satisfies MEMBER", () => {
      expect(roleSatisfies(Role.COORDINATOR, Role.MEMBER)).toBe(true);
    });

    it("coordinator satisfies DIRECTOR", () => {
      expect(roleSatisfies(Role.COORDINATOR, Role.DIRECTOR)).toBe(true);
    });

    it("coordinator satisfies COORDINATOR", () => {
      expect(roleSatisfies(Role.COORDINATOR, Role.COORDINATOR)).toBe(true);
    });
  });

  describe("SUPERADMIN satisfies any role", () => {
    it("SUPERADMIN satisfies MEMBER", () => {
      expect(roleSatisfies(Role.SUPERADMIN, Role.MEMBER)).toBe(true);
    });

    it("SUPERADMIN satisfies DIRECTOR", () => {
      expect(roleSatisfies(Role.SUPERADMIN, Role.DIRECTOR)).toBe(true);
    });

    it("SUPERADMIN satisfies COORDINATOR", () => {
      expect(roleSatisfies(Role.SUPERADMIN, Role.COORDINATOR)).toBe(true);
    });

    it("SUPERADMIN satisfies SUPERADMIN", () => {
      expect(roleSatisfies(Role.SUPERADMIN, Role.SUPERADMIN)).toBe(true);
    });
  });
});
