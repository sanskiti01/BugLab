const express = require("express");

const {
  createBugAttempt,
  getUserAttemptHistory,
  getUserAttemptHistoryWithJoin,
  getFilteredAttempts,
  getAttemptStats,
} = require("../controllers/bugAttemptController");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/attempts/history", protect, getUserAttemptHistory);

router.get(
  "/attempts/history/join",
  protect,
  getUserAttemptHistoryWithJoin
);

router.get("/attempts/filter", protect, getFilteredAttempts);
router.get("/attempts/stats", protect, getAttemptStats);
router.post("/:id/attempt", protect, createBugAttempt);

module.exports = router;