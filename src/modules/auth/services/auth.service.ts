import { HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import { MemberRegistrationStatus } from "@modules/people/enums/member-registration-status.enum";
import { MembersService } from "@modules/people/services/members.service";
import { PeopleService } from "@modules/people/services/people.service";
import { LoginDto } from "../dto/login.dto";
import { MeResponseDto } from "../dto/me-response.dto";
import { PasswordService } from "./password.service";
import { buildPermissionMap } from "@shared/permissions/permission-matrix";

@Injectable()
export class AuthService {
  constructor(
    private readonly people: PeopleService,
    private readonly password: PasswordService,
    private readonly members: MembersService,
  ) {}

  /**
   * Validates credentials and returns MeResponseDto on success.
   *
   * Security invariant — checks are performed in this exact order:
   * 1. findByRa (normalizes ra)
   * 2. person == null → verify(DUMMY_HASH, password) for constant-time → INVALID_CREDENTIALS
   * 3. passwordHash == null → INVALID_CREDENTIALS
   * 4. verify(passwordHash, password) == false → INVALID_CREDENTIALS
   * 5. member registration pending → REGISTRATION_PENDING; rejected → REGISTRATION_REJECTED
   *    (GUS-91, RN-08; only after the password is right, like ACCESS_DISABLED: decision 29)
   * 6. role == null → INVALID_CREDENTIALS
   * 7. !accessEnabled → ACCESS_DISABLED
   * 8. Return MeResponseDto
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

    // After the password (decision 29: nothing about the account is revealed before the
    // password is right). A person without member profile is not subject to validation.
    const facts = await this.members.findAccessFacts(person.id);
    if (facts.registrationStatus === MemberRegistrationStatus.PENDING) {
      throw new HttpException(
        { error: "REGISTRATION_PENDING", message: "Registration awaiting validation." },
        401,
      );
    }
    if (facts.registrationStatus === MemberRegistrationStatus.REJECTED) {
      throw new HttpException(
        {
          error: "REGISTRATION_REJECTED",
          message: "Registration rejected. Contact coordination.",
        },
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
      permissions: buildPermissionMap(person.role),
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
      permissions: buildPermissionMap(person.role),
    };
  }
}
