/**
 * Order of the list of classes (GUS-103). START_DATE puts the class that starts last first, the
 * default; CODE is alphabetical, ignoring case. Both break ties by id, so a page never repeats or
 * skips a class.
 */
export enum ClassListSort {
  START_DATE = "startDate",
  CODE = "code",
}
