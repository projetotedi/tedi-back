import { HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import { PeopleService } from "@modules/people/services/people.service";
import { LoginDto } from "../dto/login.dto";
import { MeResponseDto } from "../dto/me-response.dto";
import { PasswordService } from "./password.service";

@Injectable()
export class AuthService {
  constructor(
    private readonly people: PeopleService,
    private readonly password: PasswordService,
  ) {}

  /**
   * Validates credentials and returns MeResponseDto on success.
   *
   * Security invariant — checks are performed in this exact order:
   * 1. findByRa (normalizes ra)
   * 2. person == null → verify(DUMMY_HASH, password) for constant-time → INVALID_CREDENTIALS
   * 3. passwordHash == null → INVALID_CREDENTIALS
   * 4. verify(passwordHash, password) == false → INVALID_CREDENTIALS
   * 5. role == null → INVALID_CREDENTIALS
   * 6. !accessEnabled → ACCESS_DISABLED
   * 7. Return MeResponseDto
   */
  async login(dto: LoginDto): Promise<MeResponseDto> {
    const person = await this.people.findByRa(dto.ra);

    if (person === null) {
      // Constant-time rejection: still run argon2 verify to avoid timing attacks.
      const dummyHash = await this.password.getDummyHash();
      await this.password.verify(dummyHash, dto.password);
      throw new HttpException(
        { error: "INVALID_CREDENTIALS", message: "Invalid credentials." },
        401,
      );
    }

    if (person.passwordHash === null) {
      throw new HttpException(
        { error: "INVALID_CREDENTIALS", message: "Invalid credentials." },
        401,
      );
    }

    const passwordOk = await this.password.verify(person.passwordHash, dto.password);
    if (!passwordOk) {
      throw new HttpException(
        { error: "INVALID_CREDENTIALS", message: "Invalid credentials." },
        401,
      );
    }

    if (person.role === null) {
      throw new HttpException(
        { error: "INVALID_CREDENTIALS", message: "Invalid credentials." },
        401,
      );
    }

    if (!person.accessEnabled) {
      throw new HttpException(
        { error: "ACCESS_DISABLED", message: "Access disabled. Contact coordination." },
        401,
      );
    }

    return {
      id: person.id,
      name: person.name,
      ra: person.ra,
      email: person.email,
      role: person.role,
    };
  }

  /**
   * Loads a fresh Person from DB and returns MeResponseDto.
   * Throws 401 UNAUTHORIZED if person not found or role is null.
   */
  async getMe(userId: string): Promise<MeResponseDto> {
    const person = await this.people.findById(userId);

    if (person === null || person.role === null) {
      throw new UnauthorizedException();
    }

    return {
      id: person.id,
      name: person.name,
      ra: person.ra,
      email: person.email,
      role: person.role,
    };
  }
}
