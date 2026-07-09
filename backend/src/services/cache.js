import crypto from "crypto";
import { redis } from "../lib/redis.js";

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
