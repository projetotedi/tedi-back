import { HttpException, Injectable } from "@nestjs/common";
import { EventEmitter2 } from "@nestjs/event-emitter";
import { DataSource, EntityManager } from "typeorm";
import { Clock } from "@shared/dates/clock";
import { ArchiveDto } from "@shared/dto/archive.dto";
import { isArchived, markArchived, markUnarchived } from "@shared/entities/archivable.columns";
import {
  AUDITABLE_ACTION_EVENT,
  AuditableAction,
  AuditableActionEvent,
} from "@shared/events/auditable-action.event";
import { CreateLessonPlanDto } from "../dto/create-lesson-plan.dto";
import { LessonPlanResponseDto } from "../dto/lesson-plan.response.dto";
import { UpdateLessonPlanDto } from "../dto/update-lesson-plan.dto";
import { LessonPlanContent } from "../entities/lesson-plan-content.entity";
import { LessonPlan } from "../entities/lesson-plan.entity";
import { toLessonPlanResponse } from "./lesson-plan-response.mapper";

const PLAN_FIELDS = ["title", "objective", "expectedDurationMinutes", "materialUrl"] as const;

const LESSON_PLAN_TARGET_TYPE = "lesson_plan";

export function lessonPlanNotFound(): HttpException {
  return new HttpException(
    { error: "LESSON_PLAN_NOT_FOUND", message: "Lesson plan not found." },
    404,
  );
}

function lessonPlanArchived(): HttpException {
  return new HttpException(
    { error: "LESSON_PLAN_ARCHIVED", message: "Archived lesson plans are read-only." },
    409,
  );
}

interface FieldChanges {
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  fields: string[];
}

