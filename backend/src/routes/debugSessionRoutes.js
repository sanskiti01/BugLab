const express = require("express");

const {
  createDebugSession,
  getDebugSessions,
  updateDebugSession,
  deleteDebugSession,
  getDebugSessionStats,
} = require("../controllers/debugSessionController");

const router = express.Router();

router.post("/", createDebugSession);
router.get("/", getDebugSessions);
router.get("/stats", getDebugSessionStats);
router.put("/:id", updateDebugSession);
router.delete("/:id", deleteDebugSession);

module.exports = router;