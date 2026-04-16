import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 15000,
    hookTimeout: 15000,
    fileParallelism: false,
    env: {
      DATABASE_URL: 'postgresql://qrguard:qrguard@localhost:5432/qrguard',
      SESSION_SECRET: 'test-secret',
      EMAIL_PROVIDER: 'console',
      BASE_URL: 'http://localhost:3000',
    },
  },
});