@Injectable()
export class LessonPlansService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    private readonly clock: Clock,
  ) {}

  async create(dto: CreateLessonPlanDto, actorId: string): Promise<LessonPlanResponseDto> {
    const created = await this.dataSource.transaction(async (manager) => {
      const plan = await manager.save(
        manager.create(LessonPlan, {
          title: dto.title,
          objective: dto.objective ?? null,
          expectedDurationMinutes: dto.expectedDurationMinutes,
          materialUrl: dto.materialUrl ?? null,
          createdById: actorId,
        }),
      );
      const contents = await this.insertContents(manager, plan.id, dto.contents);

      return { plan, contents };
    });

    this.emit(AuditableAction.LESSON_PLAN_CREATED, actorId, created.plan.id, null, {
      title: created.plan.title,
      objective: created.plan.objective,
      expectedDurationMinutes: created.plan.expectedDurationMinutes,
      materialUrl: created.plan.materialUrl,
      contents: dto.contents,
    });

    return toLessonPlanResponse(created.plan, created.contents);
  }

  async findById(id: string): Promise<LessonPlanResponseDto> {
    const plan = await this.dataSource.getRepository(LessonPlan).findOne({ where: { id } });
    if (plan === null) throw lessonPlanNotFound();

    const contents = await this.dataSource.getRepository(LessonPlanContent).find({
      where: { lessonPlanId: id },
      order: { position: "ASC" },
    });

    return toLessonPlanResponse(plan, contents);
  }

  async update(
    id: string,
    dto: UpdateLessonPlanDto,
    actorId: string,
  ): Promise<LessonPlanResponseDto> {
    const changes: FieldChanges = { before: {}, after: {}, fields: [] };

    const updated = await this.dataSource.transaction(async (manager) => {
      const plan = await this.loadPlan(manager, id);

      if (isArchived(plan.archive)) {
        throw lessonPlanArchived();
      }

      let contents = await this.loadContents(manager, id);

      const planChanged = this.applyChanges(plan, dto as Record<string, unknown>, changes);

      let contentsChanged = false;
      if (dto.contents !== undefined && !this.hasSameTexts(contents, dto.contents)) {
        changes.before.contents = contents.map((content) => content.text);
        changes.after.contents = dto.contents;
        changes.fields.push("contents");

        await manager.delete(LessonPlanContent, { lessonPlanId: id });
        contents = await this.insertContents(manager, id, dto.contents);
        contentsChanged = true;
      }

      if (planChanged || contentsChanged) {
        plan.updatedAt = this.clock.now();
        await manager.save(plan);
      }

      return { plan, contents };
    });

    if (changes.fields.length > 0) {
      this.emit(AuditableAction.LESSON_PLAN_UPDATED, actorId, id, changes.before, {
        ...changes.after,
        changedFields: changes.fields,
      });
    }

    return toLessonPlanResponse(updated.plan, updated.contents);
  }

  async archive(
    id: string,
    dto: ArchiveDto | undefined,
    actorId: string,
  ): Promise<LessonPlanResponseDto> {
    const now = this.clock.now();

    const result = await this.dataSource.transaction(async (manager) => {
      const plan = await this.loadPlan(manager, id);

      const changed = markArchived(plan.archive, actorId, dto?.reason ?? null, now);
      if (changed) await manager.save(plan);

      const contents = await this.loadContents(manager, id);

      return { plan, contents, changed };
    });

    if (result.changed) {
      this.emit(
        AuditableAction.LESSON_PLAN_ARCHIVED,
        actorId,
        id,
        { archivedAt: null },
        {
          archivedAt: result.plan.archive.archivedAt,
          archiveReason: result.plan.archive.archiveReason,
        },
      );
    }

    return toLessonPlanResponse(result.plan, result.contents);
  }

  async unarchive(id: string, actorId: string): Promise<LessonPlanResponseDto> {
    const result = await this.dataSource.transaction(async (manager) => {
      const plan = await this.loadPlan(manager, id);

      const before = {
        archivedAt: plan.archive.archivedAt,
        archivedById: plan.archive.archivedById,
        archiveReason: plan.archive.archiveReason,
      };
      const changed = markUnarchived(plan.archive);
      if (changed) await manager.save(plan);

      const contents = await this.loadContents(manager, id);

      return { plan, contents, before, changed };
    });

    if (result.changed) {
      this.emit(AuditableAction.LESSON_PLAN_UNARCHIVED, actorId, id, result.before, {
        archivedAt: null,
      });
    }

    return toLessonPlanResponse(result.plan, result.contents);
  }

  private async loadPlan(manager: EntityManager, id: string): Promise<LessonPlan> {
    const plan = await manager.findOne(LessonPlan, {
      where: { id },
      lock: { mode: "pessimistic_write" },
    });
    if (plan === null) throw lessonPlanNotFound();

    return plan;
  }

  private loadContents(manager: EntityManager, lessonPlanId: string): Promise<LessonPlanContent[]> {
    return manager.find(LessonPlanContent, {
      where: { lessonPlanId },
      order: { position: "ASC" },
    });
  }

  private insertContents(
    manager: EntityManager,
    lessonPlanId: string,
    texts: readonly string[],
  ): Promise<LessonPlanContent[]> {
    return manager.save(
      texts.map((text, position) =>
        manager.create(LessonPlanContent, { lessonPlanId, position, text }),
      ),
    );
  }

  private hasSameTexts(current: readonly LessonPlanContent[], next: readonly string[]): boolean {
    return (
      current.length === next.length && current.every((content, i) => content.text === next[i])
    );
  }

  private applyChanges(
    plan: LessonPlan,
    values: Readonly<Record<string, unknown>>,
    changes: FieldChanges,
  ): boolean {
    const target = plan as unknown as Record<string, unknown>;
    let changed = false;

    for (const field of PLAN_FIELDS) {
      const next = values[field];
      if (next === undefined || next === target[field]) continue;

      changes.before[field] = target[field];
      changes.after[field] = next;
      changes.fields.push(field);
      target[field] = next;
      changed = true;
    }

    return changed;
  }

  private emit(
    action: AuditableAction,
    actorId: string,
    targetId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): void {
    const event = new AuditableActionEvent();
    event.actorId = actorId;
    event.action = action;
    event.targetType = LESSON_PLAN_TARGET_TYPE;
    event.targetId = targetId;
    event.before = before;
    event.after = after;
    event.occurredAt = this.clock.now();
    this.eventEmitter.emit(AUDITABLE_ACTION_EVENT, event);
  }
}
