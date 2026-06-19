import Redis from "ioredis";
import crypto from "crypto";

// Dedicated Redis for Kasa (port 6380 — 6379 is taken by another project).
// commandTimeout bounds every get/set: commands wait briefly for the initial
// connect, but if Redis is down they reject within 1s so the caller falls back
// to Gemini instead of hanging.
const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6380", {
    maxRetriesPerRequest: 2,
    commandTimeout: 1000,
});

redis.on("connect", () => console.log("Redis connected"));
redis.on("error", (err) => console.error("Redis error:", err.message));

// Normalize so trivially-different questions share one cache entry:
// lowercase → strip leading "@ai" → collapse whitespace → trim.
export const normalizeQuestion = (text = "") =>
    text
        .toLowerCase()
        .replace(/^@ai\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();

// SHA-256 of the normalized question → fixed-length, clean, namespaced key.
const keyFor = (text) =>
    "ai:cache:" +
    crypto.createHash("sha256").update(normalizeQuestion(text)).digest("hex");

export const getCachedAnswer = async (text) => {
    try {
        return await redis.get(keyFor(text));
    } catch (err) {
        console.error("Cache get failed (falling back to Gemini):", err.message);
        return null;
    }
};

export const setCachedAnswer = async (text, answer, ttlSec = 3600) => {
    try {
        await redis.set(keyFor(text), answer, "EX", ttlSec); // 1-hour TTL
    } catch (err) {
        console.error("Cache set failed (ignored):", err.message);
    }
};
