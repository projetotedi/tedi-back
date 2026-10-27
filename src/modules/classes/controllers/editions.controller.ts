import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { EditionResponseDto } from "../dto/edition.response.dto";
import { EditionsService } from "../services/editions.service";

/**
 * The editions, for the selectors of the screens. There is no route to create, rename or delete
 * one: an edition is created on demand by `POST /classes` (and by the edit of a class) the first
 * time its name is used. Open to every profile (classes.view).
 */
@ApiTags("classes")
@Controller("editions")
@ApiStandardErrors()
export class EditionsController {
  constructor(private readonly editionsService: EditionsService) {}

  /** Lists every edition, the most recent first (by name: 2026.2 comes before 2026.1). */
  @Get()
  @RequirePermission(Permission.CLASSES_VIEW)
  @ApiOkResponse({ type: [EditionResponseDto] })
  listEditions(): Promise<EditionResponseDto[]> {
    return this.editionsService.list();
  }
}
