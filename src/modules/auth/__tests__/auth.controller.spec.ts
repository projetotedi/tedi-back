import "reflect-metadata";
import { HTTP_CODE_METADATA } from "@nestjs/common/constants";
import { JwtService } from "@nestjs/jwt";
import { PUBLIC_KEY } from "@shared/decorators/public.decorator";
import { Role } from "@shared/enums/role.enum";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { PERMISSION_KEY } from "@shared/permissions/require-permission.decorator";
import { AccessController } from "../access.controller";
import { AuthController } from "../auth.controller";
import { ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_KEY } from "../decorators/allow-when-password-change-required.decorator";
import { InvitesController } from "../invites.controller";
import { AuthService } from "../services/auth.service";

function routesMarkedAsAllowed(): string[] {
  const marked: string[] = [];
  for (const controller of [AuthController, AccessController, InvitesController]) {
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      if (name === "constructor") continue;
      const handler = (controller.prototype as unknown as Record<string, object>)[name];
      if (Reflect.getMetadata(ALLOW_WHEN_PASSWORD_CHANGE_REQUIRED_KEY, handler) === true) {
        marked.push(`${controller.name}.${name}`);
      }
    }
  }
  return marked.sort();
}

describe("AuthController (GUS-93: password change)", () => {
  it("lets only GET /auth/me and POST /auth/password answer while a password change is required", () => {
    // A closed list on purpose: marking another route would open it to an account that has not
    // replaced its password yet.
    expect(routesMarkedAsAllowed()).toEqual(["AuthController.changePassword", "AuthController.me"]);
  });

  it("asks only for a valid session on changePassword: no @Public, @Roles or @RequirePermission", () => {
    const handler = AuthController.prototype.changePassword;

    expect(Reflect.getMetadata(PUBLIC_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBeUndefined();
  });

  it("answers 200, not 201, on changePassword", () => {
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, AuthController.prototype.changePassword)).toBe(
      200,
    );
  });

  it("delegates changePassword to AuthService.changeOwnPassword with the id of the session user", async () => {
    const me = { id: "uuid-1", mustChangePassword: false };
    const changeOwnPassword = jest.fn().mockResolvedValue(me);
    const controller = new AuthController(
      { changeOwnPassword } as unknown as AuthService,
      {} as JwtService,
    );

    const result = await controller.changePassword(
      { newPassword: "NovaSenha@123" },
      { id: "uuid-1", role: Role.COORDINATOR, accessEnabled: true },
    );

    expect(result).toBe(me);
    expect(changeOwnPassword).toHaveBeenCalledTimes(1);
    expect(changeOwnPassword).toHaveBeenCalledWith("uuid-1", { newPassword: "NovaSenha@123" });
  });
});
