import type { UserRole } from "./types";

export function hasRole(
  role: UserRole,
  allowedRoles: UserRole[],
): boolean {
  return allowedRoles.includes(role);
}

export function requireRole(
  role: UserRole,
  allowedRoles: UserRole[],
): void {
  if (!hasRole(role, allowedRoles)) {
    throw new Error("FORBIDDEN");
  }
}

export function canAccessStaff(role: UserRole): boolean {
  return role === "STAFF" || role === "OWNER";
}

export function canAccessOwner(role: UserRole): boolean {
  return role === "OWNER";
}

export function canAccessCustomer(role: UserRole): boolean {
  return role === "CUSTOMER";
}

export function canActivateMachine(role: UserRole): boolean {
  return role === "STAFF" || role === "OWNER";
}

export function canExportOwnerData(role: UserRole): boolean {
  return role === "OWNER";
}
