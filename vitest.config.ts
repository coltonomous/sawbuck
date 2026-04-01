import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['server/**/*.test.ts'],
    env: {
      BETTER_AUTH_SECRET: 'test-secret-for-vitest-sessions-must-be-32-chars-long',
      BETTER_AUTH_URL: 'http://localhost:3001',
    },
  },
});
