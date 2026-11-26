import { EnrollmentPageQueryDto } from "./enrollment-page-query.dto";

/**
 * Query parameters for GET /classes/:id/available-students. No field of its own: a class of its
 * own so the contract names it.
 */
export class ListAvailableStudentsQueryDto extends EnrollmentPageQueryDto {}
