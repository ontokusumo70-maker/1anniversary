export type UserRole = "CUSTOMER" | "STAFF" | "OWNER";

export interface AuthSession {
  sessionId: string;
  userId: string;
  role: UserRole;
  phoneHash: string;
  createdAt: string;
  expiresAt: string;
}

export interface OtpChallenge {
  challengeId: string;
  phoneHash: string;
  role: UserRole;
  otpHash: string;
  createdAt: string;
  expiresAt: string;
  attempts: number;
  consumed: boolean;
}
