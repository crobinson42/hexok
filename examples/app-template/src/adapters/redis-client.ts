import { createClient, type RedisClientType } from 'redis';

export type RedisClient = RedisClientType;

export async function connectRedis(
  url = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
): Promise<RedisClient> {
  // Inferred RESP is 2 | 3 under exactOptionalPropertyTypes. Pin the default.
  const client: RedisClient = createClient({ url });
  await client.connect();
  return client;
}
