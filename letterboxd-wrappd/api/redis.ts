/**
 * Server-only Redis client using ioredis
 * DO NOT import this file in client-side code
 */

import Redis from 'ioredis';

// Ensure this only runs on the server
if (typeof window !== 'undefined') {
  throw new Error('Redis client cannot be used in browser code');
}

// Check for Redis URL - Vercel prefixes with project name
const REDIS_URL = process.env.letterbddy_REDIS_URL || process.env.REDIS_URL;

let redis: Redis | null = null;

/**
 * Get Redis client instance (lazy initialization for serverless)
 * Returns null if Redis is not configured
 */
export function getRedis(): Redis | null {
  if (!REDIS_URL) {
    console.warn('Redis URL not configured (letterbddy_REDIS_URL or REDIS_URL)');
    return null;
  }

  if (!redis) {
    redis = new Redis(REDIS_URL, {
      // Serverless-friendly defaults
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null; // Stop retrying after 3 attempts
        return Math.min(times * 100, 1000); // Exponential backoff, max 1s
      },
      connectTimeout: 5000, // 5 second connection timeout
      commandTimeout: 5000, // 5 second command timeout
      lazyConnect: true, // Don't connect until first command
      enableReadyCheck: false, // Skip ready check for faster startup
      enableOfflineQueue: false, // Fail fast if disconnected
    });

    redis.on('error', (err) => {
      console.error('Redis connection error:', err.message);
    });
  }

  return redis;
}

/**
 * Check if Redis is available and connected
 */
export async function isRedisAvailable(): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;

  try {
    await client.ping();
    return true;
  } catch (err) {
    console.error('Redis ping failed:', err);
    return false;
  }
}

/**
 * Get cached value by key
 */
export async function getCached<T>(key: string): Promise<T | null> {
  const client = getRedis();
  if (!client) return null;

  try {
    const value = await client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch (err) {
    console.error('Redis get error:', err);
    return null;
  }
}

/**
 * Set cached value with optional expiration (in seconds)
 */
export async function setCached(key: string, value: unknown, expiresInSeconds?: number): Promise<boolean> {
  const client = getRedis();
  if (!client) return false;

  try {
    const json = JSON.stringify(value);
    if (expiresInSeconds) {
      await client.setex(key, expiresInSeconds, json);
    } else {
      await client.set(key, json);
    }
    return true;
  } catch (err) {
    console.error('Redis set error:', err);
    return false;
  }
}

// Cache key prefixes
export const CACHE_KEYS = {
  TMDB_DATA: 'tmdb:',
  LETTERBOXD_MAPPING: 'lb:',
} as const;

// Cache durations
export const CACHE_DURATION = {
  TMDB_DATA: 60 * 60 * 24 * 30, // 30 days
  LETTERBOXD_MAPPING: 60 * 60 * 24 * 90, // 90 days
} as const;
