const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

// =========================
// CREATE BUG
// =========================
const createBug = async (req, res) => {
  try {
    const {
      title,
      description,
      difficulty,
      language,
      topic,
    } = req.body;

    // Validate required fields
    if (!title || !description || !language || !topic) {
      return res.status(400).json({
        message: "Title, description, language and topic are required",
      });
    }

    // Create bug
    const bug = await prisma.bug.create({
      data: {
        title,
        description,
        difficulty: difficulty || "EASY",
        language,
        topic,
      },
    });

    return res.status(201).json({
      message: "Bug created successfully",
      bug,
    });
  } catch (error) {
    console.error("Create bug error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

// =========================
// GET ALL BUGS
// =========================
const getBugs = async (req, res) => {
  try {
    const bugs = await prisma.bug.findMany({
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      count: bugs.length,
      bugs,
    });
  } catch (error) {
    console.error("Get bugs error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

// =========================
// GET BUG BY ID
// =========================
const getBugById = async (req, res) => {
  try {
    const id = Number(req.params.id);

    // Validate bug ID
    if (Number.isNaN(id)) {
      return res.status(400).json({
        message: "Invalid bug ID",
      });
    }

    // Find bug
    const bug = await prisma.bug.findUnique({
      where: {
        id,
      },
    });

    if (!bug) {
      return res.status(404).json({
        message: "Bug not found",
      });
    }

    return res.status(200).json({
      bug,
    });
  } catch (error) {
    console.error("Get bug error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

// =========================
// UPDATE BUG
// =========================
const updateBug = async (req, res) => {
  try {
    const bugId = Number(req.params.id);

    if (Number.isNaN(bugId)) {
      return res.status(400).json({
        message: "Invalid bug ID",
      });
    }

    const existingBug = await prisma.bug.findUnique({
      where: {
        id: bugId,
      },
    });

    if (!existingBug) {
      return res.status(404).json({
        message: "Bug not found",
      });
    }

    const {
      title,
      description,
      difficulty,
      language,
      topic,
    } = req.body;

    const updatedBug = await prisma.bug.update({
      where: {
        id: bugId,
      },
      data: {
        title: title ?? existingBug.title,
        description: description ?? existingBug.description,
        difficulty: difficulty ?? existingBug.difficulty,
        language: language ?? existingBug.language,
        topic: topic ?? existingBug.topic,
      },
    });

    return res.status(200).json({
      message: "Bug updated successfully",
      bug: updatedBug,
    });
  } catch (error) {
    console.error("Update bug error:", error);

    return res.status(500).json({
      message: "Server error",
    });
  }
};

// =========================
// EXPORTS
// =========================
module.exports = {
  createBug,
  getBugs,
  getBugById,
  updateBug,
};