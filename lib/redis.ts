// lib/redis.ts
import Redis from 'ioredis';

const getRedisClient = () => {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new Error("REDIS_URL is not defined");
  }

  console.log("⚡️ Redis Client (TCP) Connecting...");
  
  return new Redis(redisUrl, {
    maxRetriesPerRequest: 2,
    connectTimeout: 10000,
    retryStrategy: (times) => {
      // Never return null — keep retrying with backoff so a brief
      // Redis outage doesn't permanently kill the client.
      return Math.min(times * 200, 5000);
    },
    reconnectOnError: () => {
      // Reconnect on all errors — Redis may restart or network may flap.
      return true;
    },
    lazyConnect: true,
    enableReadyCheck: false,
  });
};

// Singleton pattern to prevent "Too Many Connections" errors in development & serverless
const globalForRedis = global as typeof global & { redis?: Redis };
export const redis = globalForRedis.redis || getRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis;
}