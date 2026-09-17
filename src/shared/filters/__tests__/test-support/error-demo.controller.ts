import { Body, Controller, Get, Post } from "@nestjs/common";
import { IsEmail } from "class-validator";

class ValidateDto {
  @IsEmail()
  email!: string;
}

@Controller("error-demo")
export class ErrorDemoController {
  @Post("validate")
  validate(@Body() _body: ValidateDto): { ok: true } {
    return { ok: true };
  }

  @Get("boom")
  boom(): never {
    throw new Error("secret");
  }
}
