import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from './db/index.js';
import * as schema from './db/schema.js';

const isProd = process.env.NODE_ENV === 'production';

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'sqlite',
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),
  baseURL: process.env.BETTER_AUTH_URL || (isProd ? undefined : 'http://localhost:3001'),
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        overrideUserInfoOnSignIn: true,
      },
    } : {}),
  },
  account: {
    accountLinking: {
      enabled: true,
      updateUserInfoOnLink: true,
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },
  user: {
    additionalFields: {
      role: {
        type: 'string',
        defaultValue: 'user',
        input: false,
      },
      preferredLatitude: {
        type: 'number',
        required: false,
        input: false,
        fieldName: 'preferredLatitude',
      },
      preferredLongitude: {
        type: 'number',
        required: false,
        input: false,
        fieldName: 'preferredLongitude',
      },
      preferredRadiusMiles: {
        type: 'number',
        defaultValue: 25,
        input: false,
        fieldName: 'preferredRadiusMiles',
      },
      maxBudget: {
        type: 'number',
        required: false,
        input: false,
        fieldName: 'maxBudget',
      },
      shopSpace: {
        type: 'string',
        required: false,
        input: false,
        fieldName: 'shopSpace',
      },
      experienceLevel: {
        type: 'string',
        required: false,
        input: false,
        fieldName: 'experienceLevel',
      },
      stylePreferences: {
        type: 'string',
        required: false,
        input: false,
        fieldName: 'stylePreferences',
      },
    },
  },
});

export type AuthUser = typeof auth.$Infer.Session.user;
export type AuthSession = typeof auth.$Infer.Session.session;
