import { Injectable } from "@nestjs/common";
import { Readable } from "node:stream";
import { DataSource } from "typeorm";
import { MemberRefDto } from "@modules/people/dto/member-ref.response.dto";
import { MembersService } from "@modules/people/services/members.service";
import { AuthUser } from "@shared/decorators/auth-user.type";
import { Permission } from "@shared/permissions/permission.enum";
import { HoursExportQueryDto } from "../dto/hours-export-query.dto";
import { HoursPeriodQueryDto } from "../dto/hours-period-query.dto";
import { HourEntry } from "../entities/hour-entry.entity";
import { applyPopulation, HoursPopulation, isNobody } from "./hour-entry-queries";
import {
  CSV_BOM,
  csvLine,
  HOURS_CSV_HEADER,
  HOURS_EXPORT_BATCH_SIZE,
  hoursExportFileName,
  toHoursCsvValues,
} from "./hours-csv";
import { HoursScopeService } from "./hours-scope.service";
import { applyPeriod, assertValidPeriod } from "./hours.service";

/** The file of an export: its name and the stream of its bytes, read as it is sent. */
export interface HoursExportFile {
  fileName: string;
  stream: Readable;
}

/** The last entry of a batch: where the next batch starts. */
interface KeysetCursor {
  date: string;
  id: string;
}

/**
 * The export of hours (GUS-164), with hours.export and its scope: a director exports her current
 * department, coordination and the superadmin everyone. A CSV with one line per entry not removed
 * of the period (hours-csv.ts), in the order `date, id`.
 */
@Injectable()
export class HoursExportService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly scope: HoursScopeService,
    private readonly members: MembersService,
  ) {}

  /**
   * `GET /hours/export`. The period and the scope are resolved BEFORE the stream exists, so their
   * errors (400 INVALID_PERIOD) still go out as JSON; after that the file is read in batches while
   * it is sent, never loaded whole.
   */
  async exportCsv(actor: AuthUser, query: HoursExportQueryDto): Promise<HoursExportFile> {
    assertValidPeriod(query);
    const population = await this.scope.populationOf(actor, Permission.HOURS_EXPORT);

    return {
      fileName: hoursExportFileName(query),
      stream: Readable.from(this.csvLines(population, query), { objectMode: false }),
    };
  }

  /**
   * The lines of the file: the byte order mark and the header first, before any query (so the
   * headers of the response go out with them), then the entries in batches of
   * HOURS_EXPORT_BATCH_SIZE by keyset `(date, id)`, without OFFSET, until a short batch. Nobody in
   * the scope writes only the header.
   *
   * Sequential on purpose: each batch starts after the last row of the previous one, and the
   * stream asks for the next lines only when the client takes them. No transaction: a download is
   * slow I/O. Each batch is read at its own instant, so a review in the middle of a download may
   * show in part, but each entry goes out once, since the keyset neither repeats nor skips a row.
   * The members of each batch are named by one call to findMemberRefs for the people not seen yet,
   * kept in a map of this run only.
   */
  private async *csvLines(
    population: HoursPopulation,
    period: HoursPeriodQueryDto,
  ): AsyncGenerator<string> {
    yield CSV_BOM + csvLine(HOURS_CSV_HEADER);
    if (isNobody(population)) return;

    const seen = new Set<string>();
    const membersById = new Map<string, MemberRefDto>();
    let after: KeysetCursor | null = null;

    for (;;) {
      const batch = await this.readBatch(population, period, after);
      if (batch.length === 0) return;

      const unseen = [...new Set(batch.map((entry) => entry.personId))].filter(
        (personId) => !seen.has(personId),
      );
      if (unseen.length > 0) {
        for (const member of await this.members.findMemberRefs({ ids: unseen })) {
          membersById.set(member.id, member);
        }
        for (const personId of unseen) seen.add(personId);
      }

      yield batch
        .map((entry) => csvLine(toHoursCsvValues(entry, membersById.get(entry.personId) ?? null)))
        .join("");

      if (batch.length < HOURS_EXPORT_BATCH_SIZE) return;
      const last = batch[batch.length - 1];
      after = { date: last.date, id: last.id };
    }
  }

  private readBatch(
    population: HoursPopulation,
    period: HoursPeriodQueryDto,
    after: KeysetCursor | null,
  ): Promise<HourEntry[]> {
    const builder = this.dataSource.getRepository(HourEntry).createQueryBuilder("entry");
    applyPeriod(builder, period);
    applyPopulation(builder, population);
    if (after !== null) {
      builder.andWhere(
        "(entry.date > :afterDate OR (entry.date = :afterDate AND entry.id > :afterId))",
        { afterDate: after.date, afterId: after.id },
      );
    }
    return builder
      .orderBy("entry.date", "ASC")
      .addOrderBy("entry.id", "ASC")
      .limit(HOURS_EXPORT_BATCH_SIZE)
      .getMany();
  }
}
