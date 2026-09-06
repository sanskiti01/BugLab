const express = require("express");

const {
  createTestCase,
  getTestCases,
} = require("../controllers/bugTestCaseController");

const protect = require("../middleware/authMiddleware");
const adminOnly = require("../middleware/adminMiddleware");

const router = express.Router();

router.post("/:id/test-cases", protect, adminOnly, createTestCase);
router.get("/:id/test-cases", protect, getTestCases);

module.exports = router;