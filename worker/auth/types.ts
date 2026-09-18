export type UserRole = "CUSTOMER" | "STAFF" | "OWNER";

export interface AuthSession {
  sessionId: string;
  userId: string;
  role: UserRole;
  phoneHash: string;
  createdAt: string;
  expiresAt: string;
}

