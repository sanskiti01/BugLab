const express = require("express");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const {
  createSubmissionStatusHandlers,
} = require("../controllers/bugSubmissionController");
const {
  recoverStaleSubmissions,
} = require("../services/codeSubmissionWorker");
const protect = require("../middleware/authMiddleware");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });
const handlers = createSubmissionStatusHandlers(prisma);
const router = express.Router();
const recoveryTimer = setInterval(() => {
  recoverStaleSubmissions(prisma).catch((error) => {
    console.error("Stale submission recovery failed", {
      errorName: error?.name || "Error",
    });
  });
}, 10_000);
recoveryTimer.unref();

router.use(protect);
router.get("/by-key/:key", handlers.getByKey);
router.get("/:id", handlers.getById);

module.exports = router;
