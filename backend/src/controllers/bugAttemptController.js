const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

// =========================
// CREATE BUG ATTEMPT
// =========================
const createBugAttempt = async (req, res) => {
  try {
    const bugId = Number(req.params.id);

    const {
      submittedSolution,
      hintsUsed,
      timeSpent,
    } = req.body;
    // Validate submitted solution
if (
  typeof submittedSolution !== "string" ||
  submittedSolution.trim() === ""
) {
  return res.status(400).json({
    message: "Submitted solution is required",
  });
}
if (
  hintsUsed !== undefined &&
  (typeof hintsUsed !== "number" || hintsUsed < 0)
) {
  return res.status(400).json({
    message: "hintsUsed must be a non-negative number",
  });
}

if (
  timeSpent !== undefined &&
  (typeof timeSpent !== "number" || timeSpent < 0)
) {
  return res.status(400).json({
    message: "timeSpent must be a non-negative number",
  });
}

    // Validate bug ID
    if (Number.isNaN(bugId)) {
      return res.status(400).json({
        message: "Invalid bug ID",
      });
    }

    // Check that bug exists
    const bug = await prisma.bug.findUnique({
      where: {
        id: bugId,
      },
    });

    if (!bug) {
      return res.status(404).json({
        message: "Bug not found",
      });
    }
    const attempt = await prisma.bugAttempt.create({
      data: {
        userId: req.user.id,
        bugId,
        submittedSolution: submittedSolution || null,
        status: "FAILED",
        hintsUsed: hintsUsed || 0,
        timeSpent: timeSpent || 0,
      },
    });

    return res.status(201).json({
      message: "Bug attempt recorded successfully",
      attempt,
    });
  } catch (error) {
    console.error("Create bug attempt error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

module.exports = {
  createBugAttempt,
};