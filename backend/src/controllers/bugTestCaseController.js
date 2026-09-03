const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

// CREATE TEST CASE
const createTestCase = async (req, res) => {
  try {
    const bugId = Number(req.params.id);

    const {
      input,
      expectedOutput,
      isHidden,
    } = req.body;

    // Validate bug ID
    if (Number.isNaN(bugId)) {
      return res.status(400).json({
        message: "Invalid bug ID",
      });
    }

    // Validate required fields
    if (!input || !expectedOutput) {
      return res.status(400).json({
        message: "Input and expected output are required",
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

    // Create test case
    const testCase = await prisma.bugTestCase.create({
      data: {
        bugId,
        input,
        expectedOutput,
        isHidden: isHidden || false,
      },
    });

    return res.status(201).json({
      message: "Test case created successfully",
      testCase,
    });
  } catch (error) {
    console.error("Create test case error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};
// GET TEST CASES FOR A BUG
const getTestCases = async (req, res) => {
  try {
    const bugId = Number(req.params.id);

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

    // Get test cases
    const testCases = await prisma.bugTestCase.findMany({
  where: {
    bugId,
  },
  orderBy: {
    id: "asc",
  },
  select: {
    id: true,
    bugId: true,
    input: true,
    expectedOutput: true,
    isHidden: true,
  },
});

const safeTestCases = testCases.map((testCase) => {
  if (testCase.isHidden) {
    return {
      id: testCase.id,
      bugId: testCase.bugId,
      input: testCase.input,
      isHidden: true,
    };
  }

  return testCase;
});

    return res.status(200).json({
      count: safeTestCases.length,
      testCases: safeTestCases,
  });
  } catch (error) {
    console.error("Get test cases error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

module.exports = {
  createTestCase,
  getTestCases,
};
