import { NoopLogger } from '@hexok/logger';
import { createSessions } from '../runtime/sessions.js';

/**
 * Signs a user in for local development and prints the token. The template
 * has no login procedure: a real app checks the credentials it owns, then
 * calls `sessions.open`.
 *
 * npm run session:open -w @hexok/app-template -- ada
 */
const userId = process.argv[2]?.trim() ?? '';
if (userId === '') {
  console.error('usage: npm run session:open -- <userId>');
  process.exit(1);
}

const { sessions, store } = createSessions({
  env: process.env,
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  logger: new NoopLogger(),
});
await store.start();
try {
  console.log(await sessions.open({ userId }));
} finally {
  await store.stop();
}
