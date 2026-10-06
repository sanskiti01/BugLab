const express = require("express");

const {
  createDebugSession,
  getDebugSessions,
  updateDebugSession,
  deleteDebugSession,
} = require("../controllers/debugSessionController");

const router = express.Router();

router.post("/", createDebugSession);
router.get("/", getDebugSessions);
router.put("/:id", updateDebugSession);
router.delete("/:id", deleteDebugSession);

module.exports = router;