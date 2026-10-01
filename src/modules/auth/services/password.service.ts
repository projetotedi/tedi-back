import { Injectable } from "@nestjs/common";
import { hash, verify, argon2id } from "argon2";
import type { HashOptions } from "argon2";

/**
 * Argon2id options following OWASP recommendations:
 * - memory: 19 MiB (19456 KiB)
 * - time cost: 2 iterations
 * - parallelism: 1
 */
const ARGON2_OPTIONS: HashOptions = {
  type: argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * Fixed string used to compute the dummy hash for timing-safe verification
 * when a person with the given RA does not exist.
 */
const DUMMY_PASSWORD_SEED = "dummy-password-for-timing";

@Injectable()
export class PasswordService {
  /**
   * Lazy-cached dummy hash used for constant-time comparison when the person
   * is not found by RA. Computed once on first use.
   */
  private cachedDummyHash: string | null = null;

  /**
   * Returns the OWASP-compliant argon2id hash of the given plain-text password.
   */
  hashPassword(password: string): Promise<string> {
    return hash(password, ARGON2_OPTIONS);
  }

  /**
   * Verifies a plain-text password against an argon2id hash.
   * Returns true if the password matches, false otherwise.
   */
  verify(hashValue: string, password: string): Promise<boolean> {
    return verify(hashValue, password);
  }

  /**
   * Returns a stable dummy argon2id hash used for constant-time rejection
   * when the person is not found by RA (prevents timing attacks).
   * The hash is computed once and cached for the lifetime of the service.
   */
  async getDummyHash(): Promise<string> {
    if (this.cachedDummyHash === null) {
      this.cachedDummyHash = await hash(DUMMY_PASSWORD_SEED, ARGON2_OPTIONS);
    }
    return this.cachedDummyHash;
  }
}
