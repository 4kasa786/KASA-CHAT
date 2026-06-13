import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { searchMessages } from "../controllers/search.controller.js";

const router = express.Router();

// Protected: only a logged-in user can search, and only their own messages.
router.post("/", protectRoute, searchMessages);

export default router;
