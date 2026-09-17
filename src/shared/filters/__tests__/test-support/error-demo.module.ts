import { Module } from "@nestjs/common";
import { ErrorDemoController } from "./error-demo.controller";

@Module({
  controllers: [ErrorDemoController],
})
export class ErrorDemoModule {}
