// One-time backfill: add embeddings to existing messages that don't have one yet.
// Safe to re-run — it only touches messages with text and no embedding.
//   Run from the backend/ dir:  node scripts/backfill-embeddings.js
import { config } from "dotenv";
config();

import mongoose from "mongoose";
import { connectDB } from "../src/lib/db.js";
import Message from "../src/models/message.model.js";
import { getEmbedding } from "../src/services/embedding.js";

await connectDB();

const filter = {
    text: { $exists: true, $nin: [null, ""] },
    $or: [{ embedding: { $exists: false } }, { embedding: { $size: 0 } }],
};

const total = await Message.countDocuments(filter);
console.log(`Found ${total} message(s) needing an embedding.`);

let done = 0;
const cursor = Message.find(filter).cursor();
for (let msg = await cursor.next(); msg != null; msg = await cursor.next()) {
    try {
        msg.embedding = await getEmbedding(msg.text);
        await msg.save();
        done++;
        if (done % 10 === 0 || done === total) {
            console.log(`Embedded ${done}/${total}`);
        }
    } catch (err) {
        console.error(`Failed on message ${msg._id}:`, err.message);
    }
}

console.log(`Backfill complete. Embedded ${done}/${total} messages.`);
await mongoose.disconnect();
process.exit(0);
