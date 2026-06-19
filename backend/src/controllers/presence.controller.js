import { getPresence } from "../services/presence.js";

// GET /api/presence → { online: [...userIds], lastSeen: { userId: ts } }
export const getPresenceHandler = async (req, res) => {
    try {
        const presence = await getPresence();
        res.status(200).json(presence);
    } catch (error) {
        console.error("Error in getPresence controller:", error.message);
        res.status(500).json({ error: "Internal server error" });
    }
};
