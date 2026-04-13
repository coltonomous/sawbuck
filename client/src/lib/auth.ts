import { createAuthClient } from 'better-auth/react';
import type { Session, User } from 'better-auth';

// Extend the user type with custom fields defined in server/auth.ts
export interface AppUser extends User {
  role: 'user' | 'admin';
  preferredLatitude: number | null;
  preferredLongitude: number | null;
  preferredRadiusMiles: number | null;
  maxBudget: number | null;
  shopSpace: string | null;
  experienceLevel: string | null;
  stylePreferences: string | null;
}

export const authClient = createAuthClient({
  baseURL: window.location.origin,
});

// Re-export hooks with proper user typing
const { useSession: _useSession, signIn, signOut, signUp } = authClient;

export function useSession() {
  const session = _useSession();
  return session as typeof session & {
    data: { user: AppUser; session: Session } | null;
  };
}

export { signIn, signOut, signUp };
