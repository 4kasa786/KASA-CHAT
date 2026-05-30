import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import { getAIReply } from "../services/ai.js";
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
                try {
                    const prompt = text.replace(/^@ai\s*/i, "").trim();
                    botReplyText = await getAIReply(prompt);
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