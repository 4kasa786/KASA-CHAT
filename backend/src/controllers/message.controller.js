import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import { getAIReply } from "../services/ai.js";
import { getEmbedding } from "../services/embedding.js";
import { checkAiRateLimit } from "../services/rateLimit.js";
import { getAIBotId } from "../seeds/ai-bot.seed.js";
import cloudinary from "../lib/cloudinary.js";
import { getReceiverSocketId, io } from "../lib/socket.js";

export const getUsersForSidebar = async (req, res) => {
    try {
        const loggedInUserId = req.user._id;
        const filteredUsers = await User.find({ _id: { $ne: loggedInUserId } }).select("-password");

        res.status(200).json(filteredUsers);
    } catch (error) {
        console.error("Error in getUsersForSidebar: ", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const getMessages = async (req, res) => {
    try {
        const { id: userToChatId } = req.params;
        const myId = req.user._id;

        const messages = await Message.find({
            $or: [
                { senderId: myId, receiverId: userToChatId },
                { senderId: userToChatId, receiverId: myId },
                { isBot: true, receiverId: myId, conversationWith: userToChatId },
            ],
        });

        res.status(200).json(messages);
    } catch (error) {
        console.log("Error in getMessages controller: ", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
};

export const sendMessage = async (req, res) => {
    try {
        const { text, image } = req.body;
        const { id: receiverId } = req.params;
        const senderId = req.user._id;

        let imageUrl;
        if (image) {
            // Upload base64 image to cloudinary
            const uploadResponse = await cloudinary.uploader.upload(image);
            imageUrl = uploadResponse.secure_url;
        }

        const newMessage = new Message({
            senderId,
            receiverId,
            text,
            image: imageUrl,
        });

        // Embed text inline so the message is searchable (Phase 5). ~50ms once warm.
        // Image-only messages have no text to embed. Never block the send on this.
        if (text) {
            try {
                newMessage.embedding = await getEmbedding(text);
            } catch (err) {
                console.error("Embedding failed for user message:", err.message);
            }
        }

        await newMessage.save();

        const receiverSocketId = getReceiverSocketId(receiverId);
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("newMessage", newMessage);
        }

        // Respond immediately so the sender sees their message without waiting for Gemini
        res.status(201).json(newMessage);

        if (text && text.trimStart().toLowerCase().startsWith("@ai")) {
            (async () => {
                let botReplyText;

                // Per-user sliding-window rate limit (5 @ai calls/min). On reject,
                // post a friendly bot message and skip history + Gemini entirely.
                const { allowed, retryAfterSec } = await checkAiRateLimit(senderId);
                if (!allowed) {
                    botReplyText = `You're messaging @ai too fast — please slow down and try again in ${retryAfterSec} second${retryAfterSec === 1 ? "" : "s"}.`;
                    const botMessage = new Message({
                        senderId: getAIBotId(),
                        receiverId: senderId,
                        text: botReplyText,
                        isBot: true,
                        conversationWith: receiverId,
                    });
                    await botMessage.save();
                    const senderSock = getReceiverSocketId(senderId);
                    if (senderSock) io.to(senderSock).emit("newMessage", botMessage);
                    const receiverSock = getReceiverSocketId(receiverId);
                    if (receiverSock) io.to(receiverSock).emit("newMessage", botMessage);
                    return;
                }

                try {
                    // Fetch the last 20 messages of this DM for context — same 3-clause
                    // filter as getMessages, minus the message that just triggered the bot.
                    const recent = await Message.find({
                        _id: { $ne: newMessage._id },
                        $or: [
                            { senderId, receiverId },
                            { senderId: receiverId, receiverId: senderId },
                            { isBot: true, receiverId: senderId, conversationWith: receiverId },
                        ],
                    })
                        .sort({ createdAt: -1 })
                        .limit(20)
                        .lean();
                    recent.reverse(); // newest-first query → back to chronological order

                    // Label each line so Gemini knows who said what (sender / receiver / AI).
                    const receiver = await User.findById(receiverId).select("fullName");
                    const senderName = req.user.fullName;
                    const receiverName = receiver?.fullName || "User";
                    const history = recent.map((m) => ({
                        name: m.isBot
                            ? "AI"
                            : String(m.senderId) === String(senderId)
                                ? senderName
                                : receiverName,
                        text: m.text,
                    }));

                    const prompt = text.trim().replace(/^@ai\s*/i, "").trim();
                    botReplyText = await getAIReply(prompt, history);
                } catch (err) {
                    console.error("Gemini API error:", err);
                    botReplyText = err.message?.includes("429")
                        ? "I'm getting too many requests right now. Please try again in a minute."
                        : "Sorry, I couldn't process that. Please try again.";
                }
                const botMessage = new Message({
                    senderId: getAIBotId(),
                    receiverId: senderId,
                    text: botReplyText,
                    isBot: true,
                    conversationWith: receiverId,
                });

                // Embed the bot reply too, so it's searchable like any other message.
                if (botReplyText) {
                    try {
                        botMessage.embedding = await getEmbedding(botReplyText);
                    } catch (err) {
                        console.error("Embedding failed for bot message:", err.message);
                    }
                }

                await botMessage.save();

                const senderSocketId = getReceiverSocketId(senderId);
                if (senderSocketId) io.to(senderSocketId).emit("newMessage", botMessage);
                if (receiverSocketId) io.to(receiverSocketId).emit("newMessage", botMessage);
            })();
        }
    } catch (error) {
        console.log("Error in sendMessage controller: ", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
};