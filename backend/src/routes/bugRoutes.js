const express = require("express");

const {
  createBug,
  getBugs,
  getBugById,
  updateBug,
  deleteBug,
} = require("../controllers/bugController");

const protect = require("../middleware/authMiddleware");
const adminOnly = require("../middleware/adminMiddleware");

const router = express.Router();

router.post("/", protect, adminOnly, createBug);

router.get("/", protect, getBugs);

router.get("/:id", protect, getBugById);

router.put("/:id", protect, adminOnly, updateBug);

router.delete("/:id", protect, adminOnly, deleteBug);

module.exports = router;