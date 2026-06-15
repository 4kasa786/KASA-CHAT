import mongoose from "mongoose";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { getEmbedding } from "../services/embedding.js";
import { getGroundedAnswer } from "../services/ai.js";

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
                    score: { $meta: "vectorSearchScore" },
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

        const queryVector = await getEmbedding(question);

        // Retrieve top-5 relevant messages from THIS DM pair only (both directions).
        const sources = await Message.aggregate([
            {
                $vectorSearch: {
                    index: "vector_index",
                    path: "embedding",
                    queryVector,
                    numCandidates: 100,
                    limit: 5,
                    filter: {
                        $and: [
                            { senderId: { $in: [meObjId, otherObjId] } },
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

        // Label each source's speaker so the grounded prompt knows who said what.
        const otherUser = await User.findById(otherUserId).select("fullName");
        const labeledSources = sources.map((s) => ({
            ...s,
            senderName:
                String(s.senderId) === String(myId)
                    ? req.user.fullName
                    : otherUser?.fullName || "Them",
        }));

        const answer = await getGroundedAnswer(question, labeledSources);

        res.status(200).json({ answer, sources: labeledSources });
    } catch (error) {
        console.error("Error in askAboutChat controller:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
};
