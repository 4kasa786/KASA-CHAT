import { redis } from "../lib/redis.js";

const WINDOW_MS = 60_000; // 1 minute
const LIMIT = 5; // max @ai calls per window per user

// Sliding-window rate limiter as ONE atomic Lua script. Redis runs it start-to-
// finish with nothing interleaved, so the remove→count→add sequence can't race
// between concurrent requests (the gap that a non-atomic version would leave).
//   KEYS[1] = per-user key   ARGV = now(ms), window(ms), limit, uniqueMember
//   returns { allowed(1/0), retryAfterMs }
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]

-- 1. drop calls older than the window
redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
-- 2. how many remain in the window?
local count = redis.call('ZCARD', key)

if count < limit then
  -- 3a. under the limit → record this call (timestamp as score) and allow
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)  -- auto-clean idle keys
  return {1, 0}
else
  -- 3b. at the limit → reject; retry-after = when the oldest call exits the window
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local retry = window
  if oldest[2] then
    retry = (tonumber(oldest[2]) + window) - now
  end
  return {0, retry}
end
`;

// Returns { allowed: boolean, retryAfterSec: number }.
export const checkAiRateLimit = async (userId) => {
    const now = Date.now();
    const member = `${now}-${Math.random().toString(36).slice(2, 8)}`; // unique even within the same ms
    try {
        const [allowed, retryMs] = await redis.eval(
            SLIDING_WINDOW_LUA,
            1,
            `ratelimit:@ai:${userId}`,
            now,
            WINDOW_MS,
            LIMIT,
            member
        );
        return { allowed: allowed === 1, retryAfterSec: Math.ceil((retryMs || 0) / 1000) };
    } catch (err) {
        // Fail OPEN: if Redis is down, don't block users on a limiter outage.
        console.error("Rate limit check failed (allowing):", err.message);
        return { allowed: true, retryAfterSec: 0 };
    }
};
