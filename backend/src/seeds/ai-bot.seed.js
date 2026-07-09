import bcrypt from "bcryptjs";
import crypto from "crypto";
import User from "../models/user.model.js";

const BOT_EMAIL = "bot@kasa.local";
const BOT_FULL_NAME = "AI Bot";
const BOT_PROFILE_PIC =
    "https://api.dicebear.com/7.x/bottts/svg?seed=kasa-ai-bot";

let cachedBotId = null;

export const seedAIBot = async () => {
    const existing = await User.findOne({ email: BOT_EMAIL });
    if (existing) {
        cachedBotId = existing._id;
        if (!existing.isBot) {
            existing.isBot = true;
            await existing.save();
        }
        console.log(`AI Bot ready: ${cachedBotId}`);
        return cachedBotId;
    }

    const unguessable = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(unguessable, 10);

    const bot = await User.create({
        email: BOT_EMAIL,
        fullName: BOT_FULL_NAME,
        password: passwordHash,
        profilePic: BOT_PROFILE_PIC,
        isBot: true,
    });

    cachedBotId = bot._id;
    console.log(`AI Bot created: ${cachedBotId}`);
    return cachedBotId;
};

export const getAIBotId = () => {
    if (!cachedBotId) {
        throw new Error("AI Bot id not initialized. Call seedAIBot() on boot.");
    }
    return cachedBotId;
};
