import "reflect-metadata";
import { ArgumentsHost, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { HttpExceptionFilter } from "../http-exception.filter";

// ---------------------------------------------------------------------------
// Helpers — mock ArgumentsHost
// ---------------------------------------------------------------------------

function buildHost(
  responseMock: { status: jest.Mock; json: jest.Mock } = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  },
): { host: ArgumentsHost; responseMock: { status: jest.Mock; json: jest.Mock } } {
  const host = {
    switchToHttp: () => ({
      getResponse: () => responseMock,
      getRequest: () => ({}),
    }),
  } as unknown as ArgumentsHost;
  return { host, responseMock };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("HttpExceptionFilter", () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("HttpException — generic 401", () => {
    it("returns 401 with UNAUTHORIZED error code and default message", () => {
      const { host, responseMock } = buildHost();
      const exception = new HttpException("Unauthorized", HttpStatus.UNAUTHORIZED);

      filter.catch(exception, host);

      expect(responseMock.status).toHaveBeenCalledWith(HttpStatus.UNAUTHORIZED);
      const body = responseMock.json.mock.calls[0][0];
      expect(body.statusCode).toBe(401);
      expect(body.message).toBe("Unauthorized.");
      expect(body.error).toBe("UNAUTHORIZED");
    });
  });

  describe("Router NotFoundException — Cannot GET /x", () => {
    it("normalises to NOT_FOUND with canonical message", () => {
      const { host, responseMock } = buildHost();
      const exception = new HttpException(
        { statusCode: 404, message: "Cannot GET /does-not-exist", error: "Not Found" },
        HttpStatus.NOT_FOUND,
      );

      filter.catch(exception, host);

      expect(responseMock.status).toHaveBeenCalledWith(404);
      const body = responseMock.json.mock.calls[0][0];
      expect(body).toMatchObject({
        statusCode: 404,
        message: "Resource not found.",
        error: "NOT_FOUND",
      });
    });
  });

  describe("VALIDATION_FAILED payload", () => {
    it("maps rawErrors to details array and uses VALIDATION_FAILED error code", () => {
      const { host, responseMock } = buildHost();
      const exception = new HttpException(
        {
          error: "VALIDATION_FAILED",
          rawErrors: [{ field: "email", message: "email must be an email" }],
        },
        HttpStatus.BAD_REQUEST,
      );

      filter.catch(exception, host);

      expect(responseMock.status).toHaveBeenCalledWith(400);
      const body = responseMock.json.mock.calls[0][0];
      expect(body.statusCode).toBe(400);
      expect(body.error).toBe("VALIDATION_FAILED");
      expect(body.details).toEqual([{ field: "email", message: "email must be an email" }]);
    });
  });

  describe("Unhandled Error — no stack leak", () => {
    it("responds with 500 and generic message, without leaking error.message", () => {
      const { host, responseMock } = buildHost();
      jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

      const exception = new Error("secret database password");

      filter.catch(exception, host);

      expect(responseMock.status).toHaveBeenCalledWith(500);
      const body = responseMock.json.mock.calls[0][0];
      expect(body.statusCode).toBe(500);
      expect(body.message).toBe("Internal server error.");
      expect(body.error).toBe("INTERNAL_SERVER_ERROR");
      expect(JSON.stringify(body)).not.toContain("secret");
    });
  });

  describe("Unhandled Error — Logger.error receives stack", () => {
    it("calls Logger.error with message and stack", () => {
      const { host } = buildHost();
      const loggerSpy = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);

      const exception = new Error("internal boom");

      filter.catch(exception, host);

      expect(loggerSpy).toHaveBeenCalledWith("internal boom", expect.any(String));
    });
  });
});
