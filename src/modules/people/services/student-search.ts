import { Brackets, ObjectLiteral, SelectQueryBuilder } from "typeorm";
import {
  assertParametersAvailable,
  digitsSearchCondition,
  textSearchCondition,
} from "@shared/search/search.util";

/** A term the screen can only mean as a phone: digits and the formatting normalizePhone strips. */
const PHONE_SHAPED_TERM = /^[\d\s().+-]+$/;

const TEXT_PARAMETER = "studentListSearch";
const PHONE_PARAMETER = "studentListPhoneSearch";

/**
 * The search of a list of students (GUS-106), as one OR group (docs/ARCHITECTURE.md 12.1):
 * the name, ignoring case and accents; with `contact`, also the e-mail and, when the term is
 * phone-shaped, the digits of the phone (phone_digits, so a stored mask does not matter).
 * `contact` matches personal data (RNF-13): only for a caller that shows it, under students.view.
 * A term with a letter is never read as a phone: "joao123@x.com" does not bring every phone with 123.
 *
 * Adds nothing for a blank term. Throws when a parameter it needs is already in the query
 * (`assertParametersAvailable`, as `applyTextSearch` does): two searches never share a parameter.
 */
export function applyStudentSearch<T extends ObjectLiteral>(
  builder: SelectQueryBuilder<T>,
  term: string | undefined,
  options: { contact: boolean },
): void {
  if (term === undefined) return;
  const columns = options.contact ? ["person.name", "person.email"] : ["person.name"];
  const text = textSearchCondition(columns, term, TEXT_PARAMETER);
  if (text === undefined) return;

  const digits =
    options.contact && PHONE_SHAPED_TERM.test(term.trim())
      ? digitsSearchCondition("person.phone_digits", term, PHONE_PARAMETER)
      : undefined;

  assertParametersAvailable(builder, text.parameters);
  if (digits !== undefined) assertParametersAvailable(builder, digits.parameters);

  builder.andWhere(
    new Brackets((group) => {
      group.where(text.sql, text.parameters);
      if (digits !== undefined) group.orWhere(digits.sql, digits.parameters);
    }),
  );
}
