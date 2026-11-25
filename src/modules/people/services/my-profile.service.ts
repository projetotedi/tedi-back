import { Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { MyProfileResponseDto } from "../dto/my-profile.response.dto";
import { Department } from "../entities/department.entity";
import { MemberProfile } from "../entities/member-profile.entity";
import { Person } from "../entities/person.entity";
import { PersonWithRole, toMyProfileResponse } from "./my-profile.mapper";

/** Narrows a loaded Person to one with an access profile; null and a role of null do not. */
function hasRole(person: Person | null): person is PersonWithRole {
  return person !== null && person.role !== null;
}

/**
 * "Meu perfil" (GUS-122): the registration of the logged-in person, from the database.
 *
 * The "own" scope holds by construction: the only input is the id of the session user (the
 * controller passes `@CurrentUser().id`; the route has no path param, query or body), so there is
 * no id of a third party to check and no PermissionPolicy here. Another person's profile is
 * GUS-144, a different route with its own scope check.
 *
 * CPF, address, phone and e-mails are personal data (RNF-13/14): this service has no Logger and
 * the error carries no value. The CPF only leaves through the mapper, masked.
 */
@Injectable()
export class MyProfileService {
  constructor(
    @InjectRepository(Person) private readonly people: Repository<Person>,
    @InjectRepository(MemberProfile) private readonly profiles: Repository<MemberProfile>,
    @InjectRepository(Department) private readonly departments: Repository<Department>,
  ) {}

  /**
   * The Person, her member profile and its department. A person without a member profile (the
   * seeded admin, coordinators, accounts that predate GUS-91) is not an error: she gets her own
   * data with every member field null.
   *
   * 401 UNAUTHORIZED when the Person no longer exists or has no role, the same answer as
   * AuthService.getMe. The AuthGuard already rejects those; this is the second line, because the
   * guard and the service read the Person at different instants.
   */
  async getMyProfile(personId: string): Promise<MyProfileResponseDto> {
    const person = await this.people.findOne({ where: { id: personId } });
    if (!hasRole(person)) {
      throw new UnauthorizedException();
    }

    const profile = await this.profiles.findOne({ where: { personId: person.id } });
    const department = profile?.departmentId
      ? await this.departments.findOne({ where: { id: profile.departmentId } })
      : null;

    return toMyProfileResponse(person, profile, department);
  }
}
