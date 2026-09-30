import { SetMetadata } from "@nestjs/common";

export type Role = "clinician" | "subject";

export const ROLES_KEY = "roles";

/** Marks a route as requiring one of the given roles. See RolesGuard for enforcement. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
