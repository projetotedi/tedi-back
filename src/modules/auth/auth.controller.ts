import { Controller, Get, HttpCode, Post, Res, Body, UseGuards } from "@nestjs/common";
import {
  ApiOkResponse,
  ApiNoContentResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { Response, CookieOptions } from "express";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { Public } from "@shared/decorators/public.decorator";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { JwtService } from "@nestjs/jwt";
import { SESSION_COOKIE_NAME } from "./auth.constants";
import { AuthService } from "./services/auth.service";
import { LoginThrottlerGuard } from "./guards/login-throttler.guard";
import { LoginDto } from "./dto/login.dto";
import { MeResponseDto } from "./dto/me-response.dto";

/**
 * Returns cookie options for the tedi_session cookie.
 * - httpOnly: always true
 * - secure: only in production
 * - sameSite: 'none' in production (cross-site), 'lax' in dev
 * - maxAge: 7 days in milliseconds
 * - path: /
 */
function cookieOptions(): CookieOptions {
  const prod = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: prod,
    sameSite: prod ? "none" : "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
  };
}

@ApiTags("auth")
@Controller("auth")
@ApiStandardErrors()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post("login")
  @HttpCode(200)
  @UseGuards(LoginThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 15 * 60 * 1000 } })
  @ApiOkResponse({ type: MeResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorDto })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponseDto> {
    const me = await this.authService.login(dto);
    const token = await this.jwt.signAsync({ sub: me.id });
    res.cookie(SESSION_COOKIE_NAME, token, cookieOptions());
    return me;
  }

  @Get("me")
  @ApiOkResponse({ type: MeResponseDto })
  async me(@CurrentUser() user: AuthUser): Promise<MeResponseDto> {
    return this.authService.getMe(user.id);
  }

  @Public()
  @Post("logout")
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Session cookie cleared." })
  logout(@Res({ passthrough: true }) res: Response): void {
    res.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      path: "/",
    });
  }
}
