const express = require("express");

const {
  createBugAttempt,
  getUserAttemptHistory,
  getUserAttemptHistoryWithJoin,
} = require("../controllers/bugAttemptController");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/attempts/history", protect, getUserAttemptHistory);

router.get(
  "/attempts/history/join",
  protect,
  getUserAttemptHistoryWithJoin
);

router.post("/:id/attempt", protect, createBugAttempt);

module.exports = router;