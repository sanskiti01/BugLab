const express = require("express");

const {
  createBug,
  getBugs,
  getBugById,
  updateBug,
} = require("../controllers/bugController");

const protect = require("../middleware/authMiddleware");
const adminOnly = require("../middleware/adminMiddleware");

const router = express.Router();

// Create a bug
router.post("/", protect, adminOnly, createBug);

// Get all bugs
router.get("/", protect, getBugs);

// Get one bug
router.get("/:id", protect, getBugById);

// Update a bug
router.put("/:id", protect, adminOnly, updateBug);

module.exports = router;