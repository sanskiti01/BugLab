
const express = require("express");

const {
  createDebugSession,
  getDebugSessions,
  getDebugSession,
  updateDebugSession,
  deleteDebugSession,
  getDebugSessionStats,
  getDebugSessionIndexStats,
} = require("../controllers/debugSessionController");

const protect = require("../middleware/authMiddleware");
const router = express.Router();

router.use(protect);

router.post("/", createDebugSession);
router.get("/", getDebugSessions);
router.get("/stats", getDebugSessionStats);
router.get("/index-stats", getDebugSessionIndexStats);
router.get("/:id", getDebugSession);
router.put("/:id", updateDebugSession);
router.delete("/:id", deleteDebugSession);

module.exports = router;
