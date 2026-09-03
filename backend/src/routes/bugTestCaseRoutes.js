const express = require("express");

const {
  createTestCase,
  getTestCases,
} = require("../controllers/bugTestCaseController");

const protect = require("../middleware/authMiddleware");

const router = express.Router();

// Create a test case for a bug
router.post("/:id/test-cases", protect, createTestCase);

// Get test cases for a bug
router.get("/:id/test-cases", protect, getTestCases);

module.exports = router;