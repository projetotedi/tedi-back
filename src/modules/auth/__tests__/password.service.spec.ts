import { PasswordService } from "../services/password.service";

describe("PasswordService", () => {
  let service: PasswordService;

  beforeEach(() => {
    service = new PasswordService();
  });

  describe("hashPassword", () => {
    it("returns a non-empty string", async () => {
      const result = await service.hashPassword("Senha@123");
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("produces different hashes for the same input (salt randomness)", async () => {
      const h1 = await service.hashPassword("Senha@123");
      const h2 = await service.hashPassword("Senha@123");
      expect(h1).not.toBe(h2);
    });
  });

  describe("verify", () => {
    it("returns true when password matches hash", async () => {
      const h = await service.hashPassword("Senha@123");
      await expect(service.verify(h, "Senha@123")).resolves.toBe(true);
    });

    it("returns false when password does not match hash", async () => {
      const h = await service.hashPassword("Senha@123");
      await expect(service.verify(h, "WrongPass1")).resolves.toBe(false);
    });
  });

  describe("getDummyHash", () => {
    it("returns a non-empty string", async () => {
      const result = await service.getDummyHash();
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns the same value on subsequent calls (cached)", async () => {
      const h1 = await service.getDummyHash();
      const h2 = await service.getDummyHash();
      expect(h1).toBe(h2);
    });
  });
});
