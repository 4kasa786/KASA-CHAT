import { redis } from "../lib/redis.js";

// Sorted set: member = userId, score = last-heartbeat timestamp (ms).
// "Online" = heartbeat within STALE_MS. This gives per-user liveness (zombies
// age out by score — no per-member TTL, which Redis sets can't do) AND
// "last seen" for free. Reuses the Phase 9 sorted-set idea.
const HEARTBEATS_KEY = "presence:heartbeats";
const LASTSEEN_KEY = "presence:lastseen"; // hash: userId -> ts
const STALE_MS = 35_000; // slightly > the 30s client heartbeat interval

// Record a heartbeat / mark online.
export const markSeen = async (userId) => {
    try {
        const now = Date.now();
        await redis.zadd(HEARTBEATS_KEY, now, String(userId));
        await redis.hset(LASTSEEN_KEY, String(userId), now);
    } catch (err) {
        console.error("presence markSeen failed:", err.message);
    }
};

// Clean disconnect → immediately offline, but remember when.
export const markOffline = async (userId) => {
    try {
        await redis.zrem(HEARTBEATS_KEY, String(userId));
        await redis.hset(LASTSEEN_KEY, String(userId), Date.now());
    } catch (err) {
        console.error("presence markOffline failed:", err.message);
    }
};

// User IDs whose last heartbeat is within the staleness window.
export const getOnlineUserIds = async () => {
    try {
        const cutoff = Date.now() - STALE_MS;
        return await redis.zrangebyscore(HEARTBEATS_KEY, cutoff, "+inf");
    } catch (err) {
        console.error("presence getOnline failed:", err.message);
        return []; // degrade: appear empty rather than crash
    }
};

// { online: [...ids], lastSeen: { id: tsString } } for GET /api/presence.
export const getPresence = async () => {
    try {
        const [online, lastSeen] = await Promise.all([
            getOnlineUserIds(),
            redis.hgetall(LASTSEEN_KEY),
        ]);
        return { online, lastSeen };
    } catch (err) {
        console.error("presence getPresence failed:", err.message);
        return { online: [], lastSeen: {} };
    }
};
