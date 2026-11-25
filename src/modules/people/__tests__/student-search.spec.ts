import { Brackets, ObjectLiteral, SelectQueryBuilder, WhereExpressionBuilder } from "typeorm";
import { applyStudentSearch } from "../services/student-search";

const NAME = `public.search_normalize(person.name) LIKE public.search_normalize(:studentListSearch) ESCAPE '\\'`;
const EMAIL = `public.search_normalize(person.email) LIKE public.search_normalize(:studentListSearch) ESCAPE '\\'`;
const PHONE = "person.phone_digits LIKE :studentListPhoneSearch";

type Call = [string, string, Record<string, unknown>];

describe("applyStudentSearch", () => {
  const builder = { andWhere: jest.fn(), getParameters: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    builder.getParameters.mockReturnValue({});
  });

  function search(term: string | undefined, contact: boolean): void {
    applyStudentSearch(builder as unknown as SelectQueryBuilder<ObjectLiteral>, term, { contact });
  }

  /** What the one OR group added to the query says: each where and orWhere, in order. */
  function group(): Call[] {
    expect(builder.andWhere).toHaveBeenCalledTimes(1);
    const brackets: unknown = builder.andWhere.mock.calls[0][0];
    if (!(brackets instanceof Brackets)) throw new Error("The search is not one Brackets group.");

    const calls: Call[] = [];
    const recorder = {
      where: (sql: string, parameters: Record<string, unknown>) => {
        calls.push(["where", sql, parameters]);
      },
      orWhere: (sql: string, parameters: Record<string, unknown>) => {
        calls.push(["orWhere", sql, parameters]);
      },
    };
    brackets.whereFactory(recorder as unknown as WhereExpressionBuilder);
    return calls;
  }

  it("adds nothing for a blank term", () => {
    for (const term of [undefined, "", "   "]) {
      search(term, true);
      search(term, false);
    }

    expect(builder.andWhere).not.toHaveBeenCalled();
  });

  it("searches only the name without contact", () => {
    search("98888", false);

    // A phone-shaped term too: without contact there is no e-mail and no phone.
    expect(group()).toEqual([["where", `(${NAME})`, { studentListSearch: "%98888%" }]]);
  });

  it("searches the name and the e-mail with contact, and no phone for a term with letters", () => {
    search("maria", true);
    expect(group()).toEqual([["where", `(${NAME} OR ${EMAIL})`, { studentListSearch: "%maria%" }]]);

    builder.andWhere.mockClear();
    search("joao123@x.com", true);
    expect(group()).toEqual([
      ["where", `(${NAME} OR ${EMAIL})`, { studentListSearch: "%joao123@x.com%" }],
    ]);
  });

  it("adds the digits of a phone-shaped term on phone_digits", () => {
    search("(11) 98888", true);
    expect(group()).toEqual([
      ["where", `(${NAME} OR ${EMAIL})`, { studentListSearch: "%(11) 98888%" }],
      ["orWhere", PHONE, { studentListPhoneSearch: "%1198888%" }],
    ]);

    builder.andWhere.mockClear();
    search(" 98888 ", true);
    expect(group()).toEqual([
      ["where", `(${NAME} OR ${EMAIL})`, { studentListSearch: "%98888%" }],
      ["orWhere", PHONE, { studentListPhoneSearch: "%98888%" }],
    ]);
  });

  it("does not add the phone branch for a phone-shaped term without digits", () => {
    search("( )", true);

    expect(group()).toEqual([["where", `(${NAME} OR ${EMAIL})`, { studentListSearch: "%( )%" }]]);
  });

  it("throws, adding nothing, when a parameter it needs is already in the query", () => {
    builder.getParameters.mockReturnValue({ studentListSearch: "%x%" });
    expect(() => search("maria", false)).toThrow(
      'Search parameter "studentListSearch" is already defined in this query.',
    );

    builder.getParameters.mockReturnValue({ studentListPhoneSearch: "%1%" });
    expect(() => search("98888", true)).toThrow(
      'Search parameter "studentListPhoneSearch" is already defined in this query.',
    );
    // A term that does not search the phone does not need its parameter.
    search("maria", true);

    expect(builder.andWhere).toHaveBeenCalledTimes(1);
  });
});
