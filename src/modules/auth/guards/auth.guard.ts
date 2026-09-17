import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { SESSION_COOKIE_NAME, REQUEST_USER_KEY } from "../auth.constants";
import { ROLES_KEY } from "@shared/decorators/roles.decorator";
import { PUBLIC_KEY } from "@shared/decorators/public.decorator";
import { Role, roleSatisfies } from "@shared/enums/role.enum";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { PeopleService } from "@modules/people/services/people.service";

interface JwtPayload {
  sub: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly people: PeopleService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Step 1: @Public() → bypass all auth checks.
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const request = ctx.switchToHttp().getRequest<Request & Record<string, AuthUser>>();

    // Step 2: DEV_FAKE_ROLE — only in non-production environments.
    const fakeUser = this.resolveFakeUser();
    if (fakeUser !== null) {
      request[REQUEST_USER_KEY] = fakeUser;
      return this.checkRoles(ctx, fakeUser);
    }

    // Step 3: Require cookie tedi_session.
    const token: string | undefined = (request.cookies as Record<string, string | undefined>)[
      SESSION_COOKIE_NAME
    ];
    if (!token) {
      throw new UnauthorizedException();
    }

    // Step 4: Verify JWT signature.
    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token, {
        secret: this.config.getOrThrow<string>("JWT_SECRET"),
      });
    } catch {
      throw new UnauthorizedException();
    }

    // Step 5: Load Person from DB (never trust role from token — decision 19).
    const person = await this.people.findById(payload.sub);
    if (!person) {
      throw new UnauthorizedException();
    }

    // Step 6: accessEnabled=false → immediate revocation (decision 19).
    if (!person.accessEnabled) {
      throw new UnauthorizedException();
    }

    // Step 7: role=null → not fully provisioned yet.
    if (person.role === null) {
      throw new UnauthorizedException();
    }

    // Step 8: Attach AuthUser to request.
    const authUser: AuthUser = {
      id: person.id,
      role: person.role,
      accessEnabled: person.accessEnabled,
    };
    request[REQUEST_USER_KEY] = authUser;

    // Steps 9–10: Check @Roles if present.
    return this.checkRoles(ctx, authUser);
  }

  /**
   * Resolves a fake AuthUser for development bypass.
   * Returns null if: production, DEV_FAKE_ROLE not set, or value is invalid.
   */
  private resolveFakeUser(): AuthUser | null {
    if (process.env.NODE_ENV === "production") return null;

    const fakeRole = process.env.DEV_FAKE_ROLE;
    if (!fakeRole) return null;

    const validRoles: string[] = Object.values(Role);
    if (!validRoles.includes(fakeRole)) return null;

    return {
      id: "dev-fake-user",
      role: fakeRole as Role,
      accessEnabled: true,
    };
  }

  /**
   * Applies @Roles() hierarchy check.
   * If no @Roles decorator is present, any logged-in user passes.
   */
  private checkRoles(ctx: ExecutionContext, user: AuthUser): boolean {
    const minRole = this.reflector.getAllAndOverride<Role | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (minRole === undefined) return true;

    if (!roleSatisfies(user.role, minRole)) {
      throw new ForbiddenException();
    }

    return true;
  }
}
