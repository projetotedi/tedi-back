/**
 * The file formats of the export of hours (GUS-164). Only CSV: there is no spreadsheet library in
 * the project, and XLSX comes in another card, with a new dependency chosen by the team (adding a
 * value here is not a breaking change).
 */
export enum HoursExportFormat {
  CSV = "csv",
}
