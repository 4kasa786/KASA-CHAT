import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    text: {
        type: String,
    },
    image: {
        type: String,
    },
    isBot: {
        type: Boolean,
        default: false,
    },
    conversationWith: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
    },
    // 384-dim sentence embedding (all-MiniLM-L6-v2). Absent for image-only messages.
    // Used by semantic search (Phase 5) via MongoDB Atlas $vectorSearch.
    embedding: {
        type: [Number],
        default: undefined,
    },
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

export default Message;