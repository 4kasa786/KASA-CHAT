import mongoose from "mongoose";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { getEmbedding } from "../services/embedding.js";
import { streamGroundedAnswer } from "../services/ai.js";
import { getAIBotId } from "../seeds/ai-bot.seed.js";

// POST /api/search  { query: "..." }
// Semantic search over the logged-in user's messages via MongoDB Atlas $vectorSearch.
export const searchMessages = async (req, res) => {
    try {
        const { query } = req.body;
        const myId = req.user._id;

        if (!query || !query.trim()) {
            return res.status(400).json({ error: "Query text is required" });
        }

        // Embed the query the SAME way messages were embedded (Phase 4), so the
        // query vector lives in the same 384-dim space as the stored vectors.
        const queryVector = await getEmbedding(query);

        const results = await Message.aggregate([
            {
                $vectorSearch: {
                    index: "vector_index",       // the Atlas index we created
                    path: "embedding",           // field holding the stored vectors
                    queryVector,                 // the query as a 384-dim vector
                    numCandidates: 100,          // ANN explores 100, returns the best `limit` (recall vs speed dial)
                    limit: 5,                    // top 5 matches
                    // Scope to MY conversations only — uses the index's filter fields.
                    filter: {
                        $or: [{ senderId: myId }, { receiverId: myId }],
                    },
                },
            },
            {
                // Return useful fields + the similarity score; never ship the raw 384-num vector.
                $project: {
                    text: 1,
                    senderId: 1,
                    receiverId: 1,
                    isBot: 1,
                    conversationWith: 1,
                    createdAt: 1,
                    score: { $meta: "vectorSearchScore" }
                },
            },
        ]);

        res.status(200).json(results);
    } catch (error) {
        console.error("Error in searchMessages controller:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
};

// POST /api/search/ask  { question, userId }
// RAG over the CURRENT DM pair: retrieve top-K relevant messages between me and
// `userId`, then have Gemini answer grounded only in those, with citations.
export const askAboutChat = async (req, res) => {
    try {
        const { question, userId: otherUserId } = req.body;
        const myId = req.user._id;

        if (!question || !question.trim()) {
            return res.status(400).json({ error: "Question is required" });
        }
        if (!otherUserId) {
            return res.status(400).json({ error: "Conversation user is required" });
        }

        const meObjId = new mongoose.Types.ObjectId(myId);
        const otherObjId = new mongoose.Types.ObjectId(otherUserId);
        const botObjId = getAIBotId();

        const queryVector = await getEmbedding(question);

        // Retrieve candidates from THIS DM INCLUDING the @ai bot's replies. Bot
        // replies have senderId = bot, so add the bot to the sender set and pull
        // extra candidates, then narrow to this exact conversation in code below.
        const candidates = await Message.aggregate([
            {
                $vectorSearch: {
                    index: "vector_index",
                    path: "embedding",
                    queryVector,
                    numCandidates: 150,
                    limit: 20,
                    filter: {
                        $and: [
                            { senderId: { $in: [meObjId, otherObjId, botObjId] } },
                            { receiverId: { $in: [meObjId, otherObjId] } },
                        ],
                    },
                },
            },
            {
                $project: {
                    text: 1,
                    senderId: 1,
                    receiverId: 1,
                    isBot: 1,
                    conversationWith: 1,
                    createdAt: 1,
                    score: { $meta: "vectorSearchScore" },
                },
            },
        ]);

        // Human↔human is already scoped by the filter. For bot replies, keep only
        // those whose conversationWith is me/other (drops bot replies from my OTHER chats).
        const inThisDm = candidates.filter((s) => {
            if (!s.isBot) return true;
            const cw = String(s.conversationWith);
            return cw === String(myId) || cw === String(otherUserId);
        });

        // Drop weak matches, then keep the top 5. If nothing clears the floor, the
        // question isn't answerable from this chat — short-circuit gracefully below.
        const MIN_RELEVANCE = 0.3;
        const relevant = inThisDm.filter((s) => s.score >= MIN_RELEVANCE).slice(0, 5);

        // Label speakers (bot lines as "AI") before streaming starts.
        let labeledSources = [];
        if (relevant.length > 0) {
            const otherUser = await User.findById(otherUserId).select("fullName");
            labeledSources = relevant.map((s) => ({
                ...s,
                senderName: s.isBot
                    ? "AI"
                    : String(s.senderId) === String(myId)
                        ? req.user.fullName
                        : otherUser?.fullName || "Them",
            }));
        }

        // Stream the answer over Server-Sent Events.
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders?.();
        const send = (event, data) =>
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

        // Sources first, so the UI can render citation cards immediately.
        send("sources", labeledSources);

        // Nothing relevant → graceful canned reply, no Gemini call.
        if (labeledSources.length === 0) {
            send("chunk", {
                text: "I couldn't find anything relevant in this conversation to answer that.",
            });
            send("done", {});
            return res.end();
        }

        const stream = await streamGroundedAnswer(question, labeledSources);
        for await (const chunk of stream) {
            const text = chunk.text();
            if (text) send("chunk", { text });
        }
        send("done", {});
        res.end();
    } catch (error) {
        console.error("Error in askAboutChat controller:", error.message);
        const friendly = error.message?.includes("429")
            ? "The AI is rate-limited right now. Please try again in a minute."
            : "Something went wrong getting an answer. Please try again.";
        // If we've already started streaming, report the error over SSE; otherwise JSON.
        if (res.headersSent) {
            res.write(`event: error\ndata: ${JSON.stringify({ error: friendly })}\n\n`);
            res.end();
        } else {
            res.status(500).json({ error: friendly });
        }
    }
};
