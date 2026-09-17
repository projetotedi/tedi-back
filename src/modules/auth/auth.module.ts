import { APP_GUARD } from "@nestjs/core";
import { Module, Logger, OnApplicationBootstrap } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { PeopleModule } from "@modules/people/people.module";
import { AuthGuard } from "./guards/auth.guard";

@Module({
  imports: [
    PeopleModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.getOrThrow<string>("JWT_SECRET"),
        signOptions: { expiresIn: "7d" },
      }),
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    AuthGuard,
  ],
  exports: [],
})
export class AuthModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuthModule.name);

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === "production" && process.env.DEV_FAKE_ROLE !== undefined) {
      this.logger.warn(
        "DEV_FAKE_ROLE is set but NODE_ENV=production — the variable is IGNORED. " +
          "Remove DEV_FAKE_ROLE from your production environment.",
      );
    }
  }
}
