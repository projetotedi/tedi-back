import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Clock } from "@shared/dates/clock";
import { LessonPlansController } from "./controllers/lesson-plans.controller";
import { LessonPlanContent } from "./entities/lesson-plan-content.entity";
import { LessonPlan } from "./entities/lesson-plan.entity";
import { LessonPlansService } from "./services/lesson-plans.service";

@Module({
  imports: [TypeOrmModule.forFeature([LessonPlan, LessonPlanContent])],
  controllers: [LessonPlansController],
  providers: [LessonPlansService, Clock],
})
export class CatalogModule {}
