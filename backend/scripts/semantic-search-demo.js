// Manual semantic-search demo — a preview of Phase 5, with no Atlas index needed.
// Embeds your query, compares it against every stored message embedding using
// cosine similarity (dot product, since vectors are normalized), and prints the
// closest matches by MEANING — not keyword.
//
//   Run from backend/:  node scripts/semantic-search-demo.js "your search text"
import { config } from "dotenv";
config();

import mongoose from "mongoose";
import { connectDB } from "../src/lib/db.js";
import Message from "../src/models/message.model.js";
import { getEmbedding } from "../src/services/embedding.js";

const query = process.argv.slice(2).join(" ") || "hello";
const TOP_N = 5;

await connectDB();

const queryVec = await getEmbedding(query);
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

const messages = await Message.find({
    embedding: { $exists: true, $not: { $size: 0 } },
    text: { $nin: [null, ""] },
}).select("text embedding").lean();

const ranked = messages
    .map((m) => ({ text: m.text, score: dot(queryVec, m.embedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_N);

console.log(`\nQuery: "${query}"  (searched ${messages.length} messages by meaning)\n`);
ranked.forEach((r, i) => {
    console.log(`  ${i + 1}. [${r.score.toFixed(3)}]  ${r.text.slice(0, 80)}`);
});

await mongoose.disconnect();
process.exit(0);
