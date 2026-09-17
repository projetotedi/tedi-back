import { computeOpenApiJson } from "../../../../scripts/openapi-runtime";

describe("export-openapi (idempotency)", () => {
  it("produces identical output when called twice (Caso 1 in-process)", async () => {
    const [first, second] = await Promise.all([computeOpenApiJson(), computeOpenApiJson()]);
    expect(first).toBe(second);
  }, 30000);
});
