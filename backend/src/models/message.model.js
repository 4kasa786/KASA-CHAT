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
    }
}, { timestamps: true });

const Message = mongoose.model('Message', messageSchema);

export default Message;