import "reflect-metadata";
import { RequestMethod } from "@nestjs/common";
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from "@nestjs/common/constants";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { Role } from "@shared/enums/role.enum";
import { Permission } from "@shared/permissions/permission.enum";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { MyProfileController } from "../controllers/my-profile.controller";
import { MyProfileResponseDto } from "../dto/my-profile.response.dto";
import { PeopleModule } from "../people.module";
import { MyProfileService } from "../services/my-profile.service";

const USER: AuthUser = {
  id: "01999a3e-7c1b-7000-8000-000000000001",
  role: Role.MEMBER,
  accessEnabled: true,
};

describe("MyProfileController", () => {
  const handler = MyProfileController.prototype.getMyProfile;

  it("serves GET /members/me", () => {
    expect(Reflect.getMetadata(PATH_METADATA, MyProfileController)).toBe("members");
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe("me");
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it("protects getMyProfile with account.manageOwn and no @Roles", () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.ACCOUNT_MANAGE_OWN);
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
  });

  it("takes nothing from the client: the only argument of the handler is the session user", () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, MyProfileController, "getMyProfile") as
      | Record<string, unknown>
      | undefined;

    // No @Param, @Query or @Body (their keys are "<type>:<index>"): only @CurrentUser, a
    // custom decorator. So no route here can name another person.
    expect(Object.keys(args ?? {})).toHaveLength(1);
    expect(Object.keys(args ?? {})[0]).toContain("__customRouteArgs__");
  });

  it("delegates getMyProfile to MyProfileService with the id of the session user", async () => {
    const profile = { name: "Ana Torres" } as MyProfileResponseDto;
    const getMyProfile = jest.fn().mockResolvedValue(profile);
    const controller = new MyProfileController({ getMyProfile } as unknown as MyProfileService);

    await expect(controller.getMyProfile(USER)).resolves.toBe(profile);

    expect(getMyProfile).toHaveBeenCalledTimes(1);
    expect(getMyProfile).toHaveBeenCalledWith(USER.id);
  });

  it("is the first controller of PeopleModule, so GET /members/me wins over any members/:id route", () => {
    const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PeopleModule) as unknown[];

    expect(controllers[0]).toBe(MyProfileController);
  });

  it("keeps MyProfileService private to PeopleModule", () => {
    const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, PeopleModule) as unknown[];
    const exported = Reflect.getMetadata(MODULE_METADATA.EXPORTS, PeopleModule) as unknown[];

    expect(providers).toContain(MyProfileService);
    expect(exported).not.toContain(MyProfileService);
  });
});
