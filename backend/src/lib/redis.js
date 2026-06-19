import Redis from "ioredis";

// One shared Redis connection for the whole app (cache + rate limiter).
// commandTimeout bounds every command so a down Redis fails fast and callers
// can degrade gracefully instead of hanging.
export const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6380", {
    maxRetriesPerRequest: 2,
    commandTimeout: 1000,
});

redis.on("connect", () => console.log("Redis connected"));
redis.on("error", (err) => console.error("Redis error:", err.message));
