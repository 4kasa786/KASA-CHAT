import { Server } from 'socket.io';
import http from 'http';
import express from 'express';
import { markSeen, markOffline, getOnlineUserIds } from '../services/presence.js';

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: ["http://localhost:5173"],
    }
})

// LOCAL socket registry — used ONLY for message routing (which socket to emit
// to on this process). Socket IDs are process-local, so this can't move to
// Redis without the Socket.IO Redis adapter (out of scope). Presence (who's
// online) DOES live in Redis — see services/presence.js.
const userSocketMap = {}; // { userId: socketId }

export function getReceiverSocketId(userId) {
    return userSocketMap[userId];
}

// Compute the online list from Redis and push it to everyone.
const broadcastOnline = async () => {
    const online = await getOnlineUserIds();
    io.emit("getOnlineUsers", online);
};

io.on("connection", async (socket) => {
    console.log("A user connected:", socket.id);

    const userId = socket.handshake.query.userId;
    if (userId) {
        userSocketMap[userId] = socket.id; // local routing
        await markSeen(userId);            // Redis presence
    }
    await broadcastOnline();

    // Client heartbeat (~every 30s) refreshes the Redis liveness window.
    socket.on("heartbeat", async () => {
        if (userId) await markSeen(userId);
    });

    socket.on("disconnect", async () => {
        console.log("A user disconnected:", socket.id);
        if (userId) {
            delete userSocketMap[userId];
            await markOffline(userId);
        }
        await broadcastOnline();
    });
});

// Periodic sweep so zombies dropping off (heartbeat TTL lapse) also update
// everyone's green dots — no disconnect event fires for those.
setInterval(() => {
    broadcastOnline().catch(() => {});
}, 20_000);

export { io, app, server };
