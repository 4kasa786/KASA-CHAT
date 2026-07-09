import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { getPresenceHandler } from "../controllers/presence.controller.js";

const router = express.Router();

router.get("/", protectRoute, getPresenceHandler);

export default router;
