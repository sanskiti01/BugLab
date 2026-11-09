const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { createBugSubmissionHandler } = require("./bugSubmissionController");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const createBugAttempt = createBugSubmissionHandler(prisma);

const getUserAttemptHistory = async (req, res) => {
  try {
    const attempts = await prisma.bugAttempt.findMany({
      where: {
        userId: req.user.id,
      },
      include: {
        bug: {
          select: {
            id: true,
            title: true,
            difficulty: true,
            language: true,
            topic: true,
          },
        },
        user: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      count: attempts.length,
      attempts,
    });
  } catch (error) {
    console.error("Get attempt history error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const getUserAttemptHistoryWithJoin = async (req, res) => {
  try {
    const attempts = await prisma.$queryRaw`
      SELECT
        ba.id AS "attemptId",
        ba."userId",
        ba."bugId",
        ba.status,
        ba."hintsUsed",
        ba."timeSpent",
        ba."createdAt",
        ba."submittedSolution",

        u.username,
        u.email,

        b.title AS "bugTitle",
        b.difficulty,
        b.language,
        b.topic

      FROM "BugAttempt" AS ba

      INNER JOIN "User" AS u
        ON ba."userId" = u.id

      INNER JOIN "Bug" AS b
        ON ba."bugId" = b.id

      WHERE ba."userId" = ${req.user.id}

      ORDER BY ba."createdAt" DESC
    `;

    return res.status(200).json({
      count: attempts.length,
      attempts,
    });
  } catch (error) {
    console.error("SQL JOIN attempt history error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};
const getFilteredAttempts = async (req, res) => {
  try {
    const { status } = req.query;

    if (status !== "FAILED" && status !== "PASSED") {
      return res.status(400).json({
        message: "Status must be FAILED or PASSED",
      });
    }

    const attempts = await prisma.bugAttempt.findMany({
      where: {
        userId: req.user.id,
        status: status,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      count: attempts.length,
      status,
      attempts,
    });
  } catch (error) {
    console.error("Filter attempts error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

const getAttemptStats = async (req, res) => {
  try {
    const stats = await prisma.$queryRaw`
      SELECT
        status,
        COUNT(*)::int AS count
      FROM "BugAttempt"
      WHERE "userId" = ${req.user.id}
      GROUP BY status
      ORDER BY status
    `;

    return res.status(200).json({
      stats,
    });
  } catch (error) {
    console.error("Attempt stats error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

module.exports = {
  createBugAttempt,
  getUserAttemptHistory,
  getUserAttemptHistoryWithJoin,
  getFilteredAttempts,
  getAttemptStats,
};