const express = require("express");

const {
  createBugAttempt,
  getUserAttemptHistory,
} = require("../controllers/bugAttemptController");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/attempts/history", protect, getUserAttemptHistory);

router.post("/:id/attempt", protect, createBugAttempt);

module.exports = router;