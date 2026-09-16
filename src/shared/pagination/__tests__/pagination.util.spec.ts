import { normalizePagination } from "@shared/pagination/pagination.util";

describe("normalizePagination", () => {
  it("defaults to page 1 and limit 20 when nothing is provided", () => {
    expect(normalizePagination({})).toEqual({ page: 1, limit: 20 });
  });

  it("keeps valid page and limit values", () => {
    expect(normalizePagination({ page: 3, limit: 10 })).toEqual({ page: 3, limit: 10 });
  });

  it("falls back to page 1 when page is zero or negative", () => {
    expect(normalizePagination({ page: 0 })).toEqual({ page: 1, limit: 20 });
    expect(normalizePagination({ page: -5 })).toEqual({ page: 1, limit: 20 });
  });

  it("caps limit at 100", () => {
    expect(normalizePagination({ limit: 500 })).toEqual({ page: 1, limit: 100 });
  });
});
