import { Controller, Get, Logger, Query, StreamableFile } from "@nestjs/common";
import { StreamableHandlerResponse } from "@nestjs/common/file-stream/interfaces";
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { CurrentUser } from "@shared/decorators/current-user.decorator";
import { ApiErrorDto } from "@shared/dto/api-error.dto";
import { Permission } from "@shared/permissions/permission.enum";
import { RequirePermission } from "@shared/permissions/require-permission.decorator";
import { ApiStandardErrors } from "@shared/swagger/api-standard-errors.decorator";
import { HoursExportQueryDto } from "../dto/hours-export-query.dto";
import { HoursOverviewQueryDto } from "../dto/hours-overview-query.dto";
import { HoursOverviewResponseDto } from "../dto/hours-overview.response.dto";
import { HoursExportService } from "../services/hours-export.service";
import { HoursViewService } from "../services/hours-view.service";

const exportLogger = new Logger("HoursExport");

/**
 * What the export does when its stream fails, instead of the default of Nest, which answers 400
 * with the message of the error before the first byte (it would show the text of Postgres to the
 * client) and ends the response after it (a cut CSV would look complete).
 *
 * The error is logged here: the Express adapter hands an error of the stream only to this handler,
 * never to the error logger of the StreamableFile. Then:
 * - the response is already gone: nothing else;
 * - nothing was sent yet: a generic 500, without the message of the error;
 * - the file is half sent: the connection is destroyed, so the download arrives broken, never cut
 *   as if it were whole.
 */
export function abortExportResponse(error: Error, response: StreamableHandlerResponse): void {
  exportLogger.error(error.message, error.stack);
  if (response.destroyed) return;
  if (!response.headersSent) {
    response.statusCode = 500;
    response.send(
      JSON.stringify({
        statusCode: 500,
        message: "Internal server error.",
        error: "INTERNAL_SERVER_ERROR",
      }),
    );
    return;
  }
  if ("destroy" in response && typeof response.destroy === "function") {
    response.destroy();
  }
}

/**
 * The bank of hours of the team (E7, GUS-164): the overview (hours.viewOthers) and the export
 * (hours.export). A director reads and exports her current department, coordination and the
 * superadmin everyone, filtered in the query. A member answers 403 FORBIDDEN.
 */
@ApiTags("hours")
@Controller("hours")
@ApiStandardErrors()
export class HoursController {
  constructor(
    private readonly viewService: HoursViewService,
    private readonly exportService: HoursExportService,
  ) {}

  @Get("overview")
  @RequirePermission(Permission.HOURS_VIEW_OTHERS)
  @ApiOkResponse({ type: HoursOverviewResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorDto, description: "VALIDATION_FAILED | INVALID_PERIOD" })
  @ApiForbiddenResponse({
    type: ApiErrorDto,
    description:
      "FORBIDDEN: a member (hours.viewOthers). A director without department gets an empty overview.",
  })
  getHoursOverview(
    @Query() query: HoursOverviewQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<HoursOverviewResponseDto> {
    return this.viewService.getOverview(actor, query);
  }

  @Get("export")
  @RequirePermission(Permission.HOURS_EXPORT)
  @ApiProduces("text/csv")
  @ApiOkResponse({
    schema: { type: "string", format: "binary" },
    description:
      "CSV in UTF-8 with BOM, separated by ; with CRLF: a header and one line per entry of the period, in the order date, id. The name of the file comes in Content-Disposition.",
  })
  @ApiBadRequestResponse({
    type: ApiErrorDto,
    description: "VALIDATION_FAILED (format=xlsx included) | INVALID_PERIOD, as JSON.",
  })
  @ApiForbiddenResponse({ type: ApiErrorDto, description: "FORBIDDEN: a member (hours.export)." })
  async exportHours(
    @Query() query: HoursExportQueryDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<StreamableFile> {
    const file = await this.exportService.exportCsv(actor, query);
    return new StreamableFile(file.stream, {
      type: "text/csv; charset=utf-8",
      disposition: `attachment; filename="${file.fileName}"`,
    }).setErrorHandler(abortExportResponse);
  }
}
