import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { searchMessages, askAboutChat } from "../controllers/search.controller.js";

const router = express.Router();

// Protected: only a logged-in user can search, and only their own messages.
router.post("/", protectRoute, searchMessages);

// RAG Q&A over the current DM pair (Phase 7).
router.post("/ask", protectRoute, askAboutChat);

export default router;
