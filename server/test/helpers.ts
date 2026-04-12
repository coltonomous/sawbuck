import { auth } from '../auth.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

export interface TestUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
  cookieHeader: string;
}

/**
 * Creates a real user via better-auth's sign-up API, extracts the session
 * cookie from the Set-Cookie response header, and returns it for use in tests.
 *
 * No mocking — this goes through the same auth flow a real user would.
 */
export async function createTestUser(role: 'user' | 'admin' = 'user'): Promise<TestUser> {
  const email = `test-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = `TestPass${crypto.randomUUID().slice(0, 8)}!`;

  // Sign up via better-auth API — this creates a user, account, and session
  const signUpRes = await auth.api.signUpEmail({
    body: {
      email,
      password,
      name: role === 'admin' ? 'Test Admin' : 'Test User',
    },
  });

  const userId = signUpRes.user.id;

  // If admin, promote the user
  if (role === 'admin') {
    await db.update(users)
      .set({ role: 'admin' })
      .where(eq(users.id, userId));
  }

  // Sign in to get a valid session cookie
  const signInRes = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });

  // Extract session cookie from Set-Cookie header
  const setCookie = signInRes.headers.get('set-cookie') || '';
  const cookies = setCookie.split(',').map(c => c.trim());
  const sessionCookies = cookies
    .flatMap(c => c.split(';'))
    .filter(part => part.trim().startsWith('better-auth.session_token='))
    .map(part => part.trim());

  const cookieHeader = sessionCookies[0] || '';

  return {
    id: userId,
    email,
    role,
    cookieHeader,
  };
}

/**
 * Build headers for an authenticated test request.
 */
export function authHeaders(testUser: TestUser): Record<string, string> {
  return { Cookie: testUser.cookieHeader };
}
