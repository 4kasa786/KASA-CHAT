import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import authRoutes from "./routes/auth.route.js";
import messageRoutes from "./routes/message.route.js";
import searchRoutes from "./routes/search.route.js";
import presenceRoutes from "./routes/presence.route.js";
import { connectDB } from './lib/db.js';
import { seedAIBot } from './seeds/ai-bot.seed.js';
import { warmUpEmbeddings } from './services/embedding.js';
import cors from 'cors';
import { app, server } from './lib/socket.js';
import path from 'path';

dotenv.config();

const port = process.env.PORT
const __dirname = path.resolve();

app.use(express.json({ limit: '50mb' })); // increase JSON body size limit
app.use(cookieParser());
app.use(cors({
    origin: "http://localhost:5173",
    credentials: true,
}))

app.use('/api/auth', authRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/presence', presenceRoutes);

if (process.env.NODE_ENV === "production") {
    app.use(express.static(path.join(__dirname, "../frontend/dist")));

    app.get(/.*/, (req, res) => {
        res.sendFile(path.join(__dirname, "../frontend", "dist", "index.html"))
    })
}

server.listen(port, async () => {
    console.log("Server is running on port " + port);
    await connectDB();
    await seedAIBot();
    const warmMs = await warmUpEmbeddings();
    console.log(`Embedding model warmed up in ${warmMs}ms`);
})