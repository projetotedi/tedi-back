import { SetMetadata } from "@nestjs/common";

export const PUBLIC_KEY = "auth:public";

/**
 * Marks a route as publicly accessible — no cookie, no JWT required.
 * The AuthGuard short-circuits immediately when it finds this metadata.
 *
 * Usage:
 *   @Public()  — allow any request (authenticated or not).
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
