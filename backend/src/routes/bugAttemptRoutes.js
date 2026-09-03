const express = require("express");

const {
  createBugAttempt,
} = require("../controllers/bugAttemptController");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/:id/attempt", protect, createBugAttempt);

module.exports = router;